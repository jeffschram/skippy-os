import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { findEntity, mention, type Ref } from "./lib/entities";
import { describeScope, failTurn, queueTurn, startChat } from "./chats";
import { refuse } from "./lib/common";
import { cardDraft, entityType } from "./schema";
import { OWNER, requireOwner } from "./viewer";

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
      messages: await Promise.all(
        messages.map(async (message) => ({
          id: message._id,
          role: message.role,
          content: message.content,
          status: message.status,
          at: new Date(message.createdAt).toISOString(),
          cards: await Promise.all((message.cards ?? []).map((card) => presentCard(ctx, card))),
        })),
      ),
      turn: turn ? { status: turn.status, activity: turn.activity, error: turn.error } : null,
      /** When the chat runner last said it was alive. The page works out from this whether the mini is there. */
      miniSeenAt: hosts.length > 0 ? Math.max(...hosts.map((host) => host.lastSeenAt)) : null,
    };
  },
});

type Card = NonNullable<Doc<"chatMessages">["cards"]>[number];

async function presentCard(ctx: QueryCtx, card: Card) {
  const made = card.resultRef ? await findEntity(ctx, card.resultRef.entityType, card.resultRef.entityId) : null;
  return {
    cardId: card.cardId,
    kind: card.kind,
    draft: card.draft,
    state: card.state,
    /** What it created, once accepted. Missing if that record has since been deleted. */
    result: made ? mention(made) : undefined,
  };
}

/**
 * Creates the record a card offers, from the draft as the owner left it. A
 * project card also moves the chat to the new project: the chat becomes that
 * project's, and tasks accepted afterwards in the same chat join it.
 */
export const acceptCard = mutation({
  args: { messageId: v.string(), cardId: v.string(), draft: v.optional(cardDraft) },
  handler: async (ctx, args): Promise<{ type: string; id: string }> => {
    await requireOwner(ctx);
    const messageId = ctx.db.normalizeId("chatMessages", args.messageId);
    const message = messageId ? await ctx.db.get(messageId) : null;
    const card = message?.cards?.find((entry) => entry.cardId === args.cardId);
    if (!message || !card) throw refuse("not_found", "That card is no longer there.");
    if (card.state === "accepted") throw refuse("invalid_arguments", "That card has already been used.");
    const chat = (await ctx.db.get(message.chatId))!;
    const draft = args.draft ?? card.draft;
    const promoted = chat.promotedTo?.entityType === "project" ? await findEntity(ctx, "project", chat.promotedTo.entityId) : null;

    let ref: Ref;
    switch (card.kind) {
      case "task": {
        const project = draft.project ?? promoted?.publicId;
        const result = await ctx.runMutation(internal.tasks.upsert, {
          actor: OWNER,
          title: draft.title ?? "",
          ...(draft.description ? { description: draft.description } : {}),
          ...(draft.dueAt ? { dueAt: draft.dueAt } : {}),
          ...(project ? { project } : {}),
        });
        ref = { entityType: "task", entityId: result.task.id };
        break;
      }
      case "event": {
        const result = await ctx.runMutation(internal.agenda.upsertEvent, {
          actor: OWNER,
          title: draft.title ?? "",
          startAt: draft.startAt ?? "",
          ...(draft.endAt ? { endAt: draft.endAt } : {}),
          ...(draft.location ? { location: draft.location } : {}),
          ...(draft.description ? { description: draft.description } : {}),
          ...(promoted ? { project: promoted.publicId } : {}),
        });
        ref = { entityType: "event", entityId: result.event.id };
        break;
      }
      case "project": {
        const result = await ctx.runMutation(internal.projects.upsert, {
          actor: OWNER,
          title: draft.title ?? "",
          ...(draft.summary ? { summary: draft.summary } : {}),
          ...(draft.notes ? { notesPad: draft.notes } : {}),
        });
        if (!result.created) throw refuse("project_exists", "There is already a project with that name. Change the title and try again.");
        const project = (await findEntity(ctx, "project", result.project.slug))!;
        ref = project.ref;
        // The idea chat becomes the new project's chat.
        await ctx.db.patch(chat._id, { scope: { kind: "item", entityRef: ref }, state: "promoted", promotedTo: ref, updatedAt: Date.now() });
        break;
      }
      case "note": {
        const result = await ctx.runMutation(internal.knowledge.upsert, {
          actor: OWNER,
          kind: "note",
          ...(draft.title ? { title: draft.title } : {}),
          ...(draft.body ? { body: draft.body } : {}),
          ...(promoted ? { about: [{ type: "project" as const, id: promoted.publicId }] } : {}),
        });
        ref = { entityType: "knowledge", entityId: result.knowledge.id };
        break;
      }
      case "person": {
        const result = await ctx.runMutation(internal.people.upsert, {
          actor: OWNER,
          name: draft.name ?? "",
          ...(draft.email ? { emails: [draft.email] } : {}),
          ...(draft.phone ? { phoneNumbers: [draft.phone] } : {}),
          ...(draft.company ? { company: draft.company } : {}),
        });
        ref = { entityType: "person", entityId: result.person.id };
        break;
      }
      case "recurrence": {
        if (!draft.rule) throw refuse("invalid_arguments", "This card has no rule for how it repeats.");
        const result = await ctx.runMutation(internal.agenda.upsertRecurrence, {
          actor: OWNER,
          title: draft.title ?? "",
          rule: draft.rule,
          ...(draft.description ? { description: draft.description } : {}),
          ...(draft.nextDue ? { nextDue: draft.nextDue } : {}),
        });
        ref = { entityType: "recurrence", entityId: result.recurrence.id };
        break;
      }
    }
    await setCard(ctx, message, card.cardId, { draft, state: "accepted", resultRef: ref });
    const made = (await findEntity(ctx, ref.entityType, ref.entityId))!;
    return { type: ref.entityType, id: made.publicId };
  },
});

/** Puts a card aside. Nothing was created, and nothing is left anywhere else. */
export const dismissCard = mutation({
  args: { messageId: v.string(), cardId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await requireOwner(ctx);
    const messageId = ctx.db.normalizeId("chatMessages", args.messageId);
    const message = messageId ? await ctx.db.get(messageId) : null;
    const card = message?.cards?.find((entry) => entry.cardId === args.cardId);
    if (!message || !card) throw refuse("not_found", "That card is no longer there.");
    if (card.state === "offered") await setCard(ctx, message, card.cardId, { state: "dismissed" });
    return null;
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

async function setCard(ctx: MutationCtx, message: Doc<"chatMessages">, cardId: string, change: Partial<Card>) {
  await ctx.db.patch(message._id, {
    cards: (message.cards ?? []).map((card) => (card.cardId === cardId ? { ...card, ...change } : card)),
  });
}
