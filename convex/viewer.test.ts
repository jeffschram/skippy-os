/// <reference types="vite/client" />
import { signEnvelope, type OperationName } from "@skippy/shared";
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

describe("what needs the owner", () => {
  it("lists blocked and at-risk projects, one line for the quiet ones, a failed pass and a silent mini, and nothing else", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    expect(await refusal(t.query(api.viewer.needsYou, { now: NOW }))).toBe("not_signed_in");
    expect(await owner.query(api.viewer.needsYou, { now: NOW })).toEqual({ items: [] });

    for (const title of ["Kitchen", "Taxes", "Portfolio", "Garden", "Attic"]) await owner.mutation(api.viewer.createProject, { title });
    await asClaude(t, "record_project_status", { project: "kitchen", note: "Waiting on the countertop quote.", health: "blocked" });
    await asClaude(t, "record_project_status", { project: "taxes", note: "The Q4 payment is close.", health: "at_risk" });
    await asClaude(t, "record_project_status", { project: "garden", note: "Beds are dug.", health: "on_track" });
    // A paused project is nobody's worry, however long it has been quiet.
    await owner.mutation(api.viewer.saveProject, { slug: "attic", status: "paused" });
    await t.run(async (ctx) => {
      await ctx.db.insert("ingestionRuns", { startedAt: NOW - 3_600_000, status: "failed", pass: "11am", actor: { kind: "user" }, sources: [], note: "The connector needed a sign-in." });
      await ctx.db.insert("agentHosts", { host: "mini", lastSeenAt: NOW - 20 * 60_000 });
    });

    // Eight days on: nothing has been reported, so the active ones with no trouble have gone quiet.
    const later = NOW + 8 * 24 * 3_600_000 + 3_600_000;
    const { items } = await owner.query(api.viewer.needsYou, { now: later });
    expect(items.map((item) => [item.kind, "slug" in item ? item.slug : undefined])).toEqual([
      ["project_health", "kitchen"],
      ["project_health", "taxes"],
      ["projects_quiet", undefined],
      ["mini_away", undefined],
    ]);
    expect(items[0]).toMatchObject({ health: "blocked", note: "Waiting on the countertop quote." });
    // The quiet ones make one line, however many there are.
    expect(items[2]).toMatchObject({ count: 2 });
    expect((items[2] as { titles: string[] }).titles.sort()).toEqual(["Garden", "Portfolio"]);

    // The same day, the failed pass is there too; a later pass that works clears it.
    const sameDay = (await owner.query(api.viewer.needsYou, { now: NOW })).items;
    expect(sameDay.map((item) => item.kind)).toEqual(["project_health", "project_health", "pass_failed", "mini_away"]);
    await t.run(async (ctx) => {
      await ctx.db.insert("ingestionRuns", { startedAt: NOW - 60_000, status: "finished", pass: "1pm", actor: { kind: "user" }, sources: [] });
      const host = (await ctx.db.query("agentHosts").collect())[0];
      await ctx.db.patch(host._id, { lastSeenAt: NOW - 30_000 });
    });
    expect((await owner.query(api.viewer.needsYou, { now: NOW })).items.map((item) => item.kind)).toEqual(["project_health", "project_health"]);
  });
});

