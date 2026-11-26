/// <reference types="vite/client" />
import { signEnvelope, type OperationName } from "@skippy/shared";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { ahead, clock, taskTime } from "./reminders";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const SECRET = "test-secret-".repeat(4);
const OWNER = "user_owner";
const RESOURCE = "http://localhost:3000/api/mcp";
const ZONE = "America/New_York";
// Noon in New York on Wednesday 2026-11-25.
const NOW = new Date("2026-11-25T17:00:00Z").getTime();
const MINUTE = 60_000;

beforeEach(() => {
  process.env.SKIPPY_GATEWAY_SECRET = SECRET;
  process.env.SKIPPY_OWNER_CLERK_USER_ID = OWNER;
  process.env.SKIPPY_MCP_RESOURCE_URL = RESOURCE;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
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

/** A device that has asked for notifications, so they are not held back for want of one. */
async function withDevice(t: Harness) {
  await t.run(async (ctx) => {
    await ctx.db.insert("pushSubscriptions", { endpoint: "https://push.example/1", p256dh: "k", auth: "a", enabled: true, createdAt: NOW });
  });
}

async function sent(t: Harness) {
  return await t.run(async (ctx) => (await ctx.db.query("notificationDeliveries").collect()).filter((row) => row.type === "reminder"));
}

type Saved = { event?: { id: string; remindMinutes: number | null }; task?: { id: string; remindMinutes: number | null; hasTime: boolean } };

describe("reminder wording", () => {
  it("tells the time on the owner's clock and how far ahead", () => {
    expect(clock(NOW, ZONE)).toBe("12:00 PM");
    expect(clock(NOW + 75 * MINUTE, ZONE)).toBe("1:15 PM");
    expect(ahead(15)).toBe("in 15 minutes");
    expect(ahead(60)).toBe("in 1 hour");
    expect(ahead(1440)).toBe("in a day");
    expect(ahead(0)).toBe("now");
  });

  it("finds a task's time of day only when it has one", () => {
    const midnight = new Date("2026-11-25T05:00:00Z").getTime();
    const lastMinute = new Date("2026-11-26T04:59:00Z").getTime();
    expect(taskTime({ scheduledFor: midnight, dueAt: lastMinute }, ZONE)).toBeUndefined();
    expect(taskTime({ scheduledFor: midnight, dueAt: NOW }, ZONE)).toEqual({ at: NOW, which: "due" });
    expect(taskTime({ scheduledFor: NOW, dueAt: NOW + MINUTE }, ZONE)).toEqual({ at: NOW, which: "planned" });
  });
});

describe("reminders", () => {
  it("is 15 minutes before unless set otherwise, and none can be chosen", async () => {
    const t = start();
    const standard = await asClaude<Saved>(t, "upsert_event", { title: "Dentist", startAt: "2026-11-26T09:00" });
    expect(standard.event!.remindMinutes).toBe(15);
    const changed = await asClaude<Saved>(t, "upsert_event", { id: standard.event!.id, remindMinutes: 60 });
    expect(changed.event!.remindMinutes).toBe(60);
    const none = await asClaude<Saved>(t, "upsert_event", { id: standard.event!.id, remindMinutes: null });
    expect(none.event!.remindMinutes).toBeNull();

    const task = await asClaude<Saved>(t, "upsert_task", { title: "Call the plumber", scheduledFor: "2026-11-26T10:30" });
    expect(task.task).toMatchObject({ remindMinutes: 15, hasTime: true });
    const bareDay = await asClaude<Saved>(t, "upsert_task", { title: "Buy stamps", dueAt: "2026-11-26" });
    expect(bareDay.task!.hasTime).toBe(false);
    await expect(asClaude(t, "upsert_task", { id: task.task!.id, remindMinutes: 5000 })).rejects.toThrow();
  });

  it("goes out when its moment comes, once, and not for all-day, called-off or bare-day things", async () => {
    const t = start();
    await withDevice(t);
    // Due now: 15 minutes before 12:15, and 30 minutes before 12:30.
    await asClaude(t, "upsert_event", { title: "Standing call", startAt: "2026-11-25T12:15", location: "Room 4" });
    await asClaude(t, "upsert_event", { title: "Pick up the car", startAt: "2026-11-25T12:30", remindMinutes: 30 });
    // Not yet, not at all, or not with a time.
    await asClaude(t, "upsert_event", { title: "Lunch", startAt: "2026-11-25T12:30" });
    await asClaude(t, "upsert_event", { title: "Quiet one", startAt: "2026-11-25T12:15", remindMinutes: null });
    await asClaude(t, "upsert_event", { title: "Holiday", startAt: "2026-11-25" });
    await asClaude(t, "upsert_event", { title: "Called off", startAt: "2026-11-25T12:15", status: "cancelled" });
    // A task planned for 12:10 with ten minutes' notice is due now; one due on a bare day is not.
    await asClaude(t, "upsert_task", { title: "Water the plants", scheduledFor: "2026-11-25T12:10", remindMinutes: 10 });
    await asClaude(t, "upsert_task", { title: "Pay the bill", dueAt: "2026-11-25" });
    await asClaude(t, "upsert_task", { title: "Already done", scheduledFor: "2026-11-25T12:15", status: "done" });

    expect(await t.mutation(internal.reminders.sendDue, {})).toEqual({ sent: 3 });
    const first = await sent(t);
    expect(first.map((row) => row.title).sort()).toEqual(["Pick up the car", "Standing call", "Water the plants"]);
    expect(first.find((row) => row.title === "Standing call")).toMatchObject({
      body: "Starts in 15 minutes, at 12:15 PM · Room 4",
      status: "pending",
    });
    expect(first.find((row) => row.title === "Water the plants")!.body).toBe("Planned for 12:10 PM, in 10 minutes");
    expect(first.find((row) => row.title === "Water the plants")!.url).toMatch(/^\/\?task=/);

    // A minute later the same ones are not sent again.
    vi.setSystemTime(new Date(NOW + MINUTE));
    await t.mutation(internal.reminders.sendDue, {});
    expect(await sent(t)).toHaveLength(3);

    // A later one, on the standard fifteen minutes, goes out when its own moment comes.
    const lunch = (await t.run(async (ctx) => (await ctx.db.query("calendarEvents").collect()).find((row) => row.title === "Lunch")))!;
    vi.setSystemTime(new Date(NOW + 15 * MINUTE));
    await t.mutation(internal.reminders.sendDue, {});
    expect((await sent(t)).map((row) => row.title)).toContain("Lunch");
    expect(lunch.remindMinutes).toBeUndefined();
  });
});
