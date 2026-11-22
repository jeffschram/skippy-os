import {
  checkRule,
  IdentityError,
  normalizeEmail,
  normalizePhone,
  normalizeUrl,
  RuleError,
  type Actor,
  type EntityType,
} from "@skippy/shared";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { findLink } from "./lib/links";
import {
  indexCompany,
  indexEvent,
  indexKnowledge,
  indexPerson,
  indexProject,
  indexRecurrence,
  indexTask,
} from "./lib/searchIndex";
import { slugify } from "./projects";
import {
  commitment,
  companyLabel,
  eventStatus,
  lifecycle,
  projectStatus,
  readState,
  recurrenceRule,
  recurrenceStatus,
  relation,
  sourceLink,
  taskStatus,
} from "./schema";

/**
 * Loads the one-time import from the old project (spec §10). Temporary: it goes
 * away with `importMap` once the import is verified.
 *
 * `scripts/import-v1` reads the snapshot, decides what comes across and sends
 * it here in batches, already in the new shape. Records name each other by
 * their old ids; `importMap` turns those into new ones. A record that is
 * already in `importMap` is left alone, so a run that stopped halfway can be
 * started again.
 *
 * Everything here is internal: it runs only from the Convex CLI.
 */

const BY: Actor = { kind: "import", source: "skippy-v1" };

/** What happened to one batch. Every record sent ends up in exactly one of the four. */
type Outcome = {
  imported: number;
  /** Already here from an earlier run, or a link that was already made. */
  already: number;
  /** Folded into a record that was already here, such as the same link saved twice. */
  merged: number;
  skipped: { oldId: string; reason: string }[];
  /** Things worth a look that did not stop the record coming across. */
  notes: { oldId: string; note: string }[];
};
const outcome = (): Outcome => ({ imported: 0, already: 0, merged: 0, skipped: [], notes: [] });

/** Old table name to the new record type. */
const TYPES: Record<string, EntityType> = {
  projects: "project",
  tasks: "task",
  people: "person",
  companies: "company",
  goals: "goal",
  knowledge: "knowledge",
  calendarEvents: "event",
  recurrences: "recurrence",
};

const oldRef = v.object({ table: v.string(), id: v.string() });
const stamps = { createdAt: v.number(), updatedAt: v.number() };

async function mapped(ctx: QueryCtx, oldTable: string, oldId: string): Promise<string | null> {
  const row = await ctx.db
    .query("importMap")
    .withIndex("by_old", (q) => q.eq("oldTable", oldTable).eq("oldId", oldId))
    .unique();
  return row?.newId ?? null;
}

async function remember(ctx: MutationCtx, oldTable: string, oldId: string, newTable: string, newId: string) {
  await ctx.db.insert("importMap", { oldTable, oldId, newTable, newId });
}

async function resolve(ctx: QueryCtx, ref: { table: string; id: string }) {
  const entityType = TYPES[ref.table];
  if (!entityType) return null;
  const entityId = await mapped(ctx, ref.table, ref.id);
  // The map outlives the records: one imported earlier may have been deleted from the dashboard since.
  if (!entityId || !(await ctx.db.get(entityId as Id<"tasks">))) return null;
  return { entityType, entityId };
}

