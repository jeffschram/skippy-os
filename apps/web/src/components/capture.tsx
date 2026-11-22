"use client";

import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { showSize, useUpload } from "./files";
import { itemHref } from "./item-details";
import { button, Panel, problem, showDay, showTime } from "./parts";
import { useNow } from "./use-now";

/**
 * Quick capture and the inbox. The input saves at once and says nothing back.
 * What it saves waits in the inbox until it is filed as a task, a note, a
 * link or a memory, by the owner here or by Claude. "Hold" keeps something
 * for seven days as a hand-off between devices; it is never filed.
 */

type Inbox = FunctionReturnType<typeof api.viewer.captures>;
type Capture = Inbox["pending"][number];

const field = "w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base";
const quiet = "text-sm text-foreground/60 underline underline-offset-2";

/** Which record the page being looked at is about, so a capture made there can be filed under it. */
function useScope(): { type: "project"; id: string; title: string } | undefined {
  const now = useNow();
  const match = /^\/projects\/([^/]+)/.exec(usePathname());
  const slug = match ? decodeURIComponent(match[1]) : undefined;
  const page = useQuery(api.viewer.project, slug ? { slug, now } : "skip");
  return slug && page ? { type: "project", id: slug, title: page.project.title } : undefined;
}

/**
 * The capture input, docked at the bottom of every page. On a project's page
 * it captures for that project, and says so; the scope can be dropped.
 */
export function CaptureDock() {
  const add = useMutation(api.viewer.addCapture);
  const upload = useUpload();
  const picker = useRef<HTMLInputElement>(null);
  const scope = useScope();
  const [unscoped, setUnscoped] = useState<string>();
  const [file, setFile] = useState<File>();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string>();
  const [error, setError] = useState<string>();
  // Dropping the scope lasts until the owner moves to another record.
  const about = scope && unscoped !== scope.id ? scope : undefined;
  const empty = !text.trim() && !file;

  async function save(intent: "remember" | "hold") {
    if (empty || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await add({
        ...(text.trim() ? { text } : {}),
        intent,
        ...(about && intent === "remember" ? { about: { type: about.type, id: about.id } } : {}),
        ...(file ? { file: await upload(file) } : {}),
      });
      setText("");
      setFile(undefined);
      setSaved(intent === "hold" ? "Held for seven days." : about ? `Captured for ${about.title}.` : "Captured.");
    } catch (caught) {
      setError(caught instanceof Error && !("data" in caught) ? caught.message : problem(caught));
    } finally {
      setBusy(false);
    }
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter saves; Shift+Enter starts a new line.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void save("remember");
    }
  }

  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void save("remember");
      }}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-foreground/15 bg-background"
    >
      <div className="mx-auto w-full max-w-5xl px-6 py-3">
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setSaved(undefined);
          }}
          onKeyDown={onKey}
          rows={Math.min(Math.max(text.split("\n").length, 1), 6)}
          placeholder={about ? `Capture for ${about.title}. Enter saves it.` : "Capture a thought, a link, something to do. Enter saves it."}
          aria-label="Capture"
          className={`resize-none ${field}`}
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="submit" disabled={busy || empty} className={`${button} disabled:opacity-50`}>
            {busy ? "Saving…" : "Capture"}
          </button>
          <button type="button" disabled={busy || empty} onClick={() => save("hold")} className={`${button} disabled:opacity-50`}>
            Hold for 7 days
          </button>
          <input
            ref={picker}
            type="file"
            onChange={(event) => {
              setFile(event.target.files?.[0]);
              setSaved(undefined);
              event.target.value = "";
            }}
            className="hidden"
            aria-label="Choose a file to capture"
          />
          {file ? (
            <span className="text-sm">
              {file.name} <span className="text-foreground/60">· {showSize(file.size)}</span>{" "}
              <button type="button" onClick={() => setFile(undefined)} className={quiet}>
                remove
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => picker.current?.click()} className={quiet}>
              Attach a file
            </button>
          )}
          {about ? (
            <span className="rounded border border-foreground/20 px-1.5 py-0.5 text-xs text-foreground/70">
              for {about.title}{" "}
              <button type="button" onClick={() => setUnscoped(about.id)} aria-label={`Do not capture for ${about.title}`} className="underline underline-offset-2">
                drop
              </button>
            </span>
          ) : null}
          {saved ? <span className="text-sm text-foreground/60">{saved}</span> : null}
          {error ? <span className="text-sm text-red-700 dark:text-red-300">{error}</span> : null}
        </div>
      </div>
    </form>
  );
}

