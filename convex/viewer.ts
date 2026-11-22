import { actorLabel, dayBounds, localDate, type Actor } from "@skippy/shared";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { eventsBetween, liveRecurrences } from "./agenda";
import { listCaptures } from "./captures";
import { fileOnCapture, filesOn, presentFile } from "./files";
import { readIngestion } from "./ingestion";
import { findEntity } from "./lib/entities";
import { listProjects, projectBoard, readProject } from "./projects";
import { readToday, recentActivity } from "./read";
import {
  captureIntent,
  claudeHome,
  entityType,
  ingestSource,
  commitment,
  eventStatus,
  phaseStatus,
  projectHealth,
  projectKind,
  projectStatus,
  recurrenceRule,
  recurrenceStatus,
  taskStatus,
} from "./schema";
import { presentTask } from "./tasks";
import { DEFAULT_SETTINGS, getSettings, iso, refuse } from "./lib/common";

/**
 * What the web app reads and changes for the person signed in to it. These,
 * with the Memory page's functions in `viewerMemory.ts`, are the only public
 * functions besides the gateway. Each one checks the sign-in
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

export async function requireOwner(ctx: QueryCtx | MutationCtx): Promise<void> {
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

/** The activity log for its own page: newest first, optionally only the owner's lines or only agents'. */
export const activityLog = query({
  args: { limit: v.optional(v.number()), who: v.optional(v.union(v.literal("owner"), v.literal("agents"))) },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 500);
    const wanted = (event: Doc<"activityEvents">) =>
      args.who === undefined || (args.who === "owner" ? event.actor.kind === "user" : event.actor.kind === "agent");
    // Read a little past the limit to learn whether there is more to show.
    const rows = await ctx.db.query("activityEvents").withIndex("by_at").order("desc").take(args.who ? 3000 : limit + 1);
    const matching = rows.filter(wanted);
    return {
      events: await Promise.all(
        matching.slice(0, limit).map(async (event) => ({
          id: event._id,
          at: new Date(event.at).toISOString(),
          by: actorLabel(event.actor),
          type: event.activityType,
          summary: event.summary,
          project: await projectOf(ctx, event.entityRef),
        })),
      ),
      more: matching.length > limit,
    };
  },
});

/** Every open task, for the Agenda page, with the owner's "today" so the page can sort them into days. */
export const openTasks = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const settings = await getSettings(ctx);
    const slugs = new Map<Id<"projects">, string | undefined>();
    const tasks = [];
    for (const status of ["in_progress", "todo", "waiting"] as const) {
      const rows = await ctx.db
        .query("tasks")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      for (const row of rows) {
        if (row.projectId && !slugs.has(row.projectId)) slugs.set(row.projectId, (await ctx.db.get(row.projectId))?.slug);
        tasks.push(presentTask(row, row.projectId ? slugs.get(row.projectId) : undefined, settings.timeZone));
      }
    }
    return { today: localDate(args.now, settings.timeZone), timeZone: settings.timeZone, tasks };
  },
});

export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return await getSettings(ctx);
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

export const OWNER: Actor = { kind: "user" };
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
    claudeHome: nullable(claudeHome),
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

/** Adds a project. A title already in use is refused, the same as for an agent. */
export const createProject = mutation({
  args: { title: v.string(), summary: v.optional(v.string()), kind: v.optional(projectKind) },
  handler: async (ctx, args): Promise<{ slug: string }> => {
    await requireOwner(ctx);
    const result = await ctx.runMutation(internal.projects.upsert, { actor: OWNER, ...args });
    return { slug: result.project.slug };
  },
});

