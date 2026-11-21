import { createClerkClient } from "@clerk/backend";
import { verifyClerkToken } from "@clerk/mcp-tools/server";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { OAuthPrincipal } from "@skippy/shared";
import type { McpConfig } from "./config";

export type Caller = {
  /** Passed to the MCP SDK, which uses it for scope challenges. */
  authInfo: AuthInfo;
  /** Passed to Convex inside the signed gateway envelope. */
  principal: OAuthPrincipal;
};

export function bearerToken(request: Request): string | undefined {
  return request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
}

/**
 * Verifies the request's OAuth access token with Clerk: signature, expiry,
 * token type, and that its audience is exactly this MCP endpoint. Returns
 * undefined for anything else. The audience check is never skipped or widened.
 */
export async function authenticate(request: Request, config: McpConfig): Promise<Caller | undefined> {
  const token = bearerToken(request);
  if (!token) return undefined;
  const clerk = createClerkClient({
    secretKey: config.clerkSecretKey,
    publishableKey: config.clerkPublishableKey,
  });
  const state = await clerk.authenticateRequest(request, {
    acceptsToken: "oauth_token",
    audience: config.resourceUrl,
  });
  const verified = verifyClerkToken(state.toAuth(), token);
  if (!verified) return undefined;
  return {
    authInfo: { ...verified, resourceMetadataUrl: config.resourceMetadataUrl },
    principal: {
      kind: "oauth",
      subject: verified.extra.userId,
      clientId: verified.clientId,
      resource: config.resourceUrl,
      scopes: verified.scopes,
    },
  };
}
