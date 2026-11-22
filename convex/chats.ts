import type { EntityType } from "@skippy/shared";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { findEntity, mention } from "./lib/entities";
import { refuse, requireText } from "./lib/common";
import { actor, cardDraft, cardKind } from "./schema";

/**
 * Chats in the dashboard. A chat is a Claude Code session on the mini. The
 * owner's message is saved with an empty reply beside it and a queued turn;
 * the chat runner claims the turn, runs the session, and writes the reply
 * into that message as it comes.
 *
 * Nothing here needs the mini to be on: a turn waits in the queue until it is.
 */

export const LEASE_MS = 2 * 60_000;
const MAX_MESSAGE = 8000;

export type Scope = Doc<"chats">["scope"];

/** Saves the owner's message, with the reply it is waiting for and the turn that will write it. */
export async function queueTurn(ctx: MutationCtx, chatId: Id<"chats">, text: string): Promise<Id<"chatTurns">> {
  const now = Date.now();
  const content = requireText(text, "text");
  if (content.length > MAX_MESSAGE) throw refuse("invalid_arguments", `A message holds up to ${MAX_MESSAGE} characters.`);
  const busy = await ctx.db
    .query("chatTurns")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .order("desc")
    .first();
  if (busy && ["queued", "claimed", "running"].includes(busy.status)) {
    throw refuse("chat_busy", "The last message is still being answered. Wait for it, or cancel it.");
  }
  const userMessageId = await ctx.db.insert("chatMessages", { chatId, role: "user", content, status: "done", createdAt: now });
  // One millisecond later, so the reply always sorts after its question.
  const assistantMessageId = await ctx.db.insert("chatMessages", { chatId, role: "assistant", content: "", status: "waiting", createdAt: now + 1 });
  await ctx.db.patch(chatId, { updatedAt: now });
  return await ctx.db.insert("chatTurns", { chatId, userMessageId, assistantMessageId, status: "queued", createdAt: now });
}

export async function startChat(ctx: MutationCtx, args: { text: string; about?: { type: EntityType; id: string } }) {
  const now = Date.now();
  const text = requireText(args.text, "text");
  let scope: Scope = { kind: "home" };
  if (args.about) {
    const record = await findEntity(ctx, args.about.type, args.about.id);
    if (!record) throw refuse("not_found", `There is no ${args.about.type} with the id "${args.about.id}".`);
    scope = { kind: "item", entityRef: record.ref };
  }
  const firstLine = text.split("\n")[0].trim();
  const chatId = await ctx.db.insert("chats", {
    scope,
    title: firstLine.length > 70 ? `${firstLine.slice(0, 69)}…` : firstLine,
    sessionId: crypto.randomUUID(),
    state: "open",
    createdAt: now,
    updatedAt: now,
  });
  await queueTurn(ctx, chatId, text);
  return chatId;
}

/** What a chat is about, for the page and for the session's instructions. */
export async function describeScope(ctx: QueryCtx, scope: Scope) {
  if (scope.kind === "home") return { kind: "home" as const };
  const record = await findEntity(ctx, scope.entityRef.entityType, scope.entityRef.entityId);
  return { kind: "item" as const, record: record ? mention(record) : undefined };
}

/** Ends a turn as failed, with the reason shown in place of a reply. */
export async function failTurn(ctx: MutationCtx, turn: Doc<"chatTurns">, error: string) {
  const now = Date.now();
  await ctx.db.patch(turn._id, { status: "failed", error, finishedAt: now, activity: undefined, leaseUntil: undefined });
  await ctx.db.patch(turn.assistantMessageId, { status: "failed" });
}

/**
 * Fails turns whose runner stopped holding them. Run every minute by a cron.
 * A turn that was never claimed is left alone: it is waiting for the mini.
 */
export const reapStalled = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let reaped = 0;
    for (const status of ["claimed", "running"] as const) {
      const turns = await ctx.db
        .query("chatTurns")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(50);
      for (const turn of turns) {
        if ((turn.leaseUntil ?? 0) >= now) continue;
        await failTurn(ctx, turn, "The Mac mini stopped part-way through. What it had written is above. Send the message again to retry.");
        reaped++;
      }
    }
    return { reaped };
  },
});

const MAX_CARDS = 8;

/** What must be on a card of each kind for it to be worth offering. */
const NEEDS: Record<Infer<typeof cardKind>, (draft: Infer<typeof cardDraft>) => string | null> = {
  task: (draft) => (draft.title ? null : "A task card needs a title."),
  event: (draft) => (draft.title && draft.startAt ? null : "An event card needs a title and startAt."),
  project: (draft) => (draft.title ? null : "A project card needs a title."),
  note: (draft) => (draft.title || draft.body ? null : "A note card needs a title or a body."),
  person: (draft) => (draft.name ? null : "A person card needs a name."),
  recurrence: (draft) => (draft.title && draft.rule ? null : "A recurrence card needs a title and a rule."),
};

/**
 * Offers the owner a record to create, as a card under the reply being
 * written. Nothing is created until the owner accepts it. Only works while a
 * dashboard chat's turn is running, and only for that chat.
 */
export const proposePromotion = internalMutation({
  args: { actor, chatId: v.string(), kind: cardKind, draft: cardDraft },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("chats", args.chatId);
    const chat = id ? await ctx.db.get(id) : null;
    if (!chat) throw refuse("not_found", `There is no chat with the id "${args.chatId}". Cards can only be offered in a dashboard chat.`);
    const turn = await ctx.db
      .query("chatTurns")
      .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
      .order("desc")
      .first();
    if (!turn || (turn.status !== "claimed" && turn.status !== "running")) {
      throw refuse("invalid_arguments", "A card can only be offered while you are answering in that chat.");
    }
    const missing = NEEDS[args.kind](args.draft);
    if (missing) throw refuse("invalid_arguments", missing);
    const message = (await ctx.db.get(turn.assistantMessageId))!;
    const cards = message.cards ?? [];
    if (cards.length >= MAX_CARDS) throw refuse("invalid_arguments", `A reply can offer up to ${MAX_CARDS} cards.`);
    // Offering the same thing twice in one reply is one card.
    const same = cards.find((card) => card.kind === args.kind && JSON.stringify(card.draft) === JSON.stringify(args.draft));
    if (same) return { cardId: same.cardId, offered: false };
    const cardId = crypto.randomUUID();
    await ctx.db.patch(message._id, { cards: [...cards, { cardId, kind: args.kind, draft: args.draft, state: "offered" }] });
    return { cardId, offered: true };
  },
});