/** Adds a phase to a project, or changes one when `id` is given. */
export const savePhase = mutation({
  args: {
    id: v.optional(v.string()),
    project: v.optional(v.string()),
    title: v.optional(v.string()),
    description: nullable(v.string()),
    status: v.optional(phaseStatus),
  },
  handler: async (ctx, args): Promise<{ changed: boolean }> => {
    await requireOwner(ctx);
    const { id, project, title, description, status } = args;
    if (id !== undefined) {
      const result = await ctx.runMutation(internal.projects.updatePhase, { actor: OWNER, id, title, description, status });
      return { changed: result.changed };
    }
    if (project === undefined || title === undefined) {
      throw refuse("invalid_arguments", "A new phase needs a project and a title.");
    }
    await ctx.runMutation(internal.projects.createPhase, {
      actor: OWNER,
      project,
      title,
      ...(description ? { description } : {}),
      ...(status ? { status } : {}),
    });
    return { changed: true };
  },
});

/** Moves a phase one place earlier or later in its project's plan. */
export const movePhase = mutation({
  args: { id: v.string(), direction: v.union(v.literal("up"), v.literal("down")) },
  handler: async (ctx, args): Promise<{ changed: boolean }> => {
    await requireOwner(ctx);
    const result = await ctx.runMutation(internal.projects.movePhase, { actor: OWNER, ...args });
    return { changed: result.changed };
  },
});

/** Deletes a phase. Its tasks stay in the project. */
export const removePhase = mutation({
  args: { id: v.string() },
  handler: async (ctx, args): Promise<{ tasksKept: number }> => {
    await requireOwner(ctx);
    const result = await ctx.runMutation(internal.projects.removePhase, { actor: OWNER, id: args.id });
    return { tasksKept: result.tasksKept };
  },
});

/** Deletes a task for good. There is no agent tool for this: only the owner can. */
export const deleteTask = mutation({
  args: { id: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await requireOwner(ctx);
    await ctx.runMutation(internal.tasks.remove, { actor: OWNER, id: args.id });
    return null;
  },
});

/** Events from today on and every recurrence that is not retired, for the Agenda page. */
export const calendar = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const settings = await getSettings(ctx);
    const today = localDate(args.now, settings.timeZone);
    const start = dayBounds(today, settings.timeZone).start;
    return {
      today,
      events: await eventsBetween(ctx, start, start + 366 * 86_400_000, settings.timeZone),
      recurrences: await liveRecurrences(ctx, today),
    };
  },
});

/** Adds an event, or changes one when `id` is given. Only the fields passed change; null clears one. */
export const saveEvent = mutation({
  args: {
    id: v.optional(v.string()),
    title: v.optional(v.string()),
    description: nullable(v.string()),
    location: nullable(v.string()),
    startAt: v.optional(v.string()),
    endAt: nullable(v.string()),
    allDay: v.optional(v.boolean()),
    status: v.optional(eventStatus),
    project: nullable(v.string()),
  },
  handler: async (ctx, args): Promise<{ id: string; changed: boolean }> => {
    await requireOwner(ctx);
    const result = await ctx.runMutation(internal.agenda.upsertEvent, { actor: OWNER, ...args });
    return { id: result.event.id, changed: result.changed };
  },
});

/** Adds something that recurs, or changes one when `id` is given. */
export const saveRecurrence = mutation({
  args: {
    id: v.optional(v.string()),
    title: v.optional(v.string()),
    description: nullable(v.string()),
    rule: v.optional(recurrenceRule),
    anchor: v.optional(v.union(v.literal("schedule"), v.literal("completion"))),
    leadTimeDays: nullable(v.number()),
    status: v.optional(recurrenceStatus),
    nextDue: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ id: string; changed: boolean }> => {
    await requireOwner(ctx);
    const result = await ctx.runMutation(internal.agenda.upsertRecurrence, { actor: OWNER, ...args });
    return { id: result.recurrence.id, changed: result.changed };
  },
});

/** Marks one round of a recurrence done or skipped. `due` is the round the page was showing. */
export const completeRecurrence = mutation({
  args: { id: v.string(), due: v.string(), skip: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ changed: boolean; nextDue: string }> => {
    await requireOwner(ctx);
    const result = await ctx.runMutation(internal.agenda.completeRecurrence, { actor: OWNER, ...args });
    return { changed: result.changed, nextDue: result.recurrence.nextDue };
  },
});

