import { localDate, parseWhen, WhenError, type Actor } from "@skippy/shared";
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** A refusal the caller can act on. `message` says what to fix. */
export function refuse(code: string, message: string): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code, message });
}

export const DEFAULT_SETTINGS = { timeZone: "America/New_York", stalenessDays: 7, quietFrom: 22, quietTo: 8 };

/** The owner's settings, or the defaults until the settings page writes a row. */
export async function getSettings(
  ctx: QueryCtx,
): Promise<{ timeZone: string; stalenessDays: number; quietFrom: number; quietTo: number }> {
  const row = await ctx.db.query("settings").first();
  return row
    ? {
        timeZone: row.timeZone,
        stalenessDays: row.stalenessDays,
        quietFrom: row.quietFrom ?? DEFAULT_SETTINGS.quietFrom,
        quietTo: row.quietTo ?? DEFAULT_SETTINGS.quietTo,
      }
    : DEFAULT_SETTINGS;
}

type EntityType = NonNullable<Doc<"activityEvents">["entityRef"]>["entityType"];
type Diff = Record<string, { from?: unknown; to?: unknown }>;

/** Adds one line to the activity log. Every write calls this exactly once. */
export async function logActivity(
  ctx: MutationCtx,
  event: {
    entityType: EntityType;
    entityId: string;
    activityType: string;
    actor: Actor;
    at: number;
    summary: string;
    diff?: Diff;
  },
): Promise<void> {
  await ctx.db.insert("activityEvents", {
    entityRef: { entityType: event.entityType, entityId: event.entityId },
    activityType: event.activityType,
    actor: event.actor,
    at: event.at,
    summary: event.summary,
    ...(event.diff && Object.keys(event.diff).length > 0 ? { diff: event.diff } : {}),
  });
}

/**
 * Works out a patch from the fields a caller sent. A field left out is
 * untouched, `null` clears it, and a value equal to what is stored is dropped,
 * so a repeated call changes nothing and logs nothing.
 */
export function buildPatch<T extends Record<string, unknown>>(
  current: T,
  incoming: { [K in keyof T]?: T[K] | null },
): { patch: Partial<T>; diff: Diff } {
  const patch: Partial<T> = {};
  const diff: Diff = {};
  for (const key of Object.keys(incoming) as (keyof T & string)[]) {
    const value = incoming[key];
    if (value === undefined) continue;
    const next = value === null ? undefined : value;
    const before = current[key];
    if (JSON.stringify(before) === JSON.stringify(next)) continue;
    patch[key] = next as T[typeof key];
    diff[key] = { ...(before !== undefined ? { from: before } : {}), ...(next !== undefined ? { to: next } : {}) };
  }
  return { patch, diff };
}

/** Optional text: trimmed, with an empty string treated as "clear this". */
export function cleanText(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Required text: trimmed and not empty. */
export function requireText(value: string | undefined, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") throw refuse("invalid_arguments", `${field} is required.`);
  return trimmed;
}

const ISO = (at: number | undefined) => (at === undefined ? undefined : new Date(at).toISOString());
export { ISO as iso };


/** Reads a date or time a caller sent, in the owner's zone. `null` and missing pass through. */
export function when(
  input: string | null | undefined,
  timeZone: string,
  edge: "start" | "end",
  field: string,
): number | null | undefined {
  if (input === undefined || input === null) return input;
  try {
    return parseWhen(input, timeZone, edge);
  } catch (error) {
    if (error instanceof WhenError) {
      throw refuse(
        "invalid_arguments",
        `${field} must be a date like 2026-11-25, a local time like 2026-11-25T15:00, or a full ISO time.`,
      );
    }
    throw error;
  }
}

/** A stored time as the caller reads it: the exact instant and the owner's local date. */
export function showWhen(at: number | undefined, timeZone: string): { at: string; date: string } | undefined {
  return at === undefined ? undefined : { at: new Date(at).toISOString(), date: localDate(at, timeZone) };
}