describe("plans", () => {
  it("move from intention to planning to set to happened by their tasks and date, never go stale, and show on Home when close with things open", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const { slug } = await owner.mutation(api.viewer.createProject, { title: "Thanksgiving", kind: "plan", targetDate: "2026-12-03" });
    const stage = async () => (await owner.query(api.viewer.project, { slug, now: Date.now() }))!.project.stage;
    const planItems = async () => (await owner.query(api.viewer.needsYou, { now: Date.now() })).items.filter((item) => item.kind === "plan_due");
    expect(await stage()).toBe("intention");

    const hotel = (await asClaude(t, "upsert_task", { title: "Book the hotel", project: slug })) as { task: { id: string } };
    await asClaude(t, "upsert_task", { title: "Pick the pie", project: slug });
    expect(await stage()).toBe("planning");
    expect(await planItems()).toEqual([{ kind: "plan_due", slug, title: "Thanksgiving", date: "2026-12-03", open: 2 }]);

    await asClaude(t, "complete_task", { id: hotel.task.id });
    const pie = (await owner.query(api.viewer.project, { slug, now: Date.now() }))!.openTasks[0];
    await asClaude(t, "complete_task", { id: pie.id });
    expect(await stage()).toBe("set");
    expect(await planItems()).toEqual([]);

    // A month on, with no status report ever: past, and not stale.
    vi.setSystemTime(new Date("2026-12-26T17:00:00Z"));
    expect(await stage()).toBe("happened");
    const board = await owner.query(api.viewer.board, { now: Date.now() });
    expect(board.projects[0]).toMatchObject({ kind: "plan", stage: "happened", stale: false, targetDate: "2026-12-03" });

    // An ordinary project can be turned into a plan from its page.
    await owner.mutation(api.viewer.createProject, { title: "Birthday in the city" });
    await owner.mutation(api.viewer.saveProject, { slug: "birthday-in-the-city", kind: "plan" });
    expect((await owner.query(api.viewer.project, { slug: "birthday-in-the-city", now: Date.now() }))!.project.stage).toBe("intention");
  });

  it("are not on Home when their date is more than two weeks off", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.createProject, { title: "Spring trip", kind: "plan", targetDate: "2027-03-20" });
    await asClaude(t, "upsert_task", { title: "Book flights", project: "spring-trip" });
    expect((await owner.query(api.viewer.needsYou, { now: Date.now() })).items).toEqual([]);
  });
});

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

  it("keep a project's Markdown description, from the page or from Claude, and find the project by it", async () => {
    const t = start();
    await asClaude(t, "upsert_project", { title: "Garden Shed", description: "## Goal\n\nA dry place for the **tools**." });
    const owner = t.withIdentity({ subject: OWNER });
    const read = async () => (await owner.query(api.viewer.project, { slug: "garden-shed", now: Date.now() }))!.project.description;
    expect(await read()).toBe("## Goal\n\nA dry place for the **tools**.");

    await owner.mutation(api.viewer.saveProject, { slug: "garden-shed", description: "  ## Scope\n\n- Walls\n- Roof\n  " });
    expect(await read()).toBe("## Scope\n\n- Walls\n- Roof");
    const found = (await asClaude(t, "search", { query: "Roof" })) as { results: { title: string }[] };
    expect(found.results.map((result) => result.title)).toContain("Garden Shed");

    await owner.mutation(api.viewer.saveProject, { slug: "garden-shed", description: null });
    expect(await read()).toBeUndefined();
    expect(await refusal(owner.mutation(api.viewer.saveProject, { slug: "garden-shed", description: "x".repeat(20_001) }))).toBe(
      "invalid_arguments",
    );
  });

  it("show the seven days after today, and nothing from today or later", async () => {
    const t = start();
    await asClaude(t, "upsert_task", { title: "Pick a paint color", dueAt: "2026-11-20" });
    await asClaude(t, "upsert_task", { title: "Get three quotes", dueAt: "2026-11-25" });
    await asClaude(t, "upsert_task", { title: "Order shingles", dueAt: "2026-11-28" });
    await asClaude(t, "upsert_task", { title: "Call the roofer", scheduledFor: "2026-11-26T09:00" });
    await asClaude(t, "upsert_task", { title: "Frame the walls", dueAt: "2026-12-02" });
    await asClaude(t, "upsert_task", { title: "Paint", dueAt: "2026-12-03" });
    await asClaude(t, "upsert_event", { title: "Inspection", startAt: "2026-11-27T10:00", endAt: "2026-11-27T11:00" });
    await asClaude(t, "upsert_event", { title: "Lunch today", startAt: "2026-11-25T13:00" });
    const owner = t.withIdentity({ subject: OWNER });
    expect(await refusal(t.query(api.viewer.upcoming, { now: NOW }))).toBe("not_signed_in");

    const upcoming = await owner.query(api.viewer.upcoming, { now: NOW });
    expect(upcoming.from).toBe("2026-11-26");
    expect(upcoming.to).toBe("2026-12-02");
    expect(upcoming.tasks.map((task) => task.title)).toEqual(["Call the roofer", "Order shingles", "Frame the walls"]);
    expect(upcoming.events.map((event) => event.title)).toEqual(["Inspection"]);
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
    expect(await owner.query(api.viewer.settings, {})).toEqual({ timeZone: "America/New_York", stalenessDays: 7, quietFrom: 22, quietTo: 8 });
    expect(await refusal(owner.mutation(api.viewer.saveSettings, { timeZone: "Mars/Olympus" }))).toBe("invalid_arguments");
    expect(await refusal(owner.mutation(api.viewer.saveSettings, { stalenessDays: 0 }))).toBe("invalid_arguments");

    await owner.mutation(api.viewer.saveSettings, { stalenessDays: 2, timeZone: "Asia/Tokyo" });
    expect(await owner.query(api.viewer.settings, {})).toEqual({ timeZone: "Asia/Tokyo", stalenessDays: 2, quietFrom: 22, quietTo: 8 });
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

  it("keeps a place on a task and a home address for directions", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await asClaude(t, "upsert_task", { title: "Pick up the cake", dueAt: "2026-11-25", location: "Main Street Bakery, 12 Main St" });
    const [task] = (await owner.query(api.viewer.openTasks, { now: NOW })).tasks;
    expect(task.location).toBe("Main Street Bakery, 12 Main St");
    await owner.mutation(api.viewer.saveTask, { id: task.id, location: null });
    expect((await owner.query(api.viewer.openTasks, { now: NOW })).tasks[0].location).toBeUndefined();

    await owner.mutation(api.viewer.saveSettings, { homeAddress: "  1 Elm St, Springfield  " });
    expect((await owner.query(api.viewer.settings, {})).homeAddress).toBe("1 Elm St, Springfield");
    // Saving other settings leaves it; null clears it.
    await owner.mutation(api.viewer.saveSettings, { stalenessDays: 5 });
    expect((await owner.query(api.viewer.settings, {})).homeAddress).toBe("1 Elm St, Springfield");
    await owner.mutation(api.viewer.saveSettings, { homeAddress: null });
    expect((await owner.query(api.viewer.settings, {})).homeAddress).toBeUndefined();
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

describe("the inbox", () => {
  it("takes a capture from the owner or Claude, and either can file it", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.addCapture, { text: "Ask Sam about the lease\nBefore the end of the month." });
    await owner.mutation(api.viewer.addCapture, { text: "https://example.com/article" });
    await asClaude(t, "capture", { text: "Jeff prefers aisle seats" });

    let inbox = await owner.query(api.viewer.captures, { now: NOW });
    expect(inbox.pending.map((item) => [item.text, item.url, item.by])).toEqual([
      ["Ask Sam about the lease\nBefore the end of the month.", undefined, "You"],
      [undefined, "https://example.com/article", "You"],
      ["Jeff prefers aisle seats", undefined, "Claude"],
    ]);

    // Search finds a capture nobody has filed yet.
    const found = (await asClaude(t, "search", { query: "aisle seats" })) as { results: { type: string; title: string }[] };
    expect(found.results).toEqual([expect.objectContaining({ type: "capture", title: "Jeff prefers aisle seats" })]);

    const task = await owner.mutation(api.viewer.fileCapture, { id: inbox.pending[0].id, as: "task" });
    const link = await owner.mutation(api.viewer.fileCapture, { id: inbox.pending[1].id, as: "link" });
    expect([task.type, link.type]).toEqual(["task", "knowledge"]);
    expect((await owner.query(api.viewer.task, { id: task.id }))!.task).toMatchObject({
      title: "Ask Sam about the lease",
      description: "Before the end of the month.",
    });
    expect(await refusal(owner.mutation(api.viewer.fileCapture, { id: inbox.pending[2].id, as: "link" }))).toBe("invalid_arguments");

    // Claude files the last one the way the skill says: save the record, then resolve the capture.
    const listed = (await asClaude(t, "list_captures", {})) as { captures: { id: string; text: string }[] };
    expect(listed.captures.map((item) => item.text)).toEqual(["Jeff prefers aisle seats"]);
    const memory = (await asClaude(t, "upsert_knowledge", { kind: "memory", title: "Jeff prefers aisle seats" })) as {
      knowledge: { id: string };
    };
    const resolve = { id: listed.captures[0].id, outcome: "processed", results: [{ type: "knowledge", id: memory.knowledge.id }] };
    expect(await asClaude(t, "resolve_capture", resolve)).toMatchObject({ changed: true });
    expect(await asClaude(t, "resolve_capture", resolve)).toMatchObject({ changed: false });
    expect(await refusal(asClaude(t, "resolve_capture", { id: "nope", outcome: "discarded" }))).toBe("not_found");

    inbox = await owner.query(api.viewer.captures, { now: NOW });
    expect(inbox.pending).toEqual([]);
    expect(inbox.recent.map((item) => item.results?.[0].type).sort()).toEqual(["knowledge", "knowledge", "task"]);
    // Once filed, the capture itself is no longer a search result; the record it became is.
    const after = (await asClaude(t, "search", { query: "aisle seats" })) as { results: { type: string }[] };
    expect(after.results.map((result) => result.type)).toEqual(["knowledge"]);
  });

  it("keeps a held capture private, unfiled, and only for seven days", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.addCapture, { text: "door code 4417", intent: "hold" });
    const inbox = await owner.query(api.viewer.captures, { now: NOW });
    expect(inbox.pending).toEqual([]);
    expect(inbox.held.map((item) => item.text)).toEqual(["door code 4417"]);

    expect(((await asClaude(t, "list_captures", {})) as { captures: unknown[] }).captures).toEqual([]);
    expect(((await asClaude(t, "search", { query: "door code" })) as { results: unknown[] }).results).toEqual([]);
    expect(await refusal(owner.mutation(api.viewer.fileCapture, { id: inbox.held[0].id, as: "note" }))).toBe("invalid_arguments");
    const { events } = await owner.query(api.viewer.activityLog, {});
    expect(events.map((event) => event.summary)).toEqual(["Held something for seven days"]);

    const later = NOW + 8 * 86_400_000;
    expect((await owner.query(api.viewer.captures, { now: later })).held).toEqual([]);
    vi.setSystemTime(new Date(later));
    expect(await t.mutation(internal.captures.expireHolds, {})).toEqual({ removed: 1 });
    expect(await t.run((ctx) => ctx.db.query("captures").collect())).toEqual([]);
  });

  it("is closed to everyone but the owner, and refuses an empty capture", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    expect(await refusal(t.query(api.viewer.captures, { now: NOW }))).toBe("not_signed_in");
    expect(await refusal(t.mutation(api.viewer.addCapture, { text: "x" }))).toBe("not_signed_in");
    expect(await refusal(owner.mutation(api.viewer.addCapture, { text: "   " }))).toBe("invalid_arguments");
    expect(await refusal(owner.mutation(api.viewer.discardCapture, { id: "nope" }))).toBe("not_found");
  });
});

