"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

/**
 * Sends one notification to every device that asked for them, using Web Push.
 * It needs a key pair in the environment: VAPID_PUBLIC_KEY and
 * VAPID_PRIVATE_KEY. Without them it records that and sends nothing.
 */
type WebPush = typeof import("web-push");

/** The push library, however the bundler hands it over: as the module itself or under `default`. */
async function loadWebPush(): Promise<WebPush | undefined> {
  const loaded = (await import("web-push")) as unknown as { default?: unknown };
  const nested = (loaded.default as { default?: unknown } | undefined)?.default;
  return [loaded, loaded.default, nested].find(
    (candidate) => typeof (candidate as WebPush | undefined)?.setVapidDetails === "function",
  ) as WebPush | undefined;
}

export const deliver = internalAction({
  args: { deliveryId: v.id("notificationDeliveries") },
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.runQuery(internal.push.forDelivery, args);
    if (!job) return null;
    const giveUp = async (error: string) => {
      await ctx.runMutation(internal.push.settle, { ...args, results: [], error });
      return null;
    };
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return await giveUp("the push keys are not set");
    try {
      // Loaded here, so that nothing else pays for it and a missing key never reaches it.
      const webpush = await loadWebPush();
      if (!webpush) return await giveUp("the push library did not load");
      // The push services want a way to reach whoever runs the sender. The site's own address serves.
      // It must be an https address, which a development deployment's own address is not.
      const own = process.env.SKIPPY_MCP_RESOURCE_URL ? new URL(process.env.SKIPPY_MCP_RESOURCE_URL).origin : "";
      const contact = own.startsWith("https://") ? own : "https://skippyos.app";
      webpush.setVapidDetails(contact, publicKey, privateKey);
      const payload = JSON.stringify(job.delivery);
      const results = [];
      for (const device of job.devices) {
        try {
          await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, payload, {
            TTL: 6 * 60 * 60,
          });
          results.push({ id: device.id, ok: true, gone: false });
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          // 404 and 410 mean the browser has dropped the subscription for good.
          results.push({ id: device.id, ok: false, gone: status === 404 || status === 410 });
        }
      }
      await ctx.runMutation(internal.push.settle, { ...args, results });
      return null;
    } catch (error) {
      // Whatever went wrong, the notification must not be left looking as if it is still on its way.
      return await giveUp(`the sender stopped: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300));
    }
  },
});
