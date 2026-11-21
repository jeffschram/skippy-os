import type { EntityType } from "@skippy/shared";
import type { Doc, TableNames } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { refuse } from "./common";

/** A stored pointer to a record. `entityId` is always the Convex id. */
export type Ref = { entityType: EntityType; entityId: string };

/** What any record looks like from outside: enough to name it and call it up again. */
export type Found = {
  ref: Ref;
  /** What tools use to name the record: a project's slug, otherwise its id. */
  publicId: string;
  title: string;
  /** Its status or lifecycle, when it has one. */
  state?: string;
};

async function byId<T extends TableNames>(ctx: QueryCtx, table: T, id: string): Promise<Doc<T> | null> {
  const normalized = ctx.db.normalizeId(table, id);
  return normalized ? await ctx.db.get(normalized) : null;
}

/** A short name for a piece of knowledge that may have no title. */
export function knowledgeTitle(item: Pick<Doc<"knowledge">, "title" | "body" | "url">): string {
  if (item.title) return item.title;
  const firstLine = item.body?.trim().split("\n")[0] ?? "";
  if (firstLine) return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
  return item.url ?? "Untitled";
}

/** Finds a record by type and id. A project can be named by slug or by id. */
export async function findEntity(ctx: QueryCtx, entityType: EntityType, id: string): Promise<Found | null> {
  const found = (entityId: string, title: string, state?: string, publicId = entityId): Found => ({
    ref: { entityType, entityId },
    publicId,
    title,
    ...(state ? { state } : {}),
  });
  switch (entityType) {
    case "project": {
      const doc =
        (await ctx.db
          .query("projects")
          .withIndex("by_slug", (q) => q.eq("slug", id.trim().toLowerCase()))
          .unique()) ?? (await byId(ctx, "projects", id));
      return doc && found(doc._id, doc.title, doc.status, doc.slug);
    }
    case "phase": {
      const doc = await byId(ctx, "phases", id);
      return doc && found(doc._id, doc.title, doc.status);
    }
    case "task": {
      const doc = await byId(ctx, "tasks", id);
      return doc && found(doc._id, doc.title, doc.status);
    }
    case "goal": {
      const doc = await byId(ctx, "goals", id);
      return doc && found(doc._id, doc.title, doc.status);
    }
    case "area": {
      const doc = await byId(ctx, "areas", id);
      return doc && found(doc._id, doc.name);
    }
    case "person": {
      const doc = await byId(ctx, "people", id);
      return doc && found(doc._id, doc.name);
    }
    case "company": {
      const doc = await byId(ctx, "companies", id);
      return doc && found(doc._id, doc.name);
    }
    case "knowledge": {
      const doc = await byId(ctx, "knowledge", id);
      return doc && found(doc._id, knowledgeTitle(doc), doc.lifecycle);
    }
  }
}

/** Like findEntity, but a missing record is a refusal the caller can act on. */
export async function requireEntity(
  ctx: QueryCtx,
  target: { type: EntityType; id: string },
  /** Which argument named the record, when the operation takes more than one. */
  field = "",
): Promise<Found> {
  const entity = await findEntity(ctx, target.type, target.id);
  if (!entity) {
    throw refuse(
      "not_found",
      `${field ? `${field}: ` : ""}There is no ${target.type} with the id "${target.id}". Use search to find it.`,
    );
  }
  return entity;
}

/** How a record is shown wherever another record points at it. */
export function mention(entity: Found): { type: EntityType; id: string; title: string; state?: string } {
  return {
    type: entity.ref.entityType,
    id: entity.publicId,
    title: entity.title,
    ...(entity.state ? { state: entity.state } : {}),
  };
}
