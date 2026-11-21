import { actorLabel, dayBounds, localDate, WhenError } from "@skippy/shared";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import { getSettings, refuse, when } from "./lib/common";
import { presentTask } from "./tasks";

/** Read operations that cut across record types. Internal, run through `gateway.call`. */

const OPEN = ["todo", "in_progress", "waiting"] as const;

export const today = internalQuery({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const settings = await getSettings(ctx);
    const date = args.date?.trim() || localDate(Date.now(), settings.timeZone);
    let bounds: { start: number; end: number };
    try {
      bounds = dayBounds(date, settings.timeZone);
    } catch (error) {
      if (error instanceof WhenError) throw refuse("invalid_arguments", "date must look like 2026-11-25.");
      throw error;
    }
    if (Number.isNaN(bounds.start)) throw refuse("invalid_arguments", "date must look like 2026-11-25.");

    const open: Doc<"tasks">[] = [];
    for (const status of OPEN) {
      open.push(
        ...(await ctx.db
          .query("tasks")
          .withIndex("by_status", (q) => q.eq("status", status))
          .collect()),
      );
    }
    const slugs = new Map<Id<"projects">, string | undefined>();
    const show = async (task: Doc<"tasks">) => {
      if (task.projectId && !slugs.has(task.projectId)) {
        slugs.set(task.projectId, (await ctx.db.get(task.projectId))?.slug);
      }
      return presentTask(task, task.projectId ? slugs.get(task.projectId) : undefined, settings.timeZone);
    };
    const byDue = (a: Doc<"tasks">, b: Doc<"tasks">) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);

    const overdue = open.filter((task) => task.dueAt !== undefined && task.dueAt < bounds.start).sort(byDue);
    const dueToday = open
      .filter((task) => task.dueAt !== undefined && task.dueAt >= bounds.start && task.dueAt <= bounds.end)
      .sort(byDue);
    const listed = new Set([...overdue, ...dueToday].map((task) => task._id));
    // Planned for today or earlier and still open, and not already listed by its deadline.
    const scheduled = open
      .filter((task) => !listed.has(task._id) && task.scheduledFor !== undefined && task.scheduledFor <= bounds.end)
      .sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0));
    const waiting = open.filter((task) => task.status === "waiting");

    return {
      date,
      timeZone: settings.timeZone,
      overdue: await Promise.all(overdue.map(show)),
      dueToday: await Promise.all(dueToday.map(show)),
      scheduled: await Promise.all(scheduled.map(show)),
      waiting: await Promise.all(waiting.map(show)),
    };
  },
});

export const changesSince = internalQuery({
  args: { since: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const settings = await getSettings(ctx);
    const since = when(args.since, settings.timeZone, "start", "since") as number;
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 100), 1), 500);
    const rows = await ctx.db
      .query("activityEvents")
      .withIndex("by_at", (q) => q.gt("at", since))
      .take(limit + 1);
    const events = rows.slice(0, limit);
    return {
      since: new Date(since).toISOString(),
      events: events.map((event) => ({
        at: new Date(event.at).toISOString(),
        by: actorLabel(event.actor),
        actor: event.actor,
        type: event.activityType,
        summary: event.summary,
        entity: event.entityRef,
        diff: event.diff,
      })),
      // When true, call again with `since` set to the last event's `at`.
      more: rows.length > limit,
    };
  },
});
