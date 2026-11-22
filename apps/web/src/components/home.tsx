"use client";

import { SignInButton, SignOutButton, UserButton, useAuth } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import { DashboardView } from "./dashboard-view";

/**
 * Home. Signed out, it is a wall with a sign-in button. Signed in as the owner,
 * it shows today's tasks, the projects and the latest activity, read-only and
 * live. Signed in as anyone else, it shows nothing.
 *
 * The wall is a courtesy. What keeps the data private is that every Convex
 * query checks the sign-in and answers the owner only.
 */

const button = "rounded-md border border-foreground/20 px-4 py-2 text-sm font-medium hover:bg-foreground/5";

export function Home() {
  const clerk = useAuth();
  const convex = useConvexAuth();

  if (!clerk.isLoaded) return <Wall>Loading…</Wall>;
  if (!clerk.isSignedIn) {
    return (
      <Wall>
        <p>Sign in to see your dashboard.</p>
        <SignInButton>
          <button type="button" className={`mt-6 ${button}`}>
            Sign in
          </button>
        </SignInButton>
      </Wall>
    );
  }
  if (convex.isLoading) return <Wall>Loading…</Wall>;
  if (!convex.isAuthenticated) {
    return (
      <Wall>
        <p>You are signed in, but Skippy OS could not confirm that with its database. Sign out and sign in again.</p>
        <SignOut />
      </Wall>
    );
  }
  return <SignedIn />;
}

function SignedIn() {
  const me = useQuery(api.viewer.me);
  if (me === undefined) return <Wall>Loading…</Wall>;
  if (me.viewer !== "owner") {
    return (
      <Wall>
        <p>This account cannot open Skippy OS. It has one owner, and this account is not it.</p>
        <SignOut />
      </Wall>
    );
  }
  return <Dashboard />;
}

function SignOut() {
  return (
    <SignOutButton>
      <button type="button" className={`mt-6 ${button}`}>
        Sign out
      </button>
    </SignOutButton>
  );
}

function Wall({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Skippy OS</h1>
      <div className="mt-3 text-base leading-7">{children}</div>
    </main>
  );
}

const STEP_MS = 5 * 60_000;
const roundedNow = () => Math.floor(Date.now() / STEP_MS) * STEP_MS;

/** The time, in five-minute steps. The queries take it so "today" rolls over at midnight. */
function useNow(): number {
  const [now, setNow] = useState(roundedNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(roundedNow()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Each panel is its own live query, so a change redraws only the panel it touches. */
function Dashboard() {
  const now = useNow();
  const today = useQuery(api.viewer.today, { now });
  const projects = useQuery(api.viewer.projects, { now });
  const activity = useQuery(api.viewer.activity, { limit: 20 });
  return <DashboardView account={<UserButton />} today={today} projects={projects} activity={activity} />;
}
