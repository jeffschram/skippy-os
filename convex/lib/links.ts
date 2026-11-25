import type { Actor, Relation } from "@skippy/shared";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Ref } from "./entities";

/** Relationship helpers. They do not write to the activity log; the calling operation does. */

/** How many links are read in each direction. Keeps one busy record inside Convex's read limits. */
export const LINK_LIMIT = 200;

export async function findLink(ctx: QueryCtx, from: Ref, to: Ref, type: Relation): Promise<Doc<"relationships"> | null> {
  const rows = await ctx.db
    .query("relationships")
    .withIndex("by_from", (q) => q.eq("from.entityId", from.entityId).eq("type", type))
    .collect();
  return rows.find((row) => row.to.entityId === to.entityId) ?? null;
}

/** Makes the link unless it is already there. Returns whether it was made. */
export async function ensureLink(
  ctx: MutationCtx,
  link: { from: Ref; to: Ref; type: Relation; actor: Actor; at: number; reason?: string; confidence?: number },
): Promise<boolean> {
  if (await findLink(ctx, link.from, link.to, link.type)) return false;
  await ctx.db.insert("relationships", {
    from: link.from,
    to: link.to,
    type: link.type,
    ...(link.reason ? { reason: link.reason } : {}),
    ...(link.confidence !== undefined ? { confidence: link.confidence } : {}),
    createdBy: link.actor,
    createdAt: link.at,
  });
  return true;
}

/** Links of one type going out from a record. */
export async function linksFrom(ctx: QueryCtx, from: Ref, type: Relation): Promise<Doc<"relationships">[]> {
  return await ctx.db
    .query("relationships")
    .withIndex("by_from", (q) => q.eq("from.entityId", from.entityId).eq("type", type))
    .take(LINK_LIMIT);
}
