#!/usr/bin/env node
/**
 * The chat runner. It runs on the mini and does one thing: when the owner
 * sends a message in a dashboard chat, it runs that chat's Claude Code session
 * and writes the reply back as it comes.
 *
 * One loop: say "alive", claim the oldest waiting turn, run it, finish it.
 * While a turn runs it keeps renewing its lease; if this process dies, the
 * lease runs out and Skippy OS marks the turn failed, so a chat is never left
 * looking busy.
 *
 * Needs ~/.skippy-os/runner.env with two lines:
 *   CONVEX_URL=https://<deployment>.convex.cloud
 *   RUNNER_TOKEN=<the runner's secret>
 *
 * Run it by hand with `node tools/chat-runner/runner.mjs`, or install it as a
 * background job with tools/chat-runner/install.sh.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const VERSION = "2";
const HEARTBEAT_MS = 30_000;
const IDLE_POLL_MS = 2_000;
const REPORT_MS = 800;
/** The lease is two minutes; a report at least this often keeps it. */
const KEEPALIVE_MS = 40_000;
/** A session that prints nothing for this long is taken to be stuck. */
const STALL_MS = 5 * 60_000;
const TURN_LIMIT_MS = 20 * 60_000;

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

function readConfig() {
  const file = join(homedir(), ".skippy-os", "runner.env");
  if (!existsSync(file)) throw new Error(`${file} is missing. See docs/chat-runner.md.`);
  const values = Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  if (!values.CONVEX_URL || !values.RUNNER_TOKEN) throw new Error(`${file} needs CONVEX_URL and RUNNER_TOKEN.`);
  return values;
}

const config = readConfig();
const convex = new ConvexHttpClient(config.CONVEX_URL);
const identity = { token: config.RUNNER_TOKEN, host: hostname() };
const call = (name, args = {}) => convex.mutation(anyApi.runner[name], { ...identity, ...args });
const claudeBinary = process.env.SKIPPY_CLAUDE_BIN || "claude";
const scratch = join(homedir(), ".skippy-os", "chat-workspace");
mkdirSync(scratch, { recursive: true });

/** What the session is told on top of the owner's message. */
function instructions(turn) {
  const about =
    turn.scope.kind === "item" && turn.scope.record
      ? `This chat is about the ${turn.scope.record.type} "${turn.scope.record.title}" (id ${turn.scope.record.id}). Read it first, with get_project for a project or get_context_bundle for anything else, so you know where it stands.`
      : "This is an idea chat: the owner is thinking something through. Help them think, ask what you need to know, and say when something sounds like it should become a task, a project, an event or a note.";
  return [
    "You are Skippy, talking with the owner of Skippy OS inside their dashboard.",
    about,
    'Their records (projects, tasks, people, what is worth remembering, the agenda) are reached through the tools of the connector named "Skippy OS". Never use the older connector named just "Skippy".',
    `When something in the conversation should become a record (a task, an event, a project, a note, a person, something that recurs), offer it with propose_promotion, passing chatId "${turn.chatId}". It shows as a card under your reply that the owner can edit, accept or ignore. Do not create the record yourself, and do not ask whether to offer a card: offer it and say in a few words what you offered. For a new project, offer the project card and its first tasks together; leave the tasks' project empty and they will join it.`,
    "Before you change or complete a record that already exists, say what you would do and wait for the owner to agree. When you have changed something, say what in one line.",
    "Write plain text: short paragraphs, and lines starting with a hyphen for a list. No headings, bold, tables or code blocks; the page shows your words exactly as you write them. Keep replies short.",
    turn.folder
      ? "You are in the project's code folder and may read its files to answer questions. You cannot change files or run commands here; code changes happen in a Claude Code session."
      : "You cannot read files or run commands here.",
  ].join("\n");
}

/** What a tool call looks like to the owner while they wait. */
function describeTool(name) {
  const short = name.replace(/^mcp__claude_ai_Skippy_OS__/, "");
  if (short !== name) return `Using Skippy: ${short.replaceAll("_", " ")}`;
  if (name === "WebSearch") return "Searching the web";
  if (name === "Read" || name === "Grep" || name === "Glob") return "Reading the project's files";
  return `Using ${name}`;
}

