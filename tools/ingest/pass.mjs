#!/usr/bin/env node
/**
 * One ingestion pass, run from the command line. A background job starts this
 * six times a day; it can also be run by hand.
 *
 * It starts a Claude Code session with the prompt in prompt.txt and exactly
 * the tools a pass needs: reading the calendar, reading mail, reading the one
 * transcript file of messages, and Skippy OS's ingestion tools. Every other
 * tool is refused by the program itself, whatever the session reads.
 *
 * If the session ends without having closed its run in Skippy OS, this says
 * so to Skippy OS, so a pass that could not reach its tools is not silent. When
 * the Skippy OS connector is missing, it says that, and how to fix it.
 *
 *   node tools/ingest/pass.mjs [pass label]
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const here = dirname(fileURLToPath(import.meta.url));
const home = homedir();
const LIMIT_MS = 25 * 60_000;

const SKIPPY = "mcp__claude_ai_Skippy_OS__";
const TOOLS = [
  "Skill",
  `Read(/${home}/.skippy-os/imessage/**)`,
  ...["list_calendars", "list_events"].map((name) => `mcp__claude_ai_Google_Calendar__${name}`),
  ...["search_threads", "get_thread"].map((name) => `mcp__claude_ai_Gmail__${name}`),
  ...[
    "get_skill",
    "get_importance_rubric",
    "record_ingestion_run",
    "sync_calendar",
    "ingest_objects",
    "advance_source_cursor",
    "get_agenda",
    "search",
    "get_today",
    "record_briefing",
    "flag_for_owner",
    "upsert_person",
  ].map((name) => SKIPPY + name),
];

/** "9am", "1pm": the hour on this Mac's clock. */
function hourLabel() {
  const hour = new Date().getHours();
  return `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? "am" : "pm"}`;
}

const pass = process.argv[2] || hourLabel();
const prompt = readFileSync(join(here, "prompt.txt"), "utf8").replaceAll("{{HOME}}", home).replaceAll("{{PASS}}", pass);
const workspace = join(home, ".skippy-os", "ingest");
mkdirSync(workspace, { recursive: true });
const log = (...parts) => console.log(new Date().toISOString(), `[${pass}]`, ...parts);

async function reportFailure(reason) {
  log("failed:", reason);
  const file = join(home, ".skippy-os", "runner.env");
  if (!existsSync(file)) return log("no runner.env, so the failure could not be recorded in Skippy OS");
  const values = Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
  );
  try {
    await new ConvexHttpClient(values.CONVEX_URL).mutation(anyApi.runner.ingestFailed, {
      token: values.RUNNER_TOKEN,
      host: hostname(),
      pass,
      reason,
    });
  } catch (error) {
    log("could not record the failure:", error.message);
  }
}

const child = spawn(
  process.env.SKIPPY_CLAUDE_BIN || "claude",
  ["-p", prompt, "--allowedTools", ...TOOLS, "--output-format", "stream-json", "--verbose"],
  { cwd: workspace, stdio: ["ignore", "pipe", "pipe"] },
);
// The whole session, kept until the next pass, for looking into one that went wrong.
const transcript = createWriteStream(join(workspace, "last-pass.jsonl"), { mode: 0o600 });
child.stdout.pipe(transcript);

/**
 * After a pass that never closed its run: is the Skippy OS connector there at
 * all? Twice, Claude Code's sign-in on this Mac lost its access to claude.ai
 * connectors overnight, and signing in again brought them back. A headless
 * session connects them in the background after it starts, so its opening
 * report cannot tell; `claude mcp list` waits for them. Returns the cause in
 * words, or nothing when the connector is there or the check itself failed.
 */
function connectorCause() {
  const listed = spawnSync(process.env.SKIPPY_CLAUDE_BIN || "claude", ["mcp", "list"], { encoding: "utf8", timeout: 120_000 });
  if (listed.status !== 0 || !listed.stdout) return undefined;
  const lines = listed.stdout.split("\n");
  if (!lines.some((line) => line.startsWith("claude.ai "))) {
    return "Claude Code on the Mac mini has no claude.ai connectors, so the pass had no Skippy OS tools and read nothing. Its sign-in has most likely lost connector access. Fix: in Terminal on the mini, run claude auth login.";
  }
  const skippy = lines.find((line) => line.startsWith("claude.ai Skippy OS:"));
  if (!skippy) return "The Skippy OS connector is not among Claude Code's claude.ai connectors on the Mac mini, so the pass read nothing.";
  if (!/Connected/.test(skippy)) return `The Skippy OS connector did not connect on the Mac mini (${skippy.split(" - ").pop().slice(0, 120)}), so the pass read nothing.`;
  return undefined;
}

let buffered = "";
let closed; // how the session closed its run in Skippy OS, if it did
let made = 0;
let result;
let stderr = "";
const pending = new Map(); // tool call id → the status it asked record_ingestion_run for
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
      if (block.type === "tool_use" && block.name === `${SKIPPY}record_ingestion_run` && block.input?.status !== "started") {
        pending.set(block.id, block.input.status);
      }
      if (block.type === "tool_result" && pending.has(block.tool_use_id) && !block.is_error) {
        closed = pending.get(block.tool_use_id);
        const text = JSON.stringify(block.content ?? "");
        const count = /\\?"made\\?":\s*(\d+)/.exec(text);
        if (count) made = Number(count[1]);
      }
    }
    if (event.type === "result") result = event;
  }
});
child.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk.toString("utf8")).slice(-1500);
});
const timer = setTimeout(() => {
  log("ran too long; stopping it");
  child.kill("SIGTERM");
}, LIMIT_MS);

child.on("close", async (code) => {
  clearTimeout(timer);
  if (closed === "finished") {
    log(`done: made ${made} record${made === 1 ? "" : "s"}`);
  } else if (closed === "failed") {
    log("the pass recorded itself as failed");
  } else {
    const cause = connectorCause();
    if (cause) {
      await reportFailure(cause);
      process.exit(1);
    }
    // Its own last words say why it stopped. They are the session's account, kept short.
    const said = String(result?.result ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
    await reportFailure(
      said
        ? `The pass ended without recording a run. Its last words: ${said}`
        : `The session stopped before it could record a run${stderr.trim() ? `: ${stderr.trim().split("\n").pop().slice(0, 300)}` : ` (exit ${code}).`}`,
    );
  }
  process.exit(closed === "finished" ? 0 : 1);
});
