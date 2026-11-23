import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { findEntity, mention, type Ref } from "./lib/entities";
import { BRIEF_REQUEST, describeScope, failTurn, queueTurn, startChat } from "./chats";
import { filesOnMessage, presentFile } from "./files";
import { refuse } from "./lib/common";
import { cardDraft, entityType } from "./schema";
import { OWNER, requireOwner } from "./viewer";

/**
 * Chats, as the owner's dashboard reads and writes them. Public, owner-only,
 * like the functions in `viewer.ts`.
 */

/** An image or PDF the browser has already sent to storage, to go with a message. */
const upload = v.object({ storageId: v.id("_storage"), fileName: v.string() });

/** Starts a chat with its first message. `about` makes it a chat about one record; without it, an idea chat. */
export const start = mutation({
  args: { text: v.string(), about: v.optional(v.object({ type: entityType, id: v.string() })), files: v.optional(v.array(upload)) },
  handler: async (ctx, args): Promise<{ chatId: string }> => {
    await requireOwner(ctx);
    return { chatId: await startChat(ctx, args) };
  },
});

export const send = mutation({
  args: { chatId: v.string(), text: v.string(), files: v.optional(v.array(upload)) },
  handler: async (ctx, args): Promise<null> => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("chats", args.chatId);
    const chat = id ? await ctx.db.get(id) : null;
    if (!chat) throw refuse("not_found", "That chat is no longer there.");
    if (chat.state === "archived") throw refuse("invalid_arguments", "That chat is archived.");
    await queueTurn(ctx, chat._id, args.text, { files: args.files });
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
      continuedAt: found.continuedAt ? new Date(found.continuedAt).toISOString() : undefined,
      scope: await describeScope(ctx, found.scope),
      messages: await Promise.all(
        messages.map(async (message) => ({
          id: message._id,
          role: message.role,
          content: message.content,
          status: message.status,
          at: new Date(message.createdAt).toISOString(),
          files: message.role === "user" ? await Promise.all((await filesOnMessage(ctx, message._id)).map((file) => presentFile(ctx, file))) : [],
          cards: await Promise.all((message.cards ?? []).map((card) => presentCard(ctx, card))),
        })),
      ),
      turn: turn ? { status: turn.status, activity: turn.activity, error: turn.error, kind: turn.kind, replyId: turn.assistantMessageId } : null,
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
 * project's, and what the chat's other cards make joins it, whether they are
 * accepted before the project card or after.
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
        await gatherEarlier(ctx, chat._id, result.project.slug);
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

/**
 * Asks the chat's session for a brief to carry the work on in the Claude app.
 * When it is written it is kept: in the project's notes, or as a note.
 */
export const continueInClaude = mutation({
  args: { chatId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("chats", args.chatId);
    const found = id ? await ctx.db.get(id) : null;
    if (!found) throw refuse("not_found", "That chat is no longer there.");
    await queueTurn(ctx, found._id, BRIEF_REQUEST, { kind: "brief" });
    return null;
  },
});

/** Puts a chat away, or brings it back. An archived chat is off the lists and takes no more messages. */
export const archive = mutation({
  args: { chatId: v.string(), restore: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<null> => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("chats", args.chatId);
    const found = id ? await ctx.db.get(id) : null;
    if (!found) throw refuse("not_found", "That chat is no longer there.");
    await ctx.db.patch(found._id, { state: args.restore ? (found.promotedTo ? "promoted" : "open") : "archived" });
    return null;
  },
});

/** The chats about one record, newest first. */
export const chatsAbout = query({
  args: { type: entityType, id: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const record = await findEntity(ctx, args.type, args.id);
    if (!record) return { chats: [] };
    const rows = await ctx.db
      .query("chats")
      .withIndex("by_item", (q) => q.eq("scope.entityRef.entityId", record.ref.entityId))
      .order("desc")
      .take(20);
    return {
      chats: rows
        .filter((row) => row.state !== "archived")
        .map((row) => ({ id: row._id, title: row.title, updatedAt: new Date(row.updatedAt).toISOString() })),
    };
  },
});

/** The latest chats, newest first. Archived ones are left out. */
export const chats = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 8), 1), 50);
    const rows = (await ctx.db.query("chats").withIndex("by_updated").order("desc").take(limit * 3))
      .filter((row) => row.state !== "archived")
      .slice(0, limit);
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

/**
 * What this chat's cards made before the project existed joins the project,
 * so the order the cards are accepted in does not matter. A task or event that
 * is already in another project stays where it is.
 */
async function gatherEarlier(ctx: MutationCtx, chatId: Id<"chats">, slug: string) {
  const messages = await ctx.db
    .query("chatMessages")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .collect();
  for (const message of messages) {
    for (const card of message.cards ?? []) {
      if (card.state !== "accepted" || !card.resultRef) continue;
      const made = card.resultRef.entityId;
      if (card.kind === "task") {
        const id = ctx.db.normalizeId("tasks", made);
        const task = id ? await ctx.db.get(id) : null;
        if (task && !task.projectId) await ctx.runMutation(internal.tasks.upsert, { actor: OWNER, id: made, project: slug });
      } else if (card.kind === "event") {
        const id = ctx.db.normalizeId("calendarEvents", made);
        const event = id ? await ctx.db.get(id) : null;
        if (event && !event.projectId) await ctx.runMutation(internal.agenda.upsertEvent, { actor: OWNER, id: made, project: slug });
      } else if (card.kind === "note") {
        const id = ctx.db.normalizeId("knowledge", made);
        if (id && (await ctx.db.get(id))) {
          await ctx.runMutation(internal.knowledge.upsert, { actor: OWNER, id: made, about: [{ type: "project", id: slug }] });
        }
      }
    }
  }
}

async function setCard(ctx: MutationCtx, message: Doc<"chatMessages">, cardId: string, change: Partial<Card>) {
  await ctx.db.patch(message._id, {
    cards: (message.cards ?? []).map((card) => (card.cardId === cardId ? { ...card, ...change } : card)),
  });
}
