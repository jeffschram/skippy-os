import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { buildPatch, cleanText, logActivity, refuse, requireText } from "./lib/common";
import { actor, goalStatus } from "./schema";

/** Goals: what the owner is working towards. Internal: run from the web app's own functions. */

const nullable = <T extends Parameters<typeof v.optional>[0]>(validator: T) => v.optional(v.union(validator, v.null()));

export function presentGoal(goal: Doc<"goals">) {
  return {
    id: goal._id,
    title: goal.title,
    description: goal.description,
    status: goal.status,
    /** When it is for, in the owner's words: "this year", "by June". */
    horizon: goal.horizon,
    measures: goal.measures,
  };
}

export const upsert = internalMutation({
  args: {
    actor,
    id: v.optional(v.string()),
    title: v.optional(v.string()),
    description: nullable(v.string()),
    horizon: nullable(v.string()),
    status: v.optional(goalStatus),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const fields = {
      title: args.title === undefined ? undefined : requireText(args.title, "title"),
      description: cleanText(args.description),
      horizon: cleanText(args.horizon),
      status: args.status,
    };
    if (args.id !== undefined) {
      const id = ctx.db.normalizeId("goals", args.id);
      const existing = id ? await ctx.db.get(id) : null;
      if (!existing) throw refuse("not_found", `There is no goal with the id "${args.id}".`);
      const { patch, diff } = buildPatch(existing, fields);
      if (Object.keys(patch).length === 0) return { created: false, changed: false, goal: presentGoal(existing) };
      await ctx.db.patch(existing._id, { ...patch, updatedBy: args.actor, updatedAt: now });
      const updated = (await ctx.db.get(existing._id))!;
      await logActivity(ctx, {
        entityType: "goal",
        entityId: existing._id,
        activityType: "goal.updated",
        actor: args.actor,
        at: now,
        summary:
          patch.status !== undefined && Object.keys(patch).length === 1
            ? `Goal "${updated.title}" is now ${patch.status}`
            : `Updated goal "${updated.title}": ${Object.keys(diff).join(", ")}`,
        diff,
      });
      return { created: false, changed: true, goal: presentGoal(updated) };
    }
    const title = requireText(args.title, "title");
    const id = await ctx.db.insert("goals", {
      title,
      ...(fields.description ? { description: fields.description } : {}),
      ...(fields.horizon ? { horizon: fields.horizon } : {}),
      status: args.status ?? "active",
      createdBy: args.actor,
      updatedBy: args.actor,
      updatedAt: now,
    });
    await logActivity(ctx, {
      entityType: "goal",
      entityId: id,
      activityType: "goal.created",
      actor: args.actor,
      at: now,
      summary: `Added goal "${title}"`,
    });
    return { created: true, changed: true, goal: presentGoal((await ctx.db.get(id))!) };
  },
});
