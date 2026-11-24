# Phase 0 setup: the OAuth test

Phase 0 proves that an MCP client can sign in to the Skippy MCP with OAuth and make one read and one write. The code for it is in the repo. What is left needs accounts, which only the owner can create.

## Where the accounts stand (2026-11-21)

All three accounts exist and are configured, and the hosted site has every setting it needs. The first client, claude.ai, has signed in, written and read.

| Service | What exists | State |
| --- | --- | --- |
| Convex | Project `skippy-os` in team `schram-industries`. Dev deployment `tame-toad-217`, production deployment `elated-meerkat-158`. | Functions pushed to both. Gateway secret and MCP address set on both. Owner ID set on both. |
| Vercel | Project `skippy-os`, building from `main` on GitHub. Root directory `apps/web`. | Live at `www.skippyos.app` since 2026-11-22; `skippyos.app` redirects there. The first address, `skippy-os-two.vercel.app`, still serves the site. Production variables set: `SKIPPY_MCP_RESOURCE_URL`, `CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_TELEMETRY_DISABLED`, `CLERK_SECRET_KEY`, `SKIPPY_GATEWAY_SECRET`. A made-up token is refused with `401 invalid_token`. |
| Clerk | Application "Skippy OS". Since 2026-11-22 the live site uses its production instance, whose sign-in server is `https://clerk.skippyos.app`; the development instance serves the local site. How the move went is in `clerk-production.md`. | MCP server `https://www.skippyos.app/api/mcp` registered. Public (CIMD) clients allowed. DCR off. Scopes `skippy:read` and `skippy:write` created, advertised, and allowed and default for self-registering clients. JWT access tokens with audience, PKCE required. Convex integration on, so the web app's session is accepted by Convex. One user, the owner. |

The hosted MCP address is `https://www.skippyos.app/api/mcp`. Until 2026-11-22 it was `https://skippy-os-two.vercel.app/api/mcp`.

## The move to skippyos.app (2026-11-22)

The owner pointed `skippyos.app` at the Vercel project. The site answers at `https://www.skippyos.app`; the bare `skippyos.app` redirects there. Signing in to the site works on the new address with no change, because a Clerk development instance is not tied to one address. Convex does not care which address the browser is on.

One setting names the address: the MCP endpoint's URL, `SKIPPY_MCP_RESOURCE_URL`. It is the OAuth audience, so it has to agree in three places: Clerk, Vercel and Convex. An MCP client does not follow a redirect, so the URL uses `www`, the host that answers directly. Keep `www` as the primary domain in Vercel.

| Step | Who | State |
| --- | --- | --- |
| Convex production accepts both addresses: `SKIPPY_MCP_RESOURCE_URL` is the new one and `SKIPPY_MCP_RESOURCE_URL_PREVIOUS` the old one. Nothing changes for clients. | Claude | done |
| Cloudflare: the DNS records for `skippyos.app` and `www` set to "DNS only" (grey cloud), so requests go straight to Vercel. | Owner | done |
| Clerk: Agents, MCP servers, Add MCP server, `https://www.skippyos.app/api/mcp`. | Owner | done |
| Vercel: `SKIPPY_MCP_RESOURCE_URL` (Production) changed to `https://www.skippyos.app/api/mcp`, and a redeploy. This is the switch: from here the old connector is refused. | Owner | done |
| claude.ai: the Skippy OS connector removed and added again at the new URL under the same name, "Skippy OS", then connected (sign in and consent). The jobs on the mini and the project instructions use that name. | Owner | done |
| A call through the new connector from a fresh session on the mini, then `SKIPPY_MCP_RESOURCE_URL_PREVIOUS` unset in Convex. | Claude | done |
| Clerk: the check re-run on the new MCP server (all green), and the old MCP server, `https://skippy-os-two.vercel.app/api/mcp`, removed. | Owner | done |
| On each device: open the new address, sign in, turn notifications on, and add it to the Home Screen. Turn notifications off in the old Home Screen app before deleting it, or each notification arrives twice. | Owner | reported done; at 5:12pm on 2026-11-22 the only device with notifications on was still the one registered on the old address |

Two things learned on the way:

- Adding a connector in claude.ai and connecting it are two steps. Until it is connected, sessions on the mini get no Skippy OS tools.
- Claude Code on the mini remembers for a while that a connector needed a sign-in (`~/.claude/mcp-needs-auth-cache.json`). A session started just after connecting can still be refused. Removing that connector's entry from the file, or waiting, clears it.

