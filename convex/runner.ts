import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { describeScope, failTurn, LEASE_MS } from "./chats";

/**
 * What the chat runner on the mini calls. These are public functions, so each
 * one checks the runner's token first: a long random secret that the runner
 * holds in a file on the mini, and whose SHA-256 is in this deployment's
 * environment as SKIPPY_RUNNER_TOKEN_SHA256. The token itself is never stored here.
 *
 * The runner can do four things: say it is alive, claim the oldest waiting
 * turn, report progress on a turn it holds, and finish it. It cannot read the
 * owner's records or touch anything but chat turns.
 */

async function requireRunner(token: string): Promise<void> {
  const expected = process.env.SKIPPY_RUNNER_TOKEN_SHA256;
  if (!expected) throw new ConvexError({ code: "runner_not_configured" });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hex.length !== expected.length) throw new ConvexError({ code: "bad_runner_token" });
  // Compared without stopping at the first difference.
  let different = 0;
  for (let index = 0; index < hex.length; index++) different |= hex.charCodeAt(index) ^ expected.charCodeAt(index);
  if (different !== 0) throw new ConvexError({ code: "bad_runner_token" });
}

const runner = { token: v.string(), host: v.string() };

/** "The mini is here." Called every half minute, whether or not there is work. */
export const heartbeat = mutation({
  args: { ...runner, version: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRunner(args.token);
    const now = Date.now();
    const row = await ctx.db
      .query("agentHosts")
      .withIndex("by_host", (q) => q.eq("host", args.host))
      .first();
    const fields = { lastSeenAt: now, ...(args.version ? { version: args.version } : {}) };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("agentHosts", { host: args.host, ...fields });
    return null;
  },
});

/** Takes the oldest waiting turn, if there is one, and holds it for a short lease. */
export const claim = mutation({
  args: runner,
  handler: async (ctx, args) => {
    await requireRunner(args.token);
    const now = Date.now();
    const turn = await ctx.db
      .query("chatTurns")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .first();
    if (!turn) return null;
    const chat = await ctx.db.get(turn.chatId);
    const message = await ctx.db.get(turn.userMessageId);
    if (!chat || !message) {
      await failTurn(ctx, turn, "The chat this belonged to is gone.");
      return null;
    }
    await ctx.db.patch(turn._id, { status: "claimed", host: args.host, leaseUntil: now + LEASE_MS, startedAt: now });
    await ctx.db.patch(turn.assistantMessageId, { status: "writing" });

    // A chat about a code project runs in that project's folder, to read it. Every other chat runs in an empty one.
    let folder: string | undefined;
    if (chat.scope.kind === "item" && chat.scope.entityRef.entityType === "project") {
      const project = await ctx.db.get(chat.scope.entityRef.entityId as Id<"projects">);
      if (project?.claudeHome?.kind === "code_folder") folder = project.claudeHome.path;
    }
    return {
      turnId: turn._id,
      chatId: chat._id,
      sessionId: chat.sessionId,
      /** False on a chat's first turn: the session has to be started, not resumed. */
      resume: chat.sessionStarted === true,
      text: message.content,
      scope: await describeScope(ctx, chat.scope),
      folder,
    };
  },
});

/** The reply so far, and what the session is doing. Each call renews the lease. */
export const progress = mutation({
  args: { ...runner, turnId: v.id("chatTurns"), text: v.optional(v.string()), activity: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRunner(args.token);
    const turn = await ctx.db.get(args.turnId);
    // The owner may have cancelled it, or the lease may have run out. Tell the runner to stop.
    if (!turn || (turn.status !== "claimed" && turn.status !== "running") || turn.host !== args.host) return { stop: true };
    await ctx.db.patch(turn._id, {
      status: "running",
      leaseUntil: Date.now() + LEASE_MS,
      activity: args.activity?.slice(0, 200),
    });
    if (args.text !== undefined) await ctx.db.patch(turn.assistantMessageId, { content: args.text.slice(0, 60_000) });
    const chat = await ctx.db.get(turn.chatId);
    if (chat && !chat.sessionStarted) await ctx.db.patch(chat._id, { sessionStarted: true });
    return { stop: false };
  },
});

/** Ends a turn: the whole reply, or why there is none. */
export const finish = mutation({
  args: {
    ...runner,
    turnId: v.id("chatTurns"),
    status: v.union(v.literal("done"), v.literal("failed")),
    text: v.optional(v.string()),
    error: v.optional(v.string()),
    /** False when the session never started, so the next turn must start it again. */
    sessionStarted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireRunner(args.token);
    const turn = await ctx.db.get(args.turnId);
    if (!turn || (turn.status !== "claimed" && turn.status !== "running")) return null;
    const now = Date.now();
    if (args.text !== undefined) await ctx.db.patch(turn.assistantMessageId, { content: args.text.slice(0, 60_000) });
    if (args.status === "done") {
      await ctx.db.patch(turn._id, { status: "done", finishedAt: now, activity: undefined, leaseUntil: undefined });
      await ctx.db.patch(turn.assistantMessageId, { status: "done" });
    } else {
      await failTurn(ctx, turn, (args.error ?? "The session ended without a reply.").slice(0, 500));
    }
    const chat = await ctx.db.get(turn.chatId);
    if (chat) {
      await ctx.db.patch(chat._id, {
        updatedAt: now,
        ...(args.sessionStarted !== undefined ? { sessionStarted: args.sessionStarted } : {}),
      });
    }
    return null;
  },
});
