import { v, type Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { cleanText, getSettings, iso, refuse, requireText, when } from "./lib/common";
import { findEntity, mention, requireEntity } from "./lib/entities";
import { listSources } from "./lib/sources";
import { actor, entityType, flagSource } from "./schema";
import type { Actor } from "@skippy/shared";

/**
 * What needs the owner: something to decide, answer or do that they would
 * otherwise miss, such as two meetings at once or a check-in that has opened.
 * An ingestion pass or a chat raises it with `flag_for_owner`; Home shows it
 * at the top with links back to where it came from (the email, the calendar
 * event) until the owner ticks it off or dismisses it, the raiser closes it,
 * the record it is about is finished, or it lapses.
 */

type FlagSource = Infer<typeof flagSource>;
export type Link = { label: string; url: string };

const MAX_TITLE = 160;
const MAX_DETAIL = 500;
const MAX_SOURCES = 5;
const MAX_LINKS = 4;

/** What each system's link is called on Home. Anything else is named by its web address. */
const LABELS: Record<string, string> = {
  gmail: "Email",
  email: "Email",
  google_calendar: "Calendar",
  calendar: "Calendar",
  m365: "Outlook",
  outlook: "Outlook",
  imessage: "Messages",
  slack: "Slack",
};

/** A web address that is safe to open: http or https only. */
function webAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The link that opens a source: its own address, or for mail with only an id,
 * the thread in Gmail. Null when there is nothing to open, as for a text message.
 */
export function sourceLink(source: FlagSource): Link | null {
  const system = source.system.trim().toLowerCase();
  const mailId = source.threadId ?? source.messageId;
  const url =
    webAddress(source.url) ??
    (system === "gmail" && mailId ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(mailId.trim())}` : undefined);
  if (!url) return null;
  return { label: LABELS[system] ?? new URL(url).hostname.replace(/^www\./, ""), url };
}

/** The flag's own links, then the ones of the record it is about: its calendar entry and its sources. */
async function linksOf(ctx: QueryCtx, flag: Doc<"flags">): Promise<Link[]> {
  const links = (flag.sources ?? []).map(sourceLink);
  if (flag.about) {
    if (flag.about.entityType === "event") {
      const id = ctx.db.normalizeId("calendarEvents", flag.about.entityId);
      const event = id ? await ctx.db.get(id) : null;
      if (event?.htmlLink) links.push(sourceLink({ system: "google_calendar", url: event.htmlLink }));
    }
    for (const source of await listSources(ctx, flag.about)) {
      links.push(sourceLink({ system: source.system, url: source.url, threadId: source.threadId, messageId: source.messageId }));
    }
  }
  const seen = new Set<string>();
  return links.filter((link): link is Link => link !== null && !seen.has(link.url) && Boolean(seen.add(link.url))).slice(0, MAX_LINKS);
}

/** States of a record that mean whatever was flagged about it is settled. */
const SETTLED = new Set(["done", "cancelled", "completed", "archived"]);

/**
 * The flags still open, soonest to lapse first and then newest, each with the
 * record it is about and its links. A flag whose record is finished, or that
 * has lapsed, is left out.
 */
export async function openFlags(ctx: QueryCtx, now: number) {
  const rows = await ctx.db
    .query("flags")
    .withIndex("by_status", (q) => q.eq("status", "open"))
    .order("desc")
    .take(100);
  const shown = [];
  for (const flag of rows) {
    if (flag.until !== undefined && flag.until <= now) continue;
    const about = flag.about ? await findEntity(ctx, flag.about.entityType, flag.about.entityId) : null;
    if (about?.state && SETTLED.has(about.state)) continue;
    shown.push({
      id: flag._id,
      key: flag.key,
      title: flag.title,
      ...(flag.detail ? { detail: flag.detail } : {}),
      ...(about ? { about: mention(about) } : {}),
      ...(flag.until !== undefined ? { until: iso(flag.until)! } : {}),
      links: await linksOf(ctx, flag),
      raisedAt: iso(flag.createdAt ?? flag._creationTime)!,
    });
  }
  const lapses = (flag: { until?: string }) => (flag.until ? Date.parse(flag.until) : Infinity);
  return shown.sort((a, b) => lapses(a) - lapses(b));
}

/** Closes a flag as done or dismissed, and says so in the activity log. */
export async function resolveFlag(ctx: MutationCtx, flag: Doc<"flags">, status: "done" | "dismissed", by: Actor, now: number) {
  if (flag.status === status) return false;
  await ctx.db.patch(flag._id, { status, resolvedBy: by, resolvedAt: now, updatedBy: by, updatedAt: now });
  await ctx.db.insert("activityEvents", {
    activityType: `flag.${status}`,
    actor: by,
    at: now,
    summary: `${status === "done" ? "Done" : "Dismissed"}: ${flag.title}`,
  });
  return true;
}

function cleanSources(sources: FlagSource[] | undefined): FlagSource[] | undefined {
  if (sources === undefined) return undefined;
  if (sources.length > MAX_SOURCES) throw refuse("invalid_arguments", `A flag takes up to ${MAX_SOURCES} sources.`);
  return sources.map((source) => {
    const system = requireText(source.system, "sources.system").toLowerCase();
    const url = cleanText(source.url) ?? undefined;
    if (url && !webAddress(url)) throw refuse("invalid_arguments", "sources.url must be an http or https address.");
    const threadId = cleanText(source.threadId) ?? undefined;
    const messageId = cleanText(source.messageId) ?? undefined;
    return { system, ...(url ? { url } : {}), ...(threadId ? { threadId } : {}), ...(messageId ? { messageId } : {}) };
  });
}

function limited(value: string | null | undefined, field: string, max: number): string | null | undefined {
  const text = cleanText(value);
  if (text && text.length > max) throw refuse("invalid_arguments", `${field} is limited to ${max} characters.`);
  return text;
}

/**
 * Raises something for the owner, updates it, or closes it, by the raiser's
 * key. A flag the owner has already ticked off or dismissed stays closed: it
 * is not raised again under the same key.
 */
export const upsert = internalMutation({
  args: {
    actor,
    key: v.string(),
    title: v.optional(v.string()),
    detail: v.optional(v.union(v.string(), v.null())),
    about: v.optional(v.union(v.object({ type: entityType, id: v.string() }), v.null())),
    sources: v.optional(v.array(flagSource)),
    until: v.optional(v.union(v.string(), v.null())),
    status: v.optional(v.union(v.literal("open"), v.literal("done"), v.literal("dismissed"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const key = requireText(args.key, "key");
    if (key.length > 120) throw refuse("invalid_arguments", "key is limited to 120 characters.");
    const settings = await getSettings(ctx);
    const title = limited(args.title, "title", MAX_TITLE);
    const detail = limited(args.detail, "detail", MAX_DETAIL);
    const sources = cleanSources(args.sources);
    const until = when(args.until, settings.timeZone, "end", "until");
    const about =
      args.about === undefined ? undefined : args.about === null ? null : (await requireEntity(ctx, args.about, "about")).ref;

    const existing = await ctx.db
      .query("flags")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!existing) {
      if (args.status === "done" || args.status === "dismissed") return { key, status: "not_found" as const, changed: false };
      if (!title) throw refuse("invalid_arguments", "title is needed to raise a new flag.");
      await ctx.db.insert("flags", {
        key,
        title,
        ...(detail ? { detail } : {}),
        ...(about ? { about } : {}),
        ...(sources && sources.length > 0 ? { sources } : {}),
        ...(typeof until === "number" ? { until } : {}),
        status: "open",
        createdBy: args.actor,
        updatedBy: args.actor,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("activityEvents", { activityType: "flag.raised", actor: args.actor, at: now, summary: `Needs you: ${title}` });
      return { key, status: "open" as const, changed: true };
    }

    if (existing.status !== "open" && existing.resolvedBy?.kind === "user") {
      return {
        key,
        status: existing.status,
        changed: false,
        note: "The owner already closed this one, so it stays closed. Raise something new under a new key only if it is a new matter.",
      };
    }
    if (args.status === "done" || args.status === "dismissed") {
      return { key, status: args.status, changed: await resolveFlag(ctx, existing, args.status, args.actor, now) };
    }

    const patch: Partial<Doc<"flags">> = {};
    if (title && title !== existing.title) patch.title = title;
    if (detail !== undefined && (detail ?? undefined) !== existing.detail) patch.detail = detail ?? undefined;
    if (about !== undefined && about?.entityId !== existing.about?.entityId) patch.about = about ?? undefined;
    if (sources !== undefined && JSON.stringify(sources) !== JSON.stringify(existing.sources ?? [])) patch.sources = sources;
    if (until !== undefined && (until ?? undefined) !== existing.until) patch.until = until ?? undefined;
    if (existing.status !== "open") Object.assign(patch, { status: "open", resolvedBy: undefined, resolvedAt: undefined });
    if (Object.keys(patch).length === 0) return { key, status: "open" as const, changed: false };
    await ctx.db.patch(existing._id, { ...patch, updatedBy: args.actor, updatedAt: now });
    return { key, status: "open" as const, changed: true };
  },
});
