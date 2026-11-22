/**
 * Shared by the scheduled jobs that run a Claude Code session from the command
 * line: start one with a prompt and an exact list of tools, keep its
 * transcript, and say afterwards which tools it called and whether they worked.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

export const SKIPPY = "mcp__claude_ai_Skippy_OS__";
export const skippyTools = (...names) => names.map((name) => SKIPPY + name);

/** Calls one of the runner's functions in Skippy OS, with the token in ~/.skippy-os/runner.env. */
export function runnerClient() {
  const file = join(homedir(), ".skippy-os", "runner.env");
  if (!existsSync(file)) throw new Error(`${file} is missing. See docs/chat-runner.md.`);
  const values = Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
  );
  const convex = new ConvexHttpClient(values.CONVEX_URL);
  return (name, args = {}) => convex.mutation(anyApi.runner[name], { token: values.RUNNER_TOKEN, host: hostname(), ...args });
}

/**
 * Runs one session to its end. Every tool not in `tools` is refused by the
 * program. Resolves with the session's last words and each tool call it made.
 */
export function runSession({ prompt, tools, cwd, transcript, limitMs = 20 * 60_000 }) {
  return new Promise((resolve) => {
    mkdirSync(cwd, { recursive: true });
    const child = spawn(
      process.env.SKIPPY_CLAUDE_BIN || "claude",
      ["-p", prompt, "--allowedTools", ...tools, "--output-format", "stream-json", "--verbose"],
      { cwd, stdio: ["ignore", "pipe", "pipe"] },
    );
    if (transcript) {
      mkdirSync(dirname(transcript), { recursive: true });
      child.stdout.pipe(createWriteStream(transcript, { mode: 0o600 }));
    }
    const calls = new Map(); // tool call id → { name, input, ok }
    let buffered = "";
    let result;
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      let end;
      while ((end = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, end).trim();
        buffered = buffered.slice(end + 1);
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        for (const block of event.message?.content ?? []) {
          if (block.type === "tool_use") calls.set(block.id, { name: block.name, input: block.input, ok: undefined });
          if (block.type === "tool_result" && calls.has(block.tool_use_id)) calls.get(block.tool_use_id).ok = !block.is_error;
        }
        if (event.type === "result") result = event;
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-1500);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, limitMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        timedOut,
        said: String(result?.result ?? "").replace(/\s+/g, " ").trim(),
        stderr: stderr.trim(),
        calls: [...calls.values()],
        /** Whether a tool was called and answered without an error. */
        did: (name) => [...calls.values()].some((call) => call.name === name && call.ok === true),
      });
    });
  });
}
