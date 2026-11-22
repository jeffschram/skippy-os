#!/usr/bin/env node
/**
 * Copies the text of each skill in plugin/skills into the web app, so the MCP
 * tool get_skill can hand it to a client that has no plugin loaded.
 *
 * Run it after changing a SKILL.md:  node scripts/sync-skills.mjs
 * A test fails when the copy is out of date.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = resolve(root, "plugin/skills");
const target = resolve(root, "apps/web/src/lib/mcp/skills.generated.ts");

/** The instructions: everything after the frontmatter. */
const body = (text) => text.replace(/^---\n[\s\S]*?\n---\n+/, "").trimEnd() + "\n";

const names = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const lines = names.map(
  (name) => `  ${JSON.stringify(name)}: ${JSON.stringify(body(readFileSync(resolve(skillsDir, name, "SKILL.md"), "utf8")))},`,
);

writeFileSync(
  target,
  [
    "// Generated from plugin/skills by scripts/sync-skills.mjs. Do not edit by hand.",
    "export const SKILLS = {",
    ...lines,
    "} as const;",
    "",
    "export type SkillName = keyof typeof SKILLS;",
    "",
  ].join("\n"),
);
console.log(`Wrote ${names.length} skills to ${target}`);
