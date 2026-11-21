import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Who made a write. Every stored record carries one. */
export const actor = v.object({
  kind: v.literal("oauth"),
  /** The Clerk user id of the owner the client acted for. */
  subject: v.string(),
  /** The OAuth client that made the call, for example Claude or ChatGPT. */
  clientId: v.string(),
});

export default defineSchema({
  // Phase 0 only. The full knowledge schema arrives in Phase 1.
  captures: defineTable({
    text: v.string(),
    actor,
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),

  // Nonces of gateway envelopes already used, kept until the envelope expires.
  gatewayNonces: defineTable({
    nonce: v.string(),
    expiresAt: v.number(),
  })
    .index("by_nonce", ["nonce"])
    .index("by_expiry", ["expiresAt"]),
});
