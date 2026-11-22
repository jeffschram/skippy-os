/**
 * The one-time import from the old project (spec §10).
 *
 *   node scripts/import-v1/run.ts --snapshot <dir>                      dry run: counts only, writes nothing
 *   node scripts/import-v1/run.ts --snapshot <dir> --write --target dev  load into the dev deployment
 *   node scripts/import-v1/run.ts --snapshot <dir> --write --target prod load into production
 *   node scripts/import-v1/run.ts --snapshot <dir> --spot-check --target dev
 *
 * <dir> is an unzipped `npx convex export` of the old deployment. It holds
 * real personal data: keep it, and the reports this writes beside it, outside
 * the repo.
 *
 * A run can be repeated. Records already loaded are counted as "already" and
 * left alone.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LOAD_ORDER, transform, unbalanced, type BatchName, type OldDoc, type Plan, type Snapshot } from "./transform.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type Target = "dev" | "prod";
type Outcome = {
  imported: number;
  already: number;
  merged: number;
  skipped: { oldId: string; reason: string }[];
  notes: { oldId: string; note: string }[];
};

function fail(message: string): never {
  console.error(`\nStopped: ${message}\n`);
  process.exit(1);
}

function options() {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const snapshot = value("--snapshot");
  if (!snapshot) fail("give the unzipped snapshot folder with --snapshot <dir>.");
  const target = value("--target");
  if (target !== undefined && target !== "dev" && target !== "prod") fail("--target must be dev or prod.");
  const write = args.includes("--write");
  const spotCheck = args.includes("--spot-check");
  if ((write || spotCheck) && !target) fail("say where with --target dev or --target prod.");
  return { snapshot: resolve(snapshot), target: target as Target | undefined, write, spotCheck };
}

function readSnapshot(dir: string): Snapshot {
  if (!existsSync(dir)) fail(`there is no folder at ${dir}.`);
  const snapshot: Snapshot = {};
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, "documents.jsonl");
    // Folders starting with "_" are Convex's own (stored files, table list), not data tables.
    if (name.startsWith("_") || !existsSync(file)) continue;
    snapshot[name] = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as OldDoc);
  }
  if (Object.keys(snapshot).length === 0) fail(`${dir} does not look like an unzipped Convex export.`);
  return snapshot;
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, count) => total + count, 0);

function printPlan(plan: Plan) {
  const rows = Object.entries(plan.report).filter(([, row]) => row.exported > 0);
  const inPlan = rows.filter(([, row]) => row.toImport > 0 || sum(row.deferred) > 0);
  const leftBehind = rows.filter(([, row]) => row.toImport === 0 && sum(row.deferred) === 0);

  console.log("\nTables with something to bring across");
  console.log(`${"table".padEnd(22)}${"exported".padStart(9)}${"import".padStart(9)}${"later".padStart(8)}${"skip".padStart(8)}`);
  for (const [name, row] of inPlan) {
    console.log(
      `${name.padEnd(22)}${String(row.exported).padStart(9)}${String(row.toImport).padStart(9)}` +
        `${String(sum(row.deferred)).padStart(8)}${String(sum(row.skipped)).padStart(8)}`,
    );
    for (const [reason, count] of Object.entries(row.deferred)) console.log(`    later ${count}: ${reason}`);
    for (const [reason, count] of Object.entries(row.skipped)) console.log(`    skip  ${count}: ${reason}`);
  }

  console.log("\nTables left behind entirely");
  const byReason = new Map<string, string[]>();
  for (const [name, row] of leftBehind) {
    for (const reason of Object.keys(row.skipped)) {
      byReason.set(reason, [...(byReason.get(reason) ?? []), `${name} (${row.exported})`]);
    }
  }
  for (const [reason, names] of byReason) console.log(`  ${reason}: ${names.join(", ")}`);

  console.log("\nNotes");
  for (const [what, count] of Object.entries(plan.notes)) console.log(`  ${count}  ${what}`);

  console.log("\nTo load, in order");
  for (const name of LOAD_ORDER) console.log(`  ${name.padEnd(12)} ${plan.batches[name].length}`);
}

/** Runs one internal Convex function through the CLI, which is signed in as the owner. */
function convexRun(target: Target, fn: string, args: unknown): unknown {
  const result = spawnSync(
    "npx",
    ["convex", "run", `importV1:${fn}`, JSON.stringify(args), ...(target === "prod" ? ["--prod"] : [])],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) fail(`importV1:${fn} failed.\n${result.stderr || result.stdout}`);
  // A function that returns nothing prints nothing.
  if (result.stdout.trim() === "") return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return fail(`importV1:${fn} gave an answer that could not be read:\n${result.stdout.slice(0, 500)}`);
  }
}

