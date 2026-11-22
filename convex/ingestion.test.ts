/// <reference types="vite/client" />
import { signEnvelope, type OperationName } from "@skippy/shared";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const SECRET = "test-secret-".repeat(4);
const OWNER = "user_owner";
const RESOURCE = "http://localhost:3000/api/mcp";
// Noon in New York on Wednesday 2026-11-25.
const NOW = new Date("2026-11-25T17:00:00Z").getTime();

beforeEach(() => {
  process.env.SKIPPY_GATEWAY_SECRET = SECRET;
  process.env.SKIPPY_OWNER_CLERK_USER_ID = OWNER;
  process.env.SKIPPY_MCP_RESOURCE_URL = RESOURCE;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

const start = () => convexTest(schema, modules);
type Harness = ReturnType<typeof start>;

async function asClaude<T = Record<string, never>>(t: Harness, operation: OperationName, args: Record<string, unknown>): Promise<T> {
  const principal = {
    kind: "oauth" as const,
    subject: OWNER,
    clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
    resource: RESOURCE,
    scopes: ["skippy:read", "skippy:write"],
  };
  return (await t.action(api.gateway.call, await signEnvelope({ operation, args, principal }, SECRET))) as T;
}

async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ConvexError) return String((error.data as { code?: unknown }).code);
    throw error;
  }
  return "accepted";
}

const begin = async (t: Harness) => (await asClaude<{ runId: string }>(t, "record_ingestion_run", { status: "started", pass: "9am" })).runId;
const tick = () => vi.advanceTimersByTime(60_000);

type Rubric = { rubric: string[]; rules: { text: string }[]; blockList: { text: string }[]; cursors: Record<string, string | null>; today: string };
type Sync = { created: number; changed: number; unchanged: number; cancelled: number; undone: number; done: boolean };
type Ingested = { results: { outcome: string; type?: string; id?: string; message?: string }[] };

describe("an ingestion run", () => {
  it("reads the rubric, rules and cursors, and leaves each cursor where it stopped", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.saveIngestionRule, { kind: "block", source: "gmail", text: "sender: deals@shop.example" });
    await owner.mutation(api.viewer.saveIngestionRule, { text: "School newsletters never need a task." });

    const before = await asClaude<Rubric>(t, "get_importance_rubric", {});
    expect(before.today).toBe("2026-11-25");
    expect(before.rubric.length).toBeGreaterThan(5);
    expect(before.rules.map((rule) => rule.text)).toEqual(["School newsletters never need a task."]);
    expect(before.blockList.map((rule) => rule.text)).toEqual(["sender: deals@shop.example"]);
    expect(before.cursors).toEqual({ google_calendar: null, gmail: null, imessage: null });

    const runId = await begin(t);
    // A second pass cannot start while the first is going.
    expect(await refusal(asClaude(t, "record_ingestion_run", { status: "started" }))).toBe("run_in_progress");
    await asClaude(t, "advance_source_cursor", { runId, source: "gmail", cursor: "2026-11-25T16:55:00Z" });
    const done = await asClaude<{ status: string; made: number }>(t, "record_ingestion_run", {
      runId,
      status: "finished",
      sources: [{ source: "gmail", read: 12, skipped: 12 }],
    });
    expect(done).toMatchObject({ status: "finished", made: 0 });
    expect((await asClaude<Rubric>(t, "get_importance_rubric", {})).cursors.gmail).toBe("2026-11-25T16:55:00Z");
    // A finished run takes no more writes, and a new one can start.
    expect(await refusal(asClaude(t, "advance_source_cursor", { runId, source: "gmail", cursor: "x" }))).toBe("invalid_arguments");
    await begin(t);

    const seen = await owner.query(api.viewer.ingestion, {});
    expect(seen.runs.map((run) => [run.status, run.pass])).toEqual([
      ["running", "9am"],
      ["finished", "9am"],
    ]);
    expect(seen.health.find((entry) => entry.source === "gmail")?.coveredAt).toBeDefined();
    expect(seen.health.find((entry) => entry.source === "imessage")?.coveredAt).toBeUndefined();
  });

  it("closes a run that died, so later passes are not locked out", async () => {
    const t = start();
    await begin(t);
    vi.advanceTimersByTime(46 * 60_000);
    await begin(t);
    const owner = t.withIdentity({ subject: OWNER });
    expect((await owner.query(api.viewer.ingestion, {})).runs.map((run) => run.status)).toEqual(["running", "failed"]);
  });
});