describe("a capture made about a record", () => {
  it("files its task into that project, and links a note to it", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.createProject, { title: "Garden Shed" });
    const about = { type: "project" as const, id: "garden-shed" };
    await owner.mutation(api.viewer.addCapture, { text: "Order the roofing felt", about });
    await owner.mutation(api.viewer.addCapture, { text: "The neighbour's shed is 2.4m tall", about });
    await asClaude(t, "capture", { text: "Check the permit rules", about });
    expect(await refusal(owner.mutation(api.viewer.addCapture, { text: "x", about: { type: "project", id: "nope" } }))).toBe("not_found");

    const inbox = await owner.query(api.viewer.captures, { now: NOW });
    expect(inbox.pending.map((item) => item.about?.title)).toEqual(["Garden Shed", "Garden Shed", "Garden Shed"]);
    const task = await owner.mutation(api.viewer.fileCapture, { id: inbox.pending[0].id, as: "task" });
    const note = await owner.mutation(api.viewer.fileCapture, { id: inbox.pending[1].id, as: "note" });

    const page = (await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW }))!;
    expect(page.openTasks.map((item) => item.title)).toEqual(["Order the roofing felt"]);
    expect(task.type).toBe("task");
    const details = await owner.query(api.viewerMemory.item, { type: "knowledge", id: note.id, now: NOW });
    expect(details!.links.map((link) => [link.relation, link.record.title])).toEqual([["related_to", "Garden Shed"]]);
    const { events } = await owner.query(api.viewer.activityLog, { who: "agents" });
    expect(events[0].summary).toBe('Captured "Check the permit rules" for project "Garden Shed"');
  });
});

