/// <reference types="vite/client" />
import { signEnvelope, type OperationName } from "@skippy/shared";
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
const SECRET = "test-secret-".repeat(4);
const RESOURCE = "http://localhost:3000/api/mcp";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

beforeEach(async () => {
  process.env.SKIPPY_OWNER_CLERK_USER_ID = OWNER;
  process.env.SKIPPY_GATEWAY_SECRET = SECRET;
  process.env.SKIPPY_MCP_RESOURCE_URL = RESOURCE;
  process.env.SKIPPY_RUNNER_TOKEN_SHA256 = await sha256(TOKEN);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

const start = () => convexTest(schema, modules);
type Harness = ReturnType<typeof start>;

/** A call the way the chat's session makes it: through the MCP gateway. */
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

  it("carries images and PDFs to the mini, needs no words with them, and takes nothing else", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const store = (type: string) => t.run((ctx) => ctx.storage.store(new Blob(["bytes"], { type }))) as Promise<Id<"_storage">>;
    const photo = await store("image/jpeg");
    const scan = await store("application/pdf");

    const { chatId } = await owner.mutation(api.viewerChat.start, { text: "  ", files: [{ storageId: photo, fileName: "fence.jpg" }] });
    let chat = (await owner.query(api.viewerChat.chat, { id: chatId }))!;
    expect(chat.title).toBe("fence.jpg");
    expect(chat.messages[0]).toMatchObject({ content: "", files: [{ fileName: "fence.jpg", contentType: "image/jpeg", sizeBytes: 5 }] });
    expect(chat.messages[0].files[0].url).toEqual(expect.any(String));
    expect(chat.messages[1].files).toEqual([]);

    const claimed = (await t.mutation(api.runner.claim, mini)) as Claimed & { files: { fileName: string; contentType: string; url: string }[] };
    expect(claimed.text).toBe("");
    expect(claimed.files).toEqual([expect.objectContaining({ fileName: "fence.jpg", contentType: "image/jpeg", url: expect.any(String) })]);
    await t.mutation(api.runner.finish, { ...mini, turnId: claimed.turnId, status: "done", text: "A fence." });

    vi.advanceTimersByTime(1000);
    await owner.mutation(api.viewerChat.send, { chatId, text: "And this quote?", files: [{ storageId: scan, fileName: "quote.pdf" }] });
    chat = (await owner.query(api.viewerChat.chat, { id: chatId }))!;
    expect(chat.messages[2]).toMatchObject({ content: "And this quote?", files: [{ fileName: "quote.pdf" }] });
    const next = (await t.mutation(api.runner.claim, mini)) as typeof claimed;
    expect(next.files.map((file) => file.fileName)).toEqual(["quote.pdf"]);
    await t.mutation(api.runner.finish, { ...mini, turnId: next.turnId, status: "done", text: "Looks fair." });

    // Anything a session cannot read is refused, and so is a message with neither words nor files.
    const sheet = await store("text/csv");
    expect(await refusal(owner.mutation(api.viewerChat.send, { chatId, text: "Read this", files: [{ storageId: sheet, fileName: "costs.csv" }] }))).toBe("invalid_arguments");
    expect(await refusal(owner.mutation(api.viewerChat.send, { chatId, text: " " }))).toBe("invalid_arguments");
    expect((await owner.query(api.viewerChat.chat, { id: chatId }))!.messages).toHaveLength(4);
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

describe("promotion cards", () => {
  it("turn an idea into a project with two tasks, by the owner's clicks alone", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const { chatId } = await owner.mutation(api.viewerChat.start, { text: "I want to build a garden shed." });
    // No card can be offered before the mini is answering.
    expect(await refusal(asClaude(t, "propose_promotion", { chatId, kind: "task", draft: { title: "Too early" } }))).toBe("invalid_arguments");

    const claimed = (await t.mutation(api.runner.claim, mini)) as Claimed;
    const offer = (kind: string, draft: Record<string, unknown>) =>
      asClaude<{ cardId: string; offered: boolean }>(t, "propose_promotion", { chatId, kind, draft });
    const project = await offer("project", { title: "Garden Shed", summary: "A shed for the tools.", notes: "8x10, on a slab, by spring." });
    const first = await offer("task", { title: "Measure the corner of the garden" });
    await offer("task", { title: "Get three quotes for the slab", dueAt: "2026-12-05" });
    const spare = await offer("note", { title: "Shed ideas", body: "Green roof?" });
    // The same card offered twice is one card, and a card missing what it needs is refused.
    expect((await offer("task", { title: "Measure the corner of the garden" })).offered).toBe(false);
    expect(await refusal(offer("event", { title: "No time" }))).toBe("invalid_arguments");
    expect(await refusal(asClaude(t, "propose_promotion", { chatId: "nope", kind: "task", draft: { title: "x" } }))).toBe("not_found");
    await t.mutation(api.runner.finish, { ...mini, turnId: claimed.turnId, status: "done", text: "I have offered a project and two tasks." });

    let chat = (await owner.query(api.viewerChat.chat, { id: chatId }))!;
    const reply = chat.messages[1];
    expect(reply.cards.map((card) => [card.kind, card.state])).toEqual([
      ["project", "offered"],
      ["task", "offered"],
      ["task", "offered"],
      ["note", "offered"],
    ]);
    // Nothing exists yet.
    expect((await owner.query(api.viewer.board, { now: NOW })).projects).toEqual([]);

    expect(await owner.mutation(api.viewerChat.acceptCard, { messageId: reply.id, cardId: project.cardId })).toEqual({ type: "project", id: "garden-shed" });
    // The owner changed the first task's words before accepting it.
    await owner.mutation(api.viewerChat.acceptCard, { messageId: reply.id, cardId: first.cardId, draft: { title: "Measure the back corner" } });
    await owner.mutation(api.viewerChat.acceptCard, { messageId: reply.id, cardId: reply.cards[2].cardId });
    await owner.mutation(api.viewerChat.dismissCard, { messageId: reply.id, cardId: spare.cardId });
    expect(await refusal(owner.mutation(api.viewerChat.acceptCard, { messageId: reply.id, cardId: project.cardId }))).toBe("invalid_arguments");

    const page = (await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW }))!;
    expect(page.project).toMatchObject({ title: "Garden Shed", summary: "A shed for the tools.", notesPad: "8x10, on a slab, by spring." });
    expect(page.openTasks.map((task) => [task.title, task.due?.date]).sort()).toEqual([
      ["Get three quotes for the slab", "2026-12-05"],
      ["Measure the back corner", undefined],
    ]);
    // The idea chat is now the project's chat, and the cards remember what they made.
    chat = (await owner.query(api.viewerChat.chat, { id: chatId }))!;
    expect(chat).toMatchObject({ state: "promoted", scope: { kind: "item", record: { type: "project", id: "garden-shed" } } });
    expect(chat.messages[1].cards.map((card) => [card.state, card.result?.type])).toEqual([
      ["accepted", "project"],
      ["accepted", "task"],
      ["accepted", "task"],
      ["dismissed", undefined],
    ]);
    const { events } = await owner.query(api.viewer.activityLog, { who: "owner" });
    expect(events.map((event) => event.type).sort()).toEqual(["project.created", "task.created", "task.created"]);
    expect(await refusal(t.mutation(api.viewerChat.acceptCard, { messageId: reply.id, cardId: spare.cardId }))).toBe("not_signed_in");
  });
});

