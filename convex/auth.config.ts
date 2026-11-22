import type { AuthConfig } from "convex/server";

/**
 * Whose sign-ins Convex accepts: the web app's Clerk session, and nothing else.
 * CLERK_JWT_ISSUER_DOMAIN is Clerk's Frontend API URL. Clerk's Convex
 * integration puts `aud: "convex"` in the session token, which is what
 * `applicationID` checks.
 *
 * This only proves who is signed in. Whether that person is the owner is
 * checked in `viewer.ts`. MCP calls do not use this at all: they arrive signed,
 * through `gateway.call`.
 */
export default {
  providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: "convex" }],
} satisfies AuthConfig;
