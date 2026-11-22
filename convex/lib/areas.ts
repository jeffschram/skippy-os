import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { refuse } from "./common";

/** Areas of life, such as Household or Work. A task or a recurrence can sit in one. */

/** Every area's name by id. There are a handful, so one read serves a whole query. */
export async function areaNames(ctx: QueryCtx | MutationCtx): Promise<Map<Id<"areas">, string>> {
  return new Map((await ctx.db.query("areas").collect()).map((area) => [area._id, area.name]));
}

/**
 * Turns the area named in a write into its id. Undefined leaves the record's
 * area as it is and null clears it. A name that matches no area is refused with
 * the names that exist, so an agent can pick one: areas are the owner's to add.
 */
export async function resolveArea(ctx: QueryCtx | MutationCtx, name: string | null | undefined): Promise<Id<"areas"> | null | undefined> {
  if (name === undefined || name === null) return name;
  const wanted = name.trim().toLowerCase();
  if (wanted === "") return null;
  const areas = await ctx.db.query("areas").collect();
  const found = areas.find((area) => area.name.toLowerCase() === wanted);
  if (found) return found._id;
  const known = areas
    .sort((a, b) => a.order - b.order)
    .map((area) => area.name)
    .join(", ");
  throw refuse("not_found", known ? `There is no area called "${name}". The areas are: ${known}.` : `There is no area called "${name}", and no areas exist yet.`);
}
