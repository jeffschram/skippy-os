import { actorLabel, type Actor } from "@skippy/shared";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { describeFile, destroyFile, fileOnCapture, presentFile, recordFile } from "./files";
import { cleanText, iso, refuse } from "./lib/common";
import { findEntity, mention, requireEntity } from "./lib/entities";
import { actor, captureIntent, entityType } from "./schema";

/**
 * The inbox. A capture is something dropped in quickly, from the Home page or
 * from any chat, to be filed properly later: as a task, a note, a person. Until
 * then it waits here as "pending" and search can still find it.
 *
 * A "hold" capture is different: a private hand-off between the owner's own
 * devices. It is never filed, and it lapses after seven days.
 *
 * Internal: run through `gateway.call` or the web app's own functions.
 */

const MAX_TEXT = 4000;
const HOLD_MS = 7 * 86_400_000;
const WHOLE_URL = /^https?:\/\/\S+$/i;

/** A short name for a capture, for lists and the activity log. */
export function captureTitle(capture: Pick<Doc<"captures">, "text" | "url">, fileName?: string): string {
  const line = capture.text?.trim().split("\n")[0] || capture.url || fileName || "Empty capture";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/** `withLinks` adds a way to open the capture's file. Only the owner's own pages ask for it. */
export async function presentCapture(ctx: QueryCtx, capture: Doc<"captures">, withLinks = false) {
  const file = await fileOnCapture(ctx, capture._id);
  const results = [];
  for (const ref of capture.resultRefs ?? []) {
    const found = await findEntity(ctx, ref.entityType, ref.entityId);
    if (found) results.push(mention(found));
  }
  return {
    id: capture._id,
    text: capture.text,
    url: capture.url,
    file: file ? (withLinks ? await presentFile(ctx, file) : describeFile(file)) : undefined,
    intent: capture.intent,
    status: capture.status,
    by: actorLabel(capture.createdBy),
    at: iso(capture.createdAt),
    expiresAt: iso(capture.expiresAt),
    /** What it was filed as, once it has been. */
    results: results.length > 0 ? results : undefined,
    outcome: capture.outcome,
    processedBy: capture.processedBy ? actorLabel(capture.processedBy) : undefined,
  };
}

/** A capture is not a record others link to, so its lines in the activity log carry no entity. */
async function logCapture(ctx: MutationCtx, event: { activityType: string; actor: Actor; at: number; summary: string }) {
  await ctx.db.insert("activityEvents", event);
}

export const add = internalMutation({
  args: {
    actor,
    text: v.optional(v.string()),
    url: v.optional(v.string()),
    intent: v.optional(captureIntent),
    /** An upload to keep with the capture. Only the dashboard sends one. */
    file: v.optional(v.object({ storageId: v.id("_storage"), fileName: v.string() })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let text = cleanText(args.text) ?? undefined;
    let url = cleanText(args.url) ?? undefined;
    // A capture that is nothing but an address is a link.
    if (!url && text && WHOLE_URL.test(text)) {
      url = text;
      text = undefined;
    }
    if (!text && !url && !args.file) throw refuse("invalid_arguments", "Give some text, a url or a file to capture.");
    if ((text?.length ?? 0) > MAX_TEXT) throw refuse("invalid_arguments", `A capture holds up to ${MAX_TEXT} characters.`);
    if (url && !/^https?:\/\//i.test(url)) throw refuse("invalid_arguments", "url must start with http:// or https://.");
    const intent = args.intent ?? "remember";
    const id = await ctx.db.insert("captures", {
      ...(text ? { text } : {}),
      ...(url ? { url } : {}),
      intent,
      status: "pending",
      createdBy: args.actor,
      createdAt: now,
      ...(intent === "hold" ? { expiresAt: now + HOLD_MS } : {}),
    });
    const capture = (await ctx.db.get(id))!;
    const file = args.file ? await recordFile(ctx, { actor: args.actor, ...args.file, captureId: id }) : null;
    // A hold is private, so the log says only that one was made.
    await logCapture(ctx, {
      activityType: "capture.added",
      actor: args.actor,
      at: now,
      summary: intent === "hold" ? "Held something for seven days" : `Captured "${captureTitle(capture, file?.fileName)}"`,
    });
    return { capture: await presentCapture(ctx, capture) };
  },
});

/** Captures waiting to be filed, oldest first, so they are dealt with in the order they came. */
export async function listCaptures(
  ctx: QueryCtx,
  args: {
    status?: Doc<"captures">["status"];
    intent?: Doc<"captures">["intent"];
    limit?: number;
    now: number;
    withLinks?: boolean;
  },
) {
  const status = args.status ?? "pending";
  const intent = args.intent ?? "remember";
  const limit = Math.min(Math.max(Math.floor(args.limit ?? 25), 1), 100);
  const rows = await ctx.db
    .query("captures")
    .withIndex("by_status", (q) => q.eq("status", status))
    .order(status === "pending" ? "asc" : "desc")
    .take(500);
  const wanted = rows.filter(
    (row) => row.intent === intent && (row.expiresAt === undefined || row.expiresAt > args.now),
  );
  return {
    captures: await Promise.all(wanted.slice(0, limit).map((row) => presentCapture(ctx, row, args.withLinks))),
    more: wanted.length > limit,
  };
}

export const list = internalQuery({
  args: {
    status: v.optional(v.union(v.literal("pending"), v.literal("processed"), v.literal("discarded"))),
    intent: v.optional(captureIntent),
    limit: v.optional(v.number()),
  },
  handler: (ctx, args) => listCaptures(ctx, { ...args, now: Date.now() }),
});

/** Marks a capture as dealt with: filed as one or more records, or discarded. */
export const resolve = internalMutation({
  args: {
    actor,
    id: v.string(),
    outcome: v.union(v.literal("processed"), v.literal("discarded")),
    results: v.optional(v.array(v.object({ type: entityType, id: v.string() }))),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = ctx.db.normalizeId("captures", args.id);
    const capture = id ? await ctx.db.get(id) : null;
    if (!capture) throw refuse("not_found", `There is no capture with the id "${args.id}". Use list_captures to see them.`);
    // Dealing with the same capture twice changes nothing and logs nothing.
    if (capture.status !== "pending") return { changed: false, capture: await presentCapture(ctx, capture) };
    const results = await Promise.all(
      (args.results ?? []).map((target, index) => requireEntity(ctx, target, `results[${index}]`)),
    );
    if (args.outcome === "processed" && results.length === 0) {
      throw refuse("invalid_arguments", "Say what the capture was filed as in results, or discard it.");
    }
    const note = cleanText(args.note) ?? undefined;
    // A capture's file goes with it: onto the first record it became, or away when the owner discards it.
    const file = await fileOnCapture(ctx, capture._id);
    if (file && args.outcome === "discarded") {
      if (args.actor.kind !== "user") {
        throw refuse("owner_only", "That capture holds a file, and discarding it would delete the file. Leave it for the owner.");
      }
      await destroyFile(ctx, file);
    } else if (file) {
      await ctx.db.patch(file._id, { attachedTo: results[0].ref, captureId: undefined });
    }
    await ctx.db.patch(capture._id, {
      status: args.outcome,
      processedBy: args.actor,
      processedAt: now,
      ...(results.length > 0 ? { resultRefs: results.map((result) => result.ref) } : {}),
      ...(note ? { outcome: note } : {}),
    });
    const title = captureTitle(capture, file?.fileName);
    const filedAs = results.map((result) => `${result.ref.entityType} "${result.title}"`).join(", ");
    await logCapture(ctx, {
      activityType: args.outcome === "processed" ? "capture.filed" : "capture.discarded",
      actor: args.actor,
      at: now,
      summary:
        capture.intent === "hold"
          ? "Cleared a held capture"
          : args.outcome === "processed"
            ? `Filed capture "${title}" as ${filedAs}`
            : `Discarded capture "${title}"${note ? `: ${note}` : ""}`,
    });
    return { changed: true, capture: await presentCapture(ctx, (await ctx.db.get(capture._id))!) };
  },
});

/** Removes held captures whose seven days are up. Run daily by a cron. */
export const expireHolds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const lapsed = await ctx.db
      .query("captures")
      .withIndex("by_expiry", (q) => q.gt("expiresAt", 0).lt("expiresAt", Date.now()))
      .take(200);
    for (const row of lapsed) {
      const file = await fileOnCapture(ctx, row._id);
      if (file) await destroyFile(ctx, file);
      await ctx.db.delete(row._id);
    }
    return { removed: lapsed.length };
  },
});

/** Pending captures that hold every word of a search, newest first. Held ones are left out. */
export async function searchCaptures(ctx: QueryCtx, query: string, limit: number) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const pending = await ctx.db
    .query("captures")
    .withIndex("by_status", (q) => q.eq("status", "pending"))
    .order("desc")
    .take(300);
  const found = [];
  for (const row of pending) {
    if (row.intent !== "remember") continue;
    const fileName = (await fileOnCapture(ctx, row._id))?.fileName;
    const words = `${row.text ?? ""} ${row.url ?? ""} ${fileName ?? ""}`.toLowerCase();
    if (!terms.every((term) => words.includes(term))) continue;
    found.push({
      type: "capture" as const,
      id: row._id as string,
      title: captureTitle(row, fileName),
      state: "pending",
      snippet: row.text && row.text.length > 80 ? `${row.text.slice(0, 220)}${row.text.length > 220 ? "…" : ""}` : (row.url ?? fileName),
    });
    if (found.length >= limit) break;
  }
  return found;
}
