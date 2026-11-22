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
const CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata";
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

/** Writes the way Claude does: signed, through the gateway. */
async function asClaude(t: Harness, operation: OperationName, args: Record<string, unknown>) {
  const principal = {
    kind: "oauth" as const,
    subject: OWNER,
    clientId: CLAUDE,
    resource: RESOURCE,
    scopes: ["skippy:read", "skippy:write"],
  };
  return await t.action(api.gateway.call, await signEnvelope({ operation, args, principal }, SECRET));
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

describe("the web app's queries", () => {
  it("give nothing to someone who is not signed in", async () => {
    const t = start();
    expect(await t.query(api.viewer.me, {})).toEqual({ viewer: "signed_out" });
    expect(await refusal(t.query(api.viewer.today, { now: NOW }))).toBe("not_signed_in");
    expect(await refusal(t.query(api.viewer.projects, { now: NOW }))).toBe("not_signed_in");
    expect(await refusal(t.query(api.viewer.activity, {}))).toBe("not_signed_in");
  });

  it("give nothing to a signed-in account that is not the owner", async () => {
    const t = start();
    await asClaude(t, "upsert_project", { title: "Garden Shed" });
    const stranger = t.withIdentity({ subject: "user_someone_else" });
    expect(await stranger.query(api.viewer.me, {})).toEqual({ viewer: "not_owner" });
    expect(await refusal(stranger.query(api.viewer.today, { now: NOW }))).toBe("account_not_authorized");
    expect(await refusal(stranger.query(api.viewer.projects, { now: NOW }))).toBe("account_not_authorized");
    expect(await refusal(stranger.query(api.viewer.activity, {}))).toBe("account_not_authorized");
  });

  it("refuse everyone while no owner is set", async () => {
    const t = start();
    delete process.env.SKIPPY_OWNER_CLERK_USER_ID;
    const someone = t.withIdentity({ subject: OWNER });
    expect(await refusal(someone.query(api.viewer.me, {}))).toBe("viewer_not_configured");
    expect(await refusal(someone.query(api.viewer.projects, { now: NOW }))).toBe("viewer_not_configured");
  });

  it("show the owner today, the projects and the activity log", async () => {
    const t = start();
    await asClaude(t, "upsert_project", { title: "Garden Shed" });
    await asClaude(t, "upsert_task", { title: "Get three quotes", project: "garden-shed", dueAt: "2026-11-25" });
    await asClaude(t, "upsert_task", { title: "Pick a paint color", project: "garden-shed", dueAt: "2026-11-20" });
    await asClaude(t, "upsert_task", { title: "Order shingles", dueAt: "2026-12-05" });
    const owner = t.withIdentity({ subject: OWNER });

    expect(await owner.query(api.viewer.me, {})).toEqual({ viewer: "owner" });

    const today = await owner.query(api.viewer.today, { now: NOW });
    expect(today.date).toBe("2026-11-25");
    expect(today.dueToday.map((task) => task.title)).toEqual(["Get three quotes"]);
    expect(today.overdue.map((task) => task.title)).toEqual(["Pick a paint color"]);
    expect(today.dueToday[0].project).toBe("garden-shed");

    const { projects } = await owner.query(api.viewer.projects, { now: NOW });
    expect(projects.map((project) => project.title)).toEqual(["Garden Shed"]);
    expect(projects[0].stale).toBe(false);

    const { events } = await owner.query(api.viewer.activity, {});
    expect(events).toHaveLength(4);
    expect(events[0].summary).toContain("Order shingles");
    expect(events[0].by).toBe("Claude");
    expect((await owner.query(api.viewer.activity, { limit: 1 })).events).toHaveLength(1);
  });

  it("work out the day and what is stale from the time the page sends", async () => {
    const t = start();
    await asClaude(t, "upsert_project", { title: "Garden Shed", status: "active" });
    await asClaude(t, "upsert_task", { title: "Get three quotes", dueAt: "2026-11-25" });
    const owner = t.withIdentity({ subject: OWNER });
    const later = NOW + 10 * 86_400_000;

    const today = await owner.query(api.viewer.today, { now: later });
    expect(today.date).toBe("2026-12-05");
    expect(today.overdue.map((task) => task.title)).toEqual(["Get three quotes"]);
    expect((await owner.query(api.viewer.projects, { now: later })).projects[0].stale).toBe(true);
  });
});

describe("the projects board and a project's page", () => {
  it("lists every project, live ones first, with what is open and what comes next", async () => {
    const t = start();
    await asClaude(t, "upsert_project", { title: "Old Fence", status: "archived" });
    await asClaude(t, "upsert_project", { title: "Garden Shed" });
    await asClaude(t, "upsert_task", { title: "Wait for the permit", project: "garden-shed", status: "waiting" });
    await asClaude(t, "upsert_task", { title: "Order shingles", project: "garden-shed", dueAt: "2026-12-05" });
    await asClaude(t, "upsert_task", { title: "Get three quotes", project: "garden-shed", dueAt: "2026-11-27" });
    await asClaude(t, "upsert_task", { title: "Pour the slab", project: "garden-shed", status: "done" });
    const owner = t.withIdentity({ subject: OWNER });

    const { projects } = await owner.query(api.viewer.board, { now: NOW });
    expect(projects.map((project) => project.slug)).toEqual(["garden-shed", "old-fence"]);
    expect(projects[0].openTaskCount).toBe(3);
    expect(projects[0].nextTasks.map((task) => task.title)).toEqual([
      "Get three quotes",
      "Order shingles",
      "Wait for the permit",
    ]);
    expect(projects[1].openTaskCount).toBe(0);
  });

  it("reads one project in full, and answers null for a slug nobody has", async () => {
    const t = start();
    await asClaude(t, "upsert_project", { title: "Garden Shed" });
    await asClaude(t, "record_project_status", { project: "garden-shed", note: "Slab poured." });
    const owner = t.withIdentity({ subject: OWNER });

    const page = await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW });
    expect(page?.project.title).toBe("Garden Shed");
    expect(page?.recentUpdates.map((update) => update.note)).toEqual(["Slab poured."]);
    expect(await owner.query(api.viewer.project, { slug: "no-such-project", now: NOW })).toBeNull();
  });

  it("keeps both from anyone but the owner", async () => {
    const t = start();
    await asClaude(t, "upsert_project", { title: "Garden Shed" });
    const stranger = t.withIdentity({ subject: "user_someone_else" });
    expect(await refusal(t.query(api.viewer.board, { now: NOW }))).toBe("not_signed_in");
    expect(await refusal(stranger.query(api.viewer.board, { now: NOW }))).toBe("account_not_authorized");
    expect(await refusal(stranger.query(api.viewer.project, { slug: "garden-shed", now: NOW }))).toBe(
      "account_not_authorized",
    );
  });
});