const authored = (record: { createdAt: number; updatedAt: number }) => ({
  createdBy: BY,
  updatedBy: BY,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const NOT_IMPORTED = "points at a record that was not imported, or has been deleted since";

export const recurrences = internalMutation({
  args: {
    records: v.array(
      v.object({
        oldId: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
        rule: recurrenceRule,
        anchor: v.union(v.literal("schedule"), v.literal("completion")),
        leadTimeDays: v.optional(v.number()),
        status: recurrenceStatus,
        nextDue: v.string(),
        lastCompletedAt: v.optional(v.number()),
        history: v.optional(
          v.array(
            v.object({
              at: v.number(),
              outcome: v.union(v.literal("completed"), v.literal("skipped")),
              due: v.optional(v.string()),
            }),
          ),
        ),
        areaOldId: v.optional(v.string()),
        ...stamps,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const result = outcome();
    for (const { oldId, areaOldId, ...record } of args.records) {
      if (await mapped(ctx, "recurrences", oldId)) {
        result.already++;
        continue;
      }
      try {
        checkRule(record.rule);
      } catch (error) {
        if (!(error instanceof RuleError)) throw error;
        result.skipped.push({ oldId, reason: `its rule cannot be followed: ${error.message}` });
        continue;
      }
      const areaId = areaOldId ? await mapped(ctx, "areas", areaOldId) : null;
      const { createdAt, updatedAt, ...fields } = record;
      const id = await ctx.db.insert("recurrences", {
        ...fields,
        ...(areaId ? { areaId: areaId as Id<"areas"> } : {}),
        ...authored({ createdAt, updatedAt }),
      });
      await indexRecurrence(ctx, (await ctx.db.get(id))!);
      await remember(ctx, "recurrences", oldId, "recurrences", id);
      result.imported++;
    }
    return result;
  },
});

export const events = internalMutation({
  args: {
    records: v.array(
      v.object({
        oldId: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
        location: v.optional(v.string()),
        startAt: v.number(),
        endAt: v.optional(v.number()),
        allDay: v.optional(v.boolean()),
        status: eventStatus,
        externalId: v.optional(v.string()),
        calendarId: v.optional(v.string()),
        htmlLink: v.optional(v.string()),
        ...stamps,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const result = outcome();
    for (const { oldId, createdAt, updatedAt, ...record } of args.records) {
      if (await mapped(ctx, "calendarEvents", oldId)) {
        result.already++;
        continue;
      }
      const id = await ctx.db.insert("calendarEvents", {
        ...record,
        ...(record.endAt !== undefined && record.endAt < record.startAt ? { endAt: record.startAt } : {}),
        origin: "skippy",
        ...authored({ createdAt, updatedAt }),
      });
      await indexEvent(ctx, (await ctx.db.get(id))!);
      await remember(ctx, "calendarEvents", oldId, "calendarEvents", id);
      result.imported++;
    }
    return result;
  },
});

export const areas = internalMutation({
  args: { records: v.array(v.object({ oldId: v.string(), name: v.string(), ...stamps })) },
  handler: async (ctx, args) => {
    const result = outcome();
    const existing = await ctx.db.query("areas").collect();
    let order = existing.reduce((max, area) => Math.max(max, area.order), 0);
    for (const record of args.records) {
      if (await mapped(ctx, "areas", record.oldId)) {
        result.already++;
        continue;
      }
      const same = existing.find((area) => area.name.toLowerCase() === record.name.toLowerCase());
      if (same) {
        await remember(ctx, "areas", record.oldId, "areas", same._id);
        result.merged++;
        continue;
      }
      const id = await ctx.db.insert("areas", { name: record.name, order: ++order, ...authored(record) });
      await remember(ctx, "areas", record.oldId, "areas", id);
      result.imported++;
    }
    return result;
  },
});

export const goals = internalMutation({
  args: {
    records: v.array(
      v.object({
        oldId: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
        status: v.union(v.literal("active"), v.literal("paused"), v.literal("achieved"), v.literal("abandoned")),
        ...stamps,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const result = outcome();
    for (const { oldId, ...record } of args.records) {
      if (await mapped(ctx, "goals", oldId)) {
        result.already++;
        continue;
      }
      const id = await ctx.db.insert("goals", {
        title: record.title,
        ...(record.description ? { description: record.description } : {}),
        status: record.status,
        ...authored(record),
      });
      await remember(ctx, "goals", oldId, "goals", id);
      result.imported++;
    }
    return result;
  },
});

export const projects = internalMutation({
  args: {
    records: v.array(
      v.object({
        oldId: v.string(),
        title: v.string(),
        summary: v.optional(v.string()),
        status: projectStatus,
        notesPad: v.string(),
        goalOldId: v.optional(v.string()),
        ...stamps,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const result = outcome();
    for (const { oldId, ...record } of args.records) {
      if (await mapped(ctx, "projects", oldId)) {
        result.already++;
        continue;
      }
      // A slug never changes, so it has to be free before the project is made.
      const base = slugify(record.title) || "project";
      let slug = base;
      for (let n = 2; ; n++) {
        const taken = await ctx.db
          .query("projects")
          .withIndex("by_slug", (q) => q.eq("slug", slug))
          .unique();
        if (!taken) break;
        slug = `${base}-${n}`;
      }
      if (slug !== base) result.notes.push({ oldId, note: `the slug "${base}" was taken, so it is "${slug}"` });
      const goalId = record.goalOldId ? await mapped(ctx, "goals", record.goalOldId) : null;
      const id = await ctx.db.insert("projects", {
        title: record.title,
        slug,
        ...(record.summary ? { summary: record.summary } : {}),
        kind: "general",
        status: record.status,
        notesPad: record.notesPad,
        ...(goalId ? { goalId: goalId as Id<"goals"> } : {}),
        ...authored(record),
      });
      await indexProject(ctx, (await ctx.db.get(id))!);
      await remember(ctx, "projects", oldId, "projects", id);
      result.imported++;
    }
    return result;
  },
});

export const phases = internalMutation({
  args: {
    records: v.array(
      v.object({
        oldId: v.string(),
        projectOldId: v.string(),
        order: v.number(),
        title: v.string(),
        description: v.optional(v.string()),
        ...stamps,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const result = outcome();
    for (const { oldId, ...record } of args.records) {
      if (await mapped(ctx, "phases", oldId)) {
        result.already++;
        continue;
      }
      const projectId = await mapped(ctx, "projects", record.projectOldId);
      if (!projectId) {
        result.skipped.push({ oldId, reason: "its project was not imported" });
        continue;
      }
      const id = await ctx.db.insert("phases", {
        projectId: projectId as Id<"projects">,
        order: record.order,
        title: record.title,
        ...(record.description ? { description: record.description } : {}),
        status: "planned",
        ...authored(record),
      });
      await remember(ctx, "phases", oldId, "phases", id);
      result.imported++;
    }
    return result;
  },
});

export const tasks = internalMutation({
  args: {
    records: v.array(
      v.object({
        oldId: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
        status: taskStatus,
        projectOldId: v.optional(v.string()),
        phaseOldId: v.optional(v.string()),
        areaOldId: v.optional(v.string()),
        commitment: v.optional(commitment),
        dueAt: v.optional(v.number()),
        completedAt: v.optional(v.number()),
        ...stamps,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const result = outcome();
    for (const { oldId, ...record } of args.records) {
      if (await mapped(ctx, "tasks", oldId)) {
        result.already++;
        continue;
      }
      const projectId = record.projectOldId ? await mapped(ctx, "projects", record.projectOldId) : null;
      if (record.projectOldId && !projectId) {
        result.skipped.push({ oldId, reason: "its project was not imported" });
        continue;
      }
      const phaseId = record.phaseOldId ? await mapped(ctx, "phases", record.phaseOldId) : null;
      const areaId = record.areaOldId ? await mapped(ctx, "areas", record.areaOldId) : null;
      const id = await ctx.db.insert("tasks", {
        title: record.title,
        ...(record.description ? { description: record.description } : {}),
        status: record.status,
        ...(projectId ? { projectId: projectId as Id<"projects"> } : {}),
        ...(phaseId ? { phaseId: phaseId as Id<"phases"> } : {}),
        ...(areaId ? { areaId: areaId as Id<"areas"> } : {}),
        ...(record.commitment ? { commitment: record.commitment } : {}),
        ...(record.dueAt !== undefined ? { dueAt: record.dueAt } : {}),
        ...(record.completedAt !== undefined ? { completedAt: record.completedAt } : {}),
        ...authored(record),
      });
      await indexTask(ctx, (await ctx.db.get(id))!);
      await remember(ctx, "tasks", oldId, "tasks", id);
      result.imported++;
    }
    return result;
  },
});

/** Each address or number in its one spelling. Ones that cannot be read are noted and left out. */
function handles(
  values: string[],
  normalize: (value: string) => string,
  oldId: string,
  notes: Outcome["notes"],
): string[] {
  const out: string[] = [];
  for (const value of values) {
    try {
      const normal = normalize(value);
      if (!out.includes(normal)) out.push(normal);
    } catch (error) {
      if (!(error instanceof IdentityError)) throw error;
      notes.push({ oldId, note: `left out ${error.kind} "${value}", which could not be read` });
    }
  }
  return out;
}

export const people = internalMutation({
  args: {
    records: v.array(
      v.object({
        oldId: v.string(),
        name: v.string(),
        emails: v.array(v.string()),
        phoneNumbers: v.array(v.string()),
        roleTitle: v.optional(v.string()),
        relationshipContext: v.optional(v.string()),
        notes: v.optional(v.string()),
        favorite: v.optional(v.boolean()),
        ...stamps,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const result = outcome();
    for (const { oldId, ...record } of args.records) {
      if (await mapped(ctx, "people", oldId)) {
        result.already++;
        continue;
      }
      const emails = handles(record.emails, normalizeEmail, oldId, result.notes);
      const phoneNumbers = handles(record.phoneNumbers, normalizePhone, oldId, result.notes);
      // Someone already here with the same address or number is the same person.
      let owner: Id<"people"> | null = null;
      for (const [kind, values] of [
        ["email", emails],
        ["phone", phoneNumbers],
      ] as const) {
        for (const value of values) {
          const handle = await ctx.db
            .query("personHandles")
            .withIndex("by_value", (q) => q.eq("kind", kind).eq("value", value))
            .first();
          if (handle) owner ??= handle.personId;
        }
      }
      if (owner) {
        await remember(ctx, "people", oldId, "people", owner);
        result.merged++;
        result.notes.push({ oldId, note: "shares an email or phone number with someone already here, so it is that person" });
        continue;
      }
      const id = await ctx.db.insert("people", {
        name: record.name,
        nameKey: record.name.toLowerCase(),
        emails,
        phoneNumbers,
        ...(record.roleTitle ? { roleTitle: record.roleTitle } : {}),
        ...(record.relationshipContext ? { relationshipContext: record.relationshipContext } : {}),
        ...(record.notes ? { notes: record.notes } : {}),
        ...(record.favorite ? { favorite: true } : {}),
        ...authored(record),
      });
      for (const value of emails) await ctx.db.insert("personHandles", { personId: id, kind: "email", value });
      for (const value of phoneNumbers) await ctx.db.insert("personHandles", { personId: id, kind: "phone", value });
      await indexPerson(ctx, (await ctx.db.get(id))!);
      await remember(ctx, "people", oldId, "people", id);
      result.imported++;
    }
    return result;
  },
});

export const companies = internalMutation({
  args: {
    records: v.array(
      v.object({
        oldId: v.string(),
        name: v.string(),
        website: v.optional(v.string()),
        relationshipLabel: v.optional(companyLabel),
        notes: v.optional(v.string()),
        ...stamps,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const result = outcome();
    for (const { oldId, ...record } of args.records) {
      if (await mapped(ctx, "companies", oldId)) {
        result.already++;
        continue;
      }
      const nameKey = record.name.toLowerCase();
      const same = await ctx.db
        .query("companies")
        .withIndex("by_name_key", (q) => q.eq("nameKey", nameKey))
        .first();
      if (same) {
        await remember(ctx, "companies", oldId, "companies", same._id);
        result.merged++;
        continue;
      }
      const id = await ctx.db.insert("companies", {
        name: record.name,
        nameKey,
        ...(record.website ? { website: record.website } : {}),
        ...(record.relationshipLabel ? { relationshipLabel: record.relationshipLabel } : {}),
        ...(record.notes ? { notes: record.notes } : {}),
        ...authored(record),
      });
      await indexCompany(ctx, (await ctx.db.get(id))!);
      await remember(ctx, "companies", oldId, "companies", id);
      result.imported++;
    }
    return result;
  },
});

export const knowledge = internalMutation({
  args: {
    records: v.array(
      v.object({
        oldId: v.string(),
        kind: v.union(
          v.literal("note"),
          v.literal("link"),
          v.literal("memory"),
          v.literal("decision"),
          v.literal("principle"),
          v.literal("question"),
        ),
        title: v.optional(v.string()),
        body: v.optional(v.string()),
        summary: v.optional(v.string()),
        url: v.optional(v.string()),
        readState: v.optional(readState),
        lifecycle,
        whyItMatters: v.optional(v.string()),
        ...stamps,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const result = outcome();
    for (const { oldId, ...record } of args.records) {
      if (await mapped(ctx, "knowledge", oldId)) {
        result.already++;
        continue;
      }
      if (!record.title && !record.body && !record.url) {
        result.skipped.push({ oldId, reason: "has no title, body or web address" });
        continue;
      }
      let normalizedUrl: string | undefined;
      if (record.kind === "link") {
        try {
          normalizedUrl = normalizeUrl(record.url ?? "");
        } catch (error) {
          if (!(error instanceof IdentityError)) throw error;
          result.skipped.push({ oldId, reason: "a link whose web address could not be read" });
          continue;
        }
        // The same link saved twice is one link.
        const address = normalizedUrl;
        const same = (
          await ctx.db
            .query("knowledge")
            .withIndex("by_normalized_url", (q) => q.eq("normalizedUrl", address))
            .collect()
        ).find((row) => row.kind === "link");
        if (same) {
          await remember(ctx, "knowledge", oldId, "knowledge", same._id);
          result.merged++;
          continue;
        }
      }
      const id = await ctx.db.insert("knowledge", {
        kind: record.kind,
        lifecycle: record.lifecycle,
        ...(record.title ? { title: record.title } : {}),
        ...(record.body ? { body: record.body } : {}),
        ...(record.summary ? { summary: record.summary } : {}),
        ...(record.url ? { url: record.url } : {}),
        ...(normalizedUrl ? { normalizedUrl } : {}),
        ...(record.kind === "link" ? { readState: record.readState ?? "saved" } : {}),
        ...(record.whyItMatters ? { whyItMatters: record.whyItMatters } : {}),
        ...authored(record),
      });
      await indexKnowledge(ctx, (await ctx.db.get(id))!);
      await remember(ctx, "knowledge", oldId, "knowledge", id);
      result.imported++;
    }
    return result;
  },
});

export const sources = internalMutation({
  args: {
    records: v.array(
      v.object({
        oldId: v.string(),
        sourceSystem: v.string(),
        externalId: v.optional(v.string()),
        threadId: v.optional(v.string()),
        messageId: v.optional(v.string()),
        eventId: v.optional(v.string()),
        sourceTimestamp: v.optional(v.number()),
        participants: v.optional(v.array(v.string())),
        url: v.optional(v.string()),
        deepLink: v.optional(v.string()),
        excerpt: v.optional(v.string()),
        summary: v.optional(v.string()),
        createdAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const result = outcome();
    for (const { oldId, ...record } of args.records) {
      if (await mapped(ctx, "sourceRefs", oldId)) {
        result.already++;
        continue;
      }
      const id = await ctx.db.insert("sourceRefs", record);
      await remember(ctx, "sourceRefs", oldId, "sourceRefs", id);
      result.imported++;
    }
    return result;
  },
});

export const attachments = internalMutation({
  args: {
    records: v.array(v.object({ oldId: v.string(), entity: oldRef, sourceOldId: v.string(), relationship: sourceLink })),
  },
  handler: async (ctx, args) => {
    const result = outcome();
    for (const record of args.records) {
      const entityRef = await resolve(ctx, record.entity);
      const sourceRefId = (await mapped(ctx, "sourceRefs", record.sourceOldId)) as Id<"sourceRefs"> | null;
      if (!entityRef || !sourceRefId) {
        result.skipped.push({ oldId: record.oldId, reason: NOT_IMPORTED });
        continue;
      }
      const attached = await ctx.db
        .query("entitySourceRefs")
        .withIndex("by_entity", (q) => q.eq("entityRef.entityId", entityRef.entityId))
        .collect();
      if (attached.some((row) => row.sourceRefId === sourceRefId)) {
        result.already++;
        continue;
      }
      await ctx.db.insert("entitySourceRefs", { entityRef, sourceRefId, relationship: record.relationship });
      result.imported++;
    }
    return result;
  },
});

export const links = internalMutation({
  args: {
    records: v.array(
      v.object({
        oldId: v.string(),
        from: oldRef,
        to: oldRef,
        type: relation,
        confidence: v.optional(v.number()),
        reason: v.optional(v.string()),
        createdAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const result = outcome();
    for (const record of args.records) {
      const from = await resolve(ctx, record.from);
      const to = await resolve(ctx, record.to);
      if (!from || !to) {
        result.skipped.push({ oldId: record.oldId, reason: NOT_IMPORTED });
        continue;
      }
      if (from.entityId === to.entityId) {
        result.skipped.push({ oldId: record.oldId, reason: "both ends became the same record" });
        continue;
      }
      if (await findLink(ctx, from, to, record.type)) {
        result.already++;
        continue;
      }
      await ctx.db.insert("relationships", {
        from,
        to,
        type: record.type,
        ...(record.confidence !== undefined ? { confidence: record.confidence } : {}),
        ...(record.reason ? { reason: record.reason } : {}),
        createdBy: BY,
        createdAt: record.createdAt,
      });
      result.imported++;
    }
    return result;
  },
});

/** Every table that holds the owner's records. Settings and the gateway's own bookkeeping are not among them. */
const RECORD_TABLES = [
  "projects",
  "projectUpdates",
  "phases",
  "tasks",
  "people",
  "personHandles",
  "companies",
  "knowledge",
  "relationships",
  "sourceRefs",
  "entitySourceRefs",
  "searchDocs",
  "activityEvents",
  "captures",
  "areas",
  "goals",
  "recurrences",
  "calendarEvents",
] as const;

/** More rows than this in any one table means real data, not a handful of test records. */
const TEST_DATA_CEILING = 20;

/**
 * Empties the record tables before the import, so the records made while
 * trying the tools do not sit among the imported ones.
 *
 * It deletes everything, so it only runs where there is almost nothing: it
 * refuses once the import has started, and refuses if any table holds more
 * than a handful of rows. With `dryRun` it only counts.
 */
export const clearTestRecords = internalMutation({
  args: { confirm: v.literal("delete the test records"), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (await ctx.db.query("importMap").first()) {
      throw new Error("The import has started, so these are no longer only test records. Nothing was deleted.");
    }
    const found: Partial<Record<(typeof RECORD_TABLES)[number], number>> = {};
    for (const table of RECORD_TABLES) {
      const rows = await ctx.db.query(table).take(TEST_DATA_CEILING + 1);
      if (rows.length > TEST_DATA_CEILING) {
        throw new Error(`"${table}" holds more than ${TEST_DATA_CEILING} rows, which looks like real data. Nothing was deleted.`);
      }
      found[table] = rows.length;
      if (!args.dryRun) for (const row of rows) await ctx.db.delete(row._id);
    }
    return { deleted: !args.dryRun, rows: found };
  },
});

/** One line in the activity log for the whole import, instead of one per record. */
export const finish = internalMutation({
  args: { summary: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("activityEvents", {
      activityType: "import.completed",
      actor: BY,
      at: Date.now(),
      summary: args.summary,
    });
    return null;
  },
});

/** How many records `importMap` holds for each old table. */
export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const counts: Record<string, number> = {};
    for await (const row of ctx.db.query("importMap")) counts[row.oldTable] = (counts[row.oldTable] ?? 0) + 1;
    return counts;
  },
});

/** The new record behind each old one, for the spot check. `null` when it did not come across. */
export const lookup = internalQuery({
  args: { refs: v.array(oldRef) },
  handler: async (ctx, args) => {
    const found = [];
    for (const ref of args.refs) {
      const row = await ctx.db
        .query("importMap")
        .withIndex("by_old", (q) => q.eq("oldTable", ref.table).eq("oldId", ref.id))
        .unique();
      found.push(row ? await ctx.db.get(row.newId as Id<"tasks">) : null);
    }
    return found;
  },
});

/** Empties `importMap` a slice at a time. Run until it returns 0, then remove the table from the schema. */
export const dropMap = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("importMap").take(2000);
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});