describe("the calendar copy", () => {
  const stretch = { calendarId: "primary", from: "2026-11-11", to: "2027-02-23" };
  const dentist = { id: "g1", title: "Dentist", start: "2026-11-27T15:00:00-05:00", end: "2026-11-27T16:00:00-05:00", location: "12 Main St" };
  const trip = { id: "g2", title: "Kalamazoo", start: "2026-11-25", end: "2026-11-29" };

  it("copies events once, updates what changed, and cancels what is gone", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    let runId = await begin(t);
    const first = await asClaude<Sync>(t, "sync_calendar", { runId, ...stretch, events: [dentist], more: true });
    const last = await asClaude<Sync>(t, "sync_calendar", { runId, ...stretch, events: [trip] });
    expect([first.created, first.done, last.created, last.done]).toEqual([1, false, 1, true]);
    await asClaude(t, "record_ingestion_run", { runId, status: "finished", sources: [{ source: "google_calendar", read: 2, skipped: 0 }] });

    const calendar = await owner.query(api.viewer.calendar, { now: NOW });
    expect(calendar.events.map((event) => [event.title, event.origin, event.allDay, event.start.date, event.end?.date])).toEqual([
      ["Kalamazoo", "google", true, "2026-11-25", "2026-11-28"],
      ["Dentist", "google", false, "2026-11-27", "2026-11-27"],
    ]);
    // A copy cannot be changed here, by the owner or by Claude.
    expect(await refusal(owner.mutation(api.viewer.saveEvent, { id: calendar.events[1].id, title: "Mine" }))).toBe("read_only");

    // The next pass: one unchanged, one moved, and the trip is no longer in the calendar.
    tick();
    runId = await begin(t);
    // Describing an event in other words is not a change to it.
    const reworded = await asClaude<Sync>(t, "sync_calendar", { runId, ...stretch, events: [{ ...dentist, description: "Check-up." }], more: true });
    expect(reworded).toMatchObject({ created: 0, changed: 0, unchanged: 1 });
    const again = await asClaude<Sync>(t, "sync_calendar", {
      runId,
      ...stretch,
      events: [{ ...dentist, start: "2026-11-27T16:00:00-05:00", end: "2026-11-27T17:00:00-05:00" }],
    });
    expect(again).toMatchObject({ created: 0, changed: 1, unchanged: 0, cancelled: 1 });
    await asClaude(t, "record_ingestion_run", { runId, status: "finished", sources: [{ source: "google_calendar", read: 1, skipped: 0 }] });
    const after = await owner.query(api.viewer.calendar, { now: NOW });
    expect(after.events.map((event) => [event.title, event.start.time])).toEqual([["Dentist", "16:00"]]);

    // Only the first pass made anything, and the list on Home says so.
    const seen = await owner.query(api.viewer.ingestion, {});
    expect(seen.runs.map((run) => run.made.length)).toEqual([0, 2]);
    expect(seen.runs[1].made[0]).toMatchObject({ source: "google_calendar", action: "created", record: { type: "event" } });
  });

  it("does not copy again an event whose copy the owner undid", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    let runId = await begin(t);
    await asClaude(t, "sync_calendar", { runId, ...stretch, events: [dentist] });
    await asClaude(t, "record_ingestion_run", { runId, status: "finished", sources: [] });
    const [made] = (await owner.query(api.viewer.ingestion, {})).runs[0].made;
    expect(await owner.mutation(api.viewer.undoIngested, { receiptId: made.id })).toEqual({ undone: true });
    expect((await owner.query(api.viewer.calendar, { now: NOW })).events).toEqual([]);

    tick();
    runId = await begin(t);
    expect(await asClaude<Sync>(t, "sync_calendar", { runId, ...stretch, events: [dentist] })).toMatchObject({ created: 0, undone: 1 });
    expect((await owner.query(api.viewer.calendar, { now: NOW })).events).toEqual([]);
  });
});

