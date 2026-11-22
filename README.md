# skippy-os

Skippy Operating System powered by AI and love.

The plan lives in [docs/skippy-os-spec-alt.html](docs/skippy-os-spec-alt.html). The build is in **Phase 1: Foundation**. The account setup and the client acceptance run are in [docs/phase-0-setup.md](docs/phase-0-setup.md).

## Layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js app. Holds the Skippy MCP endpoint at `/api/mcp` and the dashboard, which only the owner can open. |
| `convex` | Convex functions and schema: the single shared record. Agents reach it through the signed gateway; the dashboard reads it as the signed-in owner. |
| `packages/shared` | Code both sides use: OAuth scopes and the signed gateway envelope. |
| `docs` | The spec and the static mockups. |
| `plugin` | The Skippy plugin for Claude: the skills that tell Claude when to report project status and how to file things. `.claude-plugin/marketplace.json` lets Claude Code install it from this repo. |

## Commands

Requires Node 22.18 or later and pnpm.

| Command | What it does |
| --- | --- |
| `pnpm install` | Install everything. |
| `pnpm dev:convex` | Run Convex and push functions as they change. |
| `pnpm dev` | Run the web app at http://localhost:3000. |
| `pnpm check` | Type checks, tests and lint. |
| `pnpm build` | Production build of the web app. |

To run Convex on this machine with no Convex account: `CONVEX_AGENT_MODE=anonymous pnpm dev:convex`.

## Deploying

A push to `main` deploys everything. Vercel runs [scripts/vercel-build.mjs](scripts/vercel-build.mjs), which runs the tests, builds the web app and then pushes the Convex functions and schema to production. If any step fails, the site and Convex both stay as they were.

After changing a skill in `plugin/skills`, run `node scripts/sync-skills.mjs`. It copies the text into the web app for the `get_skill` tool, and a test fails when the copy is out of date.

This needs `CONVEX_DEPLOY_KEY` set in Vercel; see [docs/phase-0-setup.md](docs/phase-0-setup.md). One-off Convex jobs, such as `npx convex run --prod maintenance:reindexSearch`, are still run by hand.
