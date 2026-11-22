#!/usr/bin/env node
/**
 * The weekly review. Once a week a Claude Code session reads the week in
 * Skippy OS and writes the owner a short review: what moved, what has gone
 * quiet, what is overdue, and how the goals stand. It reads, and saves the
 * review; it changes nothing else.
 *
 *   node tools/schedule/review.mjs
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSession, SKIPPY, skippyTools } from "../lib/session.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const work = join(homedir(), ".skippy-os", "review");
const log = (...parts) => console.log(new Date().toISOString(), ...parts);

const session = await runSession({
  prompt: readFileSync(join(here, "review-prompt.txt"), "utf8"),
  tools: [
    "Skill",
    ...skippyTools("get_skill", "list_projects", "get_project", "get_changes_since", "get_today", "get_agenda", "list_goals", "search", "record_briefing"),
  ],
  cwd: work,
  transcript: join(work, "last-review.jsonl"),
});
if (session.did(`${SKIPPY}record_briefing`)) {
  log("weekly review written");
} else {
  log("no review was saved:", session.said.slice(0, 300) || session.stderr.split("\n").pop() || `exit ${session.code}`);
  process.exitCode = 1;
}