describe("promotion cards accepted in the other order", () => {
  it("puts tasks, events and notes made before the project into it when the project is created", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.createProject, { title: "House" });
    const { chatId } = await owner.mutation(api.viewerChat.start, { text: "Christmas in Florida." });
    const claimed = (await t.mutation(api.runner.claim, mini)) as Claimed;
    const offer = (kind: string, draft: Record<string, unknown>) =>
      asClaude<{ cardId: string; offered: boolean }>(t, "propose_promotion", { chatId, kind, draft });
    const project = await offer("project", { title: "Florida Christmas" });
    const flights = await offer("task", { title: "Book the flights" });
    const elsewhere = await offer("task", { title: "Hold the mail", project: "house" });
    const dinner = await offer("event", { title: "Christmas dinner", startAt: "2026-12-25T18:00:00-05:00" });
    const note = await offer("note", { title: "Gift ideas", body: "Keep them packable." });
    await t.mutation(api.runner.finish, { ...mini, turnId: claimed.turnId, status: "done", text: "Offered." });

    const reply = (await owner.query(api.viewerChat.chat, { id: chatId }))!.messages[1];
    const accept = (cardId: string) => owner.mutation(api.viewerChat.acceptCard, { messageId: reply.id, cardId });
    // Everything else first, the project last.
    await accept(flights.cardId);
    await accept(elsewhere.cardId);
    await accept(dinner.cardId);
    await accept(note.cardId);
    expect((await owner.query(api.viewer.project, { slug: "house", now: NOW }))!.openTasks.map((task) => task.title)).toEqual(["Hold the mail"]);
    await accept(project.cardId);

    const page = (await owner.query(api.viewer.project, { slug: "florida-christmas", now: NOW }))!;
    expect(page.openTasks.map((task) => task.title)).toEqual(["Book the flights"]);
    // A task the card put in another project stays there.
    expect((await owner.query(api.viewer.project, { slug: "house", now: NOW }))!.openTasks.map((task) => task.title)).toEqual(["Hold the mail"]);
    const made = await t.run(async (ctx) => {
      const projectRow = (await ctx.db.query("projects").collect()).find((row) => row.slug === "florida-christmas")!;
      const event = (await ctx.db.query("calendarEvents").collect())[0];
      const links = (await ctx.db.query("relationships").collect()).filter((link) => link.to.entityId === projectRow._id);
      return { eventInProject: event.projectId === projectRow._id, linkTypes: links.map((link) => `${link.from.entityType}:${link.type}`) };
    });
    expect(made.eventInProject).toBe(true);
    expect(made.linkTypes).toContain("knowledge:related_to");
  });
});

