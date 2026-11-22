#!/usr/bin/env node
/**
 * The build Vercel runs (see apps/web/vercel.json).
 *
 * A production build ships the site and Convex together, so the two cannot
 * drift apart:
 *   1. run the tests
 *   2. build the web app
 *   3. push the Convex functions and schema
 * A failure at any step fails the build. The site stays as it was, and Convex
 * is only touched by the last step.
 *
 * Any other build (a preview, or a run on your own machine) builds the web app
 * and leaves Convex alone.
 *
 * Production needs CONVEX_DEPLOY_KEY: a production deploy key from the Convex
 * dashboard, set in Vercel for the Production environment only.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `convex deploy` hands the address it is about to push to the web build under this name. */
const PUSH_TARGET = "SKIPPY_CONVEX_PUSH_TARGET";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) fail(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function fail(message) {
  console.error(`\nBuild stopped: ${message}\n`);
  process.exit(1);
}

function step(message) {
  console.log(`\n== ${message}`);
}

const sameAddress = (a, b) => a.trim().replace(/\/+$/, "").toLowerCase() === b.trim().replace(/\/+$/, "").toLowerCase();

function buildWeb() {
  step("Building the web app");
  run("pnpm", ["--filter", "@skippy/web", "build"]);
}

/** Runs inside `convex deploy`, before anything is pushed. */
function buildWebForPush() {
  const target = process.env[PUSH_TARGET];
  const used = process.env.CONVEX_URL;
  if (!target) fail(`${PUSH_TARGET} is not set. This step is meant to be run by convex deploy.`);
  if (!used) fail("CONVEX_URL is not set, so the site would not know which Convex deployment to read.");
  if (!sameAddress(target, used)) {
    fail(
      `CONVEX_DEPLOY_KEY belongs to ${target}, but the site reads from ${used}. ` +
        "Pushing would update one deployment while the site uses another. " +
        "Make the deploy key and CONVEX_URL point at the same deployment.",
    );
  }
  buildWeb();
}

function buildProduction() {
  if (!process.env.CONVEX_DEPLOY_KEY) {
    fail(
      "CONVEX_DEPLOY_KEY is not set. Create a production deploy key in the Convex dashboard " +
        "and add it to this Vercel project for the Production environment.",
    );
  }
  step("Running the tests");
  run("pnpm", ["test"]);
  step("Building the web app, then pushing Convex");
  run("pnpm", [
    "exec",
    "convex",
    "deploy",
    "--typecheck",
    "enable",
    "--cmd",
    "node scripts/vercel-build.mjs web",
    "--cmd-url-env-var-name",
    PUSH_TARGET,
  ]);
}

if (process.argv[2] === "web") {
  buildWebForPush();
} else if (process.env.VERCEL_ENV === "production") {
  buildProduction();
} else {
  console.log("Not a production build: building the web app only. Convex is left alone.");
  buildWeb();
}
