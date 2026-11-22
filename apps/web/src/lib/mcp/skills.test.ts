import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SKILLS } from "./skills.generated";

const skillsDir = resolve(import.meta.dirname, "../../../../../plugin/skills");
const body = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n+/, "").trimEnd() + "\n";

describe("the skill text the MCP serves", () => {
  it("matches the plugin's skills; run node scripts/sync-skills.mjs if this fails", () => {
    const names = readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(Object.keys(SKILLS).sort()).toEqual(names);
    for (const name of names) {
      const source = readFileSync(resolve(skillsDir, name, "SKILL.md"), "utf8");
      expect(SKILLS[name as keyof typeof SKILLS]).toBe(body(source));
    }
  });
});
