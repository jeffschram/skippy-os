import type { SearchableType } from "@skippy/shared";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { knowledgeTitle } from "./entities";

/**
 * Keeps `searchDocs` in step with the records it describes. Every write to a
 * searchable record ends by calling the matching function here.
 */

const MAX_TEXT = 20_000;

async function index(
  ctx: MutationCtx,
  entityType: SearchableType,
  entityId: string,
  title: string,
  parts: (string | undefined)[],
): Promise<void> {
  const text = [title, ...parts]
    .filter((part): part is string => Boolean(part))
    .join("\n")
    .slice(0, MAX_TEXT);
  const existing = await ctx.db
    .query("searchDocs")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .unique();
  if (!existing) await ctx.db.insert("searchDocs", { entityType, entityId, title, text });
  else if (existing.title !== title || existing.text !== text) await ctx.db.patch(existing._id, { title, text });
}

export const indexProject = (ctx: MutationCtx, doc: Doc<"projects">) =>
  index(ctx, "project", doc._id, doc.title, [doc.summary, doc.statusNote, doc.notesPad, doc.slug]);

export const indexTask = (ctx: MutationCtx, doc: Doc<"tasks">) =>
  index(ctx, "task", doc._id, doc.title, [doc.description, doc.waitingOn]);

export const indexPerson = (ctx: MutationCtx, doc: Doc<"people">) =>
  index(ctx, "person", doc._id, doc.name, [
    ...doc.emails,
    ...doc.phoneNumbers,
    doc.roleTitle,
    doc.relationshipContext,
    doc.notes,
  ]);

export const indexCompany = (ctx: MutationCtx, doc: Doc<"companies">) =>
  index(ctx, "company", doc._id, doc.name, [doc.domain, doc.website, doc.notes]);

export const indexKnowledge = (ctx: MutationCtx, doc: Doc<"knowledge">) =>
  index(ctx, "knowledge", doc._id, knowledgeTitle(doc), [
    doc.summary,
    doc.body,
    doc.url,
    doc.whyItMatters,
    doc.decision?.chosen,
    doc.decision?.rationale,
    ...(doc.decision?.options ?? []),
  ]);
