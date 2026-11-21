import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { cleanText, logActivity, refuse } from "./lib/common";
import { mention, requireEntity } from "./lib/entities";
import { ensureLink, findLink } from "./lib/links";
import { actor, entityType, relation } from "./schema";

/** Relating one record to another. Internal: run through `gateway.call` or the web app's own functions. */

const target = v.object({ type: entityType, id: v.string() });

export const link = internalMutation({
  args: {
    actor,
    from: target,
    relation,
    to: target,
    reason: v.optional(v.string()),
    confidence: v.optional(v.number()),
    remove: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const from = await requireEntity(ctx, args.from, "from");
    const to = await requireEntity(ctx, args.to, "to");
    if (from.ref.entityId === to.ref.entityId) {
      throw refuse("invalid_arguments", "A record cannot be linked to itself.");
    }
    if (args.confidence !== undefined && (args.confidence < 0 || args.confidence > 1)) {
      throw refuse("invalid_arguments", "confidence must be between 0 and 1.");
    }
    const words = args.relation.replace(/_/g, " ");
    const shown = { from: mention(from), relation: args.relation, to: mention(to) };

    if (args.remove) {
      const existing = await findLink(ctx, from.ref, to.ref, args.relation);
      if (!existing) return { changed: false, linked: false, ...shown };
      await ctx.db.delete(existing._id);
      await logActivity(ctx, {
        entityType: from.ref.entityType,
        entityId: from.ref.entityId,
        activityType: "link.removed",
        actor: args.actor,
        at: now,
        summary: `Unlinked "${from.title}" ${words} "${to.title}"`,
      });
      return { changed: true, linked: false, ...shown };
    }

    const reason = cleanText(args.reason) ?? undefined;
    const made = await ensureLink(ctx, {
      from: from.ref,
      to: to.ref,
      type: args.relation,
      actor: args.actor,
      at: now,
      reason,
      confidence: args.confidence,
    });
    // Linking the same two records the same way again changes nothing and logs nothing.
    if (!made) return { changed: false, linked: true, ...shown };
    await logActivity(ctx, {
      entityType: from.ref.entityType,
      entityId: from.ref.entityId,
      activityType: "link.created",
      actor: args.actor,
      at: now,
      summary: `Linked "${from.title}" ${words} "${to.title}"${reason ? `: ${reason}` : ""}`,
    });
    return { changed: true, linked: true, ...shown };
  },
});
