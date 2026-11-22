import { ConvexError, v } from "convex/values";
import {
  EnvelopeError,
  harnessForClient,
  scopesAllow,
  verifyEnvelope,
  type AgentActor,
  type Envelope,
  type OperationName,
} from "@skippy/shared";
import type { FunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import { action, internalMutation } from "./_generated/server";

type Phase1Operation = Exclude<OperationName, "whoami">;
type AnyArgs = Record<string, unknown>;

/** Operations that only read. Each gets the caller's arguments and nothing else. */
const READS: Partial<Record<Phase1Operation, FunctionReference<"query", "internal", AnyArgs, unknown>>> = {
  get_project: internal.projects.get as never,
  list_projects: internal.projects.list as never,
  search: internal.read.search as never,
  get_context_bundle: internal.read.contextBundle as never,
  get_today: internal.read.today as never,
  get_changes_since: internal.read.changesSince as never,
  list_captures: internal.captures.list as never,
  get_agenda: internal.agenda.agenda as never,
  get_importance_rubric: internal.ingestion.rubric as never,
  list_goals: internal.goals.list as never,
};

/** Operations that write. Each gets the caller's arguments plus the actor, which the caller cannot set. */
const WRITES: Partial<Record<Phase1Operation, FunctionReference<"mutation", "internal", AnyArgs, unknown>>> = {
  upsert_project: internal.projects.upsert as never,
  record_project_status: internal.projects.recordStatus as never,
  create_phase: internal.projects.createPhase as never,
  update_phase: internal.projects.updatePhase as never,
  upsert_task: internal.tasks.upsert as never,
  complete_task: internal.tasks.complete as never,
  upsert_person: internal.people.upsert as never,
  upsert_knowledge: internal.knowledge.upsert as never,
  link_entities: internal.links.link as never,
  upsert_event: internal.agenda.upsertEvent as never,
  upsert_recurrence: internal.agenda.upsertRecurrence as never,
  complete_recurrence: internal.agenda.completeRecurrence as never,
  record_ingestion_run: internal.ingestion.recordRun as never,
  advance_source_cursor: internal.ingestion.advanceCursor as never,
  sync_calendar: internal.ingestion.syncCalendar as never,
  ingest_objects: internal.ingestion.ingestObjects as never,
  record_briefing: internal.briefing.record as never,
  propose_promotion: internal.chats.proposePromotion as never,
  capture: internal.captures.add as never,
  resolve_capture: internal.captures.resolve as never,
};

/**
 * Convex reports arguments that do not fit a function's validators with an
 * ordinary error. Turn that into a refusal the caller can read and fix.
 */
function asRefusal(error: unknown): never {
  if (error instanceof ConvexError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (/ArgumentValidationError|Validator error/i.test(message)) {
    const lines = message.split("\n").map((line) => line.trim());
    const path = lines.find((line) => line.startsWith("Path:"));
    const value = lines.find((line) => line.startsWith("Value:"));
    const detail = path
      ? `${path}${value ? `, ${value}` : ""} does not fit what this operation accepts.`
      : "An argument does not fit what this operation accepts.";
    throw new ConvexError({ code: "invalid_arguments", message: detail.slice(0, 300) });
  }
  throw error;
}

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
    if (envelope.operation === "whoami") {
      return await ctx.runQuery(internal.operations.whoami, {
        subject: envelope.principal.subject,
        clientId: envelope.principal.clientId,
        scopes: envelope.principal.scopes,
      });
    }

    const read = READS[envelope.operation];
    if (read) return await ctx.runQuery(read, envelope.args).catch(asRefusal);

    const write = WRITES[envelope.operation];
    if (write) {
      const agent: AgentActor = {
        kind: "agent",
        harness: harnessForClient(envelope.principal.clientId),
        clientId: envelope.principal.clientId,
      };
      // The actor goes last, so nothing in the caller's arguments can replace it.
      return await ctx.runMutation(write, { ...envelope.args, actor: agent }).catch(asRefusal);
    }
    throw new ConvexError({ code: "unknown_operation" });
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
