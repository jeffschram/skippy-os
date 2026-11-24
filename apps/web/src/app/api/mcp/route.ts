import { createMcpHandler } from "@modelcontextprotocol/server";
import { authenticate, bearerToken } from "@/lib/mcp/auth";
import { mcpConfig, NotConfiguredError, notConfiguredResponse, publicMcpConfig } from "@/lib/mcp/config";
import { callGateway } from "@/lib/mcp/gateway";
import { buildServer } from "@/lib/mcp/server";
import { SCOPES } from "@skippy/shared";

/**
 * 401 with a pointer to the protected-resource metadata, which is how an MCP client finds where to
 * sign in, and the scopes to ask for. A client that gets it runs the OAuth flow again.
 */
function challenge(resourceMetadataUrl: string, error?: "invalid_token" | "insufficient_scope"): Response {
  const parts = [`resource_metadata="${resourceMetadataUrl}"`, `scope="${SCOPES.join(" ")}"`];
  if (error) parts.unshift(`error="${error}"`);
  return Response.json(
    { error: error ?? "unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": `Bearer ${parts.join(", ")}` } },
  );
}

async function handler(request: Request): Promise<Response> {
  try {
    // A request with no token needs no secrets to answer: point it at the metadata.
    if (!bearerToken(request)) return challenge(publicMcpConfig().resourceMetadataUrl);

    const config = mcpConfig();
    const caller = await authenticate(request, config);
    if (!caller) {
      console.warn(`MCP token refused: ${request.method} from ${request.headers.get("user-agent") ?? "no user agent"}`);
      return challenge(config.resourceMetadataUrl, "invalid_token");
    }

    // A valid token with neither Skippy scope would get a session with no tools at all, which a
    // client shows as connected but empty. Ask it to sign in again for the scopes instead.
    if (!caller.principal.scopes.some((scope) => (SCOPES as readonly string[]).includes(scope))) {
      console.warn(
        `MCP token without Skippy scopes: client ${caller.principal.clientId}, scopes [${caller.principal.scopes.join(" ")}]`,
      );
      return challenge(config.resourceMetadataUrl, "insufficient_scope");
    }

    const mcp = createMcpHandler(() =>
      buildServer(caller.principal, (operation, args) => callGateway(config, caller.principal, operation, args)),
    );
    return await mcp.fetch(request, { authInfo: caller.authInfo });
  } catch (error) {
    if (error instanceof NotConfiguredError) return notConfiguredResponse(error);
    throw error;
  }
}

export { handler as GET, handler as POST, handler as DELETE };
