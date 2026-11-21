import { corsHeaders, fetchClerkAuthorizationServerMetadata, generateClerkProtectedResourceMetadata } from "@clerk/mcp-tools/server";
import { SCOPES } from "@skippy/shared";
import { connection } from "next/server";
import { NotConfiguredError, notConfiguredResponse, publicMcpConfig } from "./config";

const headers = { "Cache-Control": "max-age=3600", ...corsHeaders };

/**
 * RFC 9728 protected-resource metadata. `resource` is the full MCP endpoint
 * URL: clients send it when they ask for a token, Clerk puts it in the token's
 * `aud`, and the MCP route accepts no other audience.
 */
export async function protectedResourceMetadata(): Promise<Response> {
  await connection(); // Read the environment per request; never bake this response in at build time.
  try {
    const config = publicMcpConfig();
    const metadata = generateClerkProtectedResourceMetadata({
      publishableKey: config.clerkPublishableKey,
      resourceUrl: config.resourceUrl,
      properties: { scopes_supported: [...SCOPES], resource_name: "Skippy OS" },
    });
    return Response.json(metadata, { headers });
  } catch (error) {
    if (error instanceof NotConfiguredError) return notConfiguredResponse(error);
    throw error;
  }
}

/** RFC 8414 authorization-server metadata, relayed from Clerk for clients that look for it on the resource's host. */
export async function authorizationServerMetadata(): Promise<Response> {
  await connection();
  try {
    const config = publicMcpConfig();
    const metadata: unknown = await fetchClerkAuthorizationServerMetadata({
      publishableKey: config.clerkPublishableKey,
    });
    return Response.json(metadata, { headers });
  } catch (error) {
    if (error instanceof NotConfiguredError) return notConfiguredResponse(error);
    throw error;
  }
}

/** Preflight answer for MCP clients that run in a browser. */
export function metadataOptions(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}