describe("what a pass makes from mail", () => {
  const ask = {
    kind: "task",
    externalId: "msg-1",
    url: "https://mail.google.com/mail/u/0/#inbox/msg-1",
    at: "2026-11-25T14:00:00Z",
    summary: "Pat asks for the signed lease back by Friday.",
    title: "Return the signed lease to Pat",
    dueAt: "2026-11-27",
  };
  const sender = { kind: "person", externalId: "msg-1", summary: "Pat wrote about the lease.", name: "Pat Jones", emails: ["pat@example.com"] };

  it("makes each thing once, says where it came from, and survives one bad item", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const runId = await begin(t);
    const first = await asClaude<Ingested>(t, "ingest_objects", {
      runId,
      source: "gmail",
      items: [ask, sender, { kind: "event", externalId: "msg-2", summary: "No time given." }],
    });
    expect(first.results.map((result) => [result.outcome, result.type])).toEqual([
      ["created", "task"],
      ["created", "person"],
      ["refused", undefined],
    ]);
    // The same mail read again on a later pass makes nothing.
    const replay = await asClaude<Ingested>(t, "ingest_objects", { runId, source: "gmail", items: [ask, sender] });
    expect(replay.results.map((result) => result.outcome)).toEqual(["already", "already"]);
    const done = await asClaude<{ made: number }>(t, "record_ingestion_run", {
      runId,
      status: "finished",
      sources: [{ source: "gmail", read: 9, skipped: 7 }],
    });
    expect(done.made).toBe(2);

    const task = await owner.query(api.viewer.task, { id: first.results[0].id! });
    expect(task!.task).toMatchObject({ title: "Return the signed lease to Pat", due: { date: "2026-11-27" } });
    const bundle = await asClaude<{ sources: { system: string; summary: string; url: string }[] }>(t, "get_context_bundle", {
      type: "task",
      id: first.results[0].id,
    });
    expect(bundle.sources).toEqual([
      expect.objectContaining({ system: "gmail", summary: "Pat asks for the signed lease back by Friday.", url: ask.url }),
    ]);

    const [run] = (await owner.query(api.viewer.ingestion, {})).runs;
    expect(run.sources).toEqual([{ source: "gmail", read: 9, skipped: 7 }]);
    expect(run.made.map((made) => [made.record?.type, made.summary])).toEqual([
      ["task", "Pat asks for the signed lease back by Friday."],
      ["person", "Pat wrote about the lease."],
    ]);
    const { events } = await owner.query(api.viewer.activityLog, { who: "agents" });
    expect(events[0].summary).toBe("Ingestion (9am) finished: made 2 records");
  });

  it("is undone with a reason that becomes a rule, and the mail never makes that record again", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    let runId = await begin(t);
    await asClaude(t, "ingest_objects", { runId, source: "gmail", items: [ask] });
    await asClaude(t, "record_ingestion_run", { runId, status: "finished", sources: [] });
    const [made] = (await owner.query(api.viewer.ingestion, {})).runs[0].made;

    expect(await refusal(t.mutation(api.viewer.undoIngested, { receiptId: made.id }))).toBe("not_signed_in");
    expect(await owner.mutation(api.viewer.undoIngested, { receiptId: made.id, reason: "Pat's lease mails are handled by my lawyer." })).toEqual({ undone: true });
    expect(await owner.query(api.viewer.task, { id: made.record!.id })).toBeNull();
    const rubric = await asClaude<Rubric>(t, "get_importance_rubric", {});
    expect(rubric.rules[0].text).toContain("Pat's lease mails are handled by my lawyer.");

    tick();
    runId = await begin(t);
    const again = await asClaude<Ingested>(t, "ingest_objects", { runId, source: "gmail", items: [ask] });
    expect(again.results.map((result) => result.outcome)).toEqual(["undone"]);
    expect((await owner.query(api.viewer.openTasks, { now: NOW })).tasks).toEqual([]);
  });

  it("asks before undoing a record the owner has changed since", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const runId = await begin(t);
    const made = await asClaude<Ingested>(t, "ingest_objects", { runId, source: "gmail", items: [ask] });
    await asClaude(t, "record_ingestion_run", { runId, status: "finished", sources: [] });
    tick();
    await owner.mutation(api.viewer.saveTask, { id: made.results[0].id, title: "Return the lease, with the rider" });
    const [receipt] = (await owner.query(api.viewer.ingestion, {})).runs[0].made;

    const asked = await owner.mutation(api.viewer.undoIngested, { receiptId: receipt.id });
    expect(asked.undone).toBe(false);
    expect(asked.needsConfirm).toContain("You have changed");
    expect(await owner.query(api.viewer.task, { id: made.results[0].id! })).not.toBeNull();
    expect(await owner.mutation(api.viewer.undoIngested, { receiptId: receipt.id, force: true })).toEqual({ undone: true });
    expect(await owner.query(api.viewer.task, { id: made.results[0].id! })).toBeNull();
  });

  it("only adds to a person already on file, and that cannot be undone", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewerMemory.savePerson, { name: "Patricia Jones", emails: ["pat@example.com"] });
    const runId = await begin(t);
    const made = await asClaude<Ingested>(t, "ingest_objects", { runId, source: "gmail", items: [{ ...sender, roleTitle: "Landlord" }] });
    expect(made.results[0].outcome).toBe("updated");
    const { people } = await owner.query(api.viewerMemory.people, {});
    expect(people.map((person) => [person.name, person.roleTitle])).toEqual([["Patricia Jones", "Landlord"]]);
    const [receipt] = (await owner.query(api.viewer.ingestion, {})).runs[0].made;
    expect(await refusal(owner.mutation(api.viewer.undoIngested, { receiptId: receipt.id }))).toBe("invalid_arguments");
  });
});
