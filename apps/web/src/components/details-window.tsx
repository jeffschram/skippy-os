"use client";

import { PencilSimple, X } from "@phosphor-icons/react";
import { useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * The window a task, or anything in Memory or on the Agenda, opens in, over
 * whatever page the owner is on. It is as tall as the screen and no taller:
 * the top row (what it is, Edit, Close) stays put, the record's text scrolls
 * in its own short box, and the chat's messages fill whatever height is left
 * (`ChatSection`), so the window itself scrolls only on a screen too short
 * for even a small chat. On a small screen there is not room for both, so a
 * Details / Chat switch under the top row shows one at a time.
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

const iconButton =
  "inline-flex size-10 items-center justify-center rounded-lg border border-foreground/20 text-foreground/70 hover:bg-foreground/5 hover:text-foreground sm:size-9";

/** The window's buttons at the top right: edit, when the record can be edited here, and close. */
export function WindowButtons({ onEdit, onClose }: { onEdit?: () => void; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2">
      {onEdit ? (
        <button type="button" onClick={onEdit} aria-label="Edit" title="Edit" className={iconButton}>
          <PencilSimple aria-hidden size={18} />
        </button>
      ) : null}
      <button type="button" onClick={onClose} aria-label="Close" title="Close" className={iconButton}>
        <X aria-hidden size={18} />
      </button>
    </div>
  );
}

/** A phone, or a screen too short for the record and a readable chat at once. */
const SMALL_SCREEN = "(max-width: 639px), (max-height: 720px)";

function useSmallScreen(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia(SMALL_SCREEN);
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia(SMALL_SCREEN).matches,
    () => false,
  );
}

/**
 * Inside the window: the top row, then the record, its chat, and the rest
 * (files, history). On a small screen a switch shows either the record with
 * the rest, or the chat alone with the whole height. Both stay mounted, so a
 * half-written message survives a switch. While editing, the record shows.
 */
export function WindowLayout({ header, record, chat, rest, editing }: { header: ReactNode; record: ReactNode; chat: ReactNode; rest: ReactNode; editing?: boolean }) {
  const small = useSmallScreen();
  const [pane, setPane] = useState<"details" | "chat">("details");
  const split = small && !editing;
  const showing = split ? pane : undefined;
  const tab = (value: "details" | "chat", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={pane === value}
      onClick={() => setPane(value)}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${pane === value ? "bg-background text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground"}`}
    >
      {label}
    </button>
  );
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-4 pb-4">{header}</div>
      {split ? (
        <div role="tablist" aria-label="Show" className="mb-4 flex shrink-0 gap-1 rounded-lg bg-foreground/10 p-1">
          {tab("details", "Details")}
          {tab("chat", "Chat")}
        </div>
      ) : null}
      {/* `data-pane` lets the record's text drop its height limit when the chat is not beside it. */}
      <div data-pane={showing} className="-mx-6 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6">
        <div className={showing === "chat" ? "hidden" : "contents"}>{record}</div>
        <div className={showing === "details" ? "hidden" : "contents"}>{chat}</div>
        <div className={showing === "chat" ? "hidden" : "contents"}>{rest}</div>
      </div>
    </>
  );
}

/** The chat's part of the window: it takes the height the other parts leave, down to a small minimum. */
export function ChatSection({ children }: { children: ReactNode }) {
  return <section className="flex flex-1 flex-col border-t border-foreground/15 pt-4 in-data-[pane=chat]:border-t-0 in-data-[pane=chat]:pt-0">{children}</section>;
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
