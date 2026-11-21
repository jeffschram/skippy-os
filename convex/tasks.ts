import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { buildPatch, cleanText, getSettings, iso, logActivity, refuse, requireText, showWhen, when } from "./lib/common";
import { indexTask } from "./lib/searchIndex";
import { actor, commitment, taskStatus } from "./schema";

/** Task operations. Internal: they run only through `gateway.call` or the web app's own functions. */

const nullable = <T extends Parameters<typeof v.optional>[0]>(validator: T) => v.optional(v.union(validator, v.null()));

export function presentTask(task: Doc<"tasks">, projectSlug: string | undefined, timeZone: string) {
  return {
    id: task._id,
    title: task.title,
    description: task.description,
    status: task.status,
    project: projectSlug,
    phaseId: task.phaseId,
    commitment: task.commitment ?? "must",
    due: showWhen(task.dueAt, timeZone),
    scheduledFor: showWhen(task.scheduledFor, timeZone),
    waitingOn: task.waitingOn,
    completedAt: iso(task.completedAt),
  };
}

export const upsert = internalMutation({
  args: {
    actor,
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
  handler: async (ctx, args) => {
    const now = Date.now();
    const settings = await getSettings(ctx);

    let existing: Doc<"tasks"> | null = null;
    if (args.id !== undefined) {
      const id = ctx.db.normalizeId("tasks", args.id);
      existing = id ? await ctx.db.get(id) : null;
      if (!existing) throw refuse("not_found", `There is no task with the id "${args.id}".`);
    }

    // Which project the task ends up in: the one named, or the one it is already in.
    let projectId: Id<"projects"> | null | undefined;
    if (args.project === null) projectId = null;
    else if (args.project !== undefined) {
      const slug = args.project.trim().toLowerCase();
      const project = await ctx.db
        .query("projects")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (!project) throw refuse("not_found", `There is no project with the slug "${args.project}".`);
      projectId = project._id;
    }
    const finalProjectId = projectId === undefined ? existing?.projectId : (projectId ?? undefined);

    let phaseId: Id<"phases"> | null | undefined;
    if (args.phaseId === null) phaseId = null;
    else if (args.phaseId !== undefined) {
      const id = ctx.db.normalizeId("phases", args.phaseId);
      const phase = id ? await ctx.db.get(id) : null;
      if (!phase) throw refuse("not_found", `There is no phase with the id "${args.phaseId}".`);
      if (phase.projectId !== finalProjectId) {
        throw refuse("invalid_arguments", "That phase belongs to a different project than the task.");
      }
      phaseId = phase._id;
    } else if (existing?.phaseId && projectId !== undefined && projectId !== existing.projectId) {
      // Moving a task to another project takes it out of the old project's phase.
      phaseId = null;
    }

    const status = args.status;
    const fields = {
      title: args.title === undefined ? undefined : requireText(args.title, "title"),
      description: cleanText(args.description),
      status,
      projectId,
      phaseId,
      commitment: args.commitment,
      dueAt: when(args.dueAt, settings.timeZone, "end", "dueAt"),
      scheduledFor: when(args.scheduledFor, settings.timeZone, "start", "scheduledFor"),
      waitingOn: cleanText(args.waitingOn),
      // Finishing a task stamps it; reopening it clears the stamp.
      completedAt:
        status === undefined
          ? undefined
          : status === "done"
            ? (existing?.status === "done" ? existing.completedAt : now)
            : null,
    };

    if (existing) {
      const { patch, diff } = buildPatch(existing, fields);
      const slug = finalProjectId ? (await ctx.db.get(finalProjectId))?.slug : undefined;
      if (Object.keys(patch).length === 0) {
        return { created: false, changed: false, task: presentTask(existing, slug, settings.timeZone) };
      }
      await ctx.db.patch(existing._id, { ...patch, updatedBy: args.actor, updatedAt: now });
      const title = patch.title ?? existing.title;
      const finished = patch.status === "done";
      delete diff.completedAt;
      await logActivity(ctx, {
        entityType: "task",
        entityId: existing._id,
        activityType: finished ? "task.completed" : "task.updated",
        actor: args.actor,
        at: now,
        summary: finished ? `Completed task "${title}"` : `Updated task "${title}": ${Object.keys(diff).join(", ")}`,
        diff,
      });
      const updated = (await ctx.db.get(existing._id))!;
      await indexTask(ctx, updated);
      return { created: false, changed: true, task: presentTask(updated, slug, settings.timeZone) };
    }

    const title = requireText(args.title, "title");
    const newStatus = status ?? "todo";
    const id = await ctx.db.insert("tasks", {
      title,
      status: newStatus,
      ...(fields.description ? { description: fields.description } : {}),
      ...(finalProjectId ? { projectId: finalProjectId } : {}),
      ...(phaseId ? { phaseId } : {}),
      ...(fields.commitment ? { commitment: fields.commitment } : {}),
      ...(typeof fields.dueAt === "number" ? { dueAt: fields.dueAt } : {}),
      ...(typeof fields.scheduledFor === "number" ? { scheduledFor: fields.scheduledFor } : {}),
      ...(fields.waitingOn ? { waitingOn: fields.waitingOn } : {}),
      ...(newStatus === "done" ? { completedAt: now } : {}),
      createdBy: args.actor,
      updatedBy: args.actor,
      updatedAt: now,
    });
    const project = finalProjectId ? await ctx.db.get(finalProjectId) : null;
    await logActivity(ctx, {
      entityType: "task",
      entityId: id,
      activityType: "task.created",
      actor: args.actor,
      at: now,
      summary: `Created task "${title}"${project ? ` in "${project.title}"` : ""}`,
    });
    const created = (await ctx.db.get(id))!;
    await indexTask(ctx, created);
    return { created: true, changed: true, task: presentTask(created, project?.slug, settings.timeZone) };
  },
});

export const complete = internalMutation({
  args: { actor, id: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const settings = await getSettings(ctx);
    const id = ctx.db.normalizeId("tasks", args.id);
    const task = id ? await ctx.db.get(id) : null;
    if (!task) throw refuse("not_found", `There is no task with the id "${args.id}".`);
    const slug = task.projectId ? (await ctx.db.get(task.projectId))?.slug : undefined;
    // Completing a finished task again changes nothing and logs nothing.
    if (task.status === "done") {
      return { changed: false, task: presentTask(task, slug, settings.timeZone) };
    }
    const note = cleanText(args.note);
    await ctx.db.patch(task._id, { status: "done", completedAt: now, updatedBy: args.actor, updatedAt: now });
    await logActivity(ctx, {
      entityType: "task",
      entityId: task._id,
      activityType: "task.completed",
      actor: args.actor,
      at: now,
      summary: `Completed task "${task.title}"${note ? `: ${note}` : ""}`,
      diff: { status: { from: task.status, to: "done" } },
    });
    return { changed: true, task: presentTask((await ctx.db.get(task._id))!, slug, settings.timeZone) };
  },
});
