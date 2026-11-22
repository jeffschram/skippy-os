import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { OPERATIONS, SCOPE_READ, type OperationName, type OAuthPrincipal } from "@skippy/shared";
import { z } from "zod";
import { GatewayRefusal } from "./gateway";
import { SKILLS, type SkillName } from "./skills.generated";
import { TOOLS } from "./tools";

const INSTRUCTIONS = [
  "Skippy OS is the owner's personal system for projects, tasks and what is worth remembering.",
  "Projects are named by slug; every other record by its id.",
  "Read with search, get_context_bundle, list_projects, get_project, get_today and get_changes_since.",
  "Write with upsert_project, create_phase, update_phase, upsert_task, complete_task, upsert_person, upsert_knowledge and link_entities.",
  "Before saving a person or something to remember, search for it, so the same thing is not saved twice.",
  "The inbox holds quick captures waiting to be filed: capture adds one, list_captures reads them, and resolve_capture marks one as filed or discarded.",
  "When you work on a Skippy project, call record_project_status when a milestone is reached, a decision is made, something gets blocked, or the session ends.",
  "When instructions say to follow the skippy-status or skippy-capture skill and you do not already have its text, call get_skill for it and follow what it returns.",
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

  // Answered here, not by Convex: the skill text ships with the site.
  if (principal.scopes.includes(SCOPE_READ)) {
    server.registerTool(
      "get_skill",
      {
        title: "Get skill",
        description:
          "Returns the working instructions for a Skippy skill: skippy-status (when and how to report on a Skippy project) or skippy-capture (what to save where). Call it when instructions say to follow one of these skills and you do not already have its text loaded.",
        inputSchema: {
          name: z.enum(Object.keys(SKILLS) as [SkillName, ...SkillName[]]).describe("The skill to read."),
        },
        annotations: { readOnlyHint: true },
      },
      ({ name }): CallToolResult => ({ content: [{ type: "text", text: SKILLS[name] }] }),
    );
  }

  return server;
}
