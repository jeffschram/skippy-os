import { requireAdditionalScopes } from "@clerk/mcp-tools/server";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { OPERATIONS, type OperationName } from "@skippy/shared";
import { z } from "zod";
import type { Caller } from "./auth";
import type { McpConfig } from "./config";
import { callGateway, GatewayRefusal } from "./gateway";

const INSTRUCTIONS =
  "Skippy OS is the owner's personal knowledge system. This is the Phase 0 test server: " +
  "`whoami` reports who is connected and the latest captures, and `capture` saves a short note.";

/** Builds the MCP server for one request from one verified caller. */
export function buildServer(config: McpConfig, caller: Caller): McpServer {
  const server = new McpServer({ name: "skippy-os", version: "0.0.0" }, { instructions: INSTRUCTIONS });

  async function run(operation: OperationName, args: Record<string, unknown>): Promise<CallToolResult> {
    try {
      const result = await callGateway(config, caller.principal, operation, args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      if (error instanceof GatewayRefusal) {
        return { isError: true, content: [{ type: "text", text: error.message }] };
      }
      throw error;
    }
  }

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Shows which Skippy owner and client this connection acts as, the scopes it was granted, and the five most recent captures.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
      scopeChallenge: requireAdditionalScopes(OPERATIONS.whoami.scope),
    },
    () => run("whoami", {}),
  );

  server.registerTool(
    "capture",
    {
      title: "Capture",
      description: "Saves a short note to Skippy. Use it for a thought, a link or a reminder worth keeping.",
      inputSchema: { text: z.string().trim().min(1).max(4000).describe("The note to save, in plain text.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      scopeChallenge: requireAdditionalScopes(OPERATIONS.capture.scope),
    },
    ({ text }) => run("capture", { text }),
  );

  return server;
}
