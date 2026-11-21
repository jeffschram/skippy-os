import { createMcpHandler } from "@modelcontextprotocol/server";
import type { OperationName } from "@skippy/shared";
import { describe, expect, it } from "vitest";
import { GatewayRefusal } from "./gateway";
import { buildServer, type RunOperation } from "./server";

const READ = ["skippy:read"];
const BOTH = ["skippy:read", "skippy:write"];

type Tool = { name: string; inputSchema: { type: string } };
type Reply = {
  result?: { tools?: Tool[]; isError?: boolean; content?: { type: string; text: string }[] };
  error?: { code: number; message: string };
};

/** Sends one JSON-RPC request to the MCP server the way an MCP client does over HTTP. */
async function rpc(scopes: string[], method: string, params: unknown, run: RunOperation = async () => ({})) {
  const handler = createMcpHandler(() => buildServer({ scopes }, run));
  const response = await handler.fetch(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    { authInfo: { token: "test", clientId: "test", scopes } },
  );
  const text = await response.text();
  const json = text.startsWith("{") ? text : (text.split("\n").find((line) => line.startsWith("data:")) ?? "").slice(5);
  return JSON.parse(json) as Reply;
}

const toolNames = async (scopes: string[]) =>
  ((await rpc(scopes, "tools/list", {})).result?.tools ?? []).map((tool) => tool.name).sort();

describe("the MCP server", () => {
  it("lists every tool to a caller with both scopes", async () => {
    expect(await toolNames(BOTH)).toEqual([
      "capture",
      "complete_task",
      "create_phase",
      "get_changes_since",
      "get_context_bundle",
      "get_project",
      "get_today",
      "link_entities",
      "list_projects",
      "record_project_status",
      "search",
      "upsert_knowledge",
      "upsert_person",
      "upsert_project",
      "upsert_task",
      "whoami",
    ]);
  });

  it("never lists a write tool to a read-only caller", async () => {
    expect(await toolNames(READ)).toEqual([
      "get_changes_since",
      "get_context_bundle",
      "get_project",
      "get_today",
      "list_projects",
      "search",
      "whoami",
    ]);
  });

  it("will not run a write tool for a read-only caller", async () => {
    const calls: OperationName[] = [];
    const reply = await rpc(READ, "tools/call", { name: "upsert_task", arguments: { title: "x" } }, async (operation) => {
      calls.push(operation);
      return {};
    });
    expect(calls).toEqual([]);
    expect(reply.error ?? reply.result?.isError).toBeTruthy();
  });

  it("passes valid arguments through and returns what Convex answered", async () => {
    const seen: unknown[] = [];
    const reply = await rpc(
      BOTH,
      "tools/call",
      { name: "upsert_task", arguments: { title: "Buy milk", dueAt: "2026-11-25", description: null } },
      async (operation, args) => {
        seen.push([operation, args]);
        return { created: true };
      },
    );
    expect(seen).toEqual([["upsert_task", { title: "Buy milk", dueAt: "2026-11-25", description: null }]]);
    expect(JSON.parse(reply.result?.content?.[0].text ?? "")).toEqual({ created: true });
  });

  it("rejects arguments that do not fit the tool before anything runs", async () => {
    const calls: OperationName[] = [];
    const reply = await rpc(
      BOTH,
      "tools/call",
      { name: "upsert_task", arguments: { title: "x", status: "finished" } },
      async (operation) => {
        calls.push(operation);
        return {};
      },
    );
    expect(calls).toEqual([]);
    expect(reply.error ?? reply.result?.isError).toBeTruthy();
  });

  it("reports a refusal from Convex as a tool error the model can read", async () => {
    const reply = await rpc(BOTH, "tools/call", { name: "get_project", arguments: { project: "missing" } }, async () => {
      throw new GatewayRefusal("not_found", 'There is no project with the slug "missing".');
    });
    const text = reply.result?.content?.[0].text ?? "";
    expect(reply.result?.isError).toBe(true);
    expect(text).toContain("not_found");
    expect(text).toContain('slug "missing"');
  });

  it("describes every tool input", async () => {
    const tools = (await rpc(BOTH, "tools/list", {})).result?.tools ?? [];
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) expect(tool.inputSchema.type, tool.name).toBe("object");
  });
});