/** The inbox for Home: what waits to be filed, what is being held, and the last few dealt with. */
export const captures = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const [pending, held, filed, discarded] = await Promise.all([
      listCaptures(ctx, { now: args.now, limit: 50, withLinks: true }),
      listCaptures(ctx, { now: args.now, intent: "hold", limit: 50, withLinks: true }),
      listCaptures(ctx, { now: args.now, status: "processed", limit: 5 }),
      listCaptures(ctx, { now: args.now, status: "discarded", limit: 5 }),
    ]);
    return {
      pending: pending.captures,
      morePending: pending.more,
      held: held.captures,
      recent: [...filed.captures, ...discarded.captures].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, 5),
    };
  },
});

/** Drops something into the inbox: text, a file, or both. Text that is only a web address is kept as a link. */
export const addCapture = mutation({
  args: {
    text: v.optional(v.string()),
    intent: v.optional(captureIntent),
    about: v.optional(v.object({ type: entityType, id: v.string() })),
    file: v.optional(v.object({ storageId: v.id("_storage"), fileName: v.string() })),
  },
  handler: async (ctx, args): Promise<{ id: string }> => {
    await requireOwner(ctx);
    const result = await ctx.runMutation(internal.captures.add, { actor: OWNER, ...args });
    return { id: result.capture.id };
  },
});

// Files. An upload is two steps: the page asks for a one-time address, sends the bytes there, then says what they are.

/** A one-time address the owner's browser can send one file to. */
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    await requireOwner(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Attaches an uploaded file to a record: a project (by slug), a task, a note, a person… */
export const addFile = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    note: v.optional(v.string()),
    to: v.object({ type: entityType, id: v.string() }),
  },
  handler: async (ctx, args): Promise<{ id: string }> => {
    await requireOwner(ctx);
    const result = await ctx.runMutation(internal.files.attach, { actor: OWNER, ...args });
    return { id: result.file.id };
  },
});

/** The files on a record, newest first, each with a link the owner's browser can open. */
export const files = query({
  args: { type: entityType, id: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const entity = await findEntity(ctx, args.type, args.id);
    if (!entity) return { files: [] };
    const rows = (await filesOn(ctx, entity.ref.entityId)).sort((a, b) => b._creationTime - a._creationTime);
    return { files: await Promise.all(rows.map((row) => presentFile(ctx, row))) };
  },
});

/** Deletes a file for good. There is no agent tool for this: only the owner can. */
export const removeFile = mutation({
  args: { id: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await requireOwner(ctx);
    await ctx.runMutation(internal.files.remove, { actor: OWNER, id: args.id });
    return null;
  },
});

/** Files a capture as a task, or as a note, link or memory, and marks it dealt with. */
export const fileCapture = mutation({
  args: { id: v.string(), as: v.union(v.literal("task"), v.literal("note"), v.literal("link"), v.literal("memory")) },
  handler: async (ctx, args): Promise<{ type: "task" | "knowledge"; id: string }> => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("captures", args.id);
    const capture = id ? await ctx.db.get(id) : null;
    if (!capture || capture.status !== "pending") throw refuse("not_found", "That capture is no longer waiting.");
    if (capture.intent === "hold") throw refuse("invalid_arguments", "A held capture is not filed. Clear it when you are done with it.");
    const lines = (capture.text ?? "").trim().split("\n");
    // A capture that is only a file is named after the file.
    const first = lines[0]?.trim() || ((await fileOnCapture(ctx, capture._id))?.fileName ?? "");
    const rest = lines.slice(1).join("\n").trim();
    // What the capture was made about carries over: a task joins that project, anything else is linked to it.
    const about = capture.about ? await findEntity(ctx, capture.about.entityType, capture.about.entityId) : null;
    const aboutProject = about?.ref.entityType === "project" ? about.publicId : undefined;
    let made: { type: "task" | "knowledge"; id: string };
    if (args.as === "task") {
      const description = [rest, capture.url].filter(Boolean).join("\n\n");
      const result = await ctx.runMutation(internal.tasks.upsert, {
        actor: OWNER,
        title: (first || capture.url || "").slice(0, 200),
        ...(description ? { description } : {}),
        ...(aboutProject ? { project: aboutProject } : {}),
      });
      made = { type: "task", id: result.task.id };
      if (about && !aboutProject) {
        await ctx.runMutation(internal.links.link, {
          actor: OWNER,
          from: made,
          relation: "related_to",
          to: { type: about.ref.entityType, id: about.publicId },
        });
      }
    } else {
      if (args.as === "link" && !capture.url) throw refuse("invalid_arguments", "That capture has no web address, so it cannot be a link.");
      // A one-line capture is all title; a longer one keeps its text whole and takes its title from the first line.
      const result = await ctx.runMutation(internal.knowledge.upsert, {
        actor: OWNER,
        kind: args.as,
        ...(capture.text && (rest || first.length > 120) ? { body: capture.text } : first ? { title: first.slice(0, 200) } : {}),
        ...(capture.url ? { url: capture.url } : {}),
        ...(about ? { about: [{ type: about.ref.entityType, id: about.publicId }] } : {}),
      });
      made = { type: "knowledge", id: result.knowledge.id };
    }
    await ctx.runMutation(internal.captures.resolve, { actor: OWNER, id: args.id, outcome: "processed", results: [made] });
    return made;
  },
});

