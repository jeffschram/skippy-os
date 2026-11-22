import { ConvexError, v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { listProjects } from "./projects";
import { readToday, recentActivity } from "./read";

/**
 * What the web app reads for the person signed in to it. These are the only
 * public queries. Each one checks the sign-in itself: the owner gets data,
 * anyone else is refused, and nothing is ever created for them.
 *
 * Convex has already checked that the sign-in is a Clerk session for this app
 * (see `auth.config.ts`), so `subject` is a Clerk user ID that can be trusted.
 *
 * Queries that depend on the time take it as `now` from the page. A query that
 * read the clock itself would keep showing yesterday's answer after midnight,
 * because Convex only reruns a query when its data or arguments change.
 */

export type Viewer = "signed_out" | "not_owner" | "owner";

async function whoIsLooking(ctx: QueryCtx): Promise<Viewer> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return "signed_out";
  const owner = process.env.SKIPPY_OWNER_CLERK_USER_ID;
  if (!owner) throw new ConvexError({ code: "viewer_not_configured" });
  // One owner. An account that is not the owner is refused, never created.
  return identity.subject === owner ? "owner" : "not_owner";
}

async function requireOwner(ctx: QueryCtx): Promise<void> {
  const viewer = await whoIsLooking(ctx);
  if (viewer === "signed_out") throw new ConvexError({ code: "not_signed_in" });
  if (viewer === "not_owner") throw new ConvexError({ code: "account_not_authorized" });
}

/** Lets the page tell a stranger from the owner without showing either any data. */
export const me = query({
  args: {},
  handler: async (ctx) => ({ viewer: await whoIsLooking(ctx) }),
});

export const today = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return await readToday(ctx, { now: args.now });
  },
});

export const projects = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return await listProjects(ctx, { now: args.now });
  },
});

export const activity = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 20), 1), 100);
    return { events: await recentActivity(ctx, limit) };
  },
});
