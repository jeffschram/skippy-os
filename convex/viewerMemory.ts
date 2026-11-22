import { KNOWLEDGE_KINDS } from "@skippy/shared";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { knowledgeTitle } from "./lib/entities";
import { getSettings, iso } from "./lib/common";
import { presentCompany, presentPerson } from "./people";
import { readBundle, runSearch } from "./read";
import { companyLabel, goalStatus, knowledgeKind, lifecycle, readState } from "./schema";
import { OWNER, requireOwner } from "./viewer";

/**
 * The Memory page: what is worth remembering (notes, links, memories,
 * decisions, principles, questions), and the people, companies and goals it is
 * about. Public, owner-only, like the functions in `viewer.ts`. A change runs
 * the same internal function an agent's tool runs, with the owner as the actor.
 */

const nullable = <T extends Parameters<typeof v.optional>[0]>(validator: T) => v.optional(v.union(validator, v.null()));
const MEMORY_TYPES = ["knowledge", "person", "company", "goal", "event", "recurrence"] as const;
const memoryType = v.union(...MEMORY_TYPES.map((type) => v.literal(type)));

/** A few lines of a record's text, for a list. */
function preview(item: Doc<"knowledge">): string | undefined {
  const text = (item.summary ?? (item.title ? item.body : item.body?.split("\n").slice(1).join("\n")))?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

/** What has been saved, most recently changed first, one page at a time. */
export const knowledge = query({
  args: {
    kind: v.optional(knowledgeKind),
    archived: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const kind = args.kind;
    const wanted = args.archived ? "archived" : "active";
    const rows = kind
      ? ctx.db.query("knowledge").withIndex("by_kind_updated", (q) => q.eq("kind", kind))
      : ctx.db.query("knowledge").withIndex("by_updated");
    const page = await rows
      .order("desc")
      .filter((q) => q.eq(q.field("lifecycle"), wanted))
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((item) => ({
        id: item._id,
        kind: item.kind,
        title: knowledgeTitle(item),
        preview: preview(item),
        url: item.url,
        readState: item.readState,
        updatedAt: iso(item.updatedAt),
      })),
    };
  },
});

/** Everyone on file, favourites first, then by name. */
export const people = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const settings = await getSettings(ctx);
    const rows = await ctx.db.query("people").take(2000);
    const shown = await Promise.all(rows.map((row) => presentPerson(ctx, row, settings.timeZone)));
    return {
      people: shown.sort((a, b) => Number(b.favorite ?? false) - Number(a.favorite ?? false) || a.name.localeCompare(b.name)),
    };
  },
});

export const companies = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const rows = await ctx.db.query("companies").take(2000);
    return { companies: rows.map(presentCompany).sort((a, b) => a.name.localeCompare(b.name)) };
  },
});

const GOAL_ORDER = ["active", "paused", "achieved", "abandoned"] as const;

export const goals = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const rows = await ctx.db.query("goals").take(500);
    return {
      goals: rows
        .sort((a, b) => GOAL_ORDER.indexOf(a.status) - GOAL_ORDER.indexOf(b.status) || a.title.localeCompare(b.title))
        .map((goal) => ({
          id: goal._id,
          title: goal.title,
          description: goal.description,
          status: goal.status,
          horizon: goal.horizon,
        })),
    };
  },
});

/**
 * Word search. With no section it covers everything Skippy holds, tasks and
 * projects included; a section narrows it to that kind of record.
 */
export const search = query({
  args: {
    query: v.string(),
    section: v.optional(v.union(knowledgeKind, v.literal("people"), v.literal("companies"))),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    if (!args.query.trim()) return { query: "", results: [] };
    const section = args.section;
    const kind = (KNOWLEDGE_KINDS as readonly string[]).includes(section ?? "") ? section : undefined;
    const type = section === "people" ? "person" : section === "companies" ? "company" : kind ? "knowledge" : undefined;
    const found = await runSearch(ctx, { query: args.query, type, limit: 25 });
    const results = [];
    for (const result of found.results) {
      let itemKind: string | undefined;
      if (result.type === "knowledge") {
        const id = ctx.db.normalizeId("knowledge", result.id);
        itemKind = id ? (await ctx.db.get(id))?.kind : undefined;
        if (kind && itemKind !== kind) continue;
      }
      results.push({ ...result, kind: itemKind });
    }
    return { query: found.query, results };
  },
});

/** One record with its links, sources and history, or null when it is not there. Also serves events and recurrences. */
export const item = query({
  args: { type: memoryType, id: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    try {
      return await readBundle(ctx, args);
    } catch (error) {
      if (error instanceof ConvexError && (error.data as { code?: unknown }).code === "not_found") return null;
      throw error;
    }
  },
});

// Changes. The owner is the actor on each one.

/** Saves something to remember, or changes it when `id` is given. Only the fields passed change; null clears one. */
export const saveKnowledge = mutation({
  args: {
    id: v.optional(v.string()),
    kind: v.optional(knowledgeKind),
    title: nullable(v.string()),
    body: nullable(v.string()),
    summary: nullable(v.string()),
    url: nullable(v.string()),
    readState: v.optional(readState),
    lifecycle: v.optional(lifecycle),
    whyItMatters: nullable(v.string()),
  },
  handler: async (ctx, args): Promise<{ id: string; created: boolean; changed: boolean }> => {
    await requireOwner(ctx);
    const result = await ctx.runMutation(internal.knowledge.upsert, { actor: OWNER, ...args });
    return { id: result.knowledge.id, created: result.created, changed: result.changed };
  },
});

/** Adds a person, or changes one when `id` is given. Emails and numbers are added to those on file, or taken off by name. */
export const savePerson = mutation({
  args: {
    id: v.optional(v.string()),
    name: v.optional(v.string()),
    emails: v.optional(v.array(v.string())),
    phoneNumbers: v.optional(v.array(v.string())),
    removeEmails: v.optional(v.array(v.string())),
    removePhoneNumbers: v.optional(v.array(v.string())),
    company: nullable(v.string()),
    roleTitle: nullable(v.string()),
    relationshipContext: nullable(v.string()),
    birthday: nullable(v.string()),
    notes: nullable(v.string()),
    favorite: nullable(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ id: string; created: boolean; changed: boolean }> => {
    await requireOwner(ctx);
    const result = await ctx.runMutation(internal.people.upsert, { actor: OWNER, ...args });
    return { id: result.person.id, created: result.created, changed: result.changed };
  },
});

/** Adds a goal, or changes one when `id` is given. Only the fields passed change; null clears one. */
export const saveGoal = mutation({
  args: {
    id: v.optional(v.string()),
    title: v.optional(v.string()),
    description: nullable(v.string()),
    horizon: nullable(v.string()),
    status: v.optional(goalStatus),
  },
  handler: async (ctx, args): Promise<{ id: string; created: boolean; changed: boolean }> => {
    await requireOwner(ctx);
    const result = await ctx.runMutation(internal.goals.upsert, { actor: OWNER, ...args });
    return { id: result.goal.id, created: result.created, changed: result.changed };
  },
});

export const saveCompany = mutation({
  args: {
    id: v.string(),
    name: v.optional(v.string()),
    domain: nullable(v.string()),
    website: nullable(v.string()),
    relationshipLabel: nullable(companyLabel),
    notes: nullable(v.string()),
  },
  handler: async (ctx, args): Promise<{ changed: boolean }> => {
    await requireOwner(ctx);
    const result = await ctx.runMutation(internal.people.updateCompany, { actor: OWNER, ...args });
    return { changed: result.changed };
  },
});
