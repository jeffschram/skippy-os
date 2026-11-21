/// <reference types="vite/client" />
import { signEnvelope, type OAuthPrincipal, type OperationName } from "@skippy/shared";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const SECRET = "test-secret-".repeat(4);
const OWNER = "user_owner";
const RESOURCE = "http://localhost:3000/api/mcp";
const CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const DAY = 86_400_000;

beforeEach(() => {
  process.env.SKIPPY_GATEWAY_SECRET = SECRET;
  process.env.SKIPPY_OWNER_CLERK_USER_ID = OWNER;
  process.env.SKIPPY_MCP_RESOURCE_URL = RESOURCE;
  // Noon in New York on Wednesday 2026-11-25.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-25T17:00:00Z"));
});
afterEach(() => vi.useRealTimers());

function principal(overrides: Partial<OAuthPrincipal> = {}): OAuthPrincipal {
  return {
    kind: "oauth",
    subject: OWNER,
    clientId: CLAUDE,
    resource: RESOURCE,
    scopes: ["skippy:read", "skippy:write"],
    ...overrides,
  };
}

const start = () => convexTest(schema, modules);
type Harness = ReturnType<typeof start>;

/** Runs one operation the way the MCP route does: signed, through the public gateway. */
async function call<T = Record<string, any>>(
  t: Harness,
  operation: OperationName,
  args: Record<string, unknown> = {},
  who = principal(),
): Promise<T> {
  return (await t.action(api.gateway.call, await signEnvelope({ operation, args, principal: who }, SECRET))) as T;
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

const events = (t: Harness) => t.run((ctx) => ctx.db.query("activityEvents").withIndex("by_at").collect());

describe("Phase 1: projects, tasks and the activity log", () => {
  it("creates a project and a task, reads them back, and logs both with Claude as the actor", async () => {
    const t = start();
    const made = await call(t, "upsert_project", { title: "Kitchen Remodel", summary: "New counters and floor" });
    expect(made.created).toBe(true);
    expect(made.project).toMatchObject({ slug: "kitchen-remodel", status: "active", kind: "general", stale: false });

    const task = await call(t, "upsert_task", { title: "Get three quotes", project: "kitchen-remodel" });
    expect(task.task).toMatchObject({ title: "Get three quotes", status: "todo", project: "kitchen-remodel" });

    const read = await call(t, "get_project", { project: "kitchen-remodel" });
    expect(read.project.title).toBe("Kitchen Remodel");
    expect(read.openTasks.map((row: { title: string }) => row.title)).toEqual(["Get three quotes"]);

    const changes = await call(t, "get_changes_since", { since: "2026-11-25" });
    expect(changes.events.map((event: { type: string }) => event.type)).toEqual(["project.created", "task.created"]);
    for (const event of changes.events) {
      expect(event.by).toBe("Claude");
      expect(event.actor).toEqual({ kind: "agent", harness: "claude", clientId: CLAUDE });
    }
    const stored = await t.run((ctx) => ctx.db.query("tasks").first());
    expect(stored?.createdBy).toEqual({ kind: "agent", harness: "claude", clientId: CLAUDE });
  });

  it("changes nothing and logs nothing when the same update is sent twice", async () => {
    const t = start();
    await call(t, "upsert_project", { title: "Taxes", slug: "taxes" });
    const first = await call(t, "upsert_project", { slug: "taxes", summary: "2026 return" });
    const second = await call(t, "upsert_project", { slug: "taxes", summary: "2026 return" });
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(await events(t)).toHaveLength(2);
  });

  it("refuses to make a second project from the same title", async () => {
    const t = start();
    await call(t, "upsert_project", { title: "Garden" });
    expect(await refusal(call(t, "upsert_project", { title: "Garden" }))).toBe("project_exists");
    expect(await t.run((ctx) => ctx.db.query("projects").collect())).toHaveLength(1);
  });

  it("records a status report on the project and in its history", async () => {
    const t = start();
    await call(t, "upsert_project", { title: "Skippy OS", kind: "code" });
    const reported = await call(t, "record_project_status", {
      project: "skippy-os",
      note: "Phase 0 passed for claude.ai",
      health: "on_track",
      milestone: "OAuth proven",
      surface: "claude_code",
    });
    expect(reported.project).toMatchObject({
      statusNote: "Phase 0 passed for claude.ai",
      health: "on_track",
      statusUpdatedBy: "Claude",
      daysSinceStatus: 0,
    });
    const read = await call(t, "get_project", { project: "skippy-os" });
    expect(read.recentUpdates).toEqual([
      expect.objectContaining({ note: "Phase 0 passed for claude.ai", milestone: "OAuth proven", by: "Claude" }),
    ]);
    const update = await t.run((ctx) => ctx.db.query("projectUpdates").first());
    expect(update?.actor).toMatchObject({ kind: "agent", harness: "claude", surface: "claude_code" });
  });

  it("flags an active project as stale after seven quiet days, and clears the flag on a report", async () => {
    const t = start();
    await call(t, "upsert_project", { title: "Quiet" });
    await call(t, "upsert_project", { title: "Parked", status: "paused" });
    vi.setSystemTime(Date.now() + 8 * DAY);
    const stale = await call(t, "list_projects");
    expect(Object.fromEntries(stale.projects.map((p: { slug: string; stale: boolean }) => [p.slug, p.stale]))).toEqual({
      quiet: true,
      parked: false,
    });
    await call(t, "record_project_status", { project: "quiet", note: "Back on it" });
    const fresh = await call(t, "list_projects", { status: "active" });
    expect(fresh.projects).toEqual([expect.objectContaining({ slug: "quiet", stale: false })]);
  });

  it("adds phases in order and keeps a task's phase inside its project", async () => {
    const t = start();
    await call(t, "upsert_project", { title: "Move" });
    await call(t, "upsert_project", { title: "Other" });
    const one = await call(t, "create_phase", { project: "move", title: "Pack" });
    const two = await call(t, "create_phase", { project: "move", title: "Ship" });
    expect([one.phase.order, two.phase.order]).toEqual([1, 2]);

    const task = await call(t, "upsert_task", { title: "Buy boxes", project: "move", phaseId: one.phase.id });
    expect(task.task.phaseId).toBe(one.phase.id);
    expect(await refusal(call(t, "upsert_task", { title: "Stray", project: "other", phaseId: one.phase.id }))).toBe(
      "invalid_arguments",
    );
    // Moving the task to another project takes it out of the old phase.
    const moved = await call(t, "upsert_task", { id: task.task.id, project: "other" });
    expect(moved.task).toMatchObject({ project: "other" });
    expect(moved.task.phaseId).toBeUndefined();
  });

  it("reads dates in the owner's time zone and sorts tasks into today's lists", async () => {
    const t = start();
    const due = await call(t, "upsert_task", { title: "Pay water bill", dueAt: "2026-11-25" });
    expect(due.task.due).toEqual({ at: "2026-11-26T04:59:00.000Z", date: "2026-11-25" });
    await call(t, "upsert_task", { title: "Renew passport", dueAt: "2026-11-20" });
    await call(t, "upsert_task", { title: "Call plumber", scheduledFor: "2026-11-25T15:00" });
    await call(t, "upsert_task", { title: "Next week", dueAt: "2026-12-02" });
    await call(t, "upsert_task", { title: "Refund", status: "waiting", waitingOn: "the airline" });
    await call(t, "upsert_task", { title: "Already done", dueAt: "2026-11-25", status: "done" });

    const today = await call(t, "get_today");
    const titles = (rows: { title: string }[]) => rows.map((row) => row.title);
    expect(today.date).toBe("2026-11-25");
    expect(today.timeZone).toBe("America/New_York");
    expect(titles(today.overdue)).toEqual(["Renew passport"]);
    expect(titles(today.dueToday)).toEqual(["Pay water bill"]);
    expect(titles(today.scheduled)).toEqual(["Call plumber"]);
    expect(titles(today.waiting)).toEqual(["Refund"]);

    const nextWeek = await call(t, "get_today", { date: "2026-12-02" });
    expect(titles(nextWeek.dueToday)).toEqual(["Next week"]);
  });

  it("completes a task once, and a second completion changes nothing", async () => {
    const t = start();
    const made = await call(t, "upsert_task", { title: "Book flights" });
    const done = await call(t, "complete_task", { id: made.task.id, note: "Booked for the 12th" });
    expect(done).toMatchObject({ changed: true, task: { status: "done", completedAt: expect.stringMatching(/^2026-11-25T17:00:00/) } });
    const again = await call(t, "complete_task", { id: made.task.id });
    expect(again.changed).toBe(false);
    const log = await events(t);
    expect(log.map((event) => event.activityType)).toEqual(["task.created", "task.completed"]);
    expect(log[1].summary).toBe('Completed task "Book flights": Booked for the 12th');
  });

  it("clears a field when it is sent as null, and reopening a task clears its completion time", async () => {
    const t = start();
    const made = await call(t, "upsert_task", { title: "Draft will", dueAt: "2026-12-01", description: "With lawyer" });
    const cleared = await call(t, "upsert_task", { id: made.task.id, dueAt: null, description: null });
    expect(cleared.task.due).toBeUndefined();
    expect(cleared.task.description).toBeUndefined();
    await call(t, "complete_task", { id: made.task.id });
    const reopened = await call(t, "upsert_task", { id: made.task.id, status: "todo" });
    expect(reopened.task).toMatchObject({ status: "todo" });
    expect(reopened.task.completedAt).toBeUndefined();
  });

  it("holds each operation to its scope", async () => {
    const t = start();
    const readOnly = principal({ scopes: ["skippy:read"] });
    const writeOnly = principal({ scopes: ["skippy:write"] });
    expect(await refusal(call(t, "upsert_project", { title: "Nope" }, readOnly))).toBe("insufficient_scope");
    expect(await refusal(call(t, "upsert_task", { title: "Nope" }, readOnly))).toBe("insufficient_scope");
    expect(await refusal(call(t, "list_projects", {}, writeOnly))).toBe("insufficient_scope");
    expect(await refusal(call(t, "list_projects", {}, readOnly))).toBe("accepted");
    expect(await t.run((ctx) => ctx.db.query("projects").collect())).toHaveLength(0);
  });

  it("refuses an account that is not the owner", async () => {
    const t = start();
    expect(await refusal(call(t, "upsert_project", { title: "Nope" }, principal({ subject: "user_other" })))).toBe(
      "account_not_authorized",
    );
  });

  it("ignores an actor the caller tries to supply", async () => {
    const t = start();
    await call(t, "upsert_task", { title: "Sneaky", actor: { kind: "user" } });
    const stored = await t.run((ctx) => ctx.db.query("tasks").first());
    expect(stored?.createdBy).toMatchObject({ kind: "agent", harness: "claude" });
  });

  it("names a harness it does not know as another agent", async () => {
    const t = start();
    await call(t, "upsert_task", { title: "From elsewhere" }, principal({ clientId: "client_abc123" }));
    const changes = await call(t, "get_changes_since", { since: "2026-11-25" });
    expect(changes.events[0]).toMatchObject({ by: "An agent", actor: { harness: "other", clientId: "client_abc123" } });
  });

  it("explains what is wrong with bad input instead of failing", async () => {
    const t = start();
    expect(await refusal(call(t, "upsert_task", { title: "x", status: "finished" }))).toBe("invalid_arguments");
    expect(await refusal(call(t, "upsert_task", { title: "x", dueAt: "next Tuesday" }))).toBe("invalid_arguments");
    expect(await refusal(call(t, "upsert_task", { title: "   " }))).toBe("invalid_arguments");
    expect(await refusal(call(t, "upsert_task", { title: "x", project: "missing" }))).toBe("not_found");
    expect(await refusal(call(t, "complete_task", { id: "not-an-id" }))).toBe("not_found");
    expect(await refusal(call(t, "get_project", { project: "missing" }))).toBe("not_found");
    expect(await refusal(call(t, "upsert_project", { title: "x", slug: "Bad Slug!" }))).toBe("invalid_arguments");
    expect(await t.run((ctx) => ctx.db.query("tasks").collect())).toHaveLength(0);
  });

  it("pages through the activity log", async () => {
    const t = start();
    for (const title of ["A", "B", "C"]) {
      vi.setSystemTime(Date.now() + 1000);
      await call(t, "upsert_task", { title });
    }
    const page = await call(t, "get_changes_since", { since: "2026-11-25", limit: 2 });
    expect(page.events).toHaveLength(2);
    expect(page.more).toBe(true);
    const rest = await call(t, "get_changes_since", { since: page.events[1].at });
    expect(rest.events.map((event: { summary: string }) => event.summary)).toEqual(['Created task "C"']);
    expect(rest.more).toBe(false);
  });
});