Clerk runs a check when an MCP server is added. Its second test, that the address's metadata names itself, cannot pass until the Vercel change is made, because until then the new address still advertises the old one. Run the check again after the switch.

When the address was first added, both of Clerk's tests failed with "The public HTTPS endpoint could not be reached". The address answered correctly from the mini and from a data centre at that moment, with a valid certificate. The one difference from the old address was Cloudflare's proxy in front of Vercel, which Vercel and Clerk both advise against, so it was turned off, and the first test then passed.

For a later move, avoid the switch at the top of an hour: the ingestion passes, the sweep and the review all use the connector, and one that starts between the Vercel change and the new connector fails and says so on Home.

### What is left before the first test

Nothing. The owner signed in through the claude.ai connector, and that user's ID is set as `SKIPPY_OWNER_CLERK_USER_ID` on both Convex deployments.

### Decisions still open

- **DCR** is off. Clerk marks it deprecated and it opens a public registration endpoint. Turn it on only if a client in the acceptance run cannot connect without it, and record which client.
- **Sign-ups** were still open on the production instance when it went live on 2026-11-22 (Access mode "Open"). Convex refuses every account but the owner, and the web app shows such an account a page with no data, but setting Access mode to "Invite-only" now that the owner exists is tidier. Sign-in is by email; Google is off, because a production instance needs its own Google credentials.
- **Clerk production instance:** done on 2026-11-22, once the site had its own domain. See `clerk-production.md`.

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
2. Create a Vercel project from this repo with `apps/web` as its root directory. Set the variables from `apps/web/.env.example`, with `SKIPPY_MCP_RESOURCE_URL` set to the site's public address followed by `/api/mcp`. Use the host that answers without a redirect, never a per-deploy preview address.
3. In Clerk, add that same URL as an MCP server.
4. So that a push to `main` also deploys Convex: in the Convex dashboard, open the project's production deployment, go to Settings, and generate a production deploy key. In Vercel, add it to the project as `CONVEX_DEPLOY_KEY`, for the Production environment only. The key can change production data, so it goes nowhere else: not in the repo, not in a local file.

## Settings

| Name | Where | What it is |
| --- | --- | --- |
| `SKIPPY_MCP_RESOURCE_URL` | Web app and Convex | The MCP endpoint's public URL. Must be identical in both, and in Clerk. |
| `SKIPPY_MCP_RESOURCE_URL_PREVIOUS` | Convex, only during a move | The address the MCP endpoint is moving from. Convex accepts it as well as the current one. Unset it when the move is done. |
| `SKIPPY_GATEWAY_SECRET` | Web app and Convex | Signs calls from the MCP endpoint to Convex. At least 32 characters. |
| `SKIPPY_OWNER_CLERK_USER_ID` | Convex | The one Clerk user allowed in. Anyone else is refused, never created. |
| `CONVEX_URL` | Web app | The Convex deployment's address. Public: the browser connects to it. |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | Clerk's Frontend API URL, shown on Clerk's Convex integration page. Convex accepts web sign-ins from this Clerk instance only. Not a secret. |
| `CONVEX_DEPLOY_KEY` | Vercel, Production only | Lets the Vercel build push Convex functions and schema to production. The build stops if this key and `CONVEX_URL` name different deployments. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Web app | Clerk API keys. |

## The acceptance run

For each client: discovery → sign-in and consent → `whoami` → `capture` → `whoami` again to read it back → token refresh → reconnect. Record which registration mode the client used.

| Client | Needs | Result |
| --- | --- | --- |
| Claude Code | Step 1 | not run |
| claude.ai connector, then Claude iOS | Step 2 | claude.ai passed discovery, sign-in and consent, `capture`, and `whoami` reading it back (2026-11-21). It registered itself by CIMD and was granted `offline_access`, `skippy:read` and `skippy:write`. The capture is stored in Convex production with the owner and Claude's client ID recorded. Token refresh and reconnect not checked yet (access tokens last a day). Claude iOS used the same connector with no extra setup and `whoami` worked, as reported by the owner (2026-11-21). |
| Claude desktop | Step 2 | not run |
| ChatGPT | Step 2 | First try 2026-11-24: connector made, no tools seen. Clerk accepts ChatGPT's CIMD client; the token most likely lacked the Skippy scopes. The endpoint now challenges such tokens. Second try pending. |
| Codex | Step 1 | not run |

Negative checks, each of which must fail: an expired token, a token for another audience, a read-only consent attempting `capture`, and a Clerk account that is not the owner.