describe("the owner's changes from the web app", () => {
  it("add, change and finish a task, logged with the owner as the actor", async () => {
    const t = start();
    await asClaude(t, "upsert_project", { title: "Garden Shed" });
    const owner = t.withIdentity({ subject: OWNER });

    expect(await owner.mutation(api.viewer.saveTask, { title: "Get three quotes", project: "garden-shed" })).toEqual({
      created: true,
      changed: true,
    });
    const page = await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW });
    const task = page!.openTasks[0];
    expect(task.title).toBe("Get three quotes");

    await owner.mutation(api.viewer.saveTask, { id: task.id, dueAt: "2026-11-27" });
    await owner.mutation(api.viewer.saveTask, { id: task.id, status: "done" });
    const after = await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW });
    expect(after!.openTasks).toHaveLength(0);
    expect(after!.recentlyClosedTasks[0].due?.date).toBe("2026-11-27");

    const { events } = await owner.query(api.viewer.activity, {});
    expect(events.slice(0, 3).map((event) => event.by)).toEqual(["You", "You", "You"]);
    expect(events[0].type).toBe("task.completed");

    // What Claude reads at the start of its next session shows the owner's change.
    const changes = (await asClaude(t, "get_changes_since", { since: "2026-11-01" })) as {
      events: { by: string; type: string }[];
    };
    expect(changes.events.at(-1)).toMatchObject({ by: "You", type: "task.completed" });
  });

  it("change a project, and never make one from a slug nobody has", async () => {
    const t = start();
    await asClaude(t, "upsert_project", { title: "Garden Shed" });
    const owner = t.withIdentity({ subject: OWNER });

    expect(await owner.mutation(api.viewer.saveProject, { slug: "garden-shed", status: "paused", health: "at_risk" })).toEqual({
      changed: true,
    });
    const page = await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW });
    expect(page?.project.status).toBe("paused");
    expect(page?.project.health).toBe("at_risk");

    expect(await refusal(owner.mutation(api.viewer.saveProject, { slug: "no-such-project", title: "Ghost" }))).toBe(
      "not_found",
    );
    expect((await owner.query(api.viewer.board, { now: NOW })).projects).toHaveLength(1);
  });

  it("are refused for anyone but the owner", async () => {
    const t = start();
    await asClaude(t, "upsert_project", { title: "Garden Shed" });
    const stranger = t.withIdentity({ subject: "user_someone_else" });
    expect(await refusal(t.mutation(api.viewer.saveTask, { title: "Sneak in" }))).toBe("not_signed_in");
    expect(await refusal(stranger.mutation(api.viewer.saveTask, { title: "Sneak in" }))).toBe("account_not_authorized");
    expect(await refusal(stranger.mutation(api.viewer.saveProject, { slug: "garden-shed", status: "archived" }))).toBe(
      "account_not_authorized",
    );
    const owner = t.withIdentity({ subject: OWNER });
    expect((await owner.query(api.viewer.activity, {})).events).toHaveLength(1);
  });
});

