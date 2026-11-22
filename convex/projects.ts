import { actorLabel, type Actor } from "@skippy/shared";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import {
  buildPatch,
  cleanText,
  getSettings,
  iso,
  logActivity,
  refuse,
  requireText,
  showWhen,
  when,
} from "./lib/common";
import { indexProject } from "./lib/searchIndex";
import { actor, claudeHome, phaseStatus, projectHealth, projectKind, projectStatus } from "./schema";
import { presentTask } from "./tasks";

/**
 * Project operations. All are internal: they run only through `gateway.call`,
 * which has already checked the caller, or from the web app's own functions.
 */

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DAY_MS = 86_400_000;
const nullable = <T extends Parameters<typeof v.optional>[0]>(validator: T) => v.optional(v.union(validator, v.null()));

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export async function projectBySlug(ctx: QueryCtx, slug: string): Promise<Doc<"projects">> {
  const project = await ctx.db
    .query("projects")
    .withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase()))
    .unique();
  if (!project) throw refuse("not_found", `There is no project with the slug "${slug}". Use list_projects to see them.`);
  return project;
}

export function presentProject(project: Doc<"projects">, settings: { timeZone: string; stalenessDays: number }, now: number) {
  const daysSinceStatus =
    project.statusUpdatedAt === undefined ? undefined : Math.floor((now - project.statusUpdatedAt) / DAY_MS);
  // An active project is stale when nobody has reported on it within the threshold,
  // counting from when it was created if it has never had a report.
  const quietSince = project.statusUpdatedAt ?? project._creationTime;
  return {
    slug: project.slug,
    title: project.title,
    summary: project.summary,
    kind: project.kind,
    status: project.status,
    health: project.health,
    claudeHome: project.claudeHome,
    statusNote: project.statusNote,
    statusUpdatedAt: iso(project.statusUpdatedAt),
    statusUpdatedBy: project.statusUpdatedBy ? actorLabel(project.statusUpdatedBy) : undefined,
    daysSinceStatus,
    stale: project.status === "active" && now - quietSince > settings.stalenessDays * DAY_MS,
    targetDate: showWhen(project.targetDate, settings.timeZone)?.date,
  };
}

export const upsert = internalMutation({
  args: {
    actor,
    slug: v.optional(v.string()),
    title: v.optional(v.string()),
    summary: nullable(v.string()),
    kind: v.optional(projectKind),
    status: v.optional(projectStatus),
    health: nullable(projectHealth),
    claudeHome: nullable(claudeHome),
    targetDate: nullable(v.string()),
    notesPad: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const settings = await getSettings(ctx);
    const slug = args.slug?.trim().toLowerCase();
    if (slug !== undefined && !SLUG.test(slug)) {
      throw refuse("invalid_arguments", "slug may hold only lowercase letters, digits and single hyphens.");
    }
    const fields = {
      title: args.title === undefined ? undefined : requireText(args.title, "title"),
      summary: cleanText(args.summary),
      kind: args.kind,
      status: args.status,
      health: args.health,
      claudeHome: args.claudeHome,
      targetDate: when(args.targetDate, settings.timeZone, "end", "targetDate"),
      notesPad: args.notesPad,
    };

    const existing = slug
      ? await ctx.db
          .query("projects")
          .withIndex("by_slug", (q) => q.eq("slug", slug))
          .unique()
      : null;

    if (existing) {
      const { patch, diff } = buildPatch(existing, fields);
      if (Object.keys(patch).length === 0) {
        return { created: false, changed: false, project: presentProject(existing, settings, now) };
      }
      await ctx.db.patch(existing._id, { ...patch, updatedBy: args.actor, updatedAt: now });
      await logActivity(ctx, {
        entityType: "project",
        entityId: existing._id,
        activityType: "project.updated",
        actor: args.actor,
        at: now,
        summary: `Updated project "${patch.title ?? existing.title}": ${Object.keys(diff).join(", ")}`,
        diff,
      });
      const updated = (await ctx.db.get(existing._id))!;
      await indexProject(ctx, updated);
      return { created: false, changed: true, project: presentProject(updated, settings, now) };
    }

    const title = requireText(args.title, "title");
    const newSlug = slug ?? slugify(title);
    if (!SLUG.test(newSlug)) {
      throw refuse("invalid_arguments", "Could not make a slug from that title. Pass a slug as well.");
    }
    if (!slug) {
      const clash = await ctx.db
        .query("projects")
        .withIndex("by_slug", (q) => q.eq("slug", newSlug))
        .unique();
      if (clash) {
        throw refuse(
          "project_exists",
          `A project with the slug "${newSlug}" already exists. Pass slug: "${newSlug}" to update it, or a different slug to make a new one.`,
        );
      }
    }
    const id = await ctx.db.insert("projects", {
      title,
      slug: newSlug,
      kind: fields.kind ?? "general",
      status: fields.status ?? "active",
      notesPad: fields.notesPad ?? "",
      ...(fields.summary ? { summary: fields.summary } : {}),
      ...(fields.health ? { health: fields.health } : {}),
      ...(fields.claudeHome ? { claudeHome: fields.claudeHome } : {}),
      ...(typeof fields.targetDate === "number" ? { targetDate: fields.targetDate } : {}),
      createdBy: args.actor,
      updatedBy: args.actor,
      updatedAt: now,
    });
    await logActivity(ctx, {
      entityType: "project",
      entityId: id,
      activityType: "project.created",
      actor: args.actor,
      at: now,
      summary: `Created project "${title}"`,
    });
    const created = (await ctx.db.get(id))!;
    await indexProject(ctx, created);
    return { created: true, changed: true, project: presentProject(created, settings, now) };
  },
});

