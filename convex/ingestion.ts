import { actorLabel, INGEST_SOURCES, localDate, type IngestSource } from "@skippy/shared";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { dailyBriefing } from "./briefing";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { cleanText, getSettings, iso, refuse, requireText, when } from "./lib/common";
import { findEntity, mention, type Ref } from "./lib/entities";
import { destroyRecord } from "./lib/remove";
import { indexEvent } from "./lib/searchIndex";
import { attachSource } from "./lib/sources";
import { actor, ingestSource, knowledgeKind } from "./schema";

/**
 * Ingestion: a scheduled Claude task reads the owner's calendar, mail and
 * messages with its own connectors, and writes what matters here. Skippy OS
 * holds the rules it follows, how far it has read, what each pass made, and
 * the way to undo any of it. It never stores the full text of an email or a
 * message: a short summary and a pointer back.
 *
 * Internal: run through `gateway.call` or the web app's own functions.
 */

export const LOOKBACK_DAYS = 14;
/** A run that has not finished after this long is taken to have died. */
const STALE_RUN_MS = 45 * 60_000;
const MAX_SUMMARY = 600;

/** How ingestion judges what it reads. The owner's own rules and block list are added to these. */
export const RUBRIC = [
  "Create records without asking first. The owner sees what each pass made and can undo any of it.",
  "Nothing leaves: never send, reply, accept, decline or change anything in a source. Reading only.",
  "Drop promotions, newsletters, spam, receipts with nothing to do, verification codes, and anything the block list names.",
  "Make a task only for a clear ask: someone asks the owner to do something, the owner said they would do something, or there is a date attached, such as a bill, a deadline or a form to return.",
  "Make an event for something with a time that is not already on the calendar.",
  "Make a person for someone new who wrote to the owner as a person, not as a company's system.",
  "Make a memory for a lasting fact worth knowing about the owner or the people around them. One fact per record.",
  "Everything else worth knowing goes in the day's briefing, not in a record.",
  "Store a one or two line summary and a pointer back. Never copy the body of an email or a message.",
  "When unsure whether something matters, leave it out.",
];

function shorten(text: string, field: string): string {
  const clean = requireText(text, field);
  return clean.length > MAX_SUMMARY ? `${clean.slice(0, MAX_SUMMARY - 1)}…` : clean;
}

async function runOrRefuse(ctx: QueryCtx, given: string): Promise<Doc<"ingestionRuns">> {
  const id = ctx.db.normalizeId("ingestionRuns", given);
  const run = id ? await ctx.db.get(id) : null;
  if (!run) throw refuse("not_found", `There is no ingestion run with the id "${given}". Start one with record_ingestion_run.`);
  if (run.status !== "running") throw refuse("invalid_arguments", "That run has ended. Start a new one with record_ingestion_run.");
  return run;
}

export function presentRule(rule: Doc<"ingestionRules">) {
  return { id: rule._id, kind: rule.kind, source: rule.source, text: rule.text, active: rule.active };
}

/** What a pass reads before it starts: how to judge, what to leave out, and where each source was left. */
export const rubric = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const settings = await getSettings(ctx);
    const briefing = await dailyBriefing(ctx, localDate(now, settings.timeZone));
    const rules = (await ctx.db.query("ingestionRules").collect()).filter((rule) => rule.active);
    const cursors: Record<string, string | null> = {};
    for (const source of INGEST_SOURCES) {
      const row = await ctx.db
        .query("sourceCursors")
        .withIndex("by_source", (q) => q.eq("source", source))
        .first();
      // A source the old Skippy read is picked up where it stopped, so its mail is not gone through twice.
      cursors[source] = row?.cursor ?? (await importedUpTo(ctx, source, now));
    }
    return {
      now: new Date(now).toISOString(),
      today: localDate(now, settings.timeZone),
      timeZone: settings.timeZone,
      rubric: RUBRIC,
      /** The owner's own rules. They win over the rubric where they differ. */
      rules: rules.filter((rule) => rule.kind === "rule").map(presentRule),
      /** Senders, conversations and calendars to leave out entirely. */
      blockList: rules.filter((rule) => rule.kind === "block").map(presentRule),
      /** Where each source was left. null means it has never been read: look back `firstRunLookbackDays`. */
      cursors,
      /** Whether today's briefing has been written. The first pass of the day writes it; every later pass rewrites it. */
      briefingWritten: briefing !== null,
      /** Today's briefing as it stands, for a later pass to bring up to date. */
      briefing: briefing ? { text: briefing.text, writtenAt: iso(briefing.updatedAt)! } : null,
      firstRunLookbackDays: LOOKBACK_DAYS,
    };
  },
});