describe("chats about a record, the brief, and archiving", () => {
  it("lists a record's chats, and keeps a brief in the project's notes with the line that names the project", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.createProject, { title: "Garden Shed" });
    await owner.mutation(api.viewer.saveProject, { slug: "garden-shed", notesPad: "Earlier notes." });
    const about = { type: "project" as const, id: "garden-shed" };
    const { chatId } = await owner.mutation(api.viewerChat.start, { text: "Where should the shed go?", about });
    let claimed = (await t.mutation(api.runner.claim, mini)) as Claimed;
    await t.mutation(api.runner.finish, { ...mini, turnId: claimed.turnId, status: "done", text: "The back corner." });
    expect((await owner.query(api.viewerChat.chatsAbout, about)).chats.map((chat) => chat.title)).toEqual(["Where should the shed go?"]);

    await owner.mutation(api.viewerChat.continueInClaude, { chatId });
    claimed = (await t.mutation(api.runner.claim, mini)) as Claimed;
    expect(claimed.text).toContain("Write a brief");
    await t.mutation(api.runner.finish, { ...mini, turnId: claimed.turnId, status: "done", text: "Goal: a shed in the back corner.\nOpen: the size." });

    const chat = (await owner.query(api.viewerChat.chat, { id: chatId }))!;
    expect(chat.continuedAt).toBeDefined();
    expect(chat.turn).toMatchObject({ kind: "brief", status: "done" });
    const brief = chat.messages.at(-1)!.content;
    expect(brief).toContain("Goal: a shed in the back corner.");
    expect(brief).toContain("Skippy project: garden-shed. Follow the skippy-status skill.");
    const page = (await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW }))!;
    expect(page.project.notesPad.startsWith("Earlier notes.\n\nBrief from a dashboard chat, 2026-11-25")).toBe(true);
    expect(page.project.notesPad).toContain("Skippy project: garden-shed.");
  });

  it("gives a record other than a project one chat, and brings it back when it was archived", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const { id } = ((await asClaude(t, "upsert_task", { title: "Build the shed" })) as unknown as { task: { id: string } }).task;
    const about = { type: "task" as const, id };
    expect(await owner.query(api.viewerChat.itemChat, about)).toEqual({ chat: null, earlier: [] });

    const first = await owner.mutation(api.viewerChat.start, { text: "Which wood?", about });
    const claimed = (await t.mutation(api.runner.claim, mini)) as Claimed;
    await t.mutation(api.runner.finish, { ...mini, turnId: claimed.turnId, status: "done", text: "Cedar." });
    await owner.mutation(api.viewerChat.archive, { chatId: first.chatId });

    vi.setSystemTime(new Date(NOW + 60_000));
    const second = await owner.mutation(api.viewerChat.start, { text: "How much of it?", about });
    expect(second.chatId).toBe(first.chatId);
    const { chat, earlier } = await owner.query(api.viewerChat.itemChat, about);
    expect(chat).toMatchObject({ id: first.chatId, state: "open", title: "Which wood?" });
    expect(chat!.messages.map((message) => message.content)).toEqual(["Which wood?", "Cedar.", "How much of it?", ""]);
    expect(earlier).toEqual([]);
    expect(await refusal(owner.query(api.viewerChat.itemChat, { type: "project", id: "garden-shed" }))).toBe("invalid_arguments");
  });

  it("keeps an idea chat's brief as a note, and takes an archived chat off the lists", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const { chatId } = await owner.mutation(api.viewerChat.start, { text: "A podcast about sheds" });
    let claimed = (await t.mutation(api.runner.claim, mini)) as Claimed;
    await t.mutation(api.runner.finish, { ...mini, turnId: claimed.turnId, status: "done", text: "Tell me more." });
    await owner.mutation(api.viewerChat.continueInClaude, { chatId });
    claimed = (await t.mutation(api.runner.claim, mini)) as Claimed;
    await t.mutation(api.runner.finish, { ...mini, turnId: claimed.turnId, status: "done", text: "Goal: a podcast." });
    const saved = await owner.query(api.viewerMemory.knowledge, { kind: "note", paginationOpts: { numItems: 5, cursor: null } });
    expect(saved.page.map((note) => note.title)).toEqual(["Brief: A podcast about sheds"]);

    await owner.mutation(api.viewerChat.archive, { chatId });
    expect((await owner.query(api.viewerChat.chats, {})).chats).toEqual([]);
    expect(await refusal(owner.mutation(api.viewerChat.send, { chatId, text: "Still there?" }))).toBe("invalid_arguments");
    await owner.mutation(api.viewerChat.archive, { chatId, restore: true });
    expect((await owner.query(api.viewerChat.chats, {})).chats.map((chat) => chat.state)).toEqual(["open"]);
    expect(await refusal(t.mutation(api.viewerChat.archive, { chatId }))).toBe("not_signed_in");
  });
});

