/// <reference types="vite/client" />
import { signEnvelope, type OperationName } from "@skippy/shared";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const SECRET = "test-secret-".repeat(4);
const OWNER = "user_owner";
const RESOURCE = "http://localhost:3000/api/mcp";
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

/** Puts some bytes into storage the way a browser upload does. */
const upload = (t: Harness, words = "hello") =>
  t.run((ctx) => ctx.storage.store(new Blob([words], { type: "text/plain" }))) as Promise<Id<"_storage">>;
const stored = (t: Harness, id: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

describe("files on a record", () => {
  it("are added and opened by the owner, described to Claude, and deleted with their bytes", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.createProject, { title: "Garden Shed" });
    const storageId = await upload(t, "the plan");
    const added = await owner.mutation(api.viewer.addFile, {
      storageId,
      fileName: "plan.txt",
      note: "From the builder",
      to: { type: "project", id: "garden-shed" },
    });

    const { files } = await owner.query(api.viewer.files, { type: "project", id: "garden-shed" });
    expect(files).toEqual([
      expect.objectContaining({ fileName: "plan.txt", contentType: "text/plain", sizeBytes: 8, note: "From the builder", addedBy: "You" }),
    ]);
    expect(files[0].url).toEqual(expect.any(String));

    // Claude learns the file is there, and gets no way to fetch it.
    const project = await asClaude<{ files: Record<string, unknown>[] }>(t, "get_project", { project: "garden-shed" });
    expect(project.files).toEqual([expect.objectContaining({ fileName: "plan.txt", sizeBytes: 8 })]);
    expect(project.files[0]).not.toHaveProperty("url");
    expect(project.files[0]).not.toHaveProperty("storageId");

    expect(await refusal(t.mutation(api.viewer.removeFile, { id: added.id }))).toBe("not_signed_in");
    await owner.mutation(api.viewer.removeFile, { id: added.id });
    expect((await owner.query(api.viewer.files, { type: "project", id: "garden-shed" })).files).toEqual([]);
    expect(await stored(t, storageId)).toBe(false);
    const { events } = await owner.query(api.viewer.activityLog, {});
    expect(events.map((event) => event.type)).toEqual(["file.removed", "file.added", "project.created"]);
  });

  it("go when the record they are on is deleted, and are closed to everyone else", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const storageId = await upload(t);
    expect(await refusal(t.mutation(api.viewer.uploadUrl, {}))).toBe("not_signed_in");
    expect(await refusal(t.query(api.viewer.files, { type: "project", id: "x" }))).toBe("not_signed_in");
    expect(
      await refusal(t.mutation(api.viewer.addFile, { storageId, fileName: "x.txt", to: { type: "project", id: "x" } })),
    ).toBe("not_signed_in");
    expect(
      await refusal(owner.mutation(api.viewer.addFile, { storageId, fileName: "x.txt", to: { type: "project", id: "nope" } })),
    ).toBe("not_found");

    await owner.mutation(api.viewer.saveTask, { title: "Scan the receipt" });
    const [task] = (await owner.query(api.viewer.openTasks, { now: NOW })).tasks;
    await owner.mutation(api.viewer.addFile, { storageId, fileName: "receipt.txt", to: { type: "task", id: task.id } });
    await owner.mutation(api.viewer.deleteTask, { id: task.id });
    expect(await stored(t, storageId)).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("files").collect())).toEqual([]);
  });
});

describe("a capture with a file", () => {
  it("waits in the inbox, is found by its name, and its file goes onto what it is filed as", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const storageId = await upload(t, "scan");
    await owner.mutation(api.viewer.addCapture, { file: { storageId, fileName: "boiler-warranty.txt" } });

    const inbox = await owner.query(api.viewer.captures, { now: NOW });
    expect(inbox.pending[0].file).toMatchObject({ fileName: "boiler-warranty.txt", url: expect.any(String) });
    const found = await asClaude<{ results: { type: string; title: string }[] }>(t, "search", { query: "boiler" });
    expect(found.results).toEqual([expect.objectContaining({ type: "capture", title: "boiler-warranty.txt" })]);
    const listed = await asClaude<{ captures: { id: string; file: Record<string, unknown> }[] }>(t, "list_captures", {});
    expect(listed.captures[0].file).not.toHaveProperty("url");

    // Claude may not discard it, since that would delete the owner's file.
    expect(await refusal(asClaude(t, "resolve_capture", { id: listed.captures[0].id, outcome: "discarded" }))).toBe("owner_only");

    const made = await owner.mutation(api.viewer.fileCapture, { id: inbox.pending[0].id, as: "note" });
    const { files } = await owner.query(api.viewer.files, { type: "knowledge", id: made.id });
    expect(files.map((file) => file.fileName)).toEqual(["boiler-warranty.txt"]);
    const details = await owner.query(api.viewerMemory.item, { type: "knowledge", id: made.id, now: NOW });
    expect(details!.record).toMatchObject({ title: "boiler-warranty.txt" });
    expect(await stored(t, storageId)).toBe(true);
  });

  it("is deleted with its file when the owner discards it, or when a hold lapses", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const first = await upload(t, "one");
    const second = await upload(t, "two");
    const dropped = await owner.mutation(api.viewer.addCapture, { text: "not needed", file: { storageId: first, fileName: "a.txt" } });
    await owner.mutation(api.viewer.addCapture, { intent: "hold", file: { storageId: second, fileName: "ticket.txt" } });

    await owner.mutation(api.viewer.discardCapture, { id: dropped.id });
    expect(await stored(t, first)).toBe(false);

    expect((await owner.query(api.viewer.captures, { now: NOW })).held[0].file).toMatchObject({ fileName: "ticket.txt" });
    vi.setSystemTime(new Date(NOW + 8 * 86_400_000));
    await t.mutation(internal.captures.expireHolds, {});
    expect(await stored(t, second)).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("files").collect())).toEqual([]);
  });
});
