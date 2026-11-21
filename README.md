# skippy-os

Skippy Operating System powered by AI and love.

The plan lives in [docs/skippy-os-spec-alt.html](docs/skippy-os-spec-alt.html). The build is at **Phase 0: the OAuth test**; see [docs/phase-0-setup.md](docs/phase-0-setup.md).

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
