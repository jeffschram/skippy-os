import type { EntityType } from "@skippy/shared";
import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { findEntity, mention } from "./lib/entities";
import { CHAT_FILE_TYPES, MAX_CHAT_FILES, recordFile } from "./files";
import { logActivity, refuse, requireText } from "./lib/common";
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

export type Upload = { storageId: Id<"_storage">; fileName: string };

/**
 * Saves the owner's message, with the reply it is waiting for and the turn
 * that will write it. Images and PDFs sent with it are kept on the message; a
 * message that is only files needs no words.
 */
export async function queueTurn(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  text: string,
  options: { kind?: "brief" | "delegate"; files?: Upload[]; prompt?: string } = {},
): Promise<Id<"chatTurns">> {
  const now = Date.now();
  const files = options.files ?? [];
  if (files.length > MAX_CHAT_FILES) throw refuse("invalid_arguments", `A message takes up to ${MAX_CHAT_FILES} files.`);
  const content = files.length > 0 ? text.trim() : requireText(text, "text");
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
  // A file sent in a chat about a record is also one of that record's files, listed with the rest.
  const scope = (await ctx.db.get(chatId))?.scope;
  const attachedTo = scope?.kind === "item" ? scope.entityRef : undefined;
  for (const file of files) {
    const saved = await recordFile(ctx, { actor: { kind: "user" }, ...file, messageId: userMessageId, only: CHAT_FILE_TYPES, ...(attachedTo ? { attachedTo } : {}) });
    if (attachedTo) {
      await logActivity(ctx, {
        entityType: attachedTo.entityType,
        entityId: attachedTo.entityId,
        activityType: "file.added",
        actor: { kind: "user" },
        at: now,
        summary: `Added file "${saved.fileName}" to a ${attachedTo.entityType} through its chat`,
      });
    }
  }
  // One millisecond later, so the reply always sorts after its question.
  const assistantMessageId = await ctx.db.insert("chatMessages", { chatId, role: "assistant", content: "", status: "waiting", createdAt: now + 1 });
  await ctx.db.patch(chatId, { updatedAt: now });
  return await ctx.db.insert("chatTurns", {
    chatId,
    userMessageId,
    assistantMessageId,
    status: "queued",
    ...(options.kind ? { kind: options.kind } : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
    createdAt: now,
  });
}

/**
 * The chat about one record: its newest, archived or not. A project can have
 * many chats, so it has none of its own and this gives undefined for it.
 */
export async function chatOfRecord(ctx: QueryCtx, ref: Extract<Scope, { kind: "item" }>): Promise<Doc<"chats"> | undefined> {
  if (ref.entityRef.entityType === "project") return undefined;
  const row = await ctx.db
    .query("chats")
    .withIndex("by_item", (q) => q.eq("scope.entityRef.entityId", ref.entityRef.entityId))
    .order("desc")
    .first();
  return row ?? undefined;
}

/**
 * Starts a chat with its first message. A record other than a project has one
 * chat: a message about it goes on the end of that chat, which is brought back
 * if it was archived.
 */
export async function startChat(
  ctx: MutationCtx,
  args: { text: string; about?: { type: EntityType; id: string }; files?: Upload[]; kind?: "delegate"; prompt?: string },
) {
  const turn = { files: args.files, ...(args.kind ? { kind: args.kind } : {}), ...(args.prompt ? { prompt: args.prompt } : {}) };
  const now = Date.now();
  const files = args.files ?? [];
  const text = files.length > 0 ? args.text.trim() : requireText(args.text, "text");
  let scope: Scope = { kind: "home" };
  if (args.about) {
    const record = await findEntity(ctx, args.about.type, args.about.id);
    if (!record) throw refuse("not_found", `There is no ${args.about.type} with the id "${args.about.id}".`);
    scope = { kind: "item", entityRef: record.ref };
    const existing = await chatOfRecord(ctx, scope);
    if (existing) {
      if (existing.state === "archived") await ctx.db.patch(existing._id, { state: existing.promotedTo ? "promoted" : "open" });
      await queueTurn(ctx, existing._id, text, turn);
      return existing._id;
    }
  }
  // A chat that starts with only a file is named after the file.
  const firstLine = text.split("\n")[0].trim() || files[0].fileName.trim() || "A file";
  const chatId = await ctx.db.insert("chats", {
    scope,
    title: firstLine.length > 70 ? `${firstLine.slice(0, 69)}…` : firstLine,
    sessionId: crypto.randomUUID(),
    state: "open",
    createdAt: now,
    updatedAt: now,
  });
  await queueTurn(ctx, chatId, text, turn);
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

/** What the task's chat shows when the owner hands the task over. */
export const DELEGATE_SHOWN = "Work on this task for me.";

/**
 * What the session is asked when the owner hands it a task. The chat's own
 * instructions already name the task and forbid buying, booking, signing in
 * and sending forms; this widens what it may do to the task itself.
 */
export const DELEGATE_REQUEST = [
  "The owner has handed this task to you. Follow the skippy-delegate skill: call get_skill for it first, then work the task as it says.",
  "In short: do as much as you can now and write what you find as you go. You may change this task without asking, but no other record. Never buy, book, sign in, or send anything to anyone; get those steps ready and leave them to the owner.",
  "If get_skill is not there, work the task on those rules, and end with what is done and what is left for the owner.",
].join("\n");

/** What the owner's "Continue in Claude" asks the chat's session to write. */
export const BRIEF_REQUEST = [
  "Write a brief so this can be carried on in the Claude app, by a session that has not seen this chat.",
  "Cover, in this order and in plain text: the goal; what has been decided so far; what is still open; and the Skippy records this touches, each with its type and id.",
  "Write it to that session, not to me. Keep it under 300 words. Offer no cards.",
].join(" ");

const SURFACE = { kind: "agent" as const, harness: "claude" as const, clientId: "skippy-chat-runner", surface: "web_chat" as const };

/**
 * Keeps a finished brief: at the end of the project's notes when the chat is
 * about a project, otherwise as a note. Ends it with the line that tells a
 * Claude session which Skippy project it is working on.
 */
export async function keepBrief(ctx: MutationCtx, chat: Doc<"chats">, messageId: Id<"chatMessages">, brief: string): Promise<void> {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const project =
    chat.scope.kind === "item" && chat.scope.entityRef.entityType === "project"
      ? await ctx.db.get(chat.scope.entityRef.entityId as Id<"projects">)
      : null;
  let text = brief.trim();
  if (project) {
    text += `\n\nSkippy project: ${project.slug}. Follow the skippy-status skill. If you don't have that skill, get it with get_skill from the Skippy OS connector.`;
    await ctx.runMutation(internal.projects.upsert, {
      actor: SURFACE,
      slug: project.slug,
      notesPad: `${project.notesPad.trim()}${project.notesPad.trim() ? "\n\n" : ""}Brief from a dashboard chat, ${day}\n\n${text}`,
    });
  } else {
    await ctx.runMutation(internal.knowledge.upsert, { actor: SURFACE, kind: "note", title: `Brief: ${chat.title}`.slice(0, 200), body: text });
  }
  await ctx.db.patch(messageId, { content: text });
  await ctx.db.patch(chat._id, { continuedAt: now });
}
