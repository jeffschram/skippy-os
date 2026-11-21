import { isOperationName, type OperationName } from "./scopes";

/**
 * A gateway envelope is how the MCP route (on Vercel) tells Convex "this
 * verified caller wants this exact operation". The route signs it with a
 * secret both sides hold; Convex verifies the signature, the lifetime and that
 * the nonce has never been used, then rechecks the caller's scopes itself.
 */

/** The caller, as established by the MCP route from a verified OAuth access token. */
export type OAuthPrincipal = {
  kind: "oauth";
  /** The `sub` of the access token: the Clerk user id. */
  subject: string;
  /** The OAuth client the token was issued to. */
  clientId: string;
  /** The audience the token was verified against: the MCP resource URL. */
  resource: string;
  scopes: string[];
};

export type Principal = OAuthPrincipal;

export type Envelope = {
  v: 1;
  operation: OperationName;
  args: Record<string, unknown>;
  principal: Principal;
  /** Random and single-use. Convex refuses an envelope whose nonce it has seen. */
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

export type SignedEnvelope = { payload: string; signature: string };

/** How long an envelope is valid. Short, because it only has to cross one network hop. */
export const ENVELOPE_TTL_MS = 30_000;
/** Tolerated clock difference between the signer and the verifier. */
export const ENVELOPE_CLOCK_SKEW_MS = 5_000;
/** A shorter secret is treated as a configuration error on both sides. */
export const MIN_SECRET_LENGTH = 32;

export class EnvelopeError extends Error {
  constructor(
    public readonly code:
      | "secret_not_configured"
      | "bad_signature"
      | "malformed"
      | "expired"
      | "not_yet_valid"
      | "unknown_operation",
  ) {
    super(`Gateway envelope rejected: ${code}`);
    this.name = "EnvelopeError";
  }
}

function assertSecret(secret: string | undefined): asserts secret is string {
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new EnvelopeError("secret_not_configured");
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    usage,
  ]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return undefined;
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

export function newNonce(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

/** Signs one operation for one caller. Called only by the MCP route, after it verified the access token. */
export async function signEnvelope(
  input: { operation: OperationName; args: Record<string, unknown>; principal: Principal },
  secret: string | undefined,
  now: number = Date.now(),
): Promise<SignedEnvelope> {
  assertSecret(secret);
  const envelope: Envelope = {
    v: 1,
    operation: input.operation,
    args: input.args,
    principal: input.principal,
    nonce: newNonce(),
    issuedAt: now,
    expiresAt: now + ENVELOPE_TTL_MS,
  };
  const payload = JSON.stringify(envelope);
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), new TextEncoder().encode(payload));
  return { payload, signature: toBase64Url(new Uint8Array(mac)) };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEnvelope(payload: string): Envelope {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    throw new EnvelopeError("malformed");
  }
  if (!isRecord(raw) || raw.v !== 1) throw new EnvelopeError("malformed");
  const { operation, args, principal, nonce, issuedAt, expiresAt } = raw;
  if (typeof operation !== "string" || !isRecord(args) || !isRecord(principal)) throw new EnvelopeError("malformed");
  if (typeof nonce !== "string" || nonce.length < 16) throw new EnvelopeError("malformed");
  if (typeof issuedAt !== "number" || typeof expiresAt !== "number") throw new EnvelopeError("malformed");
  if (
    principal.kind !== "oauth" ||
    typeof principal.subject !== "string" ||
    principal.subject === "" ||
    typeof principal.clientId !== "string" ||
    typeof principal.resource !== "string" ||
    !isStringArray(principal.scopes)
  ) {
    throw new EnvelopeError("malformed");
  }
  if (!isOperationName(operation)) throw new EnvelopeError("unknown_operation");
  return {
    v: 1,
    operation,
    args,
    principal: {
      kind: "oauth",
      subject: principal.subject,
      clientId: principal.clientId,
      resource: principal.resource,
      scopes: principal.scopes,
    },
    nonce,
    issuedAt,
    expiresAt,
  };
}

/**
 * Checks the signature first, then the shape, then the lifetime. It does not
 * check the nonce: that needs the database, so the Convex gateway does it.
 */
export async function verifyEnvelope(
  signed: SignedEnvelope,
  secret: string | undefined,
  now: number = Date.now(),
): Promise<Envelope> {
  assertSecret(secret);
  const signature = fromBase64Url(signed.signature);
  if (!signature) throw new EnvelopeError("bad_signature");
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    signature,
    new TextEncoder().encode(signed.payload),
  );
  if (!valid) throw new EnvelopeError("bad_signature");
  const envelope = parseEnvelope(signed.payload);
  if (envelope.expiresAt - envelope.issuedAt > ENVELOPE_TTL_MS) throw new EnvelopeError("malformed");
  if (envelope.issuedAt > now + ENVELOPE_CLOCK_SKEW_MS) throw new EnvelopeError("not_yet_valid");
  if (envelope.expiresAt <= now) throw new EnvelopeError("expired");
  return envelope;
}
