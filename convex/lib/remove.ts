import type { MutationCtx } from "../_generated/server";

/**
 * Clears what points at a record that is about to be deleted: its search
 * entry, its links to and from other records, and its ties to sources. The
 * sources themselves stay, and so does the record's history in the activity log.
 */
export async function detach(ctx: MutationCtx, entityId: string): Promise<void> {
  const searchDocs = await ctx.db
    .query("searchDocs")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .collect();
  const from = await ctx.db
    .query("relationships")
    .withIndex("by_from", (q) => q.eq("from.entityId", entityId))
    .collect();
  const to = await ctx.db
    .query("relationships")
    .withIndex("by_to", (q) => q.eq("to.entityId", entityId))
    .collect();
  const sources = await ctx.db
    .query("entitySourceRefs")
    .withIndex("by_entity", (q) => q.eq("entityRef.entityId", entityId))
    .collect();
  for (const row of [...searchDocs, ...from, ...to, ...sources]) await ctx.db.delete(row._id);
}
