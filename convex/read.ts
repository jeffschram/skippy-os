import { actorLabel, dayBounds, localDate, WhenError, type EntityType, type SearchableType } from "@skippy/shared";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { eventsBetween, liveRecurrences, presentEvent, presentRecurrence } from "./agenda";
import { searchCaptures } from "./captures";
import { describeFile, filesOn } from "./files";
import { presentGoal } from "./goals";
import { getSettings, refuse, requireText, when } from "./lib/common";
import { findEntity, mention, requireEntity, type Found } from "./lib/entities";
import { LINK_LIMIT } from "./lib/links";
import { listSources } from "./lib/sources";
import { presentKnowledge } from "./knowledge";
import { presentCompany, presentPerson } from "./people";
import { presentProject } from "./projects";
import { entityType, searchableType } from "./schema";
import { presentTask } from "./tasks";
import { areaNames } from "./lib/areas";

/** Read operations that cut across record types. Internal, run through `gateway.call`. */

const OPEN = ["todo", "in_progress", "waiting"] as const;

/** Open tasks that need attention on one day: overdue, due, planned and waiting. */
export async function readToday(ctx: QueryCtx, args: { date?: string; now: number }) {
  const settings = await getSettings(ctx);
  const areas = await areaNames(ctx);
  const date = args.date?.trim() || localDate(args.now, settings.timeZone);
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
    return presentTask(task, task.projectId ? slugs.get(task.projectId) : undefined, settings.timeZone, areas);
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
    /** What is on that day, soonest first. */
    events: await eventsBetween(ctx, bounds.start, bounds.end, settings.timeZone, 50),
    /** Recurring things that are due, overdue, or inside their lead time. Complete one with complete_recurrence. */
    recurrences: (await liveRecurrences(ctx, date)).filter((item) => item.comingUp),
    overdue: await Promise.all(overdue.map(show)),
    dueToday: await Promise.all(dueToday.map(show)),
    scheduled: await Promise.all(scheduled.map(show)),
    waiting: await Promise.all(waiting.map(show)),
  };
}

export const today = internalQuery({
  args: { date: v.optional(v.string()) },
  handler: (ctx, args) => readToday(ctx, { date: args.date, now: Date.now() }),
});

/** The newest lines of the activity log, newest first. */
export async function recentActivity(ctx: QueryCtx, limit: number) {
  const rows = await ctx.db.query("activityEvents").withIndex("by_at").order("desc").take(limit);
  return rows.map((event) => ({
    id: event._id,
    at: new Date(event.at).toISOString(),
    by: actorLabel(event.actor),
    type: event.activityType,
    summary: event.summary,
    entityType: event.entityRef?.entityType,
  }));
}

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

/** A few words either side of the first place a search term appears. */
function snippet(text: string, title: string, query: string): string | undefined {
  const body = text.startsWith(title) ? text.slice(title.length).trim() : text;
  if (!body) return undefined;
  const flat = body.replace(/\s+/g, " ");
  const lower = flat.toLowerCase();
  const hits = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => lower.indexOf(term))
    .filter((at) => at >= 0);
  const start = Math.max(0, (hits.length > 0 ? Math.min(...hits) : 0) - 60);
  const piece = flat.slice(start, start + 220);
  return `${start > 0 ? "…" : ""}${piece}${start + 220 < flat.length ? "…" : ""}`;
}

/** Word search across every searchable record, best match first. */
export async function runSearch(
  ctx: QueryCtx,
  args: { query: string; type?: SearchableType; limit?: number },
) {
  {
    const query = requireText(args.query, "query");
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 10), 1), 25);
    const type = args.type;
    const rows = await ctx.db
      .query("searchDocs")
      .withSearchIndex("by_text", (q) =>
        type ? q.search("text", query).eq("entityType", type) : q.search("text", query),
      )
      .take(limit);
    const results: { type: EntityType | "capture"; id: string; title: string; state?: string; snippet?: string }[] = [];
    for (const row of rows) {
      const entity = await findEntity(ctx, row.entityType, row.entityId);
      if (!entity) continue;
      results.push({ ...mention(entity), snippet: snippet(row.text, row.title, query) });
    }
    // Captures that nobody has filed yet are found too, so nothing dropped in is lost to search.
    if (!type) results.push(...(await searchCaptures(ctx, query, Math.max(limit - results.length, 3))));
    // Best match first. Call get_context_bundle with a result's type and id to read it in full;
    // a result of type "capture" is read with list_captures.
    return { query, results };
  }
}

