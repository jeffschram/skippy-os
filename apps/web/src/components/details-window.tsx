"use client";

import type { ReactNode } from "react";

/**
 * The window a task, or anything in Memory or on the Agenda, opens in, over
 * whatever page the owner is on. It is as tall as the screen and no taller:
 * the top row (what it is, Edit, Close) stays put, the record's text scrolls
 * in its own short box, and the chat's messages fill whatever height is left
 * (`ChatSection`), so the window itself scrolls only on a screen too short
 * for even a small chat.
 */
export function DetailsWindow({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start bg-black/50 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        className="mx-auto flex h-full w-full max-w-3xl flex-col bg-background p-6 sm:rounded-lg sm:border sm:border-foreground/15"
      >
        {children}
      </div>
    </div>
  );
}

/** Inside the window: the top row, then everything else below it. */
export function WindowLayout({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-4 pb-4">{header}</div>
      <div className="-mx-6 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6">{children}</div>
    </>
  );
}

/** The chat's part of the window: it takes the height the other parts leave, down to a small minimum. */
export function ChatSection({ children }: { children: ReactNode }) {
  return <section className="flex flex-1 flex-col border-t border-foreground/15 pt-4">{children}</section>;
}

/**
 * Where the record came from, what it is linked to and its history, folded
 * away under one line that names what is in it. Not shown when there is none.
 */
export function Background({ parts, children }: { parts: string[]; children: ReactNode }) {
  if (parts.length === 0) return null;
  // "Links, source and history": the first word keeps its capital.
  const named = parts.map((part, index) => (index === 0 ? part : part.toLowerCase()));
  const label = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
  return (
    <section className="border-t border-foreground/15 pt-4">
      <details>
        <summary className="cursor-pointer text-sm font-medium text-foreground/60">{label}</summary>
        <div className="mt-4 space-y-5">{children}</div>
      </details>
    </section>
  );
}
