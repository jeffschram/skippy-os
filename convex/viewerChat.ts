import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { describeScope, failTurn, queueTurn, startChat } from "./chats";
import { refuse } from "./lib/common";
import { entityType } from "./schema";
import { requireOwner } from "./viewer";

/**
 * Chats, as the owner's dashboard reads and writes them. Public, owner-only,
 * like the functions in `viewer.ts`.
 */

/** Starts a chat with its first message. `about` makes it a chat about one record; without it, an idea chat. */
export const start = mutation({
  args: { text: v.string(), about: v.optional(v.object({ type: entityType, id: v.string() })) },
  handler: async (ctx, args): Promise<{ chatId: string }> => {
    await requireOwner(ctx);
    return { chatId: await startChat(ctx, args) };
  },
});

export const send = mutation({
  args: { chatId: v.string(), text: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("chats", args.chatId);
    const chat = id ? await ctx.db.get(id) : null;
    if (!chat) throw refuse("not_found", "That chat is no longer there.");
    if (chat.state === "archived") throw refuse("invalid_arguments", "That chat is archived.");
    await queueTurn(ctx, chat._id, args.text);
    return null;
  },
});

/** Stops waiting for a reply. What the mini had written so far stays. */
export const cancel = mutation({
  args: { chatId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("chats", args.chatId);
    if (!id) return null;
    const turn = await ctx.db
      .query("chatTurns")
      .withIndex("by_chat", (q) => q.eq("chatId", id))
      .order("desc")
      .first();
    if (turn && ["queued", "claimed", "running"].includes(turn.status)) {
      await failTurn(ctx, turn, "You stopped this one.");
      await ctx.db.patch(turn._id, { status: "cancelled" });
    }
    return null;
  },
});

/** One chat: its messages, what the mini is doing on the latest one, and when the mini was last heard from. */
export const chat = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("chats", args.id);
    const found = id ? await ctx.db.get(id) : null;
    if (!found) return null;
    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_chat", (q) => q.eq("chatId", found._id))
      .take(400);
    const turn = await ctx.db
      .query("chatTurns")
      .withIndex("by_chat", (q) => q.eq("chatId", found._id))
      .order("desc")
      .first();
    const hosts = await ctx.db.query("agentHosts").collect();
    return {
      id: found._id,
      title: found.title,
      state: found.state,
      scope: await describeScope(ctx, found.scope),
      messages: messages.map((message) => ({
        id: message._id,
        role: message.role,
        content: message.content,
        status: message.status,
        at: new Date(message.createdAt).toISOString(),
      })),
      turn: turn ? { status: turn.status, activity: turn.activity, error: turn.error } : null,
      /** When the chat runner last said it was alive. The page works out from this whether the mini is there. */
      miniSeenAt: hosts.length > 0 ? Math.max(...hosts.map((host) => host.lastSeenAt)) : null,
    };
  },
});

/** The latest chats, newest first. */
export const chats = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 8), 1), 50);
    const rows = await ctx.db.query("chats").withIndex("by_updated").order("desc").take(limit);
    return {
      chats: await Promise.all(
        rows.map(async (row) => ({
          id: row._id,
          title: row.title,
          state: row.state,
          scope: await describeScope(ctx, row.scope),
          updatedAt: new Date(row.updatedAt).toISOString(),
        })),
      ),
    };
  },
});
