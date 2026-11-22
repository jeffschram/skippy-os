"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useSyncExternalStore, type ReactNode } from "react";

let shared: { url: string; client: ConvexReactClient } | undefined;

/** One connection per page load. */
function clientFor(url: string): ConvexReactClient {
  if (shared?.url !== url) shared = { url, client: new ConvexReactClient(url) };
  return shared.client;
}

const never = () => () => {};

/**
 * Connects the page to Convex as whoever is signed in with Clerk. Convex checks
 * that sign-in itself on every query, so nothing here decides who sees what.
 *
 * The connection exists only in the browser. The page the server sends is the
 * same for everyone and holds no data, so it shows `fallback` until the
 * browser takes over.
 */
export function ConvexClientProvider({
  url,
  fallback,
  children,
}: {
  url: string;
  fallback: ReactNode;
  children: ReactNode;
}) {
  const inBrowser = useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
  if (!inBrowser) return fallback;
  return (
    <ConvexProviderWithClerk client={clientFor(url)} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
