import {
  checkRule,
  dayBounds,
  describeRule,
  localDate,
  nextOccurrence,
  RuleError,
  zoneOffsetMs,
  type RecurrenceRule,
} from "@skippy/shared";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { buildPatch, cleanText, getSettings, iso, logActivity, refuse, requireText, showWhen, when } from "./lib/common";
import { requireEntity, type Ref } from "./lib/entities";
import { ensureLink } from "./lib/links";
import { indexEvent, indexRecurrence } from "./lib/searchIndex";
import { actor, entityType, eventStatus, recurrenceRule, recurrenceStatus } from "./schema";
import { presentTask } from "./tasks";
import { areaNames, resolveArea } from "./lib/areas";

/**
 * What has a day or a time: calendar events, and things that come round again.
 * Internal: run through `gateway.call` or the web app's own functions.
 */

const nullable = <T extends Parameters<typeof v.optional>[0]>(validator: T) => v.optional(v.union(validator, v.null()));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const HISTORY_KEPT = 50;

/** A day a number of days before or after another. */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function ruleOrRefuse(rule: RecurrenceRule): RecurrenceRule {
  try {
    return checkRule(rule);
  } catch (error) {
    if (error instanceof RuleError) throw refuse("invalid_arguments", error.message);
    throw error;
  }
}

function dayOrRefuse(day: string, field: string): string {
  const text = day.trim();
  if (!DAY.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw refuse("invalid_arguments", `${field} must be a day like 2026-11-25.`);
  }
  return text;
}

// Events

/** A stored time with the owner's local day and clock time, so a page need not know the owner's zone. */
function showMoment(at: number | undefined, timeZone: string) {
  const shown = showWhen(at, timeZone);
  if (!shown || at === undefined) return undefined;
  return { ...shown, time: new Date(at + zoneOffsetMs(at, timeZone)).toISOString().slice(11, 16) };
}

const HOUR_MS = 3_600_000;

/** The instant an event is over, so a page can show it as done once that has passed. */
export function eventOverAt(event: Pick<Doc<"calendarEvents">, "startAt" | "endAt" | "allDay">, timeZone: string): number {
  if (event.endAt !== undefined) return event.endAt;
  if (event.allDay) return dayBounds(localDate(event.startAt, timeZone), timeZone).end;
  return event.startAt + HOUR_MS;
}

export function presentEvent(event: Doc<"calendarEvents">, projectSlug: string | undefined, timeZone: string) {
  return {
    id: event._id,
    title: event.title,
    description: event.description,
    location: event.location,
    start: showMoment(event.startAt, timeZone)!,
    end: showMoment(event.endAt, timeZone),
    allDay: event.allDay ?? false,
    /** When it is over: its end, the end of its day when all day, or an hour after it starts when it has no end. */
    overAt: iso(eventOverAt(event, timeZone))!,
    /** When the owner ticked it off early, if they did. */
    doneAt: iso(event.doneAt),
    status: event.status,
    /** "skippy" events can be changed here. "google" ones are a copy of the owner's calendar. */
    origin: event.origin,
    link: event.htmlLink,
    project: projectSlug,
  };
}