const sourceReport = v.object({
  source: ingestSource,
  read: v.number(),
  skipped: v.number(),
  error: v.optional(v.string()),
});

/** Opens a run, or closes one with what it read. */
export const recordRun = internalMutation({
  args: {
    actor,
    runId: v.optional(v.string()),
    status: v.union(v.literal("started"), v.literal("finished"), v.literal("failed")),
    pass: v.optional(v.string()),
    sources: v.optional(v.array(sourceReport)),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (args.status === "started") {
      const latest = await ctx.db.query("ingestionRuns").withIndex("by_started").order("desc").first();
      if (latest?.status === "running") {
        if (now - latest.startedAt < STALE_RUN_MS) {
          throw refuse("run_in_progress", "Another ingestion run is still going. Stop here; the next pass will pick up from the cursors.");
        }
        await ctx.db.patch(latest._id, { status: "failed", finishedAt: now, note: "Did not finish; closed when the next run started." });
      }
      const pass = cleanText(args.pass) ?? undefined;
      const id = await ctx.db.insert("ingestionRuns", {
        startedAt: now,
        status: "running",
        ...(pass ? { pass } : {}),
        actor: args.actor,
        sources: [],
      });
      return { runId: id, status: "running" as const };
    }
    if (args.runId === undefined) throw refuse("invalid_arguments", "Give the runId that record_ingestion_run returned when the run started.");
    const run = await runOrRefuse(ctx, args.runId);
    const note = cleanText(args.note) ?? undefined;
    await ctx.db.patch(run._id, {
      status: args.status,
      finishedAt: now,
      sources: args.sources ?? [],
      ...(note ? { note } : {}),
    });
    const made = await ctx.db
      .query("ingestionReceipts")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .collect();
    const errors = (args.sources ?? []).filter((source) => source.error).map((source) => `${source.source}: ${source.error}`);
    // One line for the whole pass. The records it made have their own lines.
    await ctx.db.insert("activityEvents", {
      activityType: args.status === "finished" ? "ingestion.finished" : "ingestion.failed",
      actor: args.actor,
      at: now,
      summary:
        `Ingestion ${run.pass ? `(${run.pass}) ` : ""}${args.status}: made ${made.length} record${made.length === 1 ? "" : "s"}` +
        (errors.length > 0 ? `; problems: ${errors.join("; ")}` : ""),
    });
    return { runId: run._id, status: args.status, made: made.length };
  },
});

/** Notes how far a source has been read, so the next pass starts there. */
export const advanceCursor = internalMutation({
  args: { actor, runId: v.string(), source: ingestSource, cursor: v.string() },
  handler: async (ctx, args) => {
    const run = await runOrRefuse(ctx, args.runId);
    const cursor = requireText(args.cursor, "cursor").slice(0, 500);
    const row = await ctx.db
      .query("sourceCursors")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .first();
    if (row) await ctx.db.patch(row._id, { cursor, updatedAt: Date.now(), runId: run._id });
    else await ctx.db.insert("sourceCursors", { source: args.source, cursor, updatedAt: Date.now(), runId: run._id });
    return { source: args.source, cursor };
  },
});

/**
 * The time of the newest thing the import brought across for a source, when
 * that is inside the look-back window. It stands in for a cursor until the
 * first pass sets a real one.
 */