describe("a scheduled ingestion pass that could not run", () => {
  it("is recorded as failed, where the owner will see it", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await t.mutation(api.runner.ingestFailed, { ...mini, pass: "3pm", reason: "The session could not reach Skippy OS." });
    let seen = await owner.query(api.viewer.ingestion, {});
    expect(seen.runs.map((run) => [run.pass, run.status, run.note])).toEqual([["3pm", "failed", "The session could not reach Skippy OS."]]);
    const { events } = await owner.query(api.viewer.activityLog, { who: "agents" });
    expect(events[0].summary).toBe("Ingestion (3pm) failed: The session could not reach Skippy OS.");
    // Home says why there is no briefing for today.
    expect(await owner.query(api.viewer.briefing, { now: NOW })).toMatchObject({
      problem: { pass: "3pm", note: "The session could not reach Skippy OS." },
    });

    // A run the pass had opened and never closed is closed, not doubled.
    await asClaude(t, "record_ingestion_run", { status: "started", pass: "5pm" });
    await t.mutation(api.runner.ingestFailed, { ...mini, pass: "5pm", reason: "It stopped half-way." });
    seen = await owner.query(api.viewer.ingestion, {});
    expect(seen.runs.map((run) => [run.pass, run.status])).toEqual([
      ["5pm", "failed"],
      ["3pm", "failed"],
    ]);
    // The phone is told once a day, not once per failed pass.
    const { recent } = await owner.query(api.viewer.notifications, {});
    expect(recent.map((sent) => sent.title)).toEqual(["The 3pm ingestion pass failed"]);
    // And the next pass is not locked out by it.
    expect(await asClaude<{ status: string }>(t, "record_ingestion_run", { status: "started", pass: "7pm" })).toMatchObject({ status: "running" });
    expect(await refusal(t.mutation(api.runner.ingestFailed, { token: "wrong", host: "mini", reason: "x" }))).toBe("bad_runner_token");
  });
});

describe("the nightly sweep", () => {
  it("is told which code projects to look at, and its reports are marked as its own", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.createProject, { title: "Garden Shed", kind: "code" });
    await owner.mutation(api.viewer.saveProject, { slug: "garden-shed", claudeHome: { kind: "code_folder", path: "/Users/me/src/shed" } });
    await owner.mutation(api.viewer.createProject, { title: "No Folder", kind: "code" });
    await owner.mutation(api.viewer.createProject, { title: "Thanksgiving" });
    await owner.mutation(api.viewer.createProject, { title: "Old App", kind: "code" });
    await owner.mutation(api.viewer.saveProject, { slug: "old-app", status: "archived", claudeHome: { kind: "code_folder", path: "/Users/me/src/old" } });

    expect(await t.mutation(api.runner.sweepTargets, mini)).toEqual([
      { slug: "garden-shed", title: "Garden Shed", folder: "/Users/me/src/shed", lastSweptAt: null, lastReportedAt: null },
    ]);
    expect(await refusal(t.mutation(api.runner.sweepTargets, { token: "wrong", host: "mini" }))).toBe("bad_runner_token");

    // The sweep's own session reports through the MCP, signing the report as the sweep's.
    await asClaude(t, "record_project_status", { project: "garden-shed", note: "Three commits laid the slab.", surface: "scheduled", ref: "nightly-sweep" });
    await asClaude(t, "record_project_status", { project: "garden-shed", note: "Framing started.", surface: "claude_code" });
    const page = (await owner.query(api.viewer.project, { slug: "garden-shed", now: NOW }))!;
    expect(page.recentUpdates.map((update) => [update.note, update.fromSweep])).toEqual([
      ["Framing started.", false],
      ["Three commits laid the slab.", true],
    ]);

    await t.mutation(api.runner.sweepDone, { ...mini, slug: "garden-shed", through: NOW - 1000 });
    await t.mutation(api.runner.sweepDone, { ...mini, slug: "garden-shed", through: NOW - 9000 });
    const [target] = (await t.mutation(api.runner.sweepTargets, mini)) as { lastSweptAt: number; lastReportedAt: number }[];
    expect(target.lastSweptAt).toBe(NOW - 1000);
    expect(target.lastReportedAt).toBeGreaterThanOrEqual(NOW);
  });
});
