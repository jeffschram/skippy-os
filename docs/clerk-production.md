# Moving Clerk to a production instance

Skippy OS signs people in with a Clerk development instance. Clerk says a development instance is not meant for a live app: it is capped at 100 users, its sign-in pages sit on an `accounts.dev` address, and it keeps the browser session in a way Clerk calls not secure enough for production. A production instance needs a domain the owner controls, and since 2026-11-22 there is one: `skippyos.app`.

This is not done yet. It is written down so it can be done in one sitting when the owner chooses. Nothing in the code changes.

## What it costs

- **Every client signs in again.** The production instance is a different sign-in server with its own users and keys. The claude.ai connector has to be reconnected, and each browser and phone signed in again. Do it before ChatGPT or Codex are connected, so they connect once.
- **The owner gets a new user id.** Convex lets in one Clerk user by id, so that setting changes. No stored record holds the old id, so no data changes.
- **`pnpm dev:live` stops working.** The local site uses the development keys. Convex production will only accept sign-ins from the production instance, and a production instance does not work on `localhost`. After the move, the local site runs on the test database only (`pnpm dev`), and live data is seen on `www.skippyos.app`.
- **An hour or so, mostly waiting** for DNS and certificates.

## Steps

| # | Step | Who |
| --- | --- | --- |
| 1 | Clerk dashboard: create the production instance for `skippyos.app`, cloning the development settings. | Owner |
| 2 | Clerk, Domains: add the DNS records it lists to Cloudflare. Set each to "DNS only" (grey cloud). Wait for Clerk to show them verified and the certificates issued. | Owner |
| 3 | Clerk, production instance: check what cloning did not bring across, and set it again. Under Agents, MCP servers: add `https://www.skippyos.app/api/mcp`. Under OAuth applications: public clients (client ID metadata documents) allowed, dynamic client registration off, scopes `skippy:read` and `skippy:write` created and default, access tokens as JWT with the audience included, consent screen on. Turn the Convex integration on and note the Frontend API address it shows. | Owner |
| 4 | Vercel, Production: replace `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` with the production instance's keys. Do not redeploy yet. | Owner |
| 5 | Convex production: set `CLERK_JWT_ISSUER_DOMAIN` to the Frontend API address from step 3. | Claude, given the address |
| 6 | Vercel: redeploy. From here the site signs in against the production instance. | Owner |
| 7 | Open `www.skippyos.app`, sign up as the owner. The page will say this account cannot open Skippy OS: that is expected. Copy the new user id from Clerk, Users. | Owner |
| 8 | Convex production: set `SKIPPY_OWNER_CLERK_USER_ID` to the new id. The site now opens. | Claude, given the id in a file or the owner runs the command |
| 9 | Clerk: close sign-ups (Access mode), now that the owner exists. | Owner |
| 10 | claude.ai: disconnect and reconnect the Skippy OS connector, keeping its name. Sign in on each device, and turn notifications on again if the browser asks. | Owner |
| 11 | Check a call through the connector from a fresh session on the mini, and run Clerk's check on the MCP server. | Claude, then owner |

Between steps 6 and 10 the scheduled jobs on the mini cannot reach Skippy OS. Avoid the top of an hour, as with the address move.

The owner's user id is never written into the repo or a chat. For step 8 the owner can run this themselves, with the id from the Clerk dashboard:

```bash
npx convex env set SKIPPY_OWNER_CLERK_USER_ID user_... --prod
```

## Going back

Until the development instance is deleted, the move can be undone: put the two development keys back in Vercel, set `CLERK_JWT_ISSUER_DOMAIN` and `SKIPPY_OWNER_CLERK_USER_ID` in Convex back to their old values, redeploy, and reconnect the clients. Keep the development instance: local development needs it.
