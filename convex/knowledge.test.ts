/// <reference types="vite/client" />
import { signEnvelope, type OAuthPrincipal, type OperationName } from "@skippy/shared";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const SECRET = "test-secret-".repeat(4);
const OWNER = "user_owner";
const RESOURCE = "http://localhost:3000/api/mcp";
const CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata";

beforeEach(() => {
  process.env.SKIPPY_GATEWAY_SECRET = SECRET;
  process.env.SKIPPY_OWNER_CLERK_USER_ID = OWNER;
  process.env.SKIPPY_MCP_RESOURCE_URL = RESOURCE;
  // Noon in New York on Wednesday 2026-11-25.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-25T17:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const principal: OAuthPrincipal = {
  kind: "oauth",
  subject: OWNER,
  clientId: CLAUDE,
  resource: RESOURCE,
  scopes: ["skippy:read", "skippy:write"],
};

const start = () => convexTest(schema, modules);
type Harness = ReturnType<typeof start>;

/** Runs one operation the way the MCP route does: signed, through the public gateway. */
async function call<T = Record<string, any>>(
  t: Harness,
  operation: OperationName,
  args: Record<string, unknown> = {},
): Promise<T> {
  return (await t.action(api.gateway.call, await signEnvelope({ operation, args, principal }, SECRET))) as T;
}

/** The refusal code of a call, or "accepted" when it went through. */
async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ConvexError) return String((error.data as { code?: unknown }).code);
    throw error;
  }
  return "accepted";
}

const eventTypes = async (t: Harness) =>
  (await t.run((ctx) => ctx.db.query("activityEvents").withIndex("by_at").collect())).map((event) => event.activityType);
const count = (t: Harness, table: "people" | "companies" | "knowledge" | "relationships" | "sourceRefs" | "searchDocs") =>
  t.run(async (ctx) => (await ctx.db.query(table).collect()).length);

describe("people", () => {
  it("adds a person with their company, and logs both with Claude as the actor", async () => {
    const t = start();
    const made = await call(t, "upsert_person", {
      name: "Sam Lee",
      emails: ["Sam.Lee@Example.com"],
      phoneNumbers: ["(212) 555-0142"],
      company: "Acme Roofing",
      roleTitle: "Estimator",
    });
    expect(made.created).toBe(true);
    expect(made.person).toMatchObject({
      name: "Sam Lee",
      emails: ["sam.lee@example.com"],
      phoneNumbers: ["+12125550142"],
      company: { name: "Acme Roofing" },
      roleTitle: "Estimator",
    });
    expect(await eventTypes(t)).toEqual(["company.created", "person.created"]);
    const stored = await t.run((ctx) => ctx.db.query("people").first());
    expect(stored?.createdBy).toEqual({ kind: "agent", harness: "claude", clientId: CLAUDE });
  });

  it("finds a person by email however it is written, adds to what is on file, and keeps their name", async () => {
    const t = start();
    const made = await call(t, "upsert_person", { name: "Samuel Lee", emails: ["sam@example.com"] });
    const again = await call(t, "upsert_person", {
      name: "Sam",
      emails: [" SAM@example.com "],
      phoneNumbers: ["212-555-0142"],
    });
    expect(again.created).toBe(false);
    expect(again.person).toMatchObject({
      id: made.person.id,
      name: "Samuel Lee",
      emails: ["sam@example.com"],
      phoneNumbers: ["+12125550142"],
    });
    // The phone number now finds the same person too.
    const byPhone = await call(t, "upsert_person", { phoneNumbers: ["+1 212 555 0142"], notes: "Prefers texts" });
    expect(byPhone.person.id).toBe(made.person.id);
    expect(await count(t, "people")).toBe(1);
  });

  it("changes nothing and logs nothing when the same details are sent twice", async () => {
    const t = start();
    const details = { name: "Sam Lee", emails: ["sam@example.com"], company: "Acme", notes: "Met at the fair" };
    await call(t, "upsert_person", details);
    const again = await call(t, "upsert_person", details);
    expect(again.changed).toBe(false);
    expect(await eventTypes(t)).toEqual(["company.created", "person.created"]);
    expect(await count(t, "relationships")).toBe(1);
  });

  it("refuses a second person with the same name unless something tells them apart", async () => {
    const t = start();
    await call(t, "upsert_person", { name: "John Smith" });
    expect(await refusal(call(t, "upsert_person", { name: "john smith" }))).toBe("person_exists");
    const other = await call(t, "upsert_person", { name: "John Smith", emails: ["john@other.example"] });
    expect(other.created).toBe(true);
    expect(await count(t, "people")).toBe(2);
  });

  it("refuses details that point at two different people, or an address that belongs to someone else", async () => {
    const t = start();
    const a = await call(t, "upsert_person", { name: "Ana", emails: ["ana@example.com"] });
    await call(t, "upsert_person", { name: "Ben", phoneNumbers: ["212-555-0100"] });
    expect(
      await refusal(call(t, "upsert_person", { emails: ["ana@example.com"], phoneNumbers: ["212-555-0100"] })),
    ).toBe("ambiguous_person");
    expect(await refusal(call(t, "upsert_person", { id: a.person.id, phoneNumbers: ["212-555-0100"] }))).toBe(
      "handle_in_use",
    );
    expect(await refusal(call(t, "upsert_person", { name: "Cy", emails: ["not an email"] }))).toBe("invalid_arguments");
  });

  it("moves a person to a new company and clears it", async () => {
    const t = start();
    const made = await call(t, "upsert_person", { name: "Sam Lee", company: "Acme" });
    const moved = await call(t, "upsert_person", { id: made.person.id, company: "Globex" });
    expect(moved.person.company.name).toBe("Globex");
    expect(await count(t, "relationships")).toBe(1);
    const cleared = await call(t, "upsert_person", { id: made.person.id, company: null });
    expect(cleared.person.company).toBeUndefined();
    expect(await count(t, "relationships")).toBe(0);
    expect(await count(t, "companies")).toBe(2);
  });
});

