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