/** What is waiting to be filed and what is being held. Shows nothing when both are empty. */
export function InboxPanel() {
  const inbox = useQuery(api.viewer.captures, { now: useNow() });
  if (!inbox || (inbox.pending.length === 0 && inbox.held.length === 0 && inbox.recent.length === 0)) return null;
  return (
    <Panel title="Inbox" note={inbox.pending.length > 0 ? `${inbox.pending.length}${inbox.morePending ? "+" : ""} to file` : "nothing to file"}>
      {inbox.pending.length > 0 ? (
        <ul className="space-y-4">
          {inbox.pending.map((capture) => (
            <Waiting key={capture.id} capture={capture} />
          ))}
        </ul>
      ) : null}
      {inbox.held.length > 0 ? (
        <div className={inbox.pending.length > 0 ? "mt-6" : ""}>
          <h3 className="mb-2 text-sm font-medium text-foreground/60">Held</h3>
          <ul className="space-y-3">
            {inbox.held.map((capture) => (
              <Held key={capture.id} capture={capture} />
            ))}
          </ul>
        </div>
      ) : null}
      {inbox.recent.length > 0 ? (
        <details className={inbox.pending.length + inbox.held.length > 0 ? "mt-6" : ""}>
          <summary className="cursor-pointer text-sm text-foreground/60">Recently dealt with</summary>
          <ul className="mt-3 space-y-2">
            {inbox.recent.map((capture) => (
              <li key={capture.id} className="text-sm">
                <span className="text-foreground/70">{capture.text?.split("\n")[0] ?? capture.url ?? capture.file?.fileName}</span>
                <span className="text-foreground/60">
                  {" · "}
                  {capture.status === "discarded" ? "discarded" : "filed as "}
                </span>
                {capture.results?.map((result, index) => {
                  const href = itemHref(result.type, result.id);
                  return (
                    <span key={result.id}>
                      {index > 0 ? ", " : ""}
                      {href ? (
                        <Link href={href} scroll={false} className="underline underline-offset-2">
                          {result.type}
                        </Link>
                      ) : (
                        result.type
                      )}
                    </span>
                  );
                })}
                {capture.processedBy ? <span className="text-foreground/60"> · {capture.processedBy}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}

function Body({ capture }: { capture: Capture }) {
  return (
    <>
      {capture.text ? <p className="text-base whitespace-pre-wrap">{capture.text}</p> : null}
      {capture.url ? (
        <a href={capture.url} target="_blank" rel="noreferrer" className="block truncate text-sm underline underline-offset-2">
          {capture.url}
        </a>
      ) : null}
      {capture.file ? (
        <p className="text-sm">
          {"url" in capture.file && typeof capture.file.url === "string" ? (
            <a href={capture.file.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {capture.file.fileName}
            </a>
          ) : (
            capture.file.fileName
          )}
          <span className="text-foreground/60"> · {showSize(capture.file.sizeBytes)}</span>
        </p>
      ) : null}
    </>
  );
}

function Waiting({ capture }: { capture: Capture }) {
  const file = useMutation(api.viewer.fileCapture);
  const discard = useMutation(api.viewer.discardCapture);
  const [error, setError] = useState<string>();

  async function run(change: () => Promise<unknown>) {
    setError(undefined);
    try {
      await change();
    } catch (caught) {
      setError(problem(caught));
    }
  }

  const kinds = ["task", "note", "memory", ...(capture.url ? (["link"] as const) : [])] as const;
  return (
    <li>
      <Body capture={capture} />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs text-foreground/60">
          {capture.by}
          {capture.at ? ` · ${showTime(capture.at)}` : ""}
          {capture.about ? ` · for ${capture.about.title}` : ""} · file as
        </span>
        {kinds.map((kind) => (
          <button key={kind} type="button" onClick={() => run(() => file({ id: capture.id, as: kind }))} className={quiet}>
            {kind}
          </button>
        ))}
        <button type="button" onClick={() => run(() => discard({ id: capture.id }))} className={`ml-auto ${quiet}`}>
          Discard
        </button>
      </div>
      {error ? <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </li>
  );
}

function Held({ capture }: { capture: Capture }) {
  const discard = useMutation(api.viewer.discardCapture);
  const [error, setError] = useState<string>();
  return (
    <li>
      <Body capture={capture} />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3">
        <span className="text-xs text-foreground/60">
          {capture.expiresAt ? `Goes on ${showDay(capture.expiresAt.slice(0, 10))}` : "Held"}
        </span>
        <button
          type="button"
          onClick={async () => {
            setError(undefined);
            try {
              await discard({ id: capture.id });
            } catch (caught) {
              setError(problem(caught));
            }
          }}
          className={`ml-auto ${quiet}`}
        >
          Clear
        </button>
      </div>
      {error ? <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </li>
  );
}
