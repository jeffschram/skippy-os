/**
 * Settings for the Skippy MCP endpoint, read from the environment on each
 * request. Nothing here falls back to a default: a missing value is reported
 * as "not configured" instead of quietly running with a weaker check.
 */

export class NotConfiguredError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Skippy MCP is not configured. Missing: ${missing.join(", ")}`);
    this.name = "NotConfiguredError";
  }
}

export type McpConfig = {
  /** The MCP endpoint's public URL. It is the OAuth resource, and the `aud` every access token must carry. */
  resourceUrl: string;
  /** Where clients read the protected-resource metadata for that resource. */
  resourceMetadataUrl: string;
  clerkSecretKey: string;
  clerkPublishableKey: string;
  convexUrl: string;
  gatewaySecret: string;
};

/** The settings the public metadata routes need. They hold no secrets. */
export type PublicMcpConfig = Pick<McpConfig, "resourceUrl" | "resourceMetadataUrl" | "clerkPublishableKey">;

function resourceMetadataUrlFor(resourceUrl: string): string {
  const url = new URL(resourceUrl);
  // RFC 9728: the well-known segment goes in front of the resource's own path.
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname === "/" ? "" : url.pathname}`;
}

function read(names: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = process.env[name];
    if (value) values[name] = value;
    else missing.push(name);
  }
  if (missing.length > 0) throw new NotConfiguredError(missing);
  return values;
}

export function publicMcpConfig(): PublicMcpConfig {
  const env = read(["SKIPPY_MCP_RESOURCE_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"]);
  return {
    resourceUrl: env.SKIPPY_MCP_RESOURCE_URL,
    resourceMetadataUrl: resourceMetadataUrlFor(env.SKIPPY_MCP_RESOURCE_URL),
    clerkPublishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  };
}

export function mcpConfig(): McpConfig {
  const env = read([
    "SKIPPY_MCP_RESOURCE_URL",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "CONVEX_URL",
    "SKIPPY_GATEWAY_SECRET",
  ]);
  return {
    resourceUrl: env.SKIPPY_MCP_RESOURCE_URL,
    resourceMetadataUrl: resourceMetadataUrlFor(env.SKIPPY_MCP_RESOURCE_URL),
    clerkSecretKey: env.CLERK_SECRET_KEY,
    clerkPublishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    convexUrl: env.CONVEX_URL,
    gatewaySecret: env.SKIPPY_GATEWAY_SECRET,
  };
}

/** The answer every route gives while a setting is missing. It names the settings, never their values. */
export function notConfiguredResponse(error: NotConfiguredError): Response {
  return Response.json({ error: "not_configured", missing: error.missing }, { status: 503 });
}