describe("areas", () => {
  it("are the owner's list: added, renamed, ordered and removed, and set on a task or a recurrence by name", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    expect(await refusal(t.query(api.viewer.areas, {}))).toBe("not_signed_in");
    const { id: home } = await owner.mutation(api.viewer.saveArea, { name: "Household" });
    const { id: work } = await owner.mutation(api.viewer.saveArea, { name: "Work" });
    expect(await refusal(owner.mutation(api.viewer.saveArea, { name: "household" }))).toBe("invalid_arguments");
    await owner.mutation(api.viewer.saveArea, { id: work, name: "Studio" });
    await owner.mutation(api.viewer.moveArea, { id: work, direction: "up" });
    expect((await owner.query(api.viewer.areas, {})).areas.map((area) => area.name)).toEqual(["Studio", "Household"]);

    // The owner sets it on the dashboard, and Claude by name; a name that is not on the list is refused with the list.
    await owner.mutation(api.viewer.saveTask, { title: "Fix the gutter", area: "Household" });
    const made = (await asClaude(t, "upsert_task", { title: "Send the invoice", area: "studio" })) as { task: { id: string; area?: string } };
    expect(made.task.area).toBe("Studio");
    await asClaude(t, "upsert_recurrence", { title: "Change the furnace filter", rule: { kind: "interval", everyDays: 90 }, area: "Household" });
    const wrong = await asClaude(t, "upsert_task", { title: "Nope", area: "Garden" }).catch((error: ConvexError<{ message: string }>) => error.data.message);
    expect(wrong).toContain("The areas are: Studio, Household.");
    expect((await owner.query(api.viewer.areas, {})).areas).toMatchObject([
      { name: "Studio", openTasks: 1, recurrences: 0 },
      { name: "Household", openTasks: 1, recurrences: 1 },
    ]);
    const today = (await asClaude(t, "get_today", {})) as { recurrences: { area?: string }[] };
    expect(today.recurrences[0].area).toBe("Household");

    // Clearing it, and removing an area: the records stay.
    await asClaude(t, "upsert_task", { id: made.task.id, area: null });
    expect(await owner.mutation(api.viewer.removeArea, { id: home })).toEqual({ cleared: 2 });
    expect((await owner.query(api.viewer.areas, {})).areas).toMatchObject([{ name: "Studio", openTasks: 0 }]);
    const tasks = await t.run((ctx) => ctx.db.query("tasks").collect());
    expect(tasks.map((task) => [task.title, task.areaId]).sort()).toEqual([
      ["Fix the gutter", undefined],
      ["Send the invoice", undefined],
    ]);
  });
});

