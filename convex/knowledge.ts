import { actorLabel, IdentityError, normalizeUrl } from "@skippy/shared";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { buildPatch, cleanText, getSettings, iso, logActivity, refuse, showWhen, when } from "./lib/common";
import { knowledgeTitle, requireEntity, type Ref } from "./lib/entities";
import { ensureLink } from "./lib/links";
import { indexKnowledge } from "./lib/searchIndex";
import { attachSource, sourceArg } from "./lib/sources";
import { actor, entityType, knowledgeKind, lifecycle, readState } from "./schema";

/**
 * What is worth remembering: notes, links, memories, decisions, principles and
 * open questions. Internal: run through `gateway.call` or the web app's own functions.
 */

const nullable = <T extends Parameters<typeof v.optional>[0]>(validator: T) => v.optional(v.union(validator, v.null()));

export function presentKnowledge(item: Doc<"knowledge">, timeZone: string) {
  return {
    id: item._id,
    kind: item.kind,
    title: item.title,
    body: item.body,
    summary: item.summary,
    url: item.url,
    readState: item.readState,
    lifecycle: item.lifecycle,
    whyItMatters: item.whyItMatters,
    decision: item.decision && {
      options: item.decision.options,
      chosen: item.decision.chosen,
      rationale: item.decision.rationale,
      revisitOn: showWhen(item.decision.revisitAt, timeZone)?.date,
    },
    savedBy: actorLabel(item.createdBy),
    updatedAt: iso(item.updatedAt),
  };
}