async function importedUpTo(ctx: QueryCtx, source: IngestSource, now: number): Promise<string | null> {
  if (source === "google_calendar") return null;
  const rows = await ctx.db
    .query("sourceRefs")
    .withIndex("by_external", (q) => q.eq("sourceSystem", source))
    .collect();
  const newest = rows.reduce((latest, row) => Math.max(latest, row.sourceTimestamp ?? 0), 0);
  return newest > now - LOOKBACK_DAYS * 86_400_000 ? new Date(newest).toISOString() : null;
}

/**
 * Whether something in a source already has a record that ingestion did not
 * make: one the import brought across, or one saved by hand with that source.
 * The old Skippy filed mail by `messageId`; ingestion files it by `externalId`.
 */
async function onFileBefore(ctx: QueryCtx, source: IngestSource, externalId: string): Promise<boolean> {
  const ours = await ctx.db
    .query("ingestionReceipts")
    .withIndex("by_key", (q) => q.eq("source", source).gte("key", `${externalId}:`).lt("key", `${externalId}:\uffff`))
    .first();
  if (ours) return false;
  const known =
    (await ctx.db
      .query("sourceRefs")
      .withIndex("by_message", (q) => q.eq("sourceSystem", source).eq("messageId", externalId))
      .first()) ??
    (await ctx.db
      .query("sourceRefs")
      .withIndex("by_external", (q) => q.eq("sourceSystem", source).eq("externalId", externalId))
      .first());
  if (!known) return false;
  const attached = await ctx.db
    .query("entitySourceRefs")
    .withIndex("by_source", (q) => q.eq("sourceRefId", known._id))
    .first();
  return attached !== null;
}

async function receiptFor(ctx: QueryCtx, source: IngestSource, key: string) {
  return await ctx.db
    .query("ingestionReceipts")
    .withIndex("by_key", (q) => q.eq("source", source).eq("key", key))
    .first();
}

// The calendar mirror

const calendarEvent = v.object({
  /** The event's id in Google Calendar. */
  id: v.string(),
  title: v.string(),
  /** As the calendar gives it: a date for an all-day event, or a time with its offset. */
  start: v.string(),
  end: v.optional(v.string()),
  location: v.optional(v.string()),
  description: v.optional(v.string()),
  url: v.optional(v.string()),
  cancelled: v.optional(v.boolean()),
});

const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Copies a stretch of one Google calendar into Skippy OS. The copy is
 * read-only here. Send every event in the stretch, a page at a time with
 * `more: true`; on the last page, events that were copied before and are no
 * longer in the calendar are marked cancelled. An event whose copy the owner
 * undid is not copied again.
 */
