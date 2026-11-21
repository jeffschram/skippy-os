import { describe, expect, it } from "vitest";
import { ENVELOPE_TTL_MS, EnvelopeError, signEnvelope, verifyEnvelope, type Principal } from "./envelope";
import { scopesAllow } from "./scopes";

const secret = "s".repeat(40);
const principal: Principal = {
  kind: "oauth",
  subject: "user_123",
  clientId: "client_abc",
  resource: "http://localhost:3000/api/mcp",
  scopes: ["skippy:read"],
};
const input = { operation: "whoami" as const, args: {}, principal };

async function code(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof EnvelopeError) return error.code;
    throw error;
  }
  return "accepted";
}

describe("gateway envelope", () => {
  it("round-trips a signed envelope", async () => {
    const signed = await signEnvelope(input, secret, 1_000);
    const envelope = await verifyEnvelope(signed, secret, 1_500);
    expect(envelope.operation).toBe("whoami");
    expect(envelope.principal).toEqual(principal);
    expect(envelope.expiresAt).toBe(1_000 + ENVELOPE_TTL_MS);
  });

  it("gives every envelope its own nonce", async () => {
    const a = await verifyEnvelope(await signEnvelope(input, secret), secret);
    const b = await verifyEnvelope(await signEnvelope(input, secret), secret);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("rejects a changed payload", async () => {
    const signed = await signEnvelope(input, secret);
    const payload = signed.payload.replace("skippy:read", "skippy:write");
    expect(payload).not.toBe(signed.payload);
    expect(await code(verifyEnvelope({ ...signed, payload }, secret))).toBe("bad_signature");
  });

  it("rejects a signature made with another secret", async () => {
    const signed = await signEnvelope(input, "x".repeat(40));
    expect(await code(verifyEnvelope(signed, secret))).toBe("bad_signature");
  });

  it("rejects a signature that is not base64url", async () => {
    const signed = await signEnvelope(input, secret);
    expect(await code(verifyEnvelope({ ...signed, signature: "not valid!" }, secret))).toBe("bad_signature");
  });

  it("rejects an expired envelope", async () => {
    const signed = await signEnvelope(input, secret, 1_000);
    expect(await code(verifyEnvelope(signed, secret, 1_000 + ENVELOPE_TTL_MS))).toBe("expired");
  });

  it("rejects an envelope issued in the future", async () => {
    const signed = await signEnvelope(input, secret, 60_000);
    expect(await code(verifyEnvelope(signed, secret, 1_000))).toBe("not_yet_valid");
  });

  it("refuses to sign or verify without a real secret", async () => {
    expect(await code(signEnvelope(input, undefined))).toBe("secret_not_configured");
    expect(await code(signEnvelope(input, "short"))).toBe("secret_not_configured");
    const signed = await signEnvelope(input, secret);
    expect(await code(verifyEnvelope(signed, ""))).toBe("secret_not_configured");
  });
});

describe("scopes", () => {
  it("needs the read scope to read and the write scope to write", () => {
    expect(scopesAllow(["skippy:read"], "whoami")).toBe(true);
    expect(scopesAllow(["skippy:read"], "capture")).toBe(false);
    expect(scopesAllow(["skippy:write"], "capture")).toBe(true);
    expect(scopesAllow(["skippy:write"], "whoami")).toBe(false);
    expect(scopesAllow(["profile", "email"], "whoami")).toBe(false);
  });
});
