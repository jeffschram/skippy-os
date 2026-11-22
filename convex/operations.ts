import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { captureTitle } from "./captures";

/**
 * Run only through `gateway.call`, which has already checked the caller.
 * Internal: nothing outside Convex can call it directly.
 */

/** Who the connection acts as, and the latest captures, so a client can check a write by reading it back. */
export const whoami = internalQuery({
  args: { subject: v.string(), clientId: v.string(), scopes: v.array(v.string()) },
  handler: async (ctx, args) => {
    const recent = (await ctx.db.query("captures").order("desc").take(20)).filter((row) => row.intent === "remember");
    return {
      owner: args.subject,
      client: args.clientId,
      scopes: args.scopes,
      recentCaptures: recent.slice(0, 5).map((capture) => ({
        id: capture._id,
        text: captureTitle(capture),
        createdAt: capture.createdAt,
        client: capture.createdBy.kind === "agent" ? capture.createdBy.clientId : capture.createdBy.kind,
      })),
    };
  },
});
