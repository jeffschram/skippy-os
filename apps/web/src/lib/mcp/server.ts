import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { OPERATIONS, type OperationName, type OAuthPrincipal } from "@skippy/shared";
import { GatewayRefusal } from "./gateway";
import { TOOLS } from "./tools";

const INSTRUCTIONS = [
  "Skippy OS is the owner's personal system for projects, tasks and what is worth remembering.",
  "Projects are named by slug; every other record by its id.",
  "Read with search, get_context_bundle, list_projects, get_project, get_today and get_changes_since.",
  "Write with upsert_project, create_phase, update_phase, upsert_task, complete_task, upsert_person, upsert_knowledge and link_entities.",
  "Before saving a person or something to remember, search for it, so the same thing is not saved twice.",
  "When you work on a Skippy project, call record_project_status when a milestone is reached, a decision is made, something gets blocked, or the session ends.",
  "Every write is logged with you as its author.",
].join(" ");

/** Runs one operation for the caller and returns what Convex answered. */
export type RunOperation = (operation: OperationName, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Builds the MCP server for one request from one verified caller. A tool whose
 * scope the caller was not granted is not registered, so it is never listed.
 */
export function buildServer(principal: Pick<OAuthPrincipal, "scopes">, run: RunOperation): McpServer {
  const server = new McpServer({ name: "skippy-os", version: "0.2.0" }, { instructions: INSTRUCTIONS });

  async function answer(operation: OperationName, args: Record<string, unknown>): Promise<CallToolResult> {
    try {
      const result = await run(operation, args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      if (error instanceof GatewayRefusal) {
        return { isError: true, content: [{ type: "text", text: error.message }] };
      }
      throw error;
    }
  }

  for (const name of Object.keys(TOOLS) as OperationName[]) {
    if (!principal.scopes.includes(OPERATIONS[name].scope)) continue;
    const tool = TOOLS[name];
    server.registerTool(
      name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations:
          tool.kind === "read"
            ? { readOnlyHint: true }
            : { readOnlyHint: false, destructiveHint: false, idempotentHint: tool.idempotent ?? false },
      },
      (args: Record<string, unknown>) => answer(name, args ?? {}),
    );
  }

  return server;
}