describe("knowledge", () => {
  it("saves a memory about a person, with where it came from", async () => {
    const t = start();
    const sam = await call(t, "upsert_person", { name: "Sam Lee", emails: ["sam@example.com"] });
    const saved = await call(t, "upsert_knowledge", {
      kind: "memory",
      body: "Sam prefers a phone call to email for anything urgent.",
      about: [{ type: "person", id: sam.person.id }],
      source: { system: "gmail", messageId: "msg-1", summary: "Sam asked to be called next time.", at: "2026-11-24" },
    });
    expect(saved.created).toBe(true);
    expect(saved.knowledge).toMatchObject({ kind: "memory", lifecycle: "active", savedBy: "Claude" });

    const bundle = await call(t, "get_context_bundle", { type: "knowledge", id: saved.knowledge.id });
    expect(bundle.links).toEqual([
      { direction: "outgoing", relation: "related_to", record: { type: "person", id: sam.person.id, title: "Sam Lee" } },
    ]);
    expect(bundle.sources).toEqual([
      expect.objectContaining({ relationship: "created_from", system: "gmail", messageId: "msg-1" }),
    ]);
    expect(bundle.recentActivity[0].summary).toContain('about "Sam Lee"');
  });

  it("changes nothing when the same thing is sent again with the same source and links", async () => {
    const t = start();
    const project = await call(t, "upsert_project", { title: "Kitchen Remodel" });
    const args = {
      kind: "note",
      title: "Counter options",
      body: "Quartz or butcher block.",
      about: [{ type: "project", id: project.project.slug }],
      source: { system: "web", url: "https://example.com/counters" },
    };
    const first = await call(t, "upsert_knowledge", args);
    const again = await call(t, "upsert_knowledge", { ...args, id: first.knowledge.id });
    expect(again.changed).toBe(false);
    expect(await count(t, "relationships")).toBe(1);
    expect(await count(t, "sourceRefs")).toBe(1);
    expect(await eventTypes(t)).toEqual(["project.created", "knowledge.created"]);
  });

  it("treats the same link saved twice as one link", async () => {
    const t = start();
    const first = await call(t, "upsert_knowledge", { kind: "link", url: "https://Example.com/guide/?utm_source=x#top" });
    expect(first.knowledge).toMatchObject({ kind: "link", readState: "saved" });
    const again = await call(t, "upsert_knowledge", {
      kind: "link",
      url: "https://example.com/guide",
      title: "The guide",
      readState: "read",
    });
    expect(again.created).toBe(false);
    expect(again.knowledge).toMatchObject({ id: first.knowledge.id, title: "The guide", readState: "read" });
    // The address written another way is the same address: nothing changes and nothing is logged.
    const third = await call(t, "upsert_knowledge", { kind: "link", url: "example.com/guide/" });
    expect(third.changed).toBe(false);
    expect(third.knowledge.url).toBe("https://Example.com/guide/?utm_source=x#top");
    expect(await count(t, "knowledge")).toBe(1);
  });

  it("records a decision with what was chosen and when to revisit it", async () => {
    const t = start();
    const saved = await call(t, "upsert_knowledge", {
      kind: "decision",
      title: "Counter material",
      decision: {
        options: ["Quartz", "Butcher block"],
        chosen: "Quartz",
        rationale: "Less upkeep.",
        revisitAt: "2027-06-01",
      },
    });
    expect(saved.knowledge.decision).toEqual({
      options: ["Quartz", "Butcher block"],
      chosen: "Quartz",
      rationale: "Less upkeep.",
      revisitOn: "2027-06-01",
    });
  });

  it("refuses input that does not fit the kind", async () => {
    const t = start();
    expect(await refusal(call(t, "upsert_knowledge", { kind: "note" }))).toBe("invalid_arguments");
    expect(await refusal(call(t, "upsert_knowledge", { kind: "link", title: "No address" }))).toBe("invalid_arguments");
    expect(await refusal(call(t, "upsert_knowledge", { kind: "note", title: "A", readState: "read" }))).toBe(
      "invalid_arguments",
    );
    expect(await refusal(call(t, "upsert_knowledge", { kind: "note", title: "A", decision: { chosen: "B" } }))).toBe(
      "invalid_arguments",
    );
    expect(await refusal(call(t, "upsert_knowledge", { title: "No kind" }))).toBe("invalid_arguments");
    expect(
      await refusal(call(t, "upsert_knowledge", { kind: "note", title: "A", about: [{ type: "task", id: "nope" }] })),
    ).toBe("not_found");
    // A refused save leaves nothing behind.
    expect(await count(t, "knowledge")).toBe(0);
  });
});

