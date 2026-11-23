# Skippy OS

Skippy project: skippy-os. Follow the skippy-status skill.

- The spec is `docs/skippy-os-spec-alt.html`. It records what is decided, what is built and what is open; keep it current.
- The owner's feedback and ideas for the web app are in `docs/feedback.md`. Add to it when asked, and when an item is done or turned down, move it to "Done or decided" there.
- `pnpm check` runs the type checks, the tests and the lint. Run it before calling work done.
- A push to `main` deploys the site and Convex to production.
- `pnpm dev` runs the site on this computer against the test database and the development sign-in, where the Mac mini answers no chats. The live data is only at `www.skippyos.app`: its sign-in does not work on this computer.
- Before writing Next.js code, read `apps/web/AGENTS.md`.