/** Splits a batch so each call stays well inside the command line's size limit. */
function chunks(records: Record<string, unknown>[], maxRecords = 100, maxBytes = 150_000) {
  const out: Record<string, unknown>[][] = [];
  let current: Record<string, unknown>[] = [];
  let bytes = 0;
  for (const record of records) {
    const size = Buffer.byteLength(JSON.stringify(record));
    if (current.length > 0 && (current.length >= maxRecords || bytes + size > maxBytes)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(record);
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** A note with the particular value taken out, so notes of one kind can be counted together. */
const kindOf = (note: string) => note.replace(/"[^"]*"/g, "“…”");

function tally(items: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item] = (counts[item] ?? 0) + 1;
  return counts;
}

function load(plan: Plan, target: Target, reportFile: string) {
  const totals: Record<string, { sent: number } & Outcome> = {};
  for (const name of LOAD_ORDER) {
    const records = plan.batches[name];
    const total = { sent: records.length, imported: 0, already: 0, merged: 0, skipped: [], notes: [] } as { sent: number } & Outcome;
    totals[name] = total;
    const parts = chunks(records);
    parts.forEach((part, index) => {
      process.stdout.write(`\r${name}: ${index + 1} of ${parts.length}   `);
      const outcome = convexRun(target, name, { records: part }) as Outcome;
      total.imported += outcome.imported;
      total.already += outcome.already;
      total.merged += outcome.merged;
      total.skipped.push(...outcome.skipped);
      total.notes.push(...outcome.notes);
    });
    if (parts.length > 0) process.stdout.write("\n");
  }

  console.log(`\nLoaded into ${target}`);
  console.log(`${"batch".padEnd(13)}${"sent".padStart(7)}${"new".padStart(7)}${"already".padStart(9)}${"merged".padStart(8)}${"skipped".padStart(9)}`);
  const wrong: string[] = [];
  for (const name of LOAD_ORDER) {
    const row = totals[name];
    console.log(
      `${name.padEnd(13)}${String(row.sent).padStart(7)}${String(row.imported).padStart(7)}${String(row.already).padStart(9)}` +
        `${String(row.merged).padStart(8)}${String(row.skipped.length).padStart(9)}`,
    );
    for (const [reason, count] of Object.entries(tally(row.skipped.map((item) => item.reason)))) console.log(`    skipped ${count}: ${reason}`);
    for (const [what, count] of Object.entries(tally(row.notes.map((item) => kindOf(item.note))))) console.log(`    note ${count}: ${what}`);
    if (row.imported + row.already + row.merged + row.skipped.length !== row.sent) wrong.push(name);
  }

  const imported = (name: BatchName) => totals[name].imported;
  if (LOAD_ORDER.some((name) => imported(name) > 0)) {
    const parts = (["projects", "tasks", "people", "companies", "goals", "knowledge"] as const)
      .filter((name) => imported(name) > 0)
      .map((name) => `${imported(name)} ${name}`);
    convexRun(target, "finish", { summary: `Imported from the old Skippy: ${parts.join(", ") || "links and sources"}` });
  }

  const inMap = convexRun(target, "status", {}) as Record<string, number>;
  console.log("\nRecords the import map now holds, by old table");
  for (const [name, count] of Object.entries(inMap).sort()) console.log(`  ${name.padEnd(14)} ${count}`);

  writeFileSync(reportFile, JSON.stringify({ target, at: new Date().toISOString(), plan: plan.report, notes: plan.notes, loaded: totals, inMap }, null, 2));
  console.log(`\nFull report, with the id of every skipped record: ${reportFile}`);
  if (wrong.length > 0) fail(`these batches do not add up: ${wrong.join(", ")}.`);
}

/** Old field → new field, for the fields a person would check by eye. */
const CHECKS: Partial<Record<BatchName, { oldTable: string; fields: string[] }>> = {
  projects: { oldTable: "projects", fields: ["title", "summary", "status", "notesPad"] },
  phases: { oldTable: "phases", fields: ["title", "description", "order"] },
  tasks: { oldTable: "tasks", fields: ["title", "description", "status", "commitment", "dueAt", "completedAt"] },
  people: { oldTable: "people", fields: ["name", "roleTitle", "relationshipContext", "notes"] },
  companies: { oldTable: "companies", fields: ["name", "website", "notes"] },
  goals: { oldTable: "goals", fields: ["title", "description", "status"] },
  knowledge: { oldTable: "knowledge", fields: ["kind", "title", "body", "summary", "url", "lifecycle", "whyItMatters"] },
};

/** Ten records of each type, spread evenly through the table, compared with what is now stored. */
function spotCheck(plan: Plan, snapshot: Snapshot, target: Target, file: string) {
  const lines: string[] = [`# Import spot check (${target})`, ""];
  let failures = 0;
  for (const name of LOAD_ORDER) {
    const check = CHECKS[name];
    if (!check) continue;
    const records = plan.batches[name];
    const step = Math.max(1, Math.floor(records.length / 10));
    const sample = records.filter((_, index) => index % step === 0).slice(0, 10);
    const stored = convexRun(target, "lookup", {
      refs: sample.map((record) => ({ table: check.oldTable, id: record.oldId })),
    }) as (Record<string, unknown> | null)[];
    let passed = 0;
    lines.push(`## ${name}`, "");
    sample.forEach((record, index) => {
      const now = stored[index];
      const old = snapshot[check.oldTable].find((doc) => doc._id === record.oldId);
      const differences = now
        ? check.fields.filter((field) => JSON.stringify(record[field]) !== JSON.stringify(now[field]))
        : ["(not found in the new deployment)"];
      if (differences.length === 0) passed++;
      else failures++;
      lines.push(
        `### ${differences.length === 0 ? "matches" : `DIFFERS in ${differences.join(", ")}`}: ${String(record.title ?? record.name ?? record.oldId)}`,
        "",
        "Old record:",
        "```json",
        JSON.stringify(old, null, 2),
        "```",
        "Stored now:",
        "```json",
        JSON.stringify(now, null, 2),
        "```",
        "",
      );
    });
    console.log(`${name.padEnd(12)} ${passed} of ${sample.length} match`);
  }
  writeFileSync(file, lines.join("\n"));
  console.log(`\nSide-by-side records for reading: ${file}`);
  if (failures > 0) fail(`${failures} sampled records differ from what was sent.`);
}

const opts = options();
const snapshot = readSnapshot(opts.snapshot);
const plan = transform(snapshot);
const bad = unbalanced(plan.report);
if (bad.length > 0) fail(`the plan does not account for every record in: ${bad.join(", ")}.`);

const beside = (name: string) => join(dirname(opts.snapshot), name);
if (opts.spotCheck) {
  spotCheck(plan, snapshot, opts.target!, beside(`spot-check-${opts.target}.md`));
} else {
  printPlan(plan);
  if (opts.write) load(plan, opts.target!, beside(`import-report-${opts.target}.json`));
  else console.log("\nDry run: nothing was written. Add --write --target dev (or prod) to load.");
}