export const upsert = internalMutation({
  args: {
    actor,
    id: v.optional(v.string()),
    kind: v.optional(knowledgeKind),
    title: nullable(v.string()),
    body: nullable(v.string()),
    summary: nullable(v.string()),
    url: nullable(v.string()),
    readState: v.optional(readState),
    lifecycle: v.optional(lifecycle),
    whyItMatters: nullable(v.string()),
    decision: nullable(
      v.object({
        options: v.optional(v.array(v.string())),
        chosen: v.optional(v.string()),
        rationale: v.optional(v.string()),
        revisitAt: v.optional(v.string()),
      }),
    ),
    about: v.optional(v.array(v.object({ type: entityType, id: v.string() }))),
    source: v.optional(sourceArg),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const settings = await getSettings(ctx);

    const url = cleanText(args.url);
    let normalizedUrl: string | null | undefined = url;
    if (url) {
      try {
        normalizedUrl = normalizeUrl(url);
      } catch (error) {
        if (error instanceof IdentityError) throw refuse("invalid_arguments", error.message);
        throw error;
      }
    }

    let existing: Doc<"knowledge"> | null = null;
    if (args.id !== undefined) {
      const id = ctx.db.normalizeId("knowledge", args.id);
      existing = id ? await ctx.db.get(id) : null;
      if (!existing) throw refuse("not_found", `There is nothing saved with the id "${args.id}".`);
    } else if (args.kind === "link" && normalizedUrl) {
      // The same link saved twice is one link.
      const address = normalizedUrl;
      const same = await ctx.db
        .query("knowledge")
        .withIndex("by_normalized_url", (q) => q.eq("normalizedUrl", address))
        .collect();
      existing = same.find((row) => row.kind === "link") ?? null;
    }

    // The same address written another way is not a change to the link.
    const sameAddress = existing !== null && normalizedUrl != null && normalizedUrl === existing.normalizedUrl;

    const kind = args.kind ?? existing?.kind;
    if (!kind) throw refuse("invalid_arguments", "kind is required when saving something new.");
    if (args.readState !== undefined && kind !== "link") {
      throw refuse("invalid_arguments", "readState applies to links only.");
    }
    if (args.decision && kind !== "decision") {
      throw refuse("invalid_arguments", 'decision details apply only when kind is "decision".');
    }

    const decisionInput = args.decision;
    const options = decisionInput?.options?.map((option) => option.trim()).filter(Boolean);
    const chosen = cleanText(decisionInput?.chosen);
    const rationale = cleanText(decisionInput?.rationale);
    const revisitAt = when(decisionInput?.revisitAt, settings.timeZone, "start", "decision.revisitAt");
    const decision =
      decisionInput == null
        ? decisionInput
        : {
            ...(options && options.length > 0 ? { options } : {}),
            ...(chosen ? { chosen } : {}),
            ...(rationale ? { rationale } : {}),
            ...(typeof revisitAt === "number" ? { revisitAt } : {}),
          };

    const fields = {
      kind: args.kind,
      title: cleanText(args.title),
      body: cleanText(args.body),
      summary: cleanText(args.summary),
      url: sameAddress ? undefined : url,
      normalizedUrl: sameAddress ? undefined : normalizedUrl,
      readState: args.readState,
      lifecycle: args.lifecycle,
      whyItMatters: cleanText(args.whyItMatters),
      decision,
    };

    // Everything the record should be about must exist before anything is written.
    const about = await Promise.all(
      (args.about ?? []).map((target, index) => requireEntity(ctx, target, `about[${index}]`)),
    );

    let item: Doc<"knowledge">;
    let created = false;
    let diff: ReturnType<typeof buildPatch>["diff"] = {};
    if (existing) {
      const built = buildPatch(existing, fields);
      const after = { ...existing, ...built.patch };
      if (!after.title && !after.body && !after.url) {
        throw refuse("invalid_arguments", "That would leave nothing: keep a title, a body or a url.");
      }
      if (after.kind === "link" && !after.url) throw refuse("invalid_arguments", "A link needs a url.");
      diff = built.diff;
      if (Object.keys(built.patch).length > 0) {
        await ctx.db.patch(existing._id, { ...built.patch, updatedBy: args.actor, updatedAt: now });
      }
      item = (await ctx.db.get(existing._id))!;
    } else {
      if (!fields.title && !fields.body && !fields.url) {
        throw refuse("invalid_arguments", "Give a title, a body or a url.");
      }
      if (kind === "link" && !fields.url) throw refuse("invalid_arguments", "A link needs a url.");
      const id = await ctx.db.insert("knowledge", {
        kind,
        lifecycle: fields.lifecycle ?? "active",
        ...(fields.title ? { title: fields.title } : {}),
        ...(fields.body ? { body: fields.body } : {}),
        ...(fields.summary ? { summary: fields.summary } : {}),
        ...(fields.url ? { url: fields.url } : {}),
        ...(fields.normalizedUrl ? { normalizedUrl: fields.normalizedUrl } : {}),
        ...(kind === "link" ? { readState: fields.readState ?? "saved" } : {}),
        ...(fields.whyItMatters ? { whyItMatters: fields.whyItMatters } : {}),
        ...(decision ? { decision } : {}),
        createdBy: args.actor,
        updatedBy: args.actor,
        updatedAt: now,
      });
      item = (await ctx.db.get(id))!;
      created = true;
    }

    const ref: Ref = { entityType: "knowledge", entityId: item._id };
    const linked: string[] = [];
    for (const target of about) {
      const made = await ensureLink(ctx, { from: ref, to: target.ref, type: "related_to", actor: args.actor, at: now });
      if (made) linked.push(target.title);
    }
    const sourced = args.source
      ? await attachSource(ctx, ref, args.source, created ? "created_from" : "updated_from", settings.timeZone, now)
      : false;

    const changed = created || Object.keys(diff).length > 0 || linked.length > 0 || sourced;
    if (!changed) return { created: false, changed: false, knowledge: presentKnowledge(item, settings.timeZone) };

    await indexKnowledge(ctx, item);
    delete diff.normalizedUrl;
    const label = `${item.kind} "${knowledgeTitle(item)}"`;
    const details = [
      ...Object.keys(diff),
      ...(linked.length > 0 ? [`linked to ${linked.map((title) => `"${title}"`).join(", ")}`] : []),
      ...(sourced && !created ? ["source added"] : []),
    ].join(", ");
    await logActivity(ctx, {
      entityType: "knowledge",
      entityId: item._id,
      activityType: created ? "knowledge.created" : "knowledge.updated",
      actor: args.actor,
      at: now,
      summary: created
        ? `Saved ${label}${linked.length > 0 ? `, about ${linked.map((title) => `"${title}"`).join(", ")}` : ""}`
        : `Updated ${label}: ${details}`,
      ...(created ? {} : { diff }),
    });
    return { created, changed: true, knowledge: presentKnowledge(item, settings.timeZone) };
  },
});
