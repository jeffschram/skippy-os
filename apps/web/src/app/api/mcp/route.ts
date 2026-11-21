import { createMcpHandler } from "@modelcontextprotocol/server";
import { authenticate, bearerToken } from "@/lib/mcp/auth";
import { mcpConfig, NotConfiguredError, notConfiguredResponse, publicMcpConfig } from "@/lib/mcp/config";
import { buildServer } from "@/lib/mcp/server";
import { SCOPES } from "@skippy/shared";

/**
 * 401 with a pointer to the protected-resource metadata, which is how an MCP client finds where to
 * sign in, and the scopes to ask for.
 */
function challenge(resourceMetadataUrl: string, error?: "invalid_token"): Response {
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
    if (!caller) return challenge(config.resourceMetadataUrl, "invalid_token");

    const mcp = createMcpHandler(() => buildServer(config, caller));
    return await mcp.fetch(request, { authInfo: caller.authInfo });
  } catch (error) {
    if (error instanceof NotConfiguredError) return notConfiguredResponse(error);
    throw error;
  }
}

export { handler as GET, handler as POST, handler as DELETE };
