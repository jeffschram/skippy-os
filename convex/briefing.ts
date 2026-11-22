import { actorLabel, localDate } from "@skippy/shared";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type QueryCtx } from "./_generated/server";
import { getSettings, iso, refuse, requireText } from "./lib/common";
import { notify } from "./push";
import { readToday } from "./read";
import { actor } from "./schema";

/**
 * The morning note. The day's first ingestion pass writes it: what is on
 * today, and what came in that is worth knowing but made no record. One a
 * day; writing it again replaces it. Writing today's sends one notification.
 */

const MAX_TEXT = 6000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function presentBriefing(briefing: Doc<"briefings">, today: string) {
  return {
    date: briefing.date,
    text: briefing.text,
    isToday: briefing.date === today,
    by: actorLabel(briefing.updatedBy),
    writtenAt: iso(briefing.updatedAt)!,
  };
}

export async function latestBriefing(ctx: QueryCtx, now: number) {
  const settings = await getSettings(ctx);
  const latest = await ctx.db.query("briefings").withIndex("by_date").order("desc").first();
  return latest ? presentBriefing(latest, localDate(now, settings.timeZone)) : null;
}

/** "3 due today, 1 overdue, 2 events", for the notification. */
function counts(today: Awaited<ReturnType<typeof readToday>>): string {
  const parts = [
    today.dueToday.length > 0 ? `${today.dueToday.length} due today` : undefined,
    today.overdue.length > 0 ? `${today.overdue.length} overdue` : undefined,
    today.events.length > 0 ? `${today.events.length} event${today.events.length === 1 ? "" : "s"}` : undefined,
    today.recurrences.length > 0 ? `${today.recurrences.length} coming round` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Nothing due today";
}

export const record = internalMutation({
  args: { actor, text: v.string(), date: v.optional(v.string()), runId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const settings = await getSettings(ctx);
    const today = localDate(now, settings.timeZone);
    const date = args.date?.trim() || today;
    if (!DAY.test(date)) throw refuse("invalid_arguments", "date must look like 2026-11-25.");
    const text = requireText(args.text, "text");
    if (text.length > MAX_TEXT) throw refuse("invalid_arguments", `A briefing holds up to ${MAX_TEXT} characters. Say less.`);
    const runId = args.runId ? ctx.db.normalizeId("ingestionRuns", args.runId) : null;

    const existing = await ctx.db
      .query("briefings")
      .withIndex("by_date", (q) => q.eq("date", date))
      .first();
    if (existing) {
      if (existing.text === text) return { date, changed: false, notification: "duplicate" as const };
      await ctx.db.patch(existing._id, { text, updatedBy: args.actor, updatedAt: now, ...(runId ? { runId } : {}) });
    } else {
      await ctx.db.insert("briefings", {
        date,
        text,
        ...(runId ? { runId } : {}),
        createdBy: args.actor,
        updatedBy: args.actor,
        updatedAt: now,
      });
    }
    await ctx.db.insert("activityEvents", {
      activityType: existing ? "briefing.rewritten" : "briefing.written",
      actor: args.actor,
      at: now,
      summary: `${existing ? "Rewrote" : "Wrote"} the briefing for ${date}`,
    });
    // One notification a day, and only for today's note.
    const sent =
      date === today
        ? await notify(ctx, {
            dedupeKey: `briefing:${date}`,
            type: "briefing",
            title: "Your briefing is ready",
            body: counts(await readToday(ctx, { now })),
            url: "/",
          })
        : { status: "skipped" as const };
    return { date, changed: true, notification: sent.status };
  },
});
