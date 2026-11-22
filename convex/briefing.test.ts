/// <reference types="vite/client" />
import { signEnvelope, type OperationName } from "@skippy/shared";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { isQuiet } from "./push";
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

async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ConvexError) return String((error.data as { code?: unknown }).code);
    throw error;
  }
  return "accepted";
}

const device = { endpoint: "https://push.example/abc", p256dh: "key", auth: "secret", userAgent: "Test Phone" };
type Written = { date: string; changed: boolean; notification: string };

describe("quiet hours", () => {
  it("cover a stretch that may run over midnight, and none when the ends are equal", () => {
    expect([21, 22, 23, 0, 7, 8, 12].map((hour) => isQuiet(hour, 22, 8))).toEqual([false, true, true, true, true, false, false]);
    expect([12, 13, 14].map((hour) => isQuiet(hour, 13, 14))).toEqual([false, true, false]);
    expect(isQuiet(3, 0, 0)).toBe(false);
  });
});

describe("the briefing", () => {
  it("is written once a day, shown on Home, and tells the next pass it is done", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    expect(await owner.query(api.viewer.briefing, { now: NOW })).toBeNull();
    expect((await asClaude<{ briefingWritten: boolean }>(t, "get_importance_rubric", {})).briefingWritten).toBe(false);

    const first = await asClaude<Written>(t, "record_briefing", { text: "Two things today.\n- Dentist at 3.\n- Rent is due." });
    expect(first).toMatchObject({ date: "2026-11-25", changed: true });
    expect((await asClaude<{ briefingWritten: boolean }>(t, "get_importance_rubric", {})).briefingWritten).toBe(true);
    expect(await owner.query(api.viewer.briefing, { now: NOW })).toMatchObject({
      date: "2026-11-25",
      isToday: true,
      by: "Claude",
      text: "Two things today.\n- Dentist at 3.\n- Rent is due.",
    });

    // The same words again change nothing; new words replace the note.
    expect(await asClaude<Written>(t, "record_briefing", { text: "Two things today.\n- Dentist at 3.\n- Rent is due." })).toMatchObject({ changed: false });
    await asClaude(t, "record_briefing", { text: "Three things today." });
    expect((await owner.query(api.viewer.briefing, { now: NOW }))!.text).toBe("Three things today.");
    expect(await t.run((ctx) => ctx.db.query("briefings").collect())).toHaveLength(1);

    // Tomorrow, yesterday's note is still the latest, and says so.
    expect((await owner.query(api.viewer.briefing, { now: NOW + 86_400_000 }))!.isToday).toBe(false);
    expect(await refusal(asClaude(t, "record_briefing", { text: "x", date: "tomorrow" }))).toBe("invalid_arguments");
    expect(await refusal(t.query(api.viewer.briefing, { now: NOW }))).toBe("not_signed_in");
  });

  it("sends one notification for today's note, with what the day holds", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.savePushSubscription, device);
    await owner.mutation(api.viewer.saveTask, { title: "Pay rent", dueAt: "2026-11-25" });
    await owner.mutation(api.viewer.saveTask, { title: "Renew passport", dueAt: "2026-11-20" });
    await owner.mutation(api.viewer.saveEvent, { title: "Dentist", startAt: "2026-11-25T15:00" });

    expect((await asClaude<Written>(t, "record_briefing", { text: "First." })).notification).toBe("pending");
    expect((await asClaude<Written>(t, "record_briefing", { text: "Second." })).notification).toBe("duplicate");
    expect((await asClaude<Written>(t, "record_briefing", { text: "Old.", date: "2026-11-24" })).notification).toBe("skipped");

    const { recent } = await owner.query(api.viewer.notifications, {});
    expect(recent.map((delivery) => [delivery.title, delivery.body])).toEqual([
      ["Your briefing is ready", "1 due today, 1 overdue, 1 event"],
    ]);
  });
});

