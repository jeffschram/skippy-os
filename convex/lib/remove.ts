import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { Ref } from "./entities";

/**
 * Clears what points at a record that is about to be deleted: its search
 * entry, its links to and from other records, its ties to sources, and its
 * files. The sources themselves stay, and so does the record's history in the
 * activity log.
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
  const files = await ctx.db
    .query("files")
    .withIndex("by_entity", (q) => q.eq("attachedTo.entityId", entityId))
    .collect();
  for (const file of files) {
    await ctx.storage.delete(file.storageId);
    await ctx.db.delete(file._id);
  }
}

/**
 * Deletes a record for good, with what points at it. Covers the kinds
 * ingestion can make: a task, an event, a person, or something in Memory.
 * Returns false for a kind it does not delete, or a record already gone.
 */
export async function destroyRecord(ctx: MutationCtx, ref: Ref): Promise<boolean> {
  const tables = { task: "tasks", event: "calendarEvents", person: "people", knowledge: "knowledge" } as const;
  const table = tables[ref.entityType as keyof typeof tables];
  if (!table) return false;
  const id = ctx.db.normalizeId(table, ref.entityId);
  if (!id || !(await ctx.db.get(id))) return false;
  if (table === "people") {
    const handles = await ctx.db
      .query("personHandles")
      .withIndex("by_person", (q) => q.eq("personId", id as Id<"people">))
      .collect();
    for (const handle of handles) await ctx.db.delete(handle._id);
  }
  await detach(ctx, id);
  await ctx.db.delete(id);
  return true;
}