export const recordStatus = internalMutation({
  args: {
    actor,
    project: v.string(),
    note: v.string(),
    health: v.optional(projectHealth),
    milestone: v.optional(v.string()),
    surface: v.optional(
      v.union(
        v.literal("web_chat"),
        v.literal("claude_project"),
        v.literal("claude_code"),
        v.literal("scheduled"),
      ),
    ),
    ref: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const settings = await getSettings(ctx);
    const project = await projectBySlug(ctx, args.project);
    const note = requireText(args.note, "note");
    const milestone = cleanText(args.milestone) ?? undefined;
    // An agent may say where it was working. A user actor has no surface.
    const reporter: Actor =
      args.actor.kind === "agent"
        ? {
            ...args.actor,
            ...(args.surface ? { surface: args.surface } : {}),
            ...(args.ref ? { ref: args.ref } : {}),
          }
        : args.actor;

    await ctx.db.insert("projectUpdates", {
      projectId: project._id,
      note,
      ...(args.health ? { health: args.health } : {}),
      ...(milestone ? { milestone } : {}),
      actor: reporter,
      at: now,
    });
    await ctx.db.patch(project._id, {
      statusNote: note,
      statusUpdatedAt: now,
      statusUpdatedBy: reporter,
      ...(args.health ? { health: args.health } : {}),
      updatedBy: reporter,
      updatedAt: now,
    });
    await logActivity(ctx, {
      entityType: "project",
      entityId: project._id,
      activityType: "project.status_recorded",
      actor: reporter,
      at: now,
      summary: `Status for "${project.title}"${milestone ? ` (${milestone})` : ""}: ${note}`,
      ...(args.health && args.health !== project.health
        ? { diff: { health: { ...(project.health ? { from: project.health } : {}), to: args.health } } }
        : {}),
    });
    const reported = (await ctx.db.get(project._id))!;
    await indexProject(ctx, reported);
    return { recorded: true, project: presentProject(reported, settings, now) };
  },
});

