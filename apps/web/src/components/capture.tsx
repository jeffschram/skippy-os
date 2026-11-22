"use client";

import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { itemHref } from "./item-details";
import { button, Panel, problem, showDay, showTime } from "./parts";
import { useNow } from "./use-now";

/**
 * Quick capture and the inbox. The box saves at once and says nothing back.
 * What it saves waits in the inbox until it is filed as a task, a note, a
 * link or a memory, by the owner here or by Claude. "Hold" keeps something
 * for seven days as a hand-off between devices; it is never filed.
 */

type Inbox = FunctionReturnType<typeof api.viewer.captures>;
type Capture = Inbox["pending"][number];

const field = "w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base";
const quiet = "text-sm text-foreground/60 underline underline-offset-2";

export function CaptureBox() {
  const add = useMutation(api.viewer.addCapture);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string>();
  const [error, setError] = useState<string>();

  async function save(intent: "remember" | "hold") {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await add({ text, intent });
      setText("");
      setSaved(intent === "hold" ? "Held for seven days." : "Captured.");
    } catch (caught) {
      setError(problem(caught));
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
    >
      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setSaved(undefined);
        }}
        onKeyDown={onKey}
        rows={2}
        placeholder="Capture a thought, a link, something to do. Enter saves it."
        aria-label="Capture"
        className={field}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || !text.trim()} className={`${button} disabled:opacity-50`}>
          Capture
        </button>
        <button type="button" disabled={busy || !text.trim()} onClick={() => save("hold")} className={`${button} disabled:opacity-50`}>
          Hold for 7 days
        </button>
        {saved ? <span className="text-sm text-foreground/60">{saved}</span> : null}
        {error ? <span className="text-sm text-red-700 dark:text-red-300">{error}</span> : null}
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
                <span className="text-foreground/70">{capture.text?.split("\n")[0] ?? capture.url}</span>
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
          {capture.at ? ` · ${showTime(capture.at)}` : ""} · file as
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
