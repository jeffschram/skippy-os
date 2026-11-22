# Skippy OS

Skippy project: skippy-os. Follow the skippy-status skill.

- The spec is `docs/skippy-os-spec-alt.html`. It records what is decided, what is built and what is open; keep it current.
- `pnpm check` runs the type checks, the tests and the lint. Run it before calling work done.
- A push to `main` deploys the site and Convex to production.
- `pnpm dev` runs the site on this computer against the test database, where the Mac mini answers no chats. `pnpm dev:live` runs it against the live data: changes made there are real. Only one of the two can run at a time.
- Before writing Next.js code, read `apps/web/AGENTS.md`.
