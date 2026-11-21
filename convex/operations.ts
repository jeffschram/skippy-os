import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { actor } from "./schema";

/** Longest capture accepted, in characters. */
const MAX_CAPTURE_LENGTH = 4000;

/**
 * Operations run only through `gateway.call`, which has already checked the
 * caller. They are internal: nothing outside Convex can call them directly.
 */

export const whoami = internalQuery({
  args: { actor, scopes: v.array(v.string()) },
  handler: async (ctx, args) => {
    const recent = await ctx.db.query("captures").withIndex("by_created").order("desc").take(5);
    return {
      owner: args.actor.subject,
      client: args.actor.clientId,
      scopes: args.scopes,
      recentCaptures: recent.map((capture) => ({
        id: capture._id,
        text: capture.text,
        createdAt: capture.createdAt,
        client: capture.actor.clientId,
      })),
    };
  },
});

export const capture = internalMutation({
  args: { actor, text: v.string() },
  handler: async (ctx, args) => {
    const text = args.text.trim();
    if (text === "" || text.length > MAX_CAPTURE_LENGTH) throw new ConvexError({ code: "invalid_arguments" });
    const createdAt = Date.now();
    const id = await ctx.db.insert("captures", { text, actor: args.actor, createdAt });
    return { id, text, createdAt };
  },
});