export const upsertEvent = internalMutation({
  args: {
    actor,
    id: v.optional(v.string()),
    title: v.optional(v.string()),
    description: nullable(v.string()),
    location: nullable(v.string()),
    startAt: v.optional(v.string()),
    endAt: nullable(v.string()),
    allDay: v.optional(v.boolean()),
    status: v.optional(eventStatus),
    project: nullable(v.string()),
    about: v.optional(v.array(v.object({ type: entityType, id: v.string() }))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const settings = await getSettings(ctx);

    let existing: Doc<"calendarEvents"> | null = null;
    if (args.id !== undefined) {
      const id = ctx.db.normalizeId("calendarEvents", args.id);
      existing = id ? await ctx.db.get(id) : null;
      if (!existing) throw refuse("not_found", `There is no event with the id "${args.id}".`);
      // A copy from the owner's Google calendar is changed there. Its project and links are
      // Skippy's own, like the done mark, so those can be set here and a pass never touches them.
      if (existing.origin !== "skippy") {
        const theirs = (["title", "description", "location", "startAt", "endAt", "allDay", "status"] as const).filter(
          (name) => args[name] !== undefined,
        );
        if (theirs.length > 0) {
          throw refuse(
            "read_only",
            `That event is a copy from the owner's Google calendar, so ${theirs.join(", ")} can only be changed there. Its project and links can be set here.`,
          );
        }
      }
    }

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

    // A start given as a bare day makes an all-day event unless the caller says otherwise.
    const allDay = args.allDay ?? (args.startAt !== undefined ? DAY.test(args.startAt.trim()) : undefined);
    const wholeDays = allDay ?? existing?.allDay ?? false;
    const startAt = when(args.startAt, settings.timeZone, "start", "startAt") as number | undefined;
    const endAt = when(args.endAt, settings.timeZone, wholeDays ? "end" : "start", "endAt");
    const finalStart = startAt ?? existing?.startAt;
    const finalEnd = endAt === undefined ? existing?.endAt : endAt;
    if (finalStart !== undefined && typeof finalEnd === "number" && finalEnd < finalStart) {
      throw refuse("invalid_arguments", "endAt is before startAt.");
    }

    const fields = {
      title: args.title === undefined ? undefined : requireText(args.title, "title"),
      description: cleanText(args.description),
      location: cleanText(args.location),
      startAt,
      endAt,
      allDay,
      status: args.status,
      projectId,
    };
    const about = await Promise.all(
      (args.about ?? []).map((target, index) => requireEntity(ctx, target, `about[${index}]`)),
    );

    let event: Doc<"calendarEvents">;
    let created = false;
    let diff: ReturnType<typeof buildPatch>["diff"] = {};
    if (existing) {
      const built = buildPatch(existing, fields);
      diff = built.diff;
      if (Object.keys(built.patch).length > 0) {
        await ctx.db.patch(existing._id, { ...built.patch, updatedBy: args.actor, updatedAt: now });
      }
      event = (await ctx.db.get(existing._id))!;
    } else {
      const title = requireText(args.title, "title");
      if (startAt === undefined) throw refuse("invalid_arguments", "A new event needs startAt.");
      const id = await ctx.db.insert("calendarEvents", {
        title,
        startAt,
        ...(typeof endAt === "number" ? { endAt } : {}),
        ...(allDay ? { allDay } : {}),
        ...(fields.description ? { description: fields.description } : {}),
        ...(fields.location ? { location: fields.location } : {}),
        status: args.status ?? "confirmed",
        origin: "skippy",
        ...(projectId ? { projectId } : {}),
        createdBy: args.actor,
        updatedBy: args.actor,
        updatedAt: now,
      });
      event = (await ctx.db.get(id))!;
      created = true;
    }

    const ref: Ref = { entityType: "event", entityId: event._id };
    const linked: string[] = [];
    for (const target of about) {
      const made = await ensureLink(ctx, { from: ref, to: target.ref, type: "related_to", actor: args.actor, at: now });
      if (made) linked.push(target.title);
    }
    const slug = event.projectId ? (await ctx.db.get(event.projectId))?.slug : undefined;
    const shown = presentEvent(event, slug, settings.timeZone);
    if (!created && Object.keys(diff).length === 0 && linked.length === 0) return { created: false, changed: false, event: shown };

    await indexEvent(ctx, event);
    const cancelled = !created && diff.status?.to === "cancelled";
    await logActivity(ctx, {
      entityType: "event",
      entityId: event._id,
      activityType: created ? "event.created" : cancelled ? "event.cancelled" : "event.updated",
      actor: args.actor,
      at: now,
      summary: created
        ? `Added event "${event.title}" on ${shown.start.date}`
        : cancelled
          ? `Cancelled event "${event.title}"`
          : `Updated event "${event.title}": ${[...Object.keys(diff), ...(linked.length > 0 ? ["links"] : [])].join(", ")}`,
      ...(created ? {} : { diff }),
    });
    return { created, changed: true, event: shown };
  },
});

/**
 * Ticks an event off before it is over, or takes the tick away. Works on Google
 * copies too: the mark is Skippy's own and the calendar never sees it.
 */
export const markEventDone = internalMutation({
  args: { actor, id: v.string(), done: v.boolean() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const settings = await getSettings(ctx);
    const id = ctx.db.normalizeId("calendarEvents", args.id);
    const existing = id ? await ctx.db.get(id) : null;
    if (!existing) throw refuse("not_found", `There is no event with the id "${args.id}".`);
    const slug = existing.projectId ? (await ctx.db.get(existing.projectId))?.slug : undefined;
    if ((existing.doneAt !== undefined) === args.done) {
      return { changed: false, event: presentEvent(existing, slug, settings.timeZone) };
    }
    await ctx.db.patch(existing._id, { doneAt: args.done ? now : undefined, updatedBy: args.actor, updatedAt: now });
    await logActivity(ctx, {
      entityType: "event",
      entityId: existing._id,
      activityType: args.done ? "event.done" : "event.reopened",
      actor: args.actor,
      at: now,
      summary: args.done ? `Marked event "${existing.title}" done` : `Took the done mark off event "${existing.title}"`,
    });
    const event = (await ctx.db.get(existing._id))!;
    return { changed: true, event: presentEvent(event, slug, settings.timeZone) };
  },
});

// Recurrences

export function presentRecurrence(item: Doc<"recurrences">, today: string, areas?: Map<Id<"areas">, string>) {
  const showFrom = shiftDay(item.nextDue, -(item.leadTimeDays ?? 0));
  return {
    id: item._id,
    title: item.title,
    description: item.description,
    /** The area of life it sits in, such as Household. */
    area: item.areaId ? areas?.get(item.areaId) : undefined,
    rule: item.rule,
    /** The rule in words. */
    repeats: describeRule(item.rule),
    anchor: item.anchor,
    leadTimeDays: item.leadTimeDays ?? 0,
    status: item.status,
    /** The day it next falls due. Pass this to complete_recurrence. */
    nextDue: item.nextDue,
    overdue: item.status === "active" && item.nextDue < today,
    /** Whether it is close enough to its due day to show under Today. */
    comingUp: item.status === "active" && showFrom <= today,
    lastCompletedAt: iso(item.lastCompletedAt),
    history: (item.history ?? []).slice(-5).map((entry) => ({ at: iso(entry.at)!, outcome: entry.outcome, due: entry.due })),
  };
}

export const upsertRecurrence = internalMutation({
  args: {
    actor,
    id: v.optional(v.string()),
    title: v.optional(v.string()),
    description: nullable(v.string()),
    rule: v.optional(recurrenceRule),
    anchor: v.optional(v.union(v.literal("schedule"), v.literal("completion"))),
    leadTimeDays: nullable(v.number()),
    status: v.optional(recurrenceStatus),
    nextDue: v.optional(v.string()),
    /** An area by name. Null takes it out of its area. */
    area: nullable(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const settings = await getSettings(ctx);
    const areas = await areaNames(ctx);
    const today = localDate(now, settings.timeZone);

    let existing: Doc<"recurrences"> | null = null;
    if (args.id !== undefined) {
      const id = ctx.db.normalizeId("recurrences", args.id);
      existing = id ? await ctx.db.get(id) : null;
      if (!existing) throw refuse("not_found", `There is no recurrence with the id "${args.id}".`);
    }
    const rule = args.rule === undefined ? undefined : ruleOrRefuse(args.rule);
    if (args.leadTimeDays != null && (!Number.isInteger(args.leadTimeDays) || args.leadTimeDays < 0 || args.leadTimeDays > 365)) {
      throw refuse("invalid_arguments", "leadTimeDays must be a whole number of days from 0 to 365.");
    }
    const nextDue = args.nextDue === undefined ? undefined : dayOrRefuse(args.nextDue, "nextDue");
    const fields = {
      title: args.title === undefined ? undefined : requireText(args.title, "title"),
      description: cleanText(args.description),
      rule,
      anchor: args.anchor,
      leadTimeDays: args.leadTimeDays === 0 ? null : args.leadTimeDays,
      status: args.status,
      nextDue,
      areaId: await resolveArea(ctx, args.area),
    };

    if (existing) {
      const { patch, diff } = buildPatch(existing, fields);
      if (Object.keys(patch).length === 0) return { created: false, changed: false, recurrence: presentRecurrence(existing, today, areas) };
      await ctx.db.patch(existing._id, { ...patch, updatedBy: args.actor, updatedAt: now });
      const updated = (await ctx.db.get(existing._id))!;
      await indexRecurrence(ctx, updated);
      await logActivity(ctx, {
        entityType: "recurrence",
        entityId: existing._id,
        activityType: "recurrence.updated",
        actor: args.actor,
        at: now,
        summary: `Updated recurring "${updated.title}": ${Object.keys(diff).join(", ")}`,
        diff,
      });
      return { created: false, changed: true, recurrence: presentRecurrence(updated, today, areas) };
    }

    const title = requireText(args.title, "title");
    if (!rule) throw refuse("invalid_arguments", "A new recurrence needs a rule.");
    // With no first day given: a calendar rule starts on its next day from today on, an interval starts today.
    const first = nextDue ?? (rule.kind === "interval" ? today : nextOccurrence(rule, shiftDay(today, -1)));
    const id = await ctx.db.insert("recurrences", {
      title,
      ...(fields.description ? { description: fields.description } : {}),
      rule,
      anchor: args.anchor ?? (rule.kind === "interval" ? "completion" : "schedule"),
      ...(fields.leadTimeDays ? { leadTimeDays: fields.leadTimeDays } : {}),
      ...(fields.areaId ? { areaId: fields.areaId } : {}),
      status: args.status ?? "active",
      nextDue: first,
      createdBy: args.actor,
      updatedBy: args.actor,
      updatedAt: now,
    });
    const created = (await ctx.db.get(id))!;
    await indexRecurrence(ctx, created);
    await logActivity(ctx, {
      entityType: "recurrence",
      entityId: id,
      activityType: "recurrence.created",
      actor: args.actor,
      at: now,
      summary: `Added recurring "${title}": ${describeRule(rule).toLowerCase()}, first due ${first}`,
    });
    return { created: true, changed: true, recurrence: presentRecurrence(created, today, areas) };
  },
});

/**
 * Marks one round of a recurrence done (or skipped) and moves it to its next
 * day. `due` names the round the caller saw. If the recurrence has already
 * moved on from that day, nothing changes: so two devices, or the owner and an
 * agent, completing the same round advance it once.
 */
export const completeRecurrence = internalMutation({
  args: { actor, id: v.string(), due: v.string(), skip: v.optional(v.boolean()), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const settings = await getSettings(ctx);
    const today = localDate(now, settings.timeZone);
    const id = ctx.db.normalizeId("recurrences", args.id);
    const item = id ? await ctx.db.get(id) : null;
    if (!item) throw refuse("not_found", `There is no recurrence with the id "${args.id}".`);
    const due = dayOrRefuse(args.due, "due");
    const areas = await areaNames(ctx);
    if (item.nextDue !== due) return { changed: false, recurrence: presentRecurrence(item, today, areas) };
    if (item.status === "retired") throw refuse("invalid_arguments", "That recurrence is retired. Set its status to active first.");

    const outcome = args.skip ? ("skipped" as const) : ("completed" as const);
    // Counted from the day it was done, or from the day it was due.
    const next = nextOccurrence(item.rule, item.anchor === "completion" ? today : due);
    const history = [...(item.history ?? []), { at: now, outcome, due }].slice(-HISTORY_KEPT);
    await ctx.db.patch(item._id, {
      nextDue: next,
      history,
      ...(outcome === "completed" ? { lastCompletedAt: now } : {}),
      updatedBy: args.actor,
      updatedAt: now,
    });
    const note = cleanText(args.note);
    await logActivity(ctx, {
      entityType: "recurrence",
      entityId: item._id,
      activityType: outcome === "completed" ? "recurrence.completed" : "recurrence.skipped",
      actor: args.actor,
      at: now,
      summary: `${outcome === "completed" ? "Completed" : "Skipped"} "${item.title}" for ${due}; next due ${next}${note ? `: ${note}` : ""}`,
      diff: { nextDue: { from: due, to: next } },
    });
    return { changed: true, recurrence: presentRecurrence((await ctx.db.get(item._id))!, today, areas) };
  },
});

// Reading

/** Events that touch a span of time, soonest first. Cancelled ones are left out. */
export async function eventsBetween(ctx: QueryCtx, start: number, end: number, timeZone: string, limit = 300) {
  // An event that began up to a week earlier may still be running.
  const rows = await ctx.db
    .query("calendarEvents")
    .withIndex("by_start", (q) => q.gte("startAt", start - 7 * DAY_MS).lte("startAt", end))
    .take(limit * 2);
  const slugs = new Map<Id<"projects">, string | undefined>();
  const shown = [];
  for (const row of rows) {
    if (row.status === "cancelled") continue;
    if ((row.endAt ?? row.startAt) < start) continue;
    if (row.projectId && !slugs.has(row.projectId)) slugs.set(row.projectId, (await ctx.db.get(row.projectId))?.slug);
    shown.push(presentEvent(row, row.projectId ? slugs.get(row.projectId) : undefined, timeZone));
    if (shown.length >= limit) break;
  }
  return shown;
}

/** Recurrences that are not retired, soonest first. */
export async function liveRecurrences(ctx: QueryCtx, today: string) {
  const rows = [];
  for (const status of ["active", "paused"] as const) {
    rows.push(
      ...(await ctx.db
        .query("recurrences")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(500)),
    );
  }
  const areas = await areaNames(ctx);
  return rows.sort((a, b) => a.nextDue.localeCompare(b.nextDue)).map((row) => presentRecurrence(row, today, areas));
}

/** What is on over a run of days: events, recurrences falling due, and tasks with a date in it. */
export async function readAgenda(ctx: QueryCtx, args: { from?: string; days?: number; now: number }) {
  const settings = await getSettings(ctx);
  const areas = await areaNames(ctx);
  const today = localDate(args.now, settings.timeZone);
  const from = args.from === undefined ? today : dayOrRefuse(args.from, "from");
  const days = Math.min(Math.max(Math.floor(args.days ?? 14), 1), 120);
  const to = shiftDay(from, days - 1);
  const start = dayBounds(from, settings.timeZone).start;
  const end = dayBounds(to, settings.timeZone).end;

  const recurrences = (await liveRecurrences(ctx, today)).filter(
    (item) => item.status === "active" && item.nextDue <= to && (item.nextDue >= from || from <= today),
  );
  const tasks = [];
  const slugs = new Map<Id<"projects">, string | undefined>();
  for (const status of ["in_progress", "todo", "waiting"] as const) {
    const rows = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", status))
      .collect();
    for (const row of rows) {
      const at = row.dueAt ?? row.scheduledFor;
      // Overdue tasks ride along when the span starts today or earlier.
      if (at === undefined || at > end || (at < start && from > today)) continue;
      if (row.projectId && !slugs.has(row.projectId)) slugs.set(row.projectId, (await ctx.db.get(row.projectId))?.slug);
      tasks.push({ at, task: presentTask(row, row.projectId ? slugs.get(row.projectId) : undefined, settings.timeZone, areas) });
    }
  }
  return {
    from,
    to,
    today,
    timeZone: settings.timeZone,
    events: await eventsBetween(ctx, start, end, settings.timeZone),
    recurrences,
    tasks: tasks.sort((a, b) => a.at - b.at).map((entry) => entry.task),
  };
}

export const agenda = internalQuery({
  args: { from: v.optional(v.string()), days: v.optional(v.number()) },
  handler: (ctx, args) => readAgenda(ctx, { ...args, now: Date.now() }),
});