describe("notifications", () => {
  it("are held back when no device asked for them, and in quiet hours", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    expect((await asClaude<Written>(t, "record_briefing", { text: "Nobody to tell." })).notification).toBe("skipped");
    let seen = await owner.query(api.viewer.notifications, {});
    expect(seen.recent[0]).toMatchObject({ status: "skipped", reason: "no device has notifications turned on" });

    await owner.mutation(api.viewer.savePushSubscription, device);
    await owner.mutation(api.viewer.savePushSubscription, device);
    seen = await owner.query(api.viewer.notifications, {});
    expect(seen.devices).toEqual([{ endpoint: device.endpoint, userAgent: "Test Phone" }]);

    // Noon falls inside quiet hours set from 10 to 14.
    await owner.mutation(api.viewer.saveSettings, { quietFrom: 10, quietTo: 14 });
    await asClaude(t, "record_briefing", { text: "Tomorrow's.", date: "2026-11-26" });
    vi.setSystemTime(new Date(NOW + 86_400_000));
    expect((await asClaude<Written>(t, "record_briefing", { text: "Written at noon.", date: "2026-11-26" })).notification).toBe("skipped");
    seen = await owner.query(api.viewer.notifications, {});
    expect(seen.recent[0]).toMatchObject({ status: "skipped", reason: "quiet hours" });
    // A test goes out whatever the hour.
    expect(await owner.mutation(api.viewer.sendTestNotification, {})).toEqual({ status: "pending" });
    expect(await refusal(owner.mutation(api.viewer.saveSettings, { quietFrom: 24 }))).toBe("invalid_arguments");
  });

  it("say so when the push keys are not set, and forget a device that turns them off", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.savePushSubscription, device);
    expect((await owner.query(api.viewer.notifications, {})).publicKey).toBeNull();
    await owner.mutation(api.viewer.sendTestNotification, {});
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();
    const seen = await owner.query(api.viewer.notifications, {});
    expect(seen.recent[0]).toMatchObject({ status: "failed", reason: "the push keys are not set" });

    await owner.mutation(api.viewer.removePushSubscription, { endpoint: device.endpoint });
    expect((await owner.query(api.viewer.notifications, {})).devices).toEqual([]);
    expect(await refusal(t.mutation(api.viewer.savePushSubscription, device))).toBe("not_signed_in");
    expect(await refusal(t.mutation(api.viewer.sendTestNotification, {}))).toBe("not_signed_in");
    expect(await refusal(owner.mutation(api.viewer.savePushSubscription, { ...device, endpoint: "ftp://x" }))).toBe("invalid_arguments");
  });
});

describe("the weekly review", () => {
  it("is kept apart from the morning note, shown for a week, and announced once", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.savePushSubscription, device);
    await asClaude(t, "record_briefing", { text: "Today: the dentist." });
    const review = await asClaude<Written>(t, "record_briefing", { kind: "weekly", text: "Two projects have gone quiet." });
    expect(review).toMatchObject({ changed: true, notification: "pending" });
    expect((await asClaude<Written>(t, "record_briefing", { kind: "weekly", text: "Three, in fact." })).notification).toBe("duplicate");

    // Both exist for the same day, and neither replaced the other.
    expect((await owner.query(api.viewer.briefing, { now: NOW }))!.text).toBe("Today: the dentist.");
    expect((await owner.query(api.viewer.weeklyReview, { now: NOW }))!.text).toBe("Three, in fact.");
    expect((await asClaude<{ briefingWritten: boolean }>(t, "get_importance_rubric", {})).briefingWritten).toBe(true);
    const { recent } = await owner.query(api.viewer.notifications, {});
    expect(recent.map((delivery) => delivery.title).sort()).toEqual(["Your briefing is ready", "Your weekly review is ready"]);

    // A review alone does not count as the day's briefing, and after eight days it is no longer shown.
    const later = NOW + 9 * 86_400_000;
    expect(await owner.query(api.viewer.weeklyReview, { now: later })).toBeNull();
    expect(await refusal(t.query(api.viewer.weeklyReview, { now: NOW }))).toBe("not_signed_in");
  });

  it("can read the owner's goals", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewerMemory.saveGoal, { title: "Record an album", horizon: "by summer" });
    const done = await owner.mutation(api.viewerMemory.saveGoal, { title: "Given up on" });
    await owner.mutation(api.viewerMemory.saveGoal, { id: done.id, status: "abandoned" });
    const listed = await asClaude<{ goals: { title: string; status: string; horizon?: string }[] }>(t, "list_goals", {});
    expect(listed.goals).toEqual([expect.objectContaining({ title: "Record an album", status: "active", horizon: "by summer" })]);
  });
});