/** Discards a capture, or clears a held one. */
export const discardCapture = mutation({
  args: { id: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await requireOwner(ctx);
    await ctx.runMutation(internal.captures.resolve, { actor: OWNER, id: args.id, outcome: "discarded" });
    return null;
  },
});

// Ingestion: what each pass made, the way to take it back, and the rules passes follow.

/** The latest ingestion passes with what each made, when each source was last read, and the rules. */
export const ingestion = query({
  args: { runs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    return await readIngestion(ctx, args);
  },
});

/**
 * Takes back something ingestion made. A reason becomes a rule for later
 * passes. Answers `needsConfirm` when the record has been changed by the owner
 * since, so the page can ask before deleting it.
 */
export const undoIngested = mutation({
  args: { receiptId: v.string(), reason: v.optional(v.string()), force: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ undone: boolean; needsConfirm?: string }> => {
    await requireOwner(ctx);
    try {
      const result = await ctx.runMutation(internal.ingestion.undo, { actor: OWNER, ...args });
      return { undone: result.undone };
    } catch (error) {
      const data = error instanceof ConvexError ? (error.data as { code?: unknown; message?: unknown }) : undefined;
      if (data?.code === "edited_since") return { undone: false, needsConfirm: String(data.message) };
      throw error;
    }
  },
});

/** Adds a rule or a block for ingestion, or changes one when `id` is given. */
export const saveIngestionRule = mutation({
  args: {
    id: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("block"), v.literal("rule"))),
    source: v.optional(v.union(ingestSource, v.null())),
    text: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<null> => {
    await requireOwner(ctx);
    await ctx.runMutation(internal.ingestion.saveRule, { actor: OWNER, ...args });
    return null;
  },
});

export const removeIngestionRule = mutation({
  args: { id: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await requireOwner(ctx);
    await ctx.runMutation(internal.ingestion.removeRule, { actor: OWNER, id: args.id });
    return null;
  },
});

/** Changes the owner-wide settings. Only the fields passed change. */
export const saveSettings = mutation({
  args: { timeZone: v.optional(v.string()), stalenessDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const timeZone = args.timeZone?.trim();
    if (timeZone !== undefined) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone });
      } catch {
        throw refuse("invalid_arguments", `"${timeZone}" is not a time zone. Use a name like America/New_York.`);
      }
    }
    const days = args.stalenessDays;
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 90)) {
      throw refuse("invalid_arguments", "The stale flag takes a whole number of days from 1 to 90.");
    }
    const row = await ctx.db.query("settings").first();
    const next = {
      timeZone: timeZone || row?.timeZone || DEFAULT_SETTINGS.timeZone,
      stalenessDays: days ?? row?.stalenessDays ?? DEFAULT_SETTINGS.stalenessDays,
      updatedAt: Date.now(),
    };
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert("settings", next);
    return { timeZone: next.timeZone, stalenessDays: next.stalenessDays };
  },
});
