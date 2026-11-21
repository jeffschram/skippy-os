# Phase 0 setup: the OAuth test

Phase 0 proves that an MCP client can sign in to the Skippy MCP with OAuth and make one read and one write. The code for it is in the repo. What is left needs accounts, which only the owner can create.

## Where the accounts stand (2026-11-21)

All three accounts exist and are configured, and the hosted site has every setting it needs. The first client, claude.ai, has signed in, written and read.

| Service | What exists | State |
| --- | --- | --- |
| Convex | Project `skippy-os` in team `schram-industries`. Dev deployment `tame-toad-217`, production deployment `elated-meerkat-158`. | Functions pushed to both. Gateway secret and MCP address set on both. Owner ID set on both. |
| Vercel | Project `skippy-os`, building from `main` on GitHub. Root directory `apps/web`. | Live at `skippy-os-two.vercel.app` (`skippy-os.vercel.app` belongs to someone else). Production variables set: `SKIPPY_MCP_RESOURCE_URL`, `CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_TELEMETRY_DISABLED`, `CLERK_SECRET_KEY`, `SKIPPY_GATEWAY_SECRET`. A made-up token is refused with `401 invalid_token`. |
| Clerk | Application "Skippy OS", development instance. | MCP server `https://skippy-os-two.vercel.app/api/mcp` registered. Public (CIMD) clients allowed. DCR off. Scopes `skippy:read` and `skippy:write` created, advertised, and allowed and default for self-registering clients. JWT access tokens with audience, PKCE required. One user, the owner. |

The hosted MCP address is `https://skippy-os-two.vercel.app/api/mcp`. Renaming the Vercel address later means registering the new address in Clerk and reconnecting every client.

### What is left before the first test

Nothing. The owner signed in through the claude.ai connector, and that user's ID is set as `SKIPPY_OWNER_CLERK_USER_ID` on both Convex deployments.

### Decisions still open

- **DCR** is off. Clerk marks it deprecated and it opens a public registration endpoint. Turn it on only if a client in the acceptance run cannot connect without it, and record which client.
- **Sign-ups** are open on the Clerk instance. Convex refuses every account but the owner, but closing sign-ups after the owner exists (Clerk, Access mode) is tidier.
- **Clerk production instance** needs a domain the owner controls, so it cannot use a `vercel.app` address. The development instance is enough for Phase 0.

## What already works without any account

Checked on the Mac mini on 2026-11-21, with Convex running locally:

- The Convex gateway accepts a correctly signed call, and refuses a replayed one, a read-only caller trying to write, and an account that is not the owner.
- `/api/mcp` answers a request with no token with `401` and a pointer to the sign-in metadata, and a made-up token with `401 invalid_token`.
- The metadata routes name the full MCP URL as the OAuth resource and list both scopes.

Not checked yet, because it needs a real Clerk instance: a real sign-in, a real access token, and every client in the acceptance run.

## Step 1: Clerk (enough to test from Claude Code on the mini)

Clerk allows `http://localhost:3000/...` as an MCP endpoint on a development instance, so the first full pass needs only Clerk. The names below come from Clerk's documentation in November 2026 and may differ slightly in the dashboard.

1. Create a new Clerk application for Skippy OS. Do not reuse the old project's instance.
2. Under **Agents → MCP servers**, add the MCP endpoint `http://localhost:3000/api/mcp`. Clerk turns on the `aud` claim in access tokens when the first MCP server is added.
3. On the **OAuth applications** page:
   - Turn on client ID metadata documents ("Allow public clients to connect").
   - Turn on dynamic client registration, for clients that still need it.
   - On the **Scopes** tab, create two custom scopes: `skippy:read` and `skippy:write`.
   - Make both the default scopes for dynamic clients.
   - Leave the access token format as JWT and the consent screen on.
4. Copy the publishable key and the secret key from **API keys** into `apps/web/.env.local` (start from `apps/web/.env.example`).
5. Sign in once to create your user, then copy your user ID (it starts with `user_`) from the **Users** page.
6. Tell Convex who the owner is:

   ```bash
   npx convex env set SKIPPY_OWNER_CLERK_USER_ID user_...
   ```

Then run `pnpm dev:convex` and `pnpm dev`, and add `http://localhost:3000/api/mcp` to Claude Code as an MCP server.

The main risk this step tests: whether Clerk grants the two custom scopes to a client that registered itself. If it does not, stop and decide before going further (spec §11, Phase 0).

## Step 2: Convex and Vercel (needed for claude.ai, iOS, Claude desktop and ChatGPT)

Those clients connect from the internet, so they need the public address.

1. Create a Convex project and deploy to it. Set the same three values there as locally: `SKIPPY_GATEWAY_SECRET`, `SKIPPY_OWNER_CLERK_USER_ID` and `SKIPPY_MCP_RESOURCE_URL`.
2. Create a Vercel project from this repo with `apps/web` as its root directory. Set the variables from `apps/web/.env.example`, with `SKIPPY_MCP_RESOURCE_URL` set to `https://<project>.vercel.app/api/mcp`. Use the stable production address, never a per-deploy preview address.
3. In Clerk, add that same URL as an MCP server.

## Settings

| Name | Where | What it is |
| --- | --- | --- |
| `SKIPPY_MCP_RESOURCE_URL` | Web app and Convex | The MCP endpoint's public URL. Must be identical in both, and in Clerk. |
| `SKIPPY_GATEWAY_SECRET` | Web app and Convex | Signs calls from the MCP endpoint to Convex. At least 32 characters. |
| `SKIPPY_OWNER_CLERK_USER_ID` | Convex | The one Clerk user allowed in. Anyone else is refused, never created. |
| `CONVEX_URL` | Web app | The Convex deployment's address. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Web app | Clerk API keys. |

## The acceptance run

For each client: discovery → sign-in and consent → `whoami` → `capture` → `whoami` again to read it back → token refresh → reconnect. Record which registration mode the client used.

| Client | Needs | Result |
| --- | --- | --- |
| Claude Code | Step 1 | not run |
| claude.ai connector, then Claude iOS | Step 2 | claude.ai passed discovery, sign-in and consent, `capture`, and `whoami` reading it back (2026-11-21). It registered itself by CIMD and was granted `offline_access`, `skippy:read` and `skippy:write`. The capture is stored in Convex production with the owner and Claude's client ID recorded. Token refresh and reconnect not checked yet (access tokens last a day). Claude iOS not run. |
| Claude desktop | Step 2 | not run |
| ChatGPT | Step 2 | not run |
| Codex | Step 1 | not run |

Negative checks, each of which must fail: an expired token, a token for another audience, a read-only consent attempting `capture`, and a Clerk account that is not the owner.