function runTurn(turn) {
  return new Promise((resolve) => {
    const folder = turn.folder && existsSync(turn.folder) ? turn.folder : undefined;
    const tools = ["mcp__claude_ai_Skippy_OS", "WebSearch", ...(folder ? ["Read", "Grep", "Glob"] : [])];
    const args = [
      "-p",
      turn.text,
      "--output-format",
      "stream-json",
      "--verbose",
      "--append-system-prompt",
      instructions({ ...turn, folder }),
      ...(turn.resume ? ["--resume", turn.sessionId] : ["--session-id", turn.sessionId]),
      "--allowedTools",
      ...tools,
      "--disallowedTools",
      "Bash",
      "Edit",
      "Write",
      "NotebookEdit",
    ];
    const child = spawn(claudeBinary, args, { cwd: folder ?? scratch, stdio: ["ignore", "pipe", "pipe"] });

    const paragraphs = [];
    let activity = "Thinking";
    let sessionStarted = turn.resume;
    let result;
    let stderr = "";
    let buffered = "";
    let lastOutput = Date.now();
    let lastReport = 0;
    let dirty = true;
    let stopped = false;
    let reporting = false;
    const text = () => paragraphs.join("\n\n");

    const stop = (why) => {
      if (stopped) return;
      stopped = true;
      log("stopping turn", turn.turnId, why);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    };

    const report = async () => {
      if (reporting || stopped) return;
      const due = dirty ? Date.now() - lastReport >= REPORT_MS : Date.now() - lastReport >= KEEPALIVE_MS;
      if (!due) return;
      reporting = true;
      dirty = false;
      lastReport = Date.now();
      try {
        const answer = await call("progress", { turnId: turn.turnId, text: text(), activity });
        // The owner cancelled, or the lease was lost: there is no one to write for.
        if (answer?.stop) stop("no longer wanted");
      } catch (error) {
        log("progress failed", error.message);
      } finally {
        reporting = false;
      }
    };
    const ticker = setInterval(() => {
      if (Date.now() - lastOutput > STALL_MS) stop("printed nothing for too long");
      void report();
    }, 400);
    const limit = setTimeout(() => stop("ran too long"), TURN_LIMIT_MS);

    child.stdout.on("data", (chunk) => {
      lastOutput = Date.now();
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
        if (event.type === "system" && event.subtype === "init") sessionStarted = true;
        if (event.type === "assistant") {
          for (const block of event.message?.content ?? []) {
            if (block.type === "text" && block.text.trim()) {
              paragraphs.push(block.text.trim());
              activity = "Writing";
            }
            if (block.type === "tool_use") activity = describeTool(block.name);
          }
          dirty = true;
        }
        if (event.type === "result") result = event;
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-2000);
    });
    child.on("error", (error) => {
      stderr += `\n${error.message}`;
    });
    child.on("close", (code) => {
      clearInterval(ticker);
      clearTimeout(limit);
      const ok = result && !result.is_error && code === 0 && !stopped;
      const reply = text() || (ok ? String(result.result ?? "").trim() : "");
      resolve({
        ok: Boolean(ok),
        text: reply,
        sessionStarted,
        // What to try again as, when the session's own state disagreed with ours.
        retryAs: /No conversation found/i.test(stderr + (result?.result ?? "")) ? "new" : /already in use/i.test(stderr) ? "resume" : undefined,
        error: stopped
          ? "The reply was stopped before it finished."
          : result?.is_error
            ? `The session ended with an error: ${String(result.result ?? "").slice(0, 300)}`
            : `The session stopped unexpectedly${stderr.trim() ? `: ${stderr.trim().split("\n").pop().slice(0, 300)}` : "."}`,
      });
    });
  });
}

async function work(turn) {
  log("turn", turn.turnId, turn.resume ? "resuming" : "starting", "session", turn.sessionId);
  let outcome = await runTurn(turn);
  if (!outcome.ok && outcome.retryAs && !outcome.text) {
    log("retrying turn as", outcome.retryAs);
    outcome = await runTurn({ ...turn, resume: outcome.retryAs === "resume" });
  }
  await call("finish", {
    turnId: turn.turnId,
    status: outcome.ok ? "done" : "failed",
    text: outcome.text,
    ...(outcome.ok ? {} : { error: outcome.error }),
    sessionStarted: outcome.sessionStarted,
  });
  log("turn", turn.turnId, outcome.ok ? "done" : `failed: ${outcome.error}`);
}

let running = true;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => (running = false));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

log("chat runner", VERSION, "on", identity.host, "talking to", new URL(config.CONVEX_URL).host);
let lastBeat = 0;
while (running) {
  try {
    if (Date.now() - lastBeat >= HEARTBEAT_MS) {
      await call("heartbeat", { version: VERSION });
      lastBeat = Date.now();
    }
    const turn = await call("claim");
    if (turn) {
      // Keep saying "alive" while a long turn runs.
      const beat = setInterval(() => call("heartbeat", { version: VERSION }).catch(() => {}), HEARTBEAT_MS);
      try {
        await work(turn);
      } finally {
        clearInterval(beat);
      }
      continue;
    }
  } catch (error) {
    log("loop error:", error.message);
    await pause(10_000);
  }
  await pause(IDLE_POLL_MS);
}
log("chat runner stopped");
