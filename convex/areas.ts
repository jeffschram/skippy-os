import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type QueryCtx } from "./_generated/server";
import { refuse, requireText } from "./lib/common";
import { actor } from "./schema";

/**
 * Areas of life, such as Household or Work. They are the owner's list: agents
 * put a task or a recurrence in an area by name, and cannot add one.
 */

const OPEN_TASKS = ["todo", "in_progress", "waiting"] as const;

/** Every area in the owner's order, with how much sits in each. */
export async function listAreas(ctx: QueryCtx) {
  const areas = (await ctx.db.query("areas").collect()).sort((a, b) => a.order - b.order);
  const open: Doc<"tasks">[] = [];
  for (const status of OPEN_TASKS) {
    open.push(
      ...(await ctx.db
        .query("tasks")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect()),
    );
  }
  const recurrences = await ctx.db.query("recurrences").collect();
  return {
    areas: areas.map((area) => ({
      id: area._id,
      name: area.name,
      openTasks: open.filter((task) => task.areaId === area._id).length,
      recurrences: recurrences.filter((item) => item.areaId === area._id && item.status !== "retired").length,
    })),
  };
}

/** Adds an area, or renames one. Two areas cannot share a name. */
export const upsert = internalMutation({
  args: { actor, id: v.optional(v.string()), name: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const name = requireText(args.name, "name");
    if (name.length > 40) throw refuse("invalid_arguments", "An area's name can be 40 characters at most.");
    const all = await ctx.db.query("areas").collect();
    const id = args.id === undefined ? null : ctx.db.normalizeId("areas", args.id);
    const existing = id ? await ctx.db.get(id) : null;
    if (args.id !== undefined && !existing) throw refuse("not_found", "That area is no longer there.");
    if (all.some((area) => area._id !== existing?._id && area.name.toLowerCase() === name.toLowerCase())) {
      throw refuse("invalid_arguments", `There is already an area called "${name}".`);
    }
    if (existing) {
      if (existing.name === name) return { id: existing._id, changed: false };
      await ctx.db.patch(existing._id, { name, updatedBy: args.actor, updatedAt: now });
      return { id: existing._id, changed: true };
    }
    // A new area goes last.
    const order = all.reduce((max, area) => Math.max(max, area.order), 0) + 1;
    const made = await ctx.db.insert("areas", { name, order, createdBy: args.actor, updatedBy: args.actor, updatedAt: now, createdAt: now });
    return { id: made, changed: true };
  },
});

/** Moves an area one place up or down the owner's list. */
export const move = internalMutation({
  args: { actor, id: v.string(), direction: v.union(v.literal("up"), v.literal("down")) },
  handler: async (ctx, args) => {
    const areas = (await ctx.db.query("areas").collect()).sort((a, b) => a.order - b.order);
    const at = areas.findIndex((area) => area._id === args.id);
    if (at === -1) throw refuse("not_found", "That area is no longer there.");
    const to = args.direction === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= areas.length) return { changed: false };
    const now = Date.now();
    // Renumber the whole list, so orders left uneven by an import or a removal do not matter.
    const next = [...areas];
    [next[at], next[to]] = [next[to], next[at]];
    for (const [index, area] of next.entries()) {
      if (area.order !== index + 1) await ctx.db.patch(area._id, { order: index + 1, updatedBy: args.actor, updatedAt: now });
    }
    return { changed: true };
  },
});

/**
 * Removes an area. What sat in it stays, with no area. The owner's alone, from
 * the dashboard.
 */
export const remove = internalMutation({
  args: { actor, id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("areas", args.id);
    const area = id ? await ctx.db.get(id) : null;
    if (!id || !area) throw refuse("not_found", "That area is no longer there.");
    let cleared = 0;
    for (const table of ["tasks", "recurrences", "projects", "goals"] as const) {
      for (const row of await ctx.db.query(table).collect()) {
        if (row.areaId === id) {
          await ctx.db.patch(row._id, { areaId: undefined });
          cleared += 1;
        }
      }
    }
    await ctx.db.delete(id);
    return { cleared };
  },
});