export const syncCalendar = internalMutation({
  args: {
    actor,
    runId: v.string(),
    calendarId: v.string(),
    from: v.string(),
    to: v.string(),
    events: v.array(calendarEvent),
    more: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const settings = await getSettings(ctx);
    const run = await runOrRefuse(ctx, args.runId);
    const from = when(args.from, settings.timeZone, "start", "from") as number;
    const to = when(args.to, settings.timeZone, "end", "to") as number;
    if (to < from) throw refuse("invalid_arguments", "to is before from.");
    const counts = { created: 0, changed: 0, unchanged: 0, cancelled: 0, undone: 0, refused: 0 };
    const refusals: { id: string; message: string }[] = [];

    for (const event of args.events) {
      const key = `${event.id}:event`;
      const receipt = await receiptFor(ctx, "google_calendar", key);
      if (receipt?.undoneAt) {
        counts.undone++;
        continue;
      }
      const allDay = BARE_DAY.test(event.start.trim());
      let startAt: number;
      let endAt: number | undefined;
      try {
        startAt = when(event.start, settings.timeZone, "start", "start") as number;
        const end = event.end === undefined ? undefined : (when(event.end, settings.timeZone, "start", "end") as number);
        // Google gives the day after an all-day event as its end.
        endAt = end === undefined ? undefined : allDay ? Math.max(end - 1, startAt) : Math.max(end, startAt);
      } catch (error) {
        if (!(error instanceof ConvexError)) throw error;
        counts.refused++;
        refusals.push({ id: event.id, message: "its start or end could not be read" });
        continue;
      }
      const description = cleanText(event.description)?.slice(0, 1000);
      const fields = {
        title: cleanText(event.title) || "(no title)",
        startAt,
        endAt,
        allDay: allDay ? true : undefined,
        location: cleanText(event.location) ?? undefined,
        description: description ?? undefined,
        htmlLink: cleanText(event.url) ?? undefined,
        status: event.cancelled ? ("cancelled" as const) : ("confirmed" as const),
      };
      const existing = (
        await ctx.db
          .query("calendarEvents")
          .withIndex("by_external", (q) => q.eq("externalId", event.id))
          .collect()
      ).find((row) => row.origin === "google");

      if (existing) {
        // The description is the pass's own wording and differs from one pass to the next,
        // so it is not what makes an event changed. It is refreshed when something else is.
        const { description: _wording, ...facts } = fields;
        const changed = (Object.keys(facts) as (keyof typeof facts)[]).some((name) => existing[name] !== facts[name]);
        await ctx.db.patch(existing._id, changed ? { ...fields, seenInRun: run._id, updatedBy: args.actor, updatedAt: now } : { seenInRun: run._id });
        if (changed) await indexEvent(ctx, (await ctx.db.get(existing._id))!);
        if (changed) counts.changed++;
        else counts.unchanged++;
        continue;
      }
      // Nothing to copy for an event that was already gone before it was ever seen.
      if (event.cancelled) continue;
      const present = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as typeof fields;
      const id = await ctx.db.insert("calendarEvents", {
        ...present,
        origin: "google",
        externalId: event.id,
        calendarId: args.calendarId,
        seenInRun: run._id,
        createdBy: args.actor,
        updatedBy: args.actor,
        updatedAt: now,
      });
      await indexEvent(ctx, (await ctx.db.get(id))!);
      await ctx.db.insert("ingestionReceipts", {
        runId: run._id,
        source: "google_calendar",
        key,
        entityRef: { entityType: "event", entityId: id },
        action: "created",
        summary: `On your calendar: ${fields.title}`,
        ...(fields.htmlLink ? { url: fields.htmlLink } : {}),
        at: now,
      });
      counts.created++;
    }

    if (!args.more) {
      // What was copied from this stretch of this calendar before, and was not in it this time, is gone.
      const copied = await ctx.db
        .query("calendarEvents")
        .withIndex("by_start", (q) => q.gte("startAt", from).lte("startAt", to))
        .collect();
      for (const row of copied) {
        if (row.origin !== "google" || row.calendarId !== args.calendarId) continue;
        if (row.seenInRun === run._id || row.status === "cancelled") continue;
        await ctx.db.patch(row._id, { status: "cancelled", updatedBy: args.actor, updatedAt: now });
        counts.cancelled++;
      }
    }
    return { calendarId: args.calendarId, ...counts, refusals, done: !args.more };
  },
});

// Everything else ingestion makes

const origin = {
  /** The id of the email, message or thread this came from, in its source. */
  externalId: v.string(),
  /** Tells apart two records of one kind made from the same thing. */
  part: v.optional(v.string()),
  /** A link back to the original, when there is one. */
  url: v.optional(v.string()),
  /** When the original was sent. */
  at: v.optional(v.string()),
  /** One or two lines: what the original says and why this was made. Never the original's text. */
  summary: v.string(),
};