describe("links", () => {
  it("links two records once, shows the link from both ends, and removes it", async () => {
    const t = start();
    const project = await call(t, "upsert_project", { title: "Kitchen Remodel" });
    const sam = await call(t, "upsert_person", { name: "Sam Lee" });
    const link = {
      from: { type: "person", id: sam.person.id },
      relation: "supports",
      to: { type: "project", id: "kitchen-remodel" },
      reason: "Doing the estimate",
    };
    expect((await call(t, "link_entities", link)).changed).toBe(true);
    expect((await call(t, "link_entities", link)).changed).toBe(false);
    expect(await count(t, "relationships")).toBe(1);

    const fromProject = await call(t, "get_context_bundle", { type: "project", id: project.project.slug });
    expect(fromProject.record.slug).toBe("kitchen-remodel");
    expect(fromProject.links).toEqual([
      {
        direction: "incoming",
        relation: "supports",
        record: { type: "person", id: sam.person.id, title: "Sam Lee" },
        reason: "Doing the estimate",
      },
    ]);

    expect((await call(t, "link_entities", { ...link, remove: true })).changed).toBe(true);
    expect((await call(t, "link_entities", { ...link, remove: true })).changed).toBe(false);
    expect(await count(t, "relationships")).toBe(0);
    expect((await eventTypes(t)).slice(-2)).toEqual(["link.created", "link.removed"]);
  });

  it("refuses a link to a record that is not there, or from a record to itself", async () => {
    const t = start();
    const sam = await call(t, "upsert_person", { name: "Sam Lee" });
    const me = { type: "person", id: sam.person.id };
    expect(
      await refusal(call(t, "link_entities", { from: me, relation: "works_at", to: { type: "company", id: "nope" } })),
    ).toBe("not_found");
    expect(await refusal(call(t, "link_entities", { from: me, relation: "related_to", to: me }))).toBe(
      "invalid_arguments",
    );
    expect(await refusal(call(t, "link_entities", { from: me, relation: "married_to", to: me }))).toBe(
      "invalid_arguments",
    );
  });
});

describe("search", () => {
  it("finds every kind of record by its words, and can be narrowed to one kind", async () => {
    const t = start();
    await call(t, "upsert_project", { title: "Kitchen Remodel", summary: "New quartz counters" });
    await call(t, "upsert_task", { title: "Order quartz samples", project: "kitchen-remodel" });
    await call(t, "upsert_person", { name: "Sam Lee", company: "Quartz Brothers", notes: "Installs quartz" });
    await call(t, "upsert_knowledge", { kind: "note", title: "Counter care", body: "Seal quartz yearly." });

    const all = await call(t, "search", { query: "quartz" });
    expect(all.results.map((row: { type: string }) => row.type).sort()).toEqual([
      "company",
      "knowledge",
      "person",
      "project",
      "task",
    ]);
    const project = all.results.find((row: { type: string }) => row.type === "project");
    expect(project).toMatchObject({ id: "kitchen-remodel", title: "Kitchen Remodel", state: "active" });
    expect(project.snippet).toContain("New quartz counters");

    const people = await call(t, "search", { query: "quartz", type: "person" });
    expect(people.results.map((row: { title: string }) => row.title)).toEqual(["Sam Lee"]);
    expect((await call(t, "search", { query: "granite" })).results).toEqual([]);
  });

  it("follows a record when its words change", async () => {
    const t = start();
    const made = await call(t, "upsert_task", { title: "Call the plumber" });
    await call(t, "upsert_task", { id: made.task.id, title: "Call the electrician" });
    expect((await call(t, "search", { query: "plumber" })).results).toEqual([]);
    expect((await call(t, "search", { query: "electrician" })).results).toHaveLength(1);
    expect(await count(t, "searchDocs")).toBe(1);
  });

  it("rebuilds the search rows for records made before search existed", async () => {
    const t = start();
    await call(t, "upsert_project", { title: "Garden Shed" });
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("searchDocs").collect()) await ctx.db.delete(row._id);
    });
    expect((await call(t, "search", { query: "shed" })).results).toEqual([]);
    expect(await t.mutation(internal.maintenance.reindexSearch, {})).toMatchObject({ project: 1 });
    expect((await call(t, "search", { query: "shed" })).results).toHaveLength(1);
  });
});
