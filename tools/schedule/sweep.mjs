#!/usr/bin/env node
/**
 * The nightly sweep. For each active code project it looks at the commits in
 * the project's folder. Where there are commits newer than the project's last
 * status report, a session did the work and did not report it, so this has a
 * Claude Code session write the report from the commits, signed as the sweep.
 *
 * A project is never reported twice for the same commits: once a report is
 * written it is newer than they are, and each project keeps the time it was
 * swept up to.
 *
 *   node tools/schedule/sweep.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerClient, runSession, SKIPPY, skippyTools } from "../lib/session.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const work = join(homedir(), ".skippy-os", "sweep");
const LOOK_BACK_MS = 14 * 86_400_000;
const log = (...parts) => console.log(new Date().toISOString(), ...parts);

/** Commits on any branch since a time, oldest first: when each was made and its first line. */
function commitsSince(folder, sinceMs) {
  const out = execFileSync(
    "git",
    ["-C", folder, "log", "--all", "--no-merges", `--since=@${Math.floor(sinceMs / 1000)}`, "--pretty=format:%ct%x09%s", "-n", "300"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ at: Number(line.slice(0, line.indexOf("\t"))) * 1000, subject: line.slice(line.indexOf("\t") + 1).slice(0, 160) }))
    .sort((a, b) => a.at - b.at);
}

const call = runnerClient();
const template = readFileSync(join(here, "sweep-prompt.txt"), "utf8");
const targets = await call("sweepTargets");
log(`sweeping ${targets.length} code project${targets.length === 1 ? "" : "s"}`);

for (const project of targets) {
  const now = Date.now();
  if (!existsSync(join(project.folder, ".git"))) {
    log(project.slug, "has no git repository at its folder; skipped");
    continue;
  }
  let commits;
  try {
    commits = commitsSince(project.folder, Math.max(project.lastSweptAt ?? 0, now - LOOK_BACK_MS));
  } catch (error) {
    log(project.slug, "git could not be read:", error.message.split("\n")[0]);
    continue;
  }
  // What a session did and did not tell Skippy OS about: commits newer than the last report.
  const unreported = commits.filter((commit) => commit.at > (project.lastReportedAt ?? 0) && commit.at > (project.lastSweptAt ?? 0));
  if (unreported.length === 0) {
    await call("sweepDone", { slug: project.slug, through: now });
    log(project.slug, "nothing unreported");
    continue;
  }
  const lines = unreported.slice(-80).map((commit) => `${new Date(commit.at).toISOString().slice(0, 16).replace("T", " ")}Z  ${commit.subject}`);
  const prompt = template
    .replaceAll("{{SLUG}}", project.slug)
    .replaceAll("{{TITLE}}", project.title)
    .replaceAll("{{COMMITS}}", lines.join("\n"));
  log(project.slug, `${unreported.length} unreported commit${unreported.length === 1 ? "" : "s"}; writing a report`);
  const session = await runSession({
    prompt,
    tools: ["Skill", ...skippyTools("get_skill", "get_project", "record_project_status")],
    cwd: work,
    transcript: join(work, `last-${project.slug}.jsonl`),
    limitMs: 10 * 60_000,
  });
  if (session.did(`${SKIPPY}record_project_status`)) {
    await call("sweepDone", { slug: project.slug, through: unreported.at(-1).at + 1 });
    log(project.slug, "reported");
  } else {
    // Left unswept, so tomorrow's sweep tries again.
    log(project.slug, "no report was recorded:", session.said.slice(0, 300) || session.stderr.split("\n").pop() || `exit ${session.code}`);
  }
}
log("sweep finished");