export const createPhase = internalMutation({
  args: {
    actor,
    project: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(phaseStatus),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const project = await projectBySlug(ctx, args.project);
    const title = requireText(args.title, "title");
    const description = cleanText(args.description) ?? undefined;
    const last = await ctx.db
      .query("phases")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .order("desc")
      .first();
    const order = (last?.order ?? 0) + 1;
    const id = await ctx.db.insert("phases", {
      projectId: project._id,
      order,
      title,
      ...(description ? { description } : {}),
      status: args.status ?? "planned",
      createdBy: args.actor,
      updatedBy: args.actor,
      updatedAt: now,
    });
    await logActivity(ctx, {
      entityType: "phase",
      entityId: id,
      activityType: "phase.created",
      actor: args.actor,
      at: now,
      summary: `Added phase ${order} "${title}" to "${project.title}"`,
    });
    return { phase: { id, project: project.slug, order, title, description, status: args.status ?? "planned" } };
  },
});

/** One project in full: details, notes, phases, tasks and the latest status reports. */
export async function readProject(ctx: QueryCtx, args: { project: string; now: number }) {
  const now = args.now;
  const settings = await getSettings(ctx);
  const project = await projectBySlug(ctx, args.project);
  const phases = await ctx.db
    .query("phases")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  const updates = await ctx.db
    .query("projectUpdates")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .order("desc")
    .take(5);
  const open = tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const closed = tasks
    .filter((task) => task.status === "done" || task.status === "cancelled")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    project: { ...presentProject(project, settings, now), notesPad: project.notesPad },
    phases: phases.map((phase) => ({
      id: phase._id,
      order: phase.order,
      title: phase.title,
      description: phase.description,
      status: phase.status,
    })),
    openTasks: open.map((task) => presentTask(task, project.slug, settings.timeZone)),
    recentlyClosedTasks: closed.slice(0, 10).map((task) => presentTask(task, project.slug, settings.timeZone)),
    closedTaskCount: closed.length,
    recentUpdates: updates.map((update) => ({
      at: iso(update.at),
      by: actorLabel(update.actor),
      note: update.note,
      health: update.health,
      milestone: update.milestone,
    })),
  };
}

export const get = internalQuery({
  args: { project: v.string() },
  handler: (ctx, args) => readProject(ctx, { project: args.project, now: Date.now() }),
});

const BOARD_ORDER = ["active", "idea", "paused", "completed", "archived"] as const;
const OPEN_STATUSES = ["in_progress", "todo", "waiting"] as const;

/** Every project, the live ones first, each with how much is open and what comes next. */
export async function projectBoard(ctx: QueryCtx, args: { now: number }) {
  const settings = await getSettings(ctx);
  const projects = await ctx.db.query("projects").collect();
  const open = new Map<Id<"projects">, Doc<"tasks">[]>();
  for (const status of OPEN_STATUSES) {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", status))
      .collect();
    for (const task of tasks) {
      if (!task.projectId) continue;
      open.set(task.projectId, [...(open.get(task.projectId) ?? []), task]);
    }
  }
  // What to do next: work that can move first, then by deadline.
  const next = (a: Doc<"tasks">, b: Doc<"tasks">) =>
    Number(a.status === "waiting") - Number(b.status === "waiting") || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);
  return {
    projects: projects
      .sort(
        (a, b) => BOARD_ORDER.indexOf(a.status) - BOARD_ORDER.indexOf(b.status) || a.title.localeCompare(b.title),
      )
      .map((project) => {
        const tasks = (open.get(project._id) ?? []).sort(next);
        return {
          ...presentProject(project, settings, args.now),
          openTaskCount: tasks.length,
          nextTasks: tasks.slice(0, 3).map((task) => presentTask(task, project.slug, settings.timeZone)),
        };
      }),
  };
}

/** Projects by title. With no status given, every project that is not archived. */
export async function listProjects(ctx: QueryCtx, args: { status?: Doc<"projects">["status"]; now: number }) {
  const settings = await getSettings(ctx);
  const status = args.status;
  const projects = status
    ? await ctx.db
        .query("projects")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect()
    : (await ctx.db.query("projects").collect()).filter((project) => project.status !== "archived");
  return {
    projects: projects
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((project) => presentProject(project, settings, args.now)),
  };
}

export const list = internalQuery({
  args: { status: v.optional(projectStatus) },
  handler: (ctx, args) => listProjects(ctx, { status: args.status, now: Date.now() }),
});
