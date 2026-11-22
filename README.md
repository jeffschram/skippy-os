# skippy-os

Skippy Operating System powered by AI and love.

The plan lives in [docs/skippy-os-spec-alt.html](docs/skippy-os-spec-alt.html). The build is in **Phase 1: Foundation**. The account setup and the client acceptance run are in [docs/phase-0-setup.md](docs/phase-0-setup.md).

## Layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js app. Holds the Skippy MCP endpoint at `/api/mcp` and, later, the dashboard. |
| `convex` | Convex functions and schema: the single shared record. |
| `packages/shared` | Code both sides use: OAuth scopes and the signed gateway envelope. |
| `docs` | The spec and the static mockups. |

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

This needs `CONVEX_DEPLOY_KEY` set in Vercel; see [docs/phase-0-setup.md](docs/phase-0-setup.md). One-off Convex jobs, such as `npx convex run --prod maintenance:reindexSearch`, are still run by hand.