/** One thing to make. The fields for its kind are filled and the rest left out; what is missing is refused item by item. */
const item = v.object({
  kind: v.union(v.literal("task"), v.literal("event"), v.literal("person"), v.literal("knowledge")),
  ...origin,
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  // A task
  dueAt: v.optional(v.string()),
  project: v.optional(v.string()),
  waitingOn: v.optional(v.string()),
  // An event
  startAt: v.optional(v.string()),
  endAt: v.optional(v.string()),
  allDay: v.optional(v.boolean()),
  location: v.optional(v.string()),
  // A person
  name: v.optional(v.string()),
  emails: v.optional(v.array(v.string())),
  phoneNumbers: v.optional(v.array(v.string())),
  company: v.optional(v.string()),
  roleTitle: v.optional(v.string()),
  relationshipContext: v.optional(v.string()),
  // Something to remember
  knowledgeKind: v.optional(knowledgeKind),
  body: v.optional(v.string()),
  linkUrl: v.optional(v.string()),
});

type Made = { ref: Ref; created: boolean };

/**
 * Makes records from what a pass read in mail or messages. Each item names
 * the thing it came from; the same thing sent again makes nothing, whether
 * the first record is still there, was changed, or was undone.
 */
export const ingestObjects = internalMutation({
  args: { actor, runId: v.string(), source: ingestSource, items: v.array(item) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const settings = await getSettings(ctx);
    const run = await runOrRefuse(ctx, args.runId);
    if (args.items.length > 50) throw refuse("invalid_arguments", "Send at most 50 items at a time.");
    const by = args.actor;
    const results = [];
    // Asked once per message at the start: a message's own records in this batch must not count against it.
    const before = new Map<string, boolean>();
    for (const entry of args.items) {
      if (!before.has(entry.externalId)) before.set(entry.externalId, await onFileBefore(ctx, args.source, entry.externalId));
    }

    for (const entry of args.items) {
      const key = `${entry.externalId}:${entry.kind}${entry.part ? `:${entry.part}` : ""}`;
      const seen = await receiptFor(ctx, args.source, key);
      if (seen) {
        results.push({ externalId: entry.externalId, kind: entry.kind, outcome: seen.undoneAt ? ("undone" as const) : ("already" as const) });
        continue;
      }
      if (before.get(entry.externalId)) {
        results.push({ externalId: entry.externalId, kind: entry.kind, outcome: "already" as const, message: "a record made from this before ingestion is on file" });
        continue;
      }
      try {
        const summary = shorten(entry.summary, "summary");
        const made = await make(ctx, by, entry);
        await attachSource(
          ctx,
          made.ref,
          { system: args.source, externalId: entry.externalId, url: entry.url, summary, at: entry.at },
          "created_from",
          settings.timeZone,
          now,
        );
        await ctx.db.insert("ingestionReceipts", {
          runId: run._id,
          source: args.source,
          key,
          entityRef: made.ref,
          action: made.created ? "created" : "updated",
          summary,
          ...(entry.url ? { url: entry.url } : {}),
          at: now,
        });
        results.push({
          externalId: entry.externalId,
          kind: entry.kind,
          outcome: made.created ? ("created" as const) : ("updated" as const),
          type: made.ref.entityType,
          id: made.ref.entityId,
        });
      } catch (error) {
        // One item that does not fit must not lose the rest of the batch.
        if (!(error instanceof ConvexError)) throw error;
        const message = String((error.data as { message?: unknown }).message ?? "refused");
        results.push({ externalId: entry.externalId, kind: entry.kind, outcome: "refused" as const, message });
      }
    }
    return { results };
  },
});

