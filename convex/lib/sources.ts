import { v, type Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { cleanText, iso, refuse, requireText, when } from "./common";
import type { Ref } from "./entities";

/**
 * Where a record came from. A source is a pointer back to the original and a
 * short excerpt or summary, never the original's full text.
 */
export const sourceArg = v.object({
  /** For example "gmail", "imessage", "calendar", "web" or "conversation". */
  system: v.string(),
  url: v.optional(v.string()),
  externalId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  threadId: v.optional(v.string()),
  excerpt: v.optional(v.string()),
  summary: v.optional(v.string()),
  at: v.optional(v.string()),
});
export type SourceArg = Infer<typeof sourceArg>;

const MAX_QUOTE = 1000;

function short(value: string | undefined, field: string): string | undefined {
  const text = cleanText(value) ?? undefined;
  if (text && text.length > MAX_QUOTE) {
    throw refuse("invalid_arguments", `source.${field} is limited to ${MAX_QUOTE} characters. Quote less of the original.`);
  }
  return text;
}

async function attached(ctx: QueryCtx, ref: Ref): Promise<{ join: Doc<"entitySourceRefs">; source: Doc<"sourceRefs"> }[]> {
  const joins = await ctx.db
    .query("entitySourceRefs")
    .withIndex("by_entity", (q) => q.eq("entityRef.entityId", ref.entityId))
    .take(50);
  const rows = await Promise.all(joins.map(async (join) => ({ join, source: await ctx.db.get(join.sourceRefId) })));
  return rows.filter((row): row is { join: Doc<"entitySourceRefs">; source: Doc<"sourceRefs"> } => row.source !== null);
}

/**
 * Attaches a source to a record. The same source sent again is recognised, by
 * its id in the system it came from or by matching what is already attached,
 * so a repeated call adds nothing. Returns whether anything was added.
 */
export async function attachSource(
  ctx: MutationCtx,
  ref: Ref,
  input: SourceArg,
  relationship: Doc<"entitySourceRefs">["relationship"],
  timeZone: string,
  now: number,
): Promise<boolean> {
  const sourceSystem = requireText(input.system, "source.system").toLowerCase();
  const fields = {
    externalId: cleanText(input.externalId) ?? undefined,
    messageId: cleanText(input.messageId) ?? undefined,
    threadId: cleanText(input.threadId) ?? undefined,
    url: cleanText(input.url) ?? undefined,
    excerpt: short(input.excerpt, "excerpt"),
    summary: short(input.summary, "summary"),
    sourceTimestamp: (when(input.at, timeZone, "start", "source.at") ?? undefined) as number | undefined,
  };
  const already = await attached(ctx, ref);

  let source: Doc<"sourceRefs"> | null = null;
  const { externalId, messageId } = fields;
  if (externalId) {
    source = await ctx.db
      .query("sourceRefs")
      .withIndex("by_external", (q) => q.eq("sourceSystem", sourceSystem).eq("externalId", externalId))
      .first();
  } else if (messageId) {
    source = await ctx.db
      .query("sourceRefs")
      .withIndex("by_message", (q) => q.eq("sourceSystem", sourceSystem).eq("messageId", messageId))
      .first();
  } else {
    source =
      already.find(
        (row) =>
          row.source.sourceSystem === sourceSystem &&
          row.source.url === fields.url &&
          row.source.excerpt === fields.excerpt &&
          row.source.summary === fields.summary,
      )?.source ?? null;
  }

  if (source) {
    const sourceId = source._id;
    if (already.some((row) => row.source._id === sourceId)) return false;
  } else {
    const present = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
    const id = await ctx.db.insert("sourceRefs", { sourceSystem, ...present, createdAt: now });
    source = (await ctx.db.get(id))!;
  }
  await ctx.db.insert("entitySourceRefs", {
    entityRef: { entityType: ref.entityType, entityId: ref.entityId },
    sourceRefId: source._id,
    relationship,
  });
  return true;
}

/** The sources attached to a record, as a reader sees them. */
export async function listSources(ctx: QueryCtx, ref: Ref) {
  return (await attached(ctx, ref)).map(({ join, source }) => ({
    relationship: join.relationship,
    system: source.sourceSystem,
    url: source.url,
    externalId: source.externalId,
    messageId: source.messageId,
    threadId: source.threadId,
    excerpt: source.excerpt,
    summary: source.summary,
    at: iso(source.sourceTimestamp),
  }));
}
