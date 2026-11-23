import { actorLabel, type Actor } from "@skippy/shared";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { cleanText, iso, logActivity, refuse, requireText } from "./lib/common";
import { requireEntity, type Ref } from "./lib/entities";
import { actor, entityType } from "./schema";

/**
 * Files the owner has put into Skippy. A file belongs to one record (a
 * project, a task, a note, a person…), waits on a capture in the inbox, or
 * was sent with a chat message.
 * The bytes live in Convex file storage; a row here says what they are.
 *
 * Internal: run from the web app's own functions. Agents see what files a
 * record has, but there is no tool that uploads, reads or deletes one. The
 * one exception is a file sent with a chat message: the chat runner on the
 * mini is handed it, so that chat's session can read it.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** What a file is, without a way to fetch it. This is what an agent sees. */
export function describeFile(file: Doc<"files">) {
  return {
    id: file._id,
    fileName: file.fileName,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    note: file.note,
    addedBy: actorLabel(file.createdBy),
    addedAt: iso(file.createdAt ?? file._creationTime),
  };
}

/** The same, with a link the owner's browser can open. The link is the only key to the file, so it goes to the owner alone. */
export async function presentFile(ctx: QueryCtx, file: Doc<"files">) {
  return { ...describeFile(file), url: await ctx.storage.getUrl(file.storageId) };
}

export async function filesOn(ctx: QueryCtx, entityId: string): Promise<Doc<"files">[]> {
  return await ctx.db
    .query("files")
    .withIndex("by_entity", (q) => q.eq("attachedTo.entityId", entityId))
    .collect();
}

export async function fileOnCapture(ctx: QueryCtx, captureId: Id<"captures">): Promise<Doc<"files"> | null> {
  return await ctx.db
    .query("files")
    .withIndex("by_capture", (q) => q.eq("captureId", captureId))
    .first();
}

/** What a chat's session can read: the images Claude Code opens, and PDFs. */
export const CHAT_FILE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"] as const;
export const MAX_CHAT_FILES = 10;

export async function filesOnMessage(ctx: QueryCtx, messageId: Id<"chatMessages">): Promise<Doc<"files">[]> {
  return await ctx.db
    .query("files")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    .collect();
}

/** Records an uploaded blob as a file. The size and type are read from storage, not taken on trust. */
export async function recordFile(
  ctx: MutationCtx,
  args: {
    actor: Actor;
    storageId: Id<"_storage">;
    fileName: string;
    note?: string | null;
    attachedTo?: Ref;
    captureId?: Id<"captures">;
    messageId?: Id<"chatMessages">;
    /** When given, the only content types let in. */
    only?: readonly string[];
  },
): Promise<Doc<"files">> {
  const blob = await ctx.db.system.get(args.storageId);
  if (!blob) throw refuse("not_found", "That upload did not arrive. Try again.");
  if (blob.size > MAX_FILE_BYTES) {
    await ctx.storage.delete(args.storageId);
    throw refuse("invalid_arguments", `A file can be up to ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  }
  if (args.only && !args.only.includes(blob.contentType ?? "")) {
    throw refuse("invalid_arguments", `"${args.fileName}" is not an image or a PDF. A chat reads PNG, JPEG, GIF and WebP images and PDFs.`);
  }
  const note = cleanText(args.note) ?? undefined;
  const id = await ctx.db.insert("files", {
    storageId: args.storageId,
    fileName: requireText(args.fileName, "fileName").slice(0, 300),
    contentType: blob.contentType ?? "application/octet-stream",
    sizeBytes: blob.size,
    ...(note ? { note } : {}),
    ...(args.attachedTo ? { attachedTo: args.attachedTo } : {}),
    ...(args.captureId ? { captureId: args.captureId } : {}),
    ...(args.messageId ? { messageId: args.messageId } : {}),
    createdBy: args.actor,
    updatedBy: args.actor,
    updatedAt: Date.now(),
  });
  return (await ctx.db.get(id))!;
}

/** Deletes a file's bytes and its row. */
export async function destroyFile(ctx: MutationCtx, file: Doc<"files">): Promise<void> {
  await ctx.storage.delete(file.storageId);
  await ctx.db.delete(file._id);
}

/** Attaches an uploaded file to a record. */
export const attach = internalMutation({
  args: {
    actor,
    storageId: v.id("_storage"),
    fileName: v.string(),
    note: v.optional(v.string()),
    to: v.object({ type: entityType, id: v.string() }),
  },
  handler: async (ctx, args) => {
    const target = await requireEntity(ctx, args.to, "to");
    const file = await recordFile(ctx, { ...args, attachedTo: target.ref });
    await logActivity(ctx, {
      entityType: target.ref.entityType,
      entityId: target.ref.entityId,
      activityType: "file.added",
      actor: args.actor,
      at: Date.now(),
      summary: `Added file "${file.fileName}" to ${target.ref.entityType} "${target.title}"`,
    });
    return { file: describeFile(file) };
  },
});

/** Deletes a file for good. Only the owner's dashboard runs this. */
export const remove = internalMutation({
  args: { actor, id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("files", args.id);
    const file = id ? await ctx.db.get(id) : null;
    if (!file) throw refuse("not_found", `There is no file with the id "${args.id}".`);
    await destroyFile(ctx, file);
    if (file.attachedTo) {
      await logActivity(ctx, {
        entityType: file.attachedTo.entityType,
        entityId: file.attachedTo.entityId,
        activityType: "file.removed",
        actor: args.actor,
        at: Date.now(),
        summary: `Deleted file "${file.fileName}"`,
      });
    }
    return { deleted: true };
  },
});