async function make(ctx: MutationCtx, by: Doc<"ingestionRuns">["actor"], entry: typeof item.type): Promise<Made> {
  switch (entry.kind) {
    case "task": {
      const result = await ctx.runMutation(internal.tasks.upsert, {
        actor: by,
        title: requireText(entry.title, "title"),
        ...(entry.description ? { description: entry.description } : {}),
        ...(entry.dueAt ? { dueAt: entry.dueAt } : {}),
        ...(entry.project ? { project: entry.project } : {}),
        ...(entry.waitingOn ? { waitingOn: entry.waitingOn, status: "waiting" as const } : {}),
      });
      return { ref: { entityType: "task", entityId: result.task.id }, created: true };
    }
    case "event": {
      const result = await ctx.runMutation(internal.agenda.upsertEvent, {
        actor: by,
        title: requireText(entry.title, "title"),
        startAt: requireText(entry.startAt, "startAt"),
        ...(entry.endAt ? { endAt: entry.endAt } : {}),
        ...(entry.allDay !== undefined ? { allDay: entry.allDay } : {}),
        ...(entry.location ? { location: entry.location } : {}),
        ...(entry.description ? { description: entry.description } : {}),
      });
      return { ref: { entityType: "event", entityId: result.event.id }, created: true };
    }
    case "person": {
      const result = await ctx.runMutation(internal.people.upsert, {
        actor: by,
        name: requireText(entry.name, "name"),
        ...(entry.emails ? { emails: entry.emails } : {}),
        ...(entry.phoneNumbers ? { phoneNumbers: entry.phoneNumbers } : {}),
        ...(entry.company ? { company: entry.company } : {}),
        ...(entry.roleTitle ? { roleTitle: entry.roleTitle } : {}),
        ...(entry.relationshipContext ? { relationshipContext: entry.relationshipContext } : {}),
      });
      return { ref: { entityType: "person", entityId: result.person.id }, created: result.created };
    }
    case "knowledge": {
      const result = await ctx.runMutation(internal.knowledge.upsert, {
        actor: by,
        kind: entry.knowledgeKind ?? "memory",
        ...(entry.title ? { title: entry.title } : {}),
        ...(entry.body ? { body: entry.body } : {}),
        ...(entry.linkUrl ? { url: entry.linkUrl } : {}),
      });
      return { ref: { entityType: "knowledge", entityId: result.knowledge.id }, created: result.created };
    }
  }
}

// What the owner sees and does

async function presentReceipt(ctx: QueryCtx, receipt: Doc<"ingestionReceipts">) {
  const record = await findEntity(ctx, receipt.entityRef.entityType, receipt.entityRef.entityId);
  return {
    id: receipt._id,
    source: receipt.source,
    action: receipt.action,
    summary: receipt.summary,
    url: receipt.url,
    at: iso(receipt.at)!,
    /** What it made. Missing when the record has since been deleted. */
    record: record ? mention(record) : undefined,
    undone: receipt.undoneAt !== undefined,
    undoReason: receipt.undoReason,
  };
}

/** The latest passes with what each made, the rules, and when each source was last read. */
export async function readIngestion(ctx: QueryCtx, args: { runs?: number }) {
  const limit = Math.min(Math.max(Math.floor(args.runs ?? 6), 1), 30);
  const runs = await ctx.db.query("ingestionRuns").withIndex("by_started").order("desc").take(limit);
  const shown = [];
  for (const run of runs) {
    const receipts = await ctx.db
      .query("ingestionReceipts")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .take(300);
    shown.push({
      id: run._id,
      startedAt: iso(run.startedAt)!,
      finishedAt: iso(run.finishedAt),
      status: run.status,
      pass: run.pass,
      by: actorLabel(run.actor),
      sources: run.sources,
      note: run.note,
      made: await Promise.all(receipts.map((receipt) => presentReceipt(ctx, receipt))),
    });
  }
  const health = [];
  for (const source of INGEST_SOURCES) {
    const cursor = await ctx.db
      .query("sourceCursors")
      .withIndex("by_source", (q) => q.eq("source", source))
      .first();
    const lastRead = runs.find((run) => run.sources.some((entry) => entry.source === source));
    health.push({
      source,
      /** When the source was last read to the end. Missing means never. */
      coveredAt: iso(cursor?.updatedAt),
      lastError: lastRead?.sources.find((entry) => entry.source === source)?.error,
    });
  }
  return {
    runs: shown,
    health,
    rules: (await ctx.db.query("ingestionRules").collect()).map(presentRule),
  };
}

