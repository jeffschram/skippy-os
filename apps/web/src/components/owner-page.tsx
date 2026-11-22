"use client";

import { Brain, CalendarBlank, GearSix, House, Kanban, Pulse } from "@phosphor-icons/react";
import { SignInButton, SignOutButton, UserButton, useAuth } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CaptureDock } from "./capture";
import { ItemDetails } from "./item-details";
import { ServiceWorker } from "./notifications";
import { button } from "./parts";
import { TaskDetails } from "./task-details";

/**
 * The frame every page of the dashboard sits in. Signed out, it is a wall with
 * a sign-in button. Signed in as the owner, it shows the top bar and the page,
 * and mounts the capture input docked at the bottom and the details views
 * that open over any page.
 * Signed in as anyone else, it shows nothing.
 *
 * The wall is a courtesy. What keeps the data private is that every Convex
 * function checks the sign-in and answers the owner only.
 */


const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/projects", label: "Projects", icon: Kanban },
  { href: "/agenda", label: "Agenda", icon: CalendarBlank },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/activity", label: "Activity", icon: Pulse },
  { href: "/settings", label: "Settings", icon: GearSix },
];

/** `wide` is for list pages; reading pages use the narrower column. A page with its own input turns the capture `dock` off. */
export function OwnerPage({ wide, dock = true, children }: { wide?: boolean; dock?: boolean; children: ReactNode }) {
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
  return (
    <ForOwner wide={wide} dock={dock}>
      {children}
    </ForOwner>
  );
}

function ForOwner({ wide, dock, children }: { wide?: boolean; dock: boolean; children: ReactNode }) {
  const me = useQuery(api.viewer.me);
  const path = usePathname();
  if (me === undefined) return <Wall>Loading…</Wall>;
  if (me.viewer !== "owner") {
    return (
      <Wall>
        <p>This account cannot open Skippy OS. It has one owner, and this account is not it.</p>
        <SignOut />
      </Wall>
    );
  }
  const here = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className={`mx-auto w-full px-6 pt-8 ${dock ? "pb-44" : "pb-8"} ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
      <header className="flex items-start justify-between gap-6">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <Link href="/" className="text-xl font-semibold">
            Skippy OS
          </Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={here(item.href) ? "page" : undefined}
                className={here(item.href) ? "font-semibold underline underline-offset-4" : "text-foreground/70 hover:text-foreground"}
              >
                <item.icon
                  aria-hidden
                  size="1.15em"
                  weight={here(item.href) ? "fill" : "regular"}
                  className="mr-1.5 inline-block align-[-0.2em]"
                />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <UserButton />
      </header>
      <main className="mt-10">{children}</main>
      <ServiceWorker />
      {dock ? <CaptureDock /> : null}
      <TaskDetails />
      <ItemDetails />
    </div>
  );
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
