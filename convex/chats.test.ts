/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const OWNER = "user_owner";
const NOW = new Date("2026-11-25T17:00:00Z").getTime();
const TOKEN = "test-runner-token";
const mini = { token: TOKEN, host: "mini" };

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

beforeEach(async () => {
  process.env.SKIPPY_OWNER_CLERK_USER_ID = OWNER;
  process.env.SKIPPY_RUNNER_TOKEN_SHA256 = await sha256(TOKEN);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

const start = () => convexTest(schema, modules);

async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ConvexError) return String((error.data as { code?: unknown }).code);
    throw error;
  }
  return "accepted";
}

type Claimed = { turnId: Id<"chatTurns">; sessionId: string; resume: boolean; text: string; scope: { kind: string }; folder?: string };

describe("a chat", () => {
  it("queues the owner's message, and the mini claims it, writes the reply and finishes", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const { chatId } = await owner.mutation(api.viewerChat.start, { text: "I want to build a garden shed.\nNot sure where to start." });

    let chat = (await owner.query(api.viewerChat.chat, { id: chatId }))!;
    expect(chat.title).toBe("I want to build a garden shed.");
    expect(chat.messages.map((message) => [message.role, message.status])).toEqual([
      ["user", "done"],
      ["assistant", "waiting"],
    ]);
    expect(chat.turn).toMatchObject({ status: "queued" });
    expect(chat.miniSeenAt).toBeNull();
    // One message at a time.
    expect(await refusal(owner.mutation(api.viewerChat.send, { chatId, text: "Hello?" }))).toBe("chat_busy");

    await t.mutation(api.runner.heartbeat, { ...mini, version: "1" });
    const claimed = (await t.mutation(api.runner.claim, mini)) as Claimed;
    expect(claimed).toMatchObject({ resume: false, text: "I want to build a garden shed.\nNot sure where to start.", scope: { kind: "home" } });
    expect(claimed.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await t.mutation(api.runner.claim, mini)).toBeNull();

    expect(await t.mutation(api.runner.progress, { ...mini, turnId: claimed.turnId, text: "Let me look", activity: "Reading your projects" })).toEqual({ stop: false });
    chat = (await owner.query(api.viewerChat.chat, { id: chatId }))!;
    expect(chat.messages[1]).toMatchObject({ content: "Let me look", status: "writing" });
    expect(chat.turn).toMatchObject({ status: "running", activity: "Reading your projects" });
    expect(chat.miniSeenAt).toBe(NOW);

    await t.mutation(api.runner.finish, { ...mini, turnId: claimed.turnId, status: "done", text: "Start with the foundation." });
    chat = (await owner.query(api.viewerChat.chat, { id: chatId }))!;
    expect(chat.messages[1]).toMatchObject({ content: "Start with the foundation.", status: "done" });
    expect(chat.turn).toMatchObject({ status: "done" });

    // The second message resumes the same session.
    await owner.mutation(api.viewerChat.send, { chatId, text: "And after that?" });
    const next = (await t.mutation(api.runner.claim, mini)) as Claimed;
    expect(next).toMatchObject({ resume: true, sessionId: claimed.sessionId, text: "And after that?" });
    expect((await owner.query(api.viewerChat.chats, {})).chats.map((row) => row.title)).toEqual(["I want to build a garden shed."]);
  });

  it("fails a turn the runner dropped, keeps what was written, and lets the owner send again", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const { chatId } = await owner.mutation(api.viewerChat.start, { text: "First" });
    const claimed = (await t.mutation(api.runner.claim, mini)) as Claimed;
    await t.mutation(api.runner.progress, { ...mini, turnId: claimed.turnId, text: "Half an ans" });

    // Inside the lease nothing is reaped; after it, the turn fails.
    vi.advanceTimersByTime(60_000);
    expect(await t.mutation(internal.chats.reapStalled, {})).toEqual({ reaped: 0 });
    vi.advanceTimersByTime(90_000);
    expect(await t.mutation(internal.chats.reapStalled, {})).toEqual({ reaped: 1 });
    const chat = (await owner.query(api.viewerChat.chat, { id: chatId }))!;
    expect(chat.messages[1]).toMatchObject({ content: "Half an ans", status: "failed" });
    expect(chat.turn!.status).toBe("failed");
    expect(chat.turn!.error).toContain("stopped part-way");
    // A runner that comes back late is told to stop, and its finish changes nothing.
    expect(await t.mutation(api.runner.progress, { ...mini, turnId: claimed.turnId, text: "late" })).toEqual({ stop: true });
    await t.mutation(api.runner.finish, { ...mini, turnId: claimed.turnId, status: "done", text: "late" });
    expect((await owner.query(api.viewerChat.chat, { id: chatId }))!.messages[1].content).toBe("Half an ans");

    await owner.mutation(api.viewerChat.send, { chatId, text: "Again" });
    expect(((await t.mutation(api.runner.claim, mini)) as Claimed).text).toBe("Again");
  });

  it("waits in the queue while the mini is away, and can be cancelled", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const { chatId } = await owner.mutation(api.viewerChat.start, { text: "Anyone there?" });
    vi.advanceTimersByTime(3 * 60 * 60_000);
    expect(await t.mutation(internal.chats.reapStalled, {})).toEqual({ reaped: 0 });
    expect((await owner.query(api.viewerChat.chat, { id: chatId }))!.turn!.status).toBe("queued");

    await owner.mutation(api.viewerChat.cancel, { chatId });
    expect((await owner.query(api.viewerChat.chat, { id: chatId }))!.turn).toMatchObject({ status: "cancelled", error: "You stopped this one." });
    expect(await t.mutation(api.runner.claim, mini)).toBeNull();
  });

  it("about a code project runs in that project's folder", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.createProject, { title: "Garden Shed", kind: "code" });
    await owner.mutation(api.viewer.saveProject, { slug: "garden-shed", claudeHome: { kind: "code_folder", path: "/Users/me/src/shed" } });
    await owner.mutation(api.viewerChat.start, { text: "What is left?", about: { type: "project", id: "garden-shed" } });
    const claimed = (await t.mutation(api.runner.claim, mini)) as Claimed;
    expect(claimed).toMatchObject({ folder: "/Users/me/src/shed", scope: { kind: "item", record: { type: "project", id: "garden-shed" } } });
    expect(await refusal(owner.mutation(api.viewerChat.start, { text: "x", about: { type: "project", id: "nope" } }))).toBe("not_found");
  });

  it("is closed to everyone but the owner, and the runner's functions to anyone without its token", async () => {
    const t = start();
    expect(await refusal(t.mutation(api.viewerChat.start, { text: "x" }))).toBe("not_signed_in");
    expect(await refusal(t.query(api.viewerChat.chats, {}))).toBe("not_signed_in");
    expect(await refusal(t.mutation(api.runner.claim, { token: "wrong", host: "mini" }))).toBe("bad_runner_token");
    expect(await refusal(t.mutation(api.runner.heartbeat, { token: "", host: "mini" }))).toBe("bad_runner_token");
    delete process.env.SKIPPY_RUNNER_TOKEN_SHA256;
    expect(await refusal(t.mutation(api.runner.claim, mini))).toBe("runner_not_configured");
  });
});