describe("what agents did since the owner last looked", () => {
  it("lists agents' changes only, and clears when marked as seen", async () => {
    const t = start();
    await asClaude(t, "upsert_project", { title: "Garden Shed" });
    await asClaude(t, "upsert_task", { title: "Get three quotes", project: "garden-shed" });
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.saveTask, { title: "Buy paint" });

    const unseen = await owner.query(api.viewer.sinceLastLook, {});
    expect(unseen.count).toBe(2);
    expect(unseen.events.map((event) => event.by)).toEqual(["Claude", "Claude"]);
    expect(unseen.events.map((event) => event.project)).toEqual(["garden-shed", "garden-shed"]);

    await owner.mutation(api.viewer.markSeen, { through: unseen.newestAt! });
    expect((await owner.query(api.viewer.sinceLastLook, {})).count).toBe(0);

    vi.setSystemTime(new Date(NOW + 60_000));
    await asClaude(t, "record_project_status", { project: "garden-shed", note: "Quotes are in." });
    const later = await owner.query(api.viewer.sinceLastLook, {});
    expect(later.events.map((event) => event.type)).toEqual(["project.status_recorded"]);

    // Marking an older point never brings read lines back.
    await owner.mutation(api.viewer.markSeen, { through: later.newestAt! });
    await owner.mutation(api.viewer.markSeen, { through: NOW - 1000 });
    expect((await owner.query(api.viewer.sinceLastLook, {})).count).toBe(0);
  });

  it("reads one task with its history, and is closed to everyone else", async () => {
    const t = start();
    await asClaude(t, "upsert_project", { title: "Garden Shed" });
    const made = (await asClaude(t, "upsert_task", { title: "Get three quotes", project: "garden-shed" })) as {
      task: { id: string };
    };
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.saveTask, { id: made.task.id, scheduledFor: "2026-11-27", commitment: "want" });

    const details = await owner.query(api.viewer.task, { id: made.task.id });
    expect(details?.task.scheduledFor?.date).toBe("2026-11-27");
    expect(details?.task.commitment).toBe("want");
    expect(details?.projectTitle).toBe("Garden Shed");
    expect(details?.history.map((event) => event.by)).toEqual(["You", "Claude"]);
    expect(await owner.query(api.viewer.task, { id: "not-a-task" })).toBeNull();

    const stranger = t.withIdentity({ subject: "user_someone_else" });
    expect(await refusal(stranger.query(api.viewer.task, { id: made.task.id }))).toBe("account_not_authorized");
    expect(await refusal(stranger.query(api.viewer.sinceLastLook, {}))).toBe("account_not_authorized");
    expect(await refusal(stranger.mutation(api.viewer.markSeen, { through: NOW }))).toBe("account_not_authorized");
  });
});