/**
 * Takes back what ingestion made: the record is deleted, and the thing it came
 * from will not be made into a record again. A reason becomes a rule later
 * passes follow. A record the owner has changed since is kept unless `force`.
 */
export const undo = internalMutation({
  args: { actor, receiptId: v.string(), reason: v.optional(v.string()), force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = ctx.db.normalizeId("ingestionReceipts", args.receiptId);
    const receipt = id ? await ctx.db.get(id) : null;
    if (!receipt) throw refuse("not_found", "That is no longer in the list.");
    if (receipt.undoneAt) return { undone: false, already: true };
    if (receipt.action !== "created") {
      throw refuse("invalid_arguments", "This only added to a record that was already there, so there is nothing to take back.");
    }
    const record = await findEntity(ctx, receipt.entityRef.entityType, receipt.entityRef.entityId);
    if (record && !args.force) {
      const tables = { task: "tasks", event: "calendarEvents", person: "people", knowledge: "knowledge" } as const;
      const table = tables[receipt.entityRef.entityType as keyof typeof tables];
      const docId = table ? ctx.db.normalizeId(table, receipt.entityRef.entityId) : null;
      const doc = docId ? await ctx.db.get(docId) : null;
      if (doc && doc.updatedBy.kind === "user" && doc.updatedAt > receipt.at) {
        throw refuse("edited_since", `You have changed "${record.title}" since it was made. Undo would delete it with your changes.`);
      }
    }
    if (record) await destroyRecord(ctx, receipt.entityRef);
    const reason = cleanText(args.reason) ?? undefined;
    await ctx.db.patch(receipt._id, { undoneAt: now, ...(reason ? { undoReason: reason } : {}) });
    if (reason) {
      await ctx.db.insert("ingestionRules", {
        kind: "rule",
        source: receipt.source,
        text: `${reason} (From an undo of: ${receipt.summary.slice(0, 200)})`,
        active: true,
        fromReceiptId: receipt._id,
        createdBy: args.actor,
        updatedBy: args.actor,
        updatedAt: now,
      });
    }
    await ctx.db.insert("activityEvents", {
      activityType: "ingestion.undone",
      actor: args.actor,
      at: now,
      summary: `Undid "${record?.title ?? receipt.summary}"${reason ? `: ${reason}` : ""}`,
    });
    return { undone: true, already: false, ruleAdded: Boolean(reason) };
  },
});

/** Adds a rule or a block, or changes one when `id` is given. */
export const saveRule = internalMutation({
  args: {
    actor,
    id: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("block"), v.literal("rule"))),
    source: v.optional(v.union(ingestSource, v.null())),
    text: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (args.id !== undefined) {
      const id = ctx.db.normalizeId("ingestionRules", args.id);
      const rule = id ? await ctx.db.get(id) : null;
      if (!rule) throw refuse("not_found", "That rule is no longer there.");
      await ctx.db.patch(rule._id, {
        ...(args.kind ? { kind: args.kind } : {}),
        ...(args.source !== undefined ? { source: args.source ?? undefined } : {}),
        ...(args.text !== undefined ? { text: requireText(args.text, "text").slice(0, 1000) } : {}),
        ...(args.active !== undefined ? { active: args.active } : {}),
        updatedBy: args.actor,
        updatedAt: now,
      });
      return { id: rule._id };
    }
    const id = await ctx.db.insert("ingestionRules", {
      kind: args.kind ?? "rule",
      ...(args.source ? { source: args.source } : {}),
      text: requireText(args.text, "text").slice(0, 1000),
      active: args.active ?? true,
      createdBy: args.actor,
      updatedBy: args.actor,
      updatedAt: now,
    });
    return { id: id as Id<"ingestionRules"> };
  },
});

export const removeRule = internalMutation({
  args: { actor, id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("ingestionRules", args.id);
    if (!id || !(await ctx.db.get(id))) throw refuse("not_found", "That rule is no longer there.");
    await ctx.db.delete(id);
    return { removed: true };
  },
});
