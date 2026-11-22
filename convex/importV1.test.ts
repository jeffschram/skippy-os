/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const OWNER = "user_owner";
const at = { createdAt: 1_000, updatedAt: 2_000 };

beforeEach(() => {
  process.env.SKIPPY_OWNER_CLERK_USER_ID = OWNER;
});

const start = () => convexTest(schema, modules);
type Harness = ReturnType<typeof start>;

/** Loads a small old project in the order the script does. */
async function loadAll(t: Harness) {
  const m = internal.importV1;
  return {
    areas: await t.mutation(m.areas, { records: [{ oldId: "household", name: "Household", ...at }] }),
    goals: await t.mutation(m.goals, { records: [{ oldId: "g1", title: "A nicer home", status: "active", ...at }] }),
    projects: await t.mutation(m.projects, {
      records: [{ oldId: "p1", title: "Garden Shed", summary: "Build it", status: "active", notesPad: "", goalOldId: "g1", ...at }],
    }),
    phases: await t.mutation(m.phases, {
      records: [
        { oldId: "ph1", projectOldId: "p1", order: 1, title: "Foundation", ...at },
        { oldId: "ph2", projectOldId: "p-code", order: 1, title: "MVP", ...at },
      ],
    }),
    tasks: await t.mutation(m.tasks, {
      records: [
        { oldId: "t1", title: "Get quotes", status: "todo", projectOldId: "p1", phaseOldId: "ph1", areaOldId: "household", dueAt: 5_000, ...at },
        { oldId: "t2", title: "Renew passport", status: "done", completedAt: 3_000, ...at },
        { oldId: "t3", title: "Fix bug", status: "todo", projectOldId: "p-code", ...at },
      ],
    }),
    people: await t.mutation(m.people, {
      records: [
        { oldId: "pe1", name: "Sam Lee", emails: ["Sam@Example.com", "not an email"], phoneNumbers: ["(555) 010-2000"], notes: "Roofer", ...at },
        { oldId: "pe2", name: "Sammy", emails: ["sam@example.com"], phoneNumbers: [], ...at },
        { oldId: "pe3", name: "Pat", emails: [], phoneNumbers: [], ...at },
      ],
    }),
    companies: await t.mutation(m.companies, {
      records: [{ oldId: "c1", name: "Acme Roofing", relationshipLabel: "vendor", ...at }],
    }),
    knowledge: await t.mutation(m.knowledge, {
      records: [
        { oldId: "k1", kind: "note", title: "Shed permit", body: "Needs one from the county", lifecycle: "active", ...at },
        { oldId: "k2", kind: "link", title: "Plans", url: "https://example.com/plans?utm_source=x", readState: "unread", lifecycle: "active", ...at },
        { oldId: "k3", kind: "link", title: "Plans again", url: "example.com/plans/", lifecycle: "active", ...at },
        { oldId: "k4", kind: "link", title: "Broken", url: "not a url", lifecycle: "active", ...at },
        { oldId: "k5", kind: "memory", lifecycle: "active", ...at },
      ],
    }),
    sources: await t.mutation(m.sources, {
      records: [{ oldId: "s1", sourceSystem: "gmail", messageId: "m1", excerpt: "About the permit", createdAt: 900 }],
    }),
    attachments: await t.mutation(m.attachments, {
      records: [
        { oldId: "a1", entity: { table: "knowledge", id: "k1" }, sourceOldId: "s1", relationship: "created_from" },
        { oldId: "a2", entity: { table: "tasks", id: "t3" }, sourceOldId: "s1", relationship: "created_from" },
      ],
    }),
    links: await t.mutation(m.links, {
      records: [
        { oldId: "r1", from: { table: "knowledge", id: "k1" }, to: { table: "projects", id: "p1" }, type: "related_to", reason: "Same job", createdAt: 950 },
        { oldId: "r2", from: { table: "people", id: "pe1" }, to: { table: "companies", id: "c1" }, type: "works_at", createdAt: 950 },
        { oldId: "r3", from: { table: "knowledge", id: "k1" }, to: { table: "tasks", id: "t3" }, type: "related_to", createdAt: 950 },
        { oldId: "r4", from: { table: "knowledge", id: "k2" }, to: { table: "knowledge", id: "k3" }, type: "related_to", createdAt: 950 },
        { oldId: "r5", from: { table: "knowledge", id: "k3" }, to: { table: "projects", id: "p1" }, type: "related_to", createdAt: 950 },
        { oldId: "r6", from: { table: "knowledge", id: "k2" }, to: { table: "projects", id: "p1" }, type: "related_to", createdAt: 950 },
      ],
    }),
  };
}

