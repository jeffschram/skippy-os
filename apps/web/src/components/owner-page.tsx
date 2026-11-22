"use client";

import { List, X } from "@phosphor-icons/react";
import { SignInButton, SignOutButton, UserButton, useAuth } from "@clerk/nextjs";
import { api } from "@convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
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
  { href: "/", label: "Home" },
  { href: "/projects", label: "Projects" },
  { href: "/agenda", label: "Agenda" },
  { href: "/memory", label: "Memory" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
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
  if (me === undefined) return <Wall>Loading…</Wall>;
  if (me.viewer !== "owner") {
    return (
      <Wall>
        <p>This account cannot open Skippy OS. It has one owner, and this account is not it.</p>
        <SignOut />
      </Wall>
    );
  }
  return (
    <div className={`mx-auto w-full px-6 pt-8 ${dock ? "pb-44" : "pb-8"} ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
      <TopBar />
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

/**
 * The name, the pages and the account button. On a wide screen the pages sit
 * in a row beside the name; on a phone they fold into a menu opened by a
 * button, which closes again on Escape or on going to another page.
 */
function TopBar() {
  const path = usePathname();
  // The page the menu was opened on, so that moving to another page closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenOn(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  const here = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const look = (href: string) =>
    here(href) ? "font-semibold underline underline-offset-4" : "text-foreground/70 hover:text-foreground";
  return (
    <header>
      <div className="flex items-center justify-between gap-6 sm:items-start">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <Link href="/" className="text-xl font-semibold">
            Skippy OS
          </Link>
          {process.env.NODE_ENV !== "development" ? null : process.env.NEXT_PUBLIC_SKIPPY_DATA === "live" ? (
            <span
              title="This page is served from this computer, but the data is the live data. Changes here are real."
              className="rounded border border-red-600/60 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-400"
            >
              Local page, live data
            </span>
          ) : (
            <span
              title="This is the test copy on this computer. It has its own data, and the Mac mini does not answer chats here."
              className="rounded border border-amber-600/60 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400"
            >
              Test copy
            </span>
          )}
          <nav aria-label="Pages" className="hidden flex-wrap gap-x-4 gap-y-1 text-sm sm:flex">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} aria-current={here(item.href) ? "page" : undefined} className={look(item.href)}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <UserButton />
          <button
            type="button"
            aria-expanded={open}
            aria-controls="page-menu"
            aria-label={open ? "Close menu" : "Menu"}
            onClick={() => setOpenOn(open ? null : path)}
            className="inline-flex size-11 items-center justify-center rounded-md border border-foreground/20 hover:bg-foreground/5 sm:hidden"
          >
            {open ? <X aria-hidden size={24} /> : <List aria-hidden size={24} />}
          </button>
        </div>
      </div>
      <nav id="page-menu" aria-label="Pages" hidden={!open} className="mt-4 border-t border-foreground/15 sm:hidden">
        <ul>
          {NAV.map((item) => (
            <li key={item.href} className="border-b border-foreground/15">
              <Link
                href={item.href}
                aria-current={here(item.href) ? "page" : undefined}
                onClick={() => setOpenOn(null)}
                className={`block py-3 text-base ${look(item.href)}`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
