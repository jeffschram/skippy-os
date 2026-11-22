/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const OWNER = "user_owner";
const NOW = new Date("2026-11-25T17:00:00Z").getTime();
const FIRST = { numItems: 2, cursor: null };

beforeEach(() => {
  process.env.SKIPPY_OWNER_CLERK_USER_ID = OWNER;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

const start = () => convexTest(schema, modules);

async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ConvexError) return String((error.data as { code?: unknown }).code);
    throw error;
  }
  return "accepted";
}

describe("the Memory page", () => {
  it("is closed to everyone but the owner", async () => {
    const t = start();
    const stranger = t.withIdentity({ subject: "user_someone_else" });
    expect(await refusal(t.query(api.viewerMemory.knowledge, { paginationOpts: FIRST }))).toBe("not_signed_in");
    expect(await refusal(t.query(api.viewerMemory.people, {}))).toBe("not_signed_in");
    expect(await refusal(t.query(api.viewerMemory.search, { query: "x" }))).toBe("not_signed_in");
    expect(await refusal(t.query(api.viewerMemory.item, { type: "person", id: "x", now: NOW }))).toBe("not_signed_in");
    expect(await refusal(t.mutation(api.viewerMemory.saveKnowledge, { kind: "note", title: "x" }))).toBe("not_signed_in");
    expect(await refusal(stranger.query(api.viewerMemory.companies, {}))).toBe("account_not_authorized");
    expect(await refusal(stranger.mutation(api.viewerMemory.savePerson, { name: "x" }))).toBe("account_not_authorized");
    expect(await t.run((ctx) => ctx.db.query("knowledge").collect())).toEqual([]);
  });

  it("lists what is saved, most recently changed first, a page at a time, by kind, without the archived", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const save = async (fields: { kind: "note" | "link" | "memory"; title: string; body?: string; url?: string }) => {
      vi.advanceTimersByTime(1000);
      return (await owner.mutation(api.viewerMemory.saveKnowledge, fields)).id;
    };
    const oldest = await save({ kind: "note", title: "Oldest note", body: "First line.\nSecond line." });
    await save({ kind: "link", title: "A link", url: "https://example.com/a" });
    await save({ kind: "memory", title: "Likes oat milk" });
    const hidden = await save({ kind: "note", title: "Put away" });
    await owner.mutation(api.viewerMemory.saveKnowledge, { id: hidden, lifecycle: "archived" });
    // Changing the oldest note brings it to the top.
    vi.advanceTimersByTime(1000);
    await owner.mutation(api.viewerMemory.saveKnowledge, { id: oldest, summary: "A short summary" });

    const first = await owner.query(api.viewerMemory.knowledge, { paginationOpts: FIRST });
    expect(first.page.map((item) => [item.kind, item.title, item.preview])).toEqual([
      ["note", "Oldest note", "A short summary"],
      ["memory", "Likes oat milk", undefined],
    ]);
    expect(first.isDone).toBe(false);
    const second = await owner.query(api.viewerMemory.knowledge, {
      paginationOpts: { numItems: 5, cursor: first.continueCursor },
    });
    expect(second.page.map((item) => item.title)).toEqual(["A link"]);

    const notes = await owner.query(api.viewerMemory.knowledge, { kind: "note", paginationOpts: { numItems: 10, cursor: null } });
    expect(notes.page.map((item) => item.title)).toEqual(["Oldest note"]);
    const archived = await owner.query(api.viewerMemory.knowledge, { archived: true, paginationOpts: { numItems: 10, cursor: null } });
    expect(archived.page.map((item) => item.title)).toEqual(["Put away"]);
  });

  it("adds and changes a person and their company, and lists both", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const pat = await owner.mutation(api.viewerMemory.savePerson, {
      name: "Pat Jones",
      emails: ["Pat@Example.com"],
      company: "Acme",
    });
    expect(pat.created).toBe(true);
    await owner.mutation(api.viewerMemory.savePerson, { name: "Al Zed", favorite: true });
    await owner.mutation(api.viewerMemory.savePerson, { id: pat.id, roleTitle: "Plumber", notes: "Fixed the sink." });

    const { people } = await owner.query(api.viewerMemory.people, {});
    expect(people.map((person) => [person.name, person.company?.name, person.roleTitle])).toEqual([
      ["Al Zed", undefined, undefined],
      ["Pat Jones", "Acme", "Plumber"],
    ]);
    const { companies } = await owner.query(api.viewerMemory.companies, {});
    expect(companies.map((company) => company.name)).toEqual(["Acme"]);

    expect(
      await owner.mutation(api.viewerMemory.saveCompany, { id: companies[0].id, website: "https://acme.example", relationshipLabel: "vendor" }),
    ).toEqual({ changed: true });
    expect(await owner.mutation(api.viewerMemory.saveCompany, { id: companies[0].id, relationshipLabel: "vendor" })).toEqual({ changed: false });
    expect(await refusal(owner.mutation(api.viewerMemory.saveCompany, { id: "nope", notes: "x" }))).toBe("not_found");

    const details = await owner.query(api.viewerMemory.item, { type: "person", id: pat.id, now: NOW });
    expect(details!.links.map((link) => [link.direction, link.relation, link.record.title])).toEqual([
      ["outgoing", "works_at", "Acme"],
    ]);
    expect(details!.recentActivity.map((event) => event.type)).toEqual(["person.updated", "person.created"]);
    expect(await owner.query(api.viewerMemory.item, { type: "person", id: "nope", now: NOW })).toBeNull();
  });

  it("searches everything, or one section", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewerMemory.saveKnowledge, { kind: "note", title: "Sourdough starter", body: "Feed it weekly." });
    await owner.mutation(api.viewerMemory.saveKnowledge, { kind: "decision", title: "Buy the sourdough book" });
    await owner.mutation(api.viewerMemory.savePerson, { name: "Sam Baker", notes: "Sells sourdough." });
    await owner.mutation(api.viewer.saveTask, { title: "Bake sourdough" });

    const all = await owner.query(api.viewerMemory.search, { query: "sourdough" });
    expect(all.results.map((result) => result.type).sort()).toEqual(["knowledge", "knowledge", "person", "task"]);
    const notes = await owner.query(api.viewerMemory.search, { query: "sourdough", section: "note" });
    expect(notes.results.map((result) => [result.kind, result.title])).toEqual([["note", "Sourdough starter"]]);
    const people = await owner.query(api.viewerMemory.search, { query: "sourdough", section: "people" });
    expect(people.results.map((result) => result.title)).toEqual(["Sam Baker"]);
    expect((await owner.query(api.viewerMemory.search, { query: "  " })).results).toEqual([]);
  });

  it("lists goals, live ones first", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await t.run(async (ctx) => {
      const by = { kind: "user" as const };
      const row = { createdBy: by, updatedBy: by, updatedAt: NOW };
      await ctx.db.insert("goals", { title: "Ran a marathon", status: "achieved", ...row });
      await ctx.db.insert("goals", { title: "Record an album", status: "active", ...row });
    });
    const { goals } = await owner.query(api.viewerMemory.goals, {});
    expect(goals.map((goal) => [goal.title, goal.status])).toEqual([
      ["Record an album", "active"],
      ["Ran a marathon", "achieved"],
    ]);
    const details = await owner.query(api.viewerMemory.item, { type: "goal", id: goals[0].id, now: NOW });
    expect(details!.record).toMatchObject({ title: "Record an album", status: "active" });
  });
});