describe("phases, new projects, the agenda and settings", () => {
  it("lets Claude and the owner change a phase, and logs each change once", async () => {
    const t = start();
    await asClaude(t, "upsert_project", { title: "Garden Shed" });
    const made = (await asClaude(t, "create_phase", { project: "garden-shed", title: "Foundation" })) as {
      phase: { id: string };
    };
    const first = (await asClaude(t, "update_phase", { id: made.phase.id, status: "active" })) as { changed: boolean };
    const again = (await asClaude(t, "update_phase", { id: made.phase.id, status: "active" })) as { changed: boolean };
    expect([first.changed, again.changed]).toEqual([true, false]);
    expect(await refusal(asClaude(t, "update_phase", { id: "nope", status: "done" }))).toBe("not_found");

    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.savePhase, { id: made.phase.id, status: "done", title: "Slab" });
    await owner.mutation(api.viewer.savePhase, { project: "garden-shed", title: "Framing" });
    const page = await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW });
    expect(page!.phases.map((phase) => [phase.order, phase.title, phase.status])).toEqual([
      [1, "Slab", "done"],
      [2, "Framing", "planned"],
    ]);
    const { events } = await owner.query(api.viewer.activityLog, { who: "owner" });
    expect(events.map((event) => event.type)).toEqual(["phase.created", "phase.updated"]);
    expect(events[0].project).toBe("garden-shed");
    expect((await owner.query(api.viewer.activityLog, { who: "agents" })).events).toHaveLength(3);
    expect(await owner.query(api.viewer.activityLog, { limit: 2 })).toMatchObject({ more: true });
  });

  it("lets the owner add a project, and refuses a title already in use", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    expect(await owner.mutation(api.viewer.createProject, { title: "Garden Shed" })).toEqual({ slug: "garden-shed" });
    expect(await refusal(owner.mutation(api.viewer.createProject, { title: "Garden Shed" }))).not.toBe("accepted");
    expect((await owner.query(api.viewer.board, { now: NOW })).projects).toHaveLength(1);
  });

  it("lists every open task with the owner's today", async () => {
    const t = start();
    await asClaude(t, "upsert_task", { title: "Get three quotes", dueAt: "2026-11-27" });
    await asClaude(t, "upsert_task", { title: "Wait for the permit", status: "waiting" });
    await asClaude(t, "upsert_task", { title: "Pour the slab", status: "done" });
    const owner = t.withIdentity({ subject: OWNER });
    const agenda = await owner.query(api.viewer.openTasks, { now: NOW });
    expect(agenda.today).toBe("2026-11-25");
    expect(agenda.tasks.map((task) => task.title).sort()).toEqual(["Get three quotes", "Wait for the permit"]);
  });

  it("saves settings, and they change what counts as stale and as today", async () => {
    const t = start();
    await asClaude(t, "upsert_project", { title: "Garden Shed" });
    const owner = t.withIdentity({ subject: OWNER });
    expect(await owner.query(api.viewer.settings, {})).toEqual({ timeZone: "America/New_York", stalenessDays: 7 });
    expect(await refusal(owner.mutation(api.viewer.saveSettings, { timeZone: "Mars/Olympus" }))).toBe("invalid_arguments");
    expect(await refusal(owner.mutation(api.viewer.saveSettings, { stalenessDays: 0 }))).toBe("invalid_arguments");

    await owner.mutation(api.viewer.saveSettings, { stalenessDays: 2, timeZone: "Asia/Tokyo" });
    expect(await owner.query(api.viewer.settings, {})).toEqual({ timeZone: "Asia/Tokyo", stalenessDays: 2 });
    expect((await owner.query(api.viewer.openTasks, { now: NOW })).today).toBe("2026-11-26");
    const later = NOW + 3 * 86_400_000;
    expect((await owner.query(api.viewer.board, { now: later })).projects[0].stale).toBe(true);

    const stranger = t.withIdentity({ subject: "user_someone_else" });
    expect(await refusal(stranger.mutation(api.viewer.saveSettings, { stalenessDays: 3 }))).toBe("account_not_authorized");
    expect(await refusal(stranger.mutation(api.viewer.savePhase, { project: "garden-shed", title: "X" }))).toBe(
      "account_not_authorized",
    );
    expect(await refusal(stranger.mutation(api.viewer.createProject, { title: "X" }))).toBe("account_not_authorized");
  });
});

