/// <reference types="vite/client" />
import { signEnvelope, type OperationName } from "@skippy/shared";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { sourceLink } from "./flags";
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

async function asClaude<T = Record<string, unknown>>(t: Harness, operation: OperationName, args: Record<string, unknown>): Promise<T> {
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

type Flagged = { key: string; status: string; changed: boolean };
const needsYou = async (t: Harness) =>
  (await t.withIdentity({ subject: OWNER }).query(api.viewer.needsYou, { now: Date.now() })).items.flatMap((item) =>
    item.kind === "flag" ? [item] : [],
  );

describe("sourceLink", () => {
  it("names a link by where it came from, and opens mail by its thread when there is no link", () => {
    expect(sourceLink({ system: "gmail", url: "https://mail.google.com/mail/u/0/#inbox/abc" })).toEqual({
      label: "Email",
      url: "https://mail.google.com/mail/u/0/#inbox/abc",
    });
    expect(sourceLink({ system: "Gmail", threadId: "18c2f" })).toEqual({ label: "Email", url: "https://mail.google.com/mail/u/0/#all/18c2f" });
    expect(sourceLink({ system: "web", url: "https://www.example.com/check-in" })).toEqual({
      label: "example.com",
      url: "https://www.example.com/check-in",
    });
    expect(sourceLink({ system: "imessage" })).toBeNull();
    expect(sourceLink({ system: "web", url: "javascript:alert(1)" })).toBeNull();
  });
});

describe("Needs you", () => {
  it("shows what was flagged with links to its sources and its record, until it is done", async () => {
    const t = start();
    const event = (
      await asClaude<{ event: { id: string } }>(t, "upsert_event", { title: "Design review", startAt: "2026-11-30T16:00", endAt: "2026-11-30T17:00" })
    ).event.id;
    await t.run(async (ctx) => {
      await ctx.db.patch(ctx.db.normalizeId("calendarEvents", event)!, { htmlLink: "https://calendar.google.com/event?eid=xyz" });
    });

    const raised = await asClaude<Flagged>(t, "flag_for_owner", {
      key: "clash-2026-11-30",
      title: "Move the design review off your day off",
      detail: "Monday is marked out of office.",
      about: { type: "event", id: event },
      sources: [{ system: "gmail", url: "https://mail.google.com/mail/u/0/#inbox/ooo" }],
      until: "2026-11-30",
    });
    expect(raised).toMatchObject({ status: "open", changed: true });

    const [flag] = await needsYou(t);
    expect(flag).toMatchObject({
      title: "Move the design review off your day off",
      detail: "Monday is marked out of office.",
      about: { type: "event", id: event, title: "Design review" },
      links: [
        { label: "Email", url: "https://mail.google.com/mail/u/0/#inbox/ooo" },
        { label: "Calendar", url: "https://calendar.google.com/event?eid=xyz" },
      ],
    });

    // Raising it again with the same key changes it in place.
    expect(await asClaude<Flagged>(t, "flag_for_owner", { key: "clash-2026-11-30", title: "Move the design review" })).toMatchObject({ changed: true });
    expect(await asClaude<Flagged>(t, "flag_for_owner", { key: "clash-2026-11-30", title: "Move the design review" })).toMatchObject({ changed: false });
    expect((await needsYou(t)).map((item) => item.title)).toEqual(["Move the design review"]);

    // The raiser closes it once it is handled.
    expect(await asClaude<Flagged>(t, "flag_for_owner", { key: "clash-2026-11-30", status: "done" })).toMatchObject({ status: "done", changed: true });
    expect(await needsYou(t)).toEqual([]);
  });

  it("stays closed once the owner ticks it off, and drops off when it lapses or its task is done", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await asClaude(t, "flag_for_owner", { key: "checkin", title: "Pick a room in the hotel app", until: "2026-11-25T18:00" });
    const task = (await asClaude<{ task: { id: string } }>(t, "upsert_task", { title: "Reply to the landlord" })).task.id;
    await asClaude(t, "flag_for_owner", { key: "landlord", title: "Reply to the landlord today", about: { type: "task", id: task } });
    await asClaude(t, "flag_for_owner", { key: "bill", title: "Check the bill" });
    expect((await needsYou(t)).map((item) => item.key)).toEqual(["checkin", "bill", "landlord"]);

    const bill = (await needsYou(t)).find((item) => item.key === "bill")!;
    await owner.mutation(api.viewer.resolveFlag, { id: bill.id, status: "dismissed" });
    expect(await asClaude(t, "flag_for_owner", { key: "bill", title: "Check the bill again" })).toMatchObject({ status: "dismissed", changed: false });

    await asClaude(t, "complete_task", { id: task });
    vi.setSystemTime(new Date("2026-11-25T23:30:00Z"));
    expect(await needsYou(t)).toEqual([]);

    const rubric = await asClaude<{ flags: unknown[] }>(t, "get_importance_rubric", {});
    expect(rubric.flags).toEqual([]);
  });

  it("refuses a flag without a title, or a link that is not a web address", async () => {
    const t = start();
    expect(await refusal(asClaude(t, "flag_for_owner", { key: "x" }))).toBe("invalid_arguments");
    expect(
      await refusal(asClaude(t, "flag_for_owner", { key: "x", title: "Y", sources: [{ system: "web", url: "file:///etc/passwd" }] })),
    ).toBe("invalid_arguments");
    expect(await asClaude(t, "flag_for_owner", { key: "never-raised", status: "done" })).toMatchObject({ status: "not_found" });
  });
});