const counts = (result: { imported: number; already: number; merged: number; skipped: unknown[] }) => [
  result.imported,
  result.already,
  result.merged,
  result.skipped.length,
];

describe("the import loaders", () => {
  it("load each record once and say what happened to the rest", async () => {
    const t = start();
    const first = await loadAll(t);
    // [new, already, merged, skipped]
    expect(counts(first.projects)).toEqual([1, 0, 0, 0]);
    expect(counts(first.phases)).toEqual([1, 0, 0, 1]);
    expect(counts(first.tasks)).toEqual([2, 0, 0, 1]);
    expect(first.tasks.skipped[0]).toEqual({ oldId: "t3", reason: "its project was not imported" });
    // Sammy shares Sam's email, so is Sam.
    expect(counts(first.people)).toEqual([2, 0, 1, 0]);
    expect(first.people.notes.map((note) => note.oldId)).toEqual(["pe1", "pe2"]);
    // The same link twice is one link; an unreadable address and an empty record are skipped.
    expect(counts(first.knowledge)).toEqual([2, 0, 1, 2]);
    expect(counts(first.attachments)).toEqual([1, 0, 0, 1]);
    // r3 touches a skipped task, r4 joins a link to itself, r6 repeats r5.
    expect(counts(first.links)).toEqual([3, 1, 0, 2]);

    const again = await loadAll(t);
    for (const [name, result] of Object.entries(again)) {
      expect(result.imported, name).toBe(0);
    }
    expect(counts(again.tasks)).toEqual([0, 2, 0, 1]);
    expect(counts(again.links)).toEqual([0, 4, 0, 2]);
    expect(await t.run((ctx) => ctx.db.query("tasks").collect())).toHaveLength(2);
    expect(await t.run((ctx) => ctx.db.query("knowledge").collect())).toHaveLength(2);
  });

  it("store records in the new shape, marked as imported, with their old dates", async () => {
    const t = start();
    await loadAll(t);
    const [task] = await t.query(internal.importV1.lookup, { refs: [{ table: "tasks", id: "t1" }] });
    const project = await t.run((ctx) => ctx.db.query("projects").first());
    const phase = await t.run((ctx) => ctx.db.query("phases").first());
    const area = await t.run((ctx) => ctx.db.query("areas").first());
    const goal = await t.run((ctx) => ctx.db.query("goals").first());
    expect(task).toMatchObject({
      title: "Get quotes",
      projectId: project!._id,
      phaseId: phase!._id,
      areaId: area!._id,
      dueAt: 5_000,
      createdAt: 1_000,
      updatedAt: 2_000,
      createdBy: { kind: "import", source: "skippy-v1" },
    });
    expect(project).toMatchObject({ slug: "garden-shed", kind: "general", goalId: goal!._id });

    const sam = await t.run((ctx) => ctx.db.query("people").withIndex("by_name_key", (q) => q.eq("nameKey", "sam lee")).unique());
    expect(sam).toMatchObject({ emails: ["sam@example.com"], phoneNumbers: ["+15550102000"] });
    const link = await t.run((ctx) => ctx.db.query("knowledge").withIndex("by_kind", (q) => q.eq("kind", "link")).unique());
    expect(link).toMatchObject({ normalizedUrl: "https://example.com/plans", readState: "unread" });
    expect(await t.query(internal.importV1.status, {})).toMatchObject({ tasks: 2, people: 3, knowledge: 3, sourceRefs: 1 });
  });

  it("give a second project with the same title its own slug", async () => {
    const t = start();
    const record = { title: "Garden Shed", status: "active" as const, notesPad: "", ...at };
    await t.mutation(internal.importV1.projects, { records: [{ oldId: "p1", ...record }] });
    const second = await t.mutation(internal.importV1.projects, { records: [{ oldId: "p2", ...record }] });
    expect(second.notes[0].note).toContain("garden-shed-2");
  });

  it("leave what was imported searchable and visible to the owner", async () => {
    const t = start();
    await loadAll(t);
    await t.mutation(internal.importV1.finish, { summary: "Imported from the old Skippy: 1 projects, 2 tasks" });
    const found = await t.query(internal.read.search, { query: "county permit" });
    expect(found.results.map((result) => result.title)).toEqual(["Shed permit"]);
    const sam = await t.query(internal.read.search, { query: "roofer", type: "person" });
    const bundle = await t.query(internal.read.contextBundle, { type: "person", id: sam.results[0].id });
    expect(bundle.links.map((link) => `${link.relation} ${link.record.title}`)).toEqual(["works_at Acme Roofing"]);

    const owner = t.withIdentity({ subject: OWNER });
    const { projects } = await owner.query(api.viewer.projects, { now: 3_000 });
    expect(projects.map((project) => project.title)).toEqual(["Garden Shed"]);
    const { events } = await owner.query(api.viewer.activity, {});
    expect(events).toMatchObject([{ by: "Import", type: "import.completed" }]);
  });

  it("clear a handful of test records, and refuse to clear anything bigger", async () => {
    const t = start();
    const confirm = "delete the test records" as const;
    const by = { kind: "user" as const };
    await t.run(async (ctx) => {
      const projectId = await ctx.db.insert("projects", { title: "Garden Shed", slug: "garden-shed", kind: "general", status: "active", notesPad: "", createdBy: by, updatedBy: by, updatedAt: 1 });
      await ctx.db.insert("tasks", { title: "Get three quotes", status: "todo", projectId, createdBy: by, updatedBy: by, updatedAt: 1 });
      await ctx.db.insert("activityEvents", { activityType: "project.created", actor: by, at: 1, summary: "Created project" });
      await ctx.db.insert("settings", { timeZone: "America/New_York", stalenessDays: 7, updatedAt: 1 });
    });

    const preview = await t.mutation(internal.importV1.clearTestRecords, { confirm, dryRun: true });
    expect(preview).toMatchObject({ deleted: false, rows: { projects: 1, tasks: 1, activityEvents: 1, people: 0 } });
    expect(await t.run((ctx) => ctx.db.query("tasks").collect())).toHaveLength(1);

    expect(await t.mutation(internal.importV1.clearTestRecords, { confirm })).toMatchObject({ deleted: true, rows: { projects: 1 } });
    expect(await t.run((ctx) => ctx.db.query("projects").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("tasks").collect())).toHaveLength(0);
    // Settings are not records, so they stay.
    expect(await t.run((ctx) => ctx.db.query("settings").collect())).toHaveLength(1);

    // Real data: more rows than a test would leave.
    await t.run(async (ctx) => {
      for (let n = 0; n < 21; n++) await ctx.db.insert("tasks", { title: `Task ${n}`, status: "todo", createdBy: by, updatedBy: by, updatedAt: 1 });
    });
    await expect(t.mutation(internal.importV1.clearTestRecords, { confirm })).rejects.toThrow(/looks like real data/);
    expect(await t.run((ctx) => ctx.db.query("tasks").collect())).toHaveLength(21);
  });

  it("refuse to clear anything once the import has started", async () => {
    const t = start();
    await t.mutation(internal.importV1.goals, { records: [{ oldId: "g1", title: "A nicer home", status: "active", ...at }] });
    await expect(
      t.mutation(internal.importV1.clearTestRecords, { confirm: "delete the test records" }),
    ).rejects.toThrow(/import has started/);
    expect(await t.run((ctx) => ctx.db.query("goals").collect())).toHaveLength(1);
  });

  it("empty the import map when the import is done", async () => {
    const t = start();
    await loadAll(t);
    expect(await t.mutation(internal.importV1.dropMap, {})).toBeGreaterThan(0);
    expect(await t.mutation(internal.importV1.dropMap, {})).toBe(0);
    expect(await t.query(internal.importV1.status, {})).toEqual({});
    expect(await t.run((ctx) => ctx.db.query("tasks").collect())).toHaveLength(2);
  });
});