describe("reordering and removing phases, deleting a task, and a project's Claude home", () => {
  it("moves a phase, renumbers the plan, and does nothing at either end", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.createProject, { title: "Garden Shed" });
    for (const title of ["Foundation", "Framing", "Roof"]) {
      await owner.mutation(api.viewer.savePhase, { project: "garden-shed", title });
    }
    const plan = async () =>
      (await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW }))!.phases.map((phase) => [phase.order, phase.title]);
    const id = async (title: string) =>
      (await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW }))!.phases.find((phase) => phase.title === title)!.id;

    expect(await owner.mutation(api.viewer.movePhase, { id: await id("Roof"), direction: "up" })).toEqual({ changed: true });
    expect(await plan()).toEqual([
      [1, "Foundation"],
      [2, "Roof"],
      [3, "Framing"],
    ]);
    expect(await owner.mutation(api.viewer.movePhase, { id: await id("Foundation"), direction: "up" })).toEqual({ changed: false });
    expect(await owner.mutation(api.viewer.movePhase, { id: await id("Framing"), direction: "down" })).toEqual({ changed: false });
    const { events } = await owner.query(api.viewer.activityLog, {});
    expect(events.filter((event) => event.type === "phase.moved")).toHaveLength(1);
    expect(await refusal(t.mutation(api.viewer.movePhase, { id: await id("Roof"), direction: "up" }))).toBe("not_signed_in");
  });

  it("removes a phase, keeps its tasks in the project and closes the gap", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.createProject, { title: "Garden Shed" });
    for (const title of ["Foundation", "Framing", "Roof"]) {
      await owner.mutation(api.viewer.savePhase, { project: "garden-shed", title });
    }
    const before = (await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW }))!;
    const framing = before.phases[1].id;
    await owner.mutation(api.viewer.saveTask, { title: "Buy studs", project: "garden-shed", phaseId: framing });

    expect(await owner.mutation(api.viewer.removePhase, { id: framing })).toEqual({ tasksKept: 1 });
    const after = (await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW }))!;
    expect(after.phases.map((phase) => [phase.order, phase.title])).toEqual([
      [1, "Foundation"],
      [2, "Roof"],
    ]);
    expect(after.openTasks.map((task) => [task.title, task.phaseId])).toEqual([["Buy studs", undefined]]);
    const { events } = await owner.query(api.viewer.activityLog, {});
    expect(events[0]).toMatchObject({ type: "phase.removed", project: "garden-shed" });
    expect(await refusal(owner.mutation(api.viewer.removePhase, { id: framing }))).toBe("not_found");
    expect(await refusal(t.mutation(api.viewer.removePhase, { id: before.phases[0].id }))).toBe("not_signed_in");
  });

  it("deletes a task with its search entry and links, and keeps its history", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await asClaude(t, "upsert_project", { title: "Garden Shed" });
    const made = (await asClaude(t, "upsert_task", { title: "Buy purple paint", project: "garden-shed" })) as {
      task: { id: string };
    };
    const person = (await asClaude(t, "upsert_person", { name: "Pat Painter" })) as { person: { id: string } };
    await asClaude(t, "link_entities", {
      from: { type: "task", id: made.task.id },
      relation: "waiting_on",
      to: { type: "person", id: person.person.id },
    });
    const found = (await asClaude(t, "search", { query: "purple" })) as { results: unknown[] };
    expect(found.results).toHaveLength(1);

    expect(await refusal(t.mutation(api.viewer.deleteTask, { id: made.task.id }))).toBe("not_signed_in");
    await owner.mutation(api.viewer.deleteTask, { id: made.task.id });

    expect(await owner.query(api.viewer.task, { id: made.task.id })).toBeNull();
    expect((await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW }))!.openTasks).toEqual([]);
    expect(((await asClaude(t, "search", { query: "purple" })) as { results: unknown[] }).results).toEqual([]);
    const rows = await t.run(async (ctx) => ({
      links: await ctx.db.query("relationships").collect(),
      searchDocs: (await ctx.db.query("searchDocs").collect()).map((doc) => doc.entityType),
    }));
    expect(rows.links).toEqual([]);
    expect(rows.searchDocs.sort()).toEqual(["person", "project"]);
    const { events } = await owner.query(api.viewer.activityLog, { who: "owner" });
    expect(events.map((event) => [event.type, event.summary])).toEqual([
      ["task.deleted", 'Deleted task "Buy purple paint" from "Garden Shed"'],
    ]);
    expect(await refusal(owner.mutation(api.viewer.deleteTask, { id: made.task.id }))).toBe("not_found");
  });

  it("sets and clears a project's Claude home and target date", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.createProject, { title: "Garden Shed" });
    await owner.mutation(api.viewer.saveProject, {
      slug: "garden-shed",
      claudeHome: { kind: "claude_project", name: "Garden Shed", url: "https://claude.ai/project/abc" },
      targetDate: "2026-12-24",
    });
    let page = (await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW }))!;
    expect(page.project.claudeHome).toEqual({ kind: "claude_project", name: "Garden Shed", url: "https://claude.ai/project/abc" });
    expect(page.project.targetDate).toBe("2026-12-24");
    await owner.mutation(api.viewer.saveProject, { slug: "garden-shed", claudeHome: null, targetDate: null });
    page = (await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW }))!;
    expect([page.project.claudeHome, page.project.targetDate]).toEqual([undefined, undefined]);
  });
});
