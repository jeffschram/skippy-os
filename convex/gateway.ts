import { ConvexError, v } from "convex/values";
import { EnvelopeError, scopesAllow, verifyEnvelope, type Envelope } from "@skippy/shared";
import { internal } from "./_generated/api";
import { action, internalMutation } from "./_generated/server";

const signed = { payload: v.string(), signature: v.string() };

/** The checks that need no database: signature, lifetime, owner, resource and scope. */
async function verifyCaller(args: { payload: string; signature: string }): Promise<Envelope> {
  let envelope: Envelope;
  try {
    envelope = await verifyEnvelope(args, process.env.SKIPPY_GATEWAY_SECRET);
  } catch (error) {
    if (error instanceof EnvelopeError) throw new ConvexError({ code: error.code });
    throw error;
  }
  const owner = process.env.SKIPPY_OWNER_CLERK_USER_ID;
  const resource = process.env.SKIPPY_MCP_RESOURCE_URL;
  if (!owner || !resource) throw new ConvexError({ code: "gateway_not_configured" });
  // One owner. An account that is not the owner is refused, never created.
  if (envelope.principal.subject !== owner) throw new ConvexError({ code: "account_not_authorized" });
  if (envelope.principal.resource !== resource) throw new ConvexError({ code: "wrong_resource" });
  if (!scopesAllow(envelope.principal.scopes, envelope.operation)) {
    throw new ConvexError({ code: "insufficient_scope" });
  }
  return envelope;
}

/**
 * The only public entry point for MCP operations. The MCP route verifies the
 * caller's access token and signs the exact operation; this action trusts
 * nothing but that signature, and rechecks owner and scope before running it.
 */
export const call = action({
  args: signed,
  handler: async (ctx, args): Promise<unknown> => {
    const envelope = await verifyCaller(args);
    await ctx.runMutation(internal.gateway.useNonce, args);
    const actor = {
      kind: "oauth" as const,
      subject: envelope.principal.subject,
      clientId: envelope.principal.clientId,
    };
    switch (envelope.operation) {
      case "whoami":
        return await ctx.runQuery(internal.operations.whoami, { actor, scopes: envelope.principal.scopes });
      case "capture": {
        const text = envelope.args.text;
        if (typeof text !== "string") throw new ConvexError({ code: "invalid_arguments" });
        return await ctx.runMutation(internal.operations.capture, { actor, text });
      }
    }
  },
});

/** Records the envelope's nonce, and refuses an envelope whose nonce was already recorded. */
export const useNonce = internalMutation({
  args: signed,
  handler: async (ctx, args) => {
    // Verified again here so that this mutation is safe whoever calls it.
    const envelope = await verifyCaller(args);
    const seen = await ctx.db
      .query("gatewayNonces")
      .withIndex("by_nonce", (q) => q.eq("nonce", envelope.nonce))
      .unique();
    if (seen) throw new ConvexError({ code: "envelope_already_used" });
    await ctx.db.insert("gatewayNonces", { nonce: envelope.nonce, expiresAt: envelope.expiresAt });
    // An expired envelope fails the lifetime check before it reaches this point,
    // so its nonce is no longer needed. Remove a few each call.
    const expired = await ctx.db
      .query("gatewayNonces")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", Date.now()))
      .take(20);
    for (const row of expired) await ctx.db.delete(row._id);
    return null;
  },
});