export const search = internalQuery({
  args: { query: v.string(), type: v.optional(searchableType), limit: v.optional(v.number()) },
  handler: (ctx, args) => runSearch(ctx, args),
});

/** The record itself, in the same shape the tool that writes it returns. */
async function presentRecord(ctx: QueryCtx, entity: Found, now: number) {
  const settings = await getSettings(ctx);
  const areas = await areaNames(ctx);
  const { entityType: type, entityId } = entity.ref;
  switch (type) {
    case "project": {
      const doc = (await ctx.db.get(entityId as Id<"projects">))!;
      return presentProject(doc, settings, now);
    }
    case "task": {
      const doc = (await ctx.db.get(entityId as Id<"tasks">))!;
      const slug = doc.projectId ? (await ctx.db.get(doc.projectId))?.slug : undefined;
      return presentTask(doc, slug, settings.timeZone, areas);
    }
    case "person":
      return await presentPerson(ctx, (await ctx.db.get(entityId as Id<"people">))!, settings.timeZone);
    case "company":
      return presentCompany((await ctx.db.get(entityId as Id<"companies">))!);
    case "knowledge":
      return presentKnowledge((await ctx.db.get(entityId as Id<"knowledge">))!, settings.timeZone);
    case "event": {
      const doc = (await ctx.db.get(entityId as Id<"calendarEvents">))!;
      const slug = doc.projectId ? (await ctx.db.get(doc.projectId))?.slug : undefined;
      return presentEvent(doc, slug, settings.timeZone);
    }
    case "recurrence":
      return presentRecurrence((await ctx.db.get(entityId as Id<"recurrences">))!, localDate(now, settings.timeZone), areas);
    case "goal":
      return presentGoal((await ctx.db.get(entityId as Id<"goals">))!);
    default:
      return mention(entity);
  }
}

/** One record with what surrounds it: its links, its sources and its latest history. */
export async function readBundle(ctx: QueryCtx, args: { type: EntityType; id: string; now: number }) {
  {
    const now = args.now;
    const entity = await requireEntity(ctx, args);
    const { entityId } = entity.ref;

    const outgoing = await ctx.db
      .query("relationships")
      .withIndex("by_from", (q) => q.eq("from.entityId", entityId))
      .take(LINK_LIMIT + 1);
    const incoming = await ctx.db
      .query("relationships")
      .withIndex("by_to", (q) => q.eq("to.entityId", entityId))
      .take(LINK_LIMIT + 1);
    const links = [];
    for (const [direction, rows] of [
      ["outgoing", outgoing.slice(0, LINK_LIMIT)],
      ["incoming", incoming.slice(0, LINK_LIMIT)],
    ] as const) {
      for (const row of rows) {
        const end = direction === "outgoing" ? row.to : row.from;
        const other = await findEntity(ctx, end.entityType, end.entityId);
        if (!other) continue;
        links.push({ direction, relation: row.type, record: mention(other), reason: row.reason });
      }
    }

    const activity = await ctx.db
      .query("activityEvents")
      .withIndex("by_entity", (q) => q.eq("entityRef.entityId", entityId))
      .order("desc")
      .take(5);

    return {
      type: entity.ref.entityType,
      id: entity.publicId,
      record: await presentRecord(ctx, entity, now),
      // "outgoing" reads as: this record <relation> the other. "incoming" reads the other way round.
      links,
      moreLinks: outgoing.length > LINK_LIMIT || incoming.length > LINK_LIMIT,
      sources: await listSources(ctx, entity.ref),
      /** What files the record holds. They are opened from the dashboard; there is no tool that reads one. */
      files: (await filesOn(ctx, entityId)).map(describeFile),
      recentActivity: activity.map((event) => ({
        at: new Date(event.at).toISOString(),
        by: actorLabel(event.actor),
        type: event.activityType,
        summary: event.summary,
      })),
    };
  }
}

export const contextBundle = internalQuery({
  args: { type: entityType, id: v.string() },
  handler: (ctx, args) => readBundle(ctx, { ...args, now: Date.now() }),
});