describe("one person, several addresses", () => {
  it("adds a new address under a known name to that person, unless told it is someone else", async () => {
    const t = start();
    type Saved = { created: boolean; person: { id: string; emails: string[]; phoneNumbers: string[] } };
    const first = (await asClaude(t, "upsert_person", { name: "Marco Rossi", emails: ["marco@example.com"] })) as Saved;
    expect(first.created).toBe(true);
    // The same person turns up in messages as a phone number.
    const second = (await asClaude(t, "upsert_person", { name: "marco rossi", phoneNumbers: ["+1 203 555 0100"] })) as Saved;
    expect(second.created).toBe(false);
    expect(second.person.id).toBe(first.person.id);
    expect(second.person.emails).toEqual(["marco@example.com"]);
    expect(second.person.phoneNumbers).toHaveLength(1);

    // A namesake is a second person only when said to be.
    const other = (await asClaude(t, "upsert_person", { name: "Marco Rossi", emails: ["other.marco@example.com"], separate: true })) as Saved;
    expect(other.created).toBe(true);
    expect(other.person.id).not.toBe(first.person.id);
    // With two people of that name, a third address cannot be guessed onto either.
    const third = (await asClaude(t, "upsert_person", { name: "Marco Rossi", emails: ["third@example.com"] })) as Saved;
    expect(third.created).toBe(true);
    expect(await t.run(async (ctx) => (await ctx.db.query("people").collect()).length)).toBe(3);
  });
});
