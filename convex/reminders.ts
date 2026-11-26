import { zoneOffsetMs } from "@skippy/shared";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { getSettings, refuse } from "./lib/common";
import { notify } from "./push";

/**
 * Reminders before events and tasks that have a time of day. Each one carries
 * how many minutes ahead to remind; missing means the standard fifteen, and
 * "none" means no reminder. A job runs every minute and sends the ones whose
 * moment has just come, through the same notifications as everything else, so
 * quiet hours hold and nothing is sent twice.
 */

export const DEFAULT_REMIND_MINUTES = 15;
/** A day ahead is the furthest a reminder can be set. */
export const MAX_REMIND_MINUTES = 24 * 60;
/** A job that runs late still sends a reminder up to this long after its moment. */
const CATCH_UP_MS = 5 * 60_000;
const MINUTE_MS = 60_000;

/** What callers send: minutes ahead, or null for no reminder. */
export const remindArg = v.optional(v.union(v.number(), v.null()));

/** Checks what a caller sent and turns it into what is stored. */
export function storedRemind(value: number | null | undefined): number | "none" | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "none";
  if (!Number.isInteger(value) || value < 0 || value > MAX_REMIND_MINUTES) {
    throw refuse("invalid_arguments", `remindMinutes must be a whole number of minutes from 0 to ${MAX_REMIND_MINUTES}, or null for no reminder.`);
  }
  return value;
}

/** What a page or tool is shown: minutes ahead, or null for no reminder. */
export function showRemind(stored: number | "none" | undefined): number | null {
  if (stored === "none") return null;
  return stored ?? DEFAULT_REMIND_MINUTES;
}

/** The owner's clock at a moment, as minutes past midnight. */
function minuteOfDay(at: number, timeZone: string): number {
  const shifted = new Date(at + zoneOffsetMs(at, timeZone));
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/**
 * The moment a task is reminded about, when it has a time of day: when it is
 * planned for, or else when it is due. A bare day is kept as the start of the
 * day when planned and as 23:59 when due, so those have no time of their own.
 */
export function taskTime(
  task: Pick<Doc<"tasks">, "scheduledFor" | "dueAt">,
  timeZone: string,
): { at: number; which: "planned" | "due" } | undefined {
  if (task.scheduledFor !== undefined && minuteOfDay(task.scheduledFor, timeZone) !== 0) return { at: task.scheduledFor, which: "planned" };
  if (task.dueAt !== undefined && minuteOfDay(task.dueAt, timeZone) !== 23 * 60 + 59) return { at: task.dueAt, which: "due" };
  return undefined;
}

/** "3:05 PM" on the owner's clock. */
export function clock(at: number, timeZone: string): string {
  const minutes = minuteOfDay(at, timeZone);
  const hour = Math.floor(minutes / 60);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** "in 15 minutes", "in 1 hour", "in a day", or "now". */
export function ahead(minutes: number): string {
  if (minutes === 0) return "now";
  if (minutes % 1440 === 0) return minutes === 1440 ? "in a day" : `in ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "in 1 hour" : `in ${minutes / 60} hours`;
  return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
}

/** Whether a reminder set for `fireAt` is due now: its moment has come, and not too long ago. */
function dueNow(fireAt: number, now: number): boolean {
  return fireAt <= now && fireAt > now - CATCH_UP_MS;
}

const OPEN = new Set<Doc<"tasks">["status"]>(["todo", "in_progress", "waiting"]);

/** Sends the reminders whose moment has come. Runs every minute. */
export const sendDue = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    const now = Date.now();
    const settings = await getSettings(ctx);
    // Anything that starts between a moment ago and a day ahead may have a reminder due.
    const from = now - CATCH_UP_MS;
    const to = now + MAX_REMIND_MINUTES * MINUTE_MS;
    let sent = 0;

    const events = await ctx.db
      .query("calendarEvents")
      .withIndex("by_start", (q) => q.gt("startAt", from).lte("startAt", to))
      .collect();
    for (const event of events) {
      if (event.allDay || event.status === "cancelled" || event.doneAt !== undefined) continue;
      const minutes = showRemind(event.remindMinutes);
      if (minutes === null) continue;
      const fireAt = event.startAt - minutes * MINUTE_MS;
      if (!dueNow(fireAt, now)) continue;
      const when = minutes === 0 ? `Starting now, ${clock(event.startAt, settings.timeZone)}` : `Starts ${ahead(minutes)}, at ${clock(event.startAt, settings.timeZone)}`;
      await notify(ctx, {
        dedupeKey: `remind:event:${event._id}:${fireAt}`,
        type: "reminder",
        title: event.title,
        body: event.location ? `${when} · ${event.location}` : when,
        url: `/?item=event:${event._id}`,
      });
      sent += 1;
    }

    // A task is reminded about at the time it is planned for, or else the time it is due.
    const seen = new Set<string>();
    const candidates = [
      ...(await ctx.db.query("tasks").withIndex("by_scheduled", (q) => q.gt("scheduledFor", from).lte("scheduledFor", to)).collect()),
      ...(await ctx.db.query("tasks").withIndex("by_due", (q) => q.gt("dueAt", from).lte("dueAt", to)).collect()),
    ];
    for (const task of candidates) {
      if (seen.has(task._id)) continue;
      seen.add(task._id);
      if (!OPEN.has(task.status)) continue;
      const moment = taskTime(task, settings.timeZone);
      const minutes = showRemind(task.remindMinutes);
      if (!moment || minutes === null) continue;
      const fireAt = moment.at - minutes * MINUTE_MS;
      if (!dueNow(fireAt, now)) continue;
      const label = moment.which === "planned" ? "Planned for" : "Due at";
      const when = `${label} ${clock(moment.at, settings.timeZone)}${minutes === 0 ? "" : `, ${ahead(minutes)}`}`;
      await notify(ctx, {
        dedupeKey: `remind:task:${task._id}:${fireAt}`,
        type: "reminder",
        title: task.title,
        body: task.location ? `${when} · ${task.location}` : when,
        url: `/?task=${task._id}`,
      });
      sent += 1;
    }
    return { sent };
  },
});
