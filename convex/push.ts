import { zoneOffsetMs } from "@skippy/shared";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { getSettings } from "./lib/common";

/**
 * Notifications to the owner's devices. `notify` decides whether one goes out:
 * not twice for the same thing, not in quiet hours, and not when no device has
 * asked for them. What it decides is kept, so the owner can see what was sent
 * and what was held back. The sending itself is in `pushNode.ts`.
 */

/** The hour on the owner's clock, 0 to 23. */
function localHour(at: number, timeZone: string): number {
  return new Date(at + zoneOffsetMs(at, timeZone)).getUTCHours();
}

/** Whether an hour falls in the quiet stretch, which may run over midnight. Equal ends mean no quiet hours. */
export function isQuiet(hour: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

export async function notify(
  ctx: MutationCtx,
  args: { dedupeKey: string; type: string; title: string; body: string; url: string; evenInQuietHours?: boolean },
): Promise<{ status: "pending" | "skipped" | "duplicate"; reason?: string }> {
  const now = Date.now();
  const seen = await ctx.db
    .query("notificationDeliveries")
    .withIndex("by_key", (q) => q.eq("dedupeKey", args.dedupeKey))
    .first();
  if (seen) return { status: "duplicate" };
  const settings = await getSettings(ctx);
  const devices = (await ctx.db.query("pushSubscriptions").collect()).filter((device) => device.enabled);
  const reason =
    devices.length === 0
      ? "no device has notifications turned on"
      : !args.evenInQuietHours && isQuiet(localHour(now, settings.timeZone), settings.quietFrom, settings.quietTo)
        ? "quiet hours"
        : undefined;
  const { evenInQuietHours: _force, ...delivery } = args;
  const id = await ctx.db.insert("notificationDeliveries", {
    ...delivery,
    status: reason ? "skipped" : "pending",
    ...(reason ? { reason } : {}),
    createdAt: now,
  });
  if (reason) return { status: "skipped", reason };
  await ctx.scheduler.runAfter(0, internal.pushNode.deliver, { deliveryId: id });
  return { status: "pending" };
}

/** What the sender needs: the notification and the devices to send it to. */
export const forDelivery = internalQuery({
  args: { deliveryId: v.id("notificationDeliveries") },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status !== "pending") return null;
    const devices = (await ctx.db.query("pushSubscriptions").collect()).filter((device) => device.enabled);
    return {
      delivery: { title: delivery.title, body: delivery.body, url: delivery.url },
      devices: devices.map((device) => ({ id: device._id, endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth })),
    };
  },
});

/** Records how the sending went. A device the push service says is gone is switched off. */
export const settle = internalMutation({
  args: {
    deliveryId: v.id("notificationDeliveries"),
    results: v.array(v.object({ id: v.id("pushSubscriptions"), ok: v.boolean(), gone: v.boolean() })),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const result of args.results) {
      if (result.gone) await ctx.db.patch(result.id, { enabled: false });
      else if (result.ok) await ctx.db.patch(result.id, { lastSentAt: now });
    }
    const reached = args.results.filter((result) => result.ok).length;
    await ctx.db.patch(args.deliveryId, {
      status: reached > 0 ? "sent" : "failed",
      ...(reached > 0 ? { sentAt: now } : { reason: args.error ?? "no device could be reached" }),
    });
    return null;
  },
});

export type DeviceId = Id<"pushSubscriptions">;
