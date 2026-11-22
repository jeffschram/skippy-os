import { actorLabel, type Actor } from "@skippy/shared";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { listProjects, projectBoard, readProject } from "./projects";
import { readToday, recentActivity } from "./read";
import { commitment, projectHealth, projectStatus, taskStatus } from "./schema";
import { presentTask } from "./tasks";
import { getSettings, iso } from "./lib/common";

/**
 * What the web app reads and changes for the person signed in to it. These are
 * the only public functions besides the gateway. Each one checks the sign-in
 * itself: the owner gets data, anyone else is refused, and nothing is ever
 * created for them.
 *
 * A change made here runs the same internal function an agent's tool runs, so
 * the same rules apply and the activity log shows it, with the owner as the actor.
 *
 * Convex has already checked that the sign-in is a Clerk session for this app
 * (see `auth.config.ts`), so `subject` is a Clerk user ID that can be trusted.
 *
 * Queries that depend on the time take it as `now` from the page. A query that
 * read the clock itself would keep showing yesterday's answer after midnight,
 * because Convex only reruns a query when its data or arguments change.
 */

export type Viewer = "signed_out" | "not_owner" | "owner";

async function whoIsLooking(ctx: QueryCtx | MutationCtx): Promise<Viewer> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return "signed_out";
  const owner = process.env.SKIPPY_OWNER_CLERK_USER_ID;
  if (!owner) throw new ConvexError({ code: "viewer_not_configured" });
  // One owner. An account that is not the owner is refused, never created.
  return identity.subject === owner ? "owner" : "not_owner";
}

async function requireOwner(ctx: QueryCtx | MutationCtx): Promise<void> {
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

/** Every project, archived ones included, for the projects board. */
export const board = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return await projectBoard(ctx, { now: args.now });
  },
});

/** One project in full, or null when no project has that slug. */
export const project = query({
  args: { slug: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    try {
      return await readProject(ctx, { project: args.slug, now: args.now });
    } catch (error) {
      if (error instanceof ConvexError && (error.data as { code?: unknown }).code === "not_found") return null;
      throw error;
    }
  },
});

/** The slug of the project an activity line belongs to, when it is about a project or one of its tasks. */
async function projectOf(ctx: QueryCtx, ref: Doc<"activityEvents">["entityRef"]): Promise<string | undefined> {
  if (!ref) return undefined;
  let projectId: Id<"projects"> | null | undefined;
  if (ref.entityType === "project") projectId = ctx.db.normalizeId("projects", ref.entityId);
  else if (ref.entityType === "task") {
    const id = ctx.db.normalizeId("tasks", ref.entityId);
    projectId = id ? (await ctx.db.get(id))?.projectId : undefined;
  } else if (ref.entityType === "phase") {
    const id = ctx.db.normalizeId("phases", ref.entityId);
    projectId = id ? (await ctx.db.get(id))?.projectId : undefined;
  }
  return projectId ? (await ctx.db.get(projectId))?.slug : undefined;
}

const UNSEEN_LIMIT = 40;

/**
 * What agents recorded since the owner last marked the log as read, newest
 * first. The owner's own changes are left out: they already know about those.
 */
export const sinceLastLook = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const seenAt = (await ctx.db.query("viewerState").first())?.activitySeenAt ?? 0;
    const rows = await ctx.db
      .query("activityEvents")
      .withIndex("by_at", (q) => q.gt("at", seenAt))
      .order("desc")
      .take(500);
    const fromAgents = rows.filter((event) => event.actor.kind === "agent");
    const shown = fromAgents.slice(0, UNSEEN_LIMIT);
    return {
      seenAt: seenAt === 0 ? undefined : iso(seenAt),
      /** Pass this to `markSeen` to clear the list. */
      newestAt: fromAgents[0]?.at,
      count: fromAgents.length,
      events: await Promise.all(
        shown.map(async (event) => ({
          id: event._id,
          at: new Date(event.at).toISOString(),
          by: actorLabel(event.actor),
          type: event.activityType,
          summary: event.summary,
          project: await projectOf(ctx, event.entityRef),
        })),
      ),
    };
  },
});

/** One task with what the details view needs: its project's phases and its own history. */
export const task = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("tasks", args.id);
    const found = id ? await ctx.db.get(id) : null;
    if (!found) return null;
    const settings = await getSettings(ctx);
    const project = found.projectId ? await ctx.db.get(found.projectId) : null;
    const history = await ctx.db
      .query("activityEvents")
      .withIndex("by_entity", (q) => q.eq("entityRef.entityId", found._id))
      .order("desc")
      .take(10);
    return {
      task: presentTask(found, project?.slug, settings.timeZone),
      projectTitle: project?.title,
      history: history.map((event) => ({
        id: event._id,
        at: new Date(event.at).toISOString(),
        by: actorLabel(event.actor),
        summary: event.summary,
      })),
    };
  },
});

// Changes. The owner is the actor on each one.

/** Marks the activity log as read up to a point. It never moves backwards. */
export const markSeen = mutation({
  args: { through: v.number() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const through = Math.min(args.through, Date.now());
    const row = await ctx.db.query("viewerState").first();
    if (!row) await ctx.db.insert("viewerState", { activitySeenAt: through });
    else if (through > row.activitySeenAt) await ctx.db.patch(row._id, { activitySeenAt: through });
    return null;
  },
});

const OWNER: Actor = { kind: "user" };
const nullable = <T extends Parameters<typeof v.optional>[0]>(validator: T) => v.optional(v.union(validator, v.null()));

/** Adds a task, or changes one when `id` is given. Only the fields passed change; null clears one. */
export const saveTask = mutation({
  args: {
    id: v.optional(v.string()),
    title: v.optional(v.string()),
    description: nullable(v.string()),
    status: v.optional(taskStatus),
    project: nullable(v.string()),
    phaseId: nullable(v.string()),
    commitment: nullable(commitment),
    dueAt: nullable(v.string()),
    scheduledFor: nullable(v.string()),
    waitingOn: nullable(v.string()),
  },
  handler: async (ctx, args): Promise<{ created: boolean; changed: boolean }> => {
    await requireOwner(ctx);
    const result = await ctx.runMutation(internal.tasks.upsert, { actor: OWNER, ...args });
    return { created: result.created, changed: result.changed };
  },
});

/** Changes a project. Only the fields passed change; null clears one. */
export const saveProject = mutation({
  args: {
    slug: v.string(),
    title: v.optional(v.string()),
    summary: nullable(v.string()),
    status: v.optional(projectStatus),
    health: nullable(projectHealth),
    targetDate: nullable(v.string()),
    notesPad: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ changed: boolean }> => {
    await requireOwner(ctx);
    // The slug must name a project that exists: the page never creates one by accident.
    await readProject(ctx, { project: args.slug, now: Date.now() });
    const result = await ctx.runMutation(internal.projects.upsert, { actor: OWNER, ...args });
    return { changed: result.changed };
  },
});
