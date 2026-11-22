/// <reference types="vite/client" />
import { signEnvelope, type OAuthPrincipal, type OperationName } from "@skippy/shared";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Every Convex module, including _generated, but not the test files.
const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const SECRET = "test-secret-".repeat(4);
const OWNER = "user_owner";
const RESOURCE = "http://localhost:3000/api/mcp";

beforeEach(() => {
  process.env.SKIPPY_GATEWAY_SECRET = SECRET;
  process.env.SKIPPY_OWNER_CLERK_USER_ID = OWNER;
  process.env.SKIPPY_MCP_RESOURCE_URL = RESOURCE;
});

function principal(overrides: Partial<OAuthPrincipal> = {}): OAuthPrincipal {
  return {
    kind: "oauth",
    subject: OWNER,
    clientId: "client_claude",
    resource: RESOURCE,
    scopes: ["skippy:read", "skippy:write"],
    ...overrides,
  };
}

function sign(operation: OperationName, args: Record<string, unknown>, who = principal(), secret = SECRET) {
  return signEnvelope({ operation, args, principal: who }, secret);
}

/** The refusal code of a gateway call, or "accepted" when it went through. */
async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ConvexError) return String((error.data as { code?: unknown }).code);
    throw error;
  }
  return "accepted";
}

type WhoAmI = { owner: string; client: string; scopes: string[]; recentCaptures: { text: string; client: string }[] };

describe("gateway.call", () => {
  it("captures a note and reads it back, recording who wrote it", async () => {
    const t = convexTest(schema, modules);
    const saved = (await t.action(api.gateway.call, await sign("capture", { text: "  Call the plumber  " }))) as {
      capture: { text: string; status: string; intent: string };
    };
    expect(saved.capture).toMatchObject({ text: "Call the plumber", status: "pending", intent: "remember" });

    const me = (await t.action(api.gateway.call, await sign("whoami", {}))) as WhoAmI;
    expect(me.owner).toBe(OWNER);
    expect(me.client).toBe("client_claude");
    expect(me.recentCaptures).toEqual([expect.objectContaining({ text: "Call the plumber", client: "client_claude" })]);

    const rows = await t.run((ctx) => ctx.db.query("captures").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].createdBy).toMatchObject({ kind: "agent", clientId: "client_claude" });
  });

  it("refuses the same envelope a second time", async () => {
    const t = convexTest(schema, modules);
    const signed = await sign("capture", { text: "once" });
    await t.action(api.gateway.call, signed);
    expect(await refusal(t.action(api.gateway.call, signed))).toBe("envelope_already_used");
    expect(await t.run((ctx) => ctx.db.query("captures").collect())).toHaveLength(1);
  });

  it("refuses an account that is not the owner, and creates nothing", async () => {
    const t = convexTest(schema, modules);
    const stranger = principal({ subject: "user_stranger" });
    expect(await refusal(t.action(api.gateway.call, await sign("whoami", {}, stranger)))).toBe("account_not_authorized");
    expect(await refusal(t.action(api.gateway.call, await sign("capture", { text: "hi" }, stranger)))).toBe(
      "account_not_authorized",
    );
    expect(await t.run((ctx) => ctx.db.query("captures").collect())).toHaveLength(0);
  });

  it("refuses a write from a read-only grant", async () => {
    const t = convexTest(schema, modules);
    const readOnly = principal({ scopes: ["skippy:read"] });
    expect(await refusal(t.action(api.gateway.call, await sign("capture", { text: "hi" }, readOnly)))).toBe(
      "insufficient_scope",
    );
    expect(await refusal(t.action(api.gateway.call, await sign("whoami", {}, readOnly)))).toBe("accepted");
    expect(await t.run((ctx) => ctx.db.query("captures").collect())).toHaveLength(0);
  });

  it("refuses a token that was verified for another resource", async () => {
    const t = convexTest(schema, modules);
    const elsewhere = principal({ resource: "https://example.com/api/mcp" });
    expect(await refusal(t.action(api.gateway.call, await sign("whoami", {}, elsewhere)))).toBe("wrong_resource");
  });

  it("refuses an envelope signed with another secret, or changed after signing", async () => {
    const t = convexTest(schema, modules);
    const forged = await sign("whoami", {}, principal(), "another-secret-".repeat(4));
    expect(await refusal(t.action(api.gateway.call, forged))).toBe("bad_signature");

    const signed = await sign("capture", { text: "original" });
    const changed = { ...signed, payload: signed.payload.replace("original", "replaced") };
    expect(await refusal(t.action(api.gateway.call, changed))).toBe("bad_signature");
  });

  it("refuses everything while the gateway is not configured", async () => {
    const t = convexTest(schema, modules);
    const signed = await sign("whoami", {});
    delete process.env.SKIPPY_OWNER_CLERK_USER_ID;
    expect(await refusal(t.action(api.gateway.call, signed))).toBe("gateway_not_configured");
    delete process.env.SKIPPY_GATEWAY_SECRET;
    expect(await refusal(t.action(api.gateway.call, signed))).toBe("secret_not_configured");
  });

  it("refuses an empty or oversized capture", async () => {
    const t = convexTest(schema, modules);
    expect(await refusal(t.action(api.gateway.call, await sign("capture", { text: "   " })))).toBe("invalid_arguments");
    expect(await refusal(t.action(api.gateway.call, await sign("capture", { text: "x".repeat(4001) })))).toBe(
      "invalid_arguments",
    );
    expect(await refusal(t.action(api.gateway.call, await sign("capture", { text: 42 })))).toBe("invalid_arguments");
  });
});
