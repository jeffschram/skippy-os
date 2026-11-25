"use client";

import { Tray } from "@phosphor-icons/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Composer, ComposerBar, CHAT_FILE_TYPES, MAX_CHAT_FILES } from "./composer";
import { showSize, useUpload } from "./files";
import { chatHref, itemHref } from "./item-href";
import { Panel, problem, showDay, showTime } from "./parts";
import { useNow } from "./use-now";

/**
 * The docked box and the inbox. A capture saves at once and says nothing
 * back. What it saves waits in the inbox until it is filed as a task, a note,
 * a link or a memory, by the owner here or by Claude. "Hold" keeps something
 * for seven days as a hand-off between devices; it is never filed.
 */

type Inbox = FunctionReturnType<typeof api.viewer.captures>;
type Capture = Inbox["pending"][number];

const quiet = "text-sm text-foreground/60 underline underline-offset-2";

/** Which record the page being looked at is about, so a capture made there can be filed under it. */
function useScope(): { type: "project"; id: string; title: string } | undefined {
  const now = useNow();
  const match = /^\/projects\/([^/]+)/.exec(usePathname());
  const slug = match ? decodeURIComponent(match[1]) : undefined;
  const page = useQuery(api.viewer.project, slug ? { slug, now } : "skip");
  return slug && page ? { type: "project", id: slug, title: page.project.title } : undefined;
}

type Mode = "chat" | "capture" | "hold";
const MODES: { id: Mode; label: string; send: string }[] = [
  { id: "chat", label: "Chat", send: "Start the chat" },
  { id: "capture", label: "Capture", send: "Capture it" },
  { id: "hold", label: "Hold", send: "Hold it for seven days" },
];

/**
 * The box docked at the bottom of every page. A switch says what sending
 * does: start a chat, capture for the inbox, or hold for seven days. It starts
 * on Chat and goes back to Chat after each send, so it is never left on Hold
 * by accident. On a project's page a chat or a capture is about that project,
 * and says so; that can be dropped. It is as wide as the page it sits under.
 */
export function CaptureDock({ wide }: { wide?: boolean }) {
  const add = useMutation(api.viewer.addCapture);
  const startChat = useMutation(api.viewerChat.start);
  const router = useRouter();
  const path = usePathname();
  const upload = useUpload();
  const scope = useScope();
  const [unscoped, setUnscoped] = useState<string>();
  const [mode, setMode] = useState<Mode>("chat");
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string>();
  const [error, setError] = useState<string>();
  // Dropping the scope lasts until the owner moves to another record.
  const about = scope && unscoped !== scope.id ? scope : undefined;
  const empty = !text.trim() && files.length === 0;

  async function send() {
    if (empty || busy) return;
    // The switch may have been moved after the files were added.
    const unreadable = files.find((file) => !CHAT_FILE_TYPES.includes(file.type));
    if (mode === "chat" && unreadable) return setError(`A chat reads images and PDFs. Take off "${unreadable.name}", or switch to Capture to keep it.`);
    if (mode !== "chat" && files.length > 1) return setError("A capture keeps one file. Take the others off, or switch to Chat.");
    setBusy(true);
    setError(undefined);
    setSaved(undefined);
    try {
      const sent = await Promise.all(files.map((file) => upload(file)));
      if (mode === "chat") {
        const { chatId } = await startChat({ text, files: sent, ...(about ? { about: { type: about.type, id: about.id } } : {}) });
        setText("");
        setFiles([]);
        router.push(`${path}${chatHref(chatId)}`, { scroll: false });
      } else {
        await add({
          ...(text.trim() ? { text } : {}),
          intent: mode === "hold" ? "hold" : "remember",
          ...(about && mode === "capture" ? { about: { type: about.type, id: about.id } } : {}),
          ...(sent[0] ? { file: sent[0] } : {}),
        });
        setText("");
        setFiles([]);
        setSaved(mode === "hold" ? "Held for seven days." : about ? `Captured for ${about.title}.` : "Captured.");
        setMode("chat");
      }
    } catch (caught) {
      setError(caught instanceof Error && !("data" in caught) ? caught.message : problem(caught));
    } finally {
      setBusy(false);
    }
  }

  const change = () => {
    setSaved(undefined);
    setError(undefined);
  };
  const placeholder =
    mode === "chat"
      ? about
        ? `Chat about ${about.title}`
        : "Talk something through with Skippy"
      : mode === "capture"
        ? about
          ? `Capture for ${about.title}`
          : "Capture a thought, a link, something to do"
        : "Hold something for seven days, to pick up on another device";

  return (
    <ComposerBar wide={wide}>
      <Composer
        text={text}
        onText={(value) => {
          setText(value);
          change();
        }}
        files={files}
        onFiles={(value) => {
          setFiles(value);
          change();
        }}
        onSend={send}
        accept={mode === "chat" ? CHAT_FILE_TYPES : undefined}
        refusal="A chat reads images and PDFs. Switch to Capture to keep any other file."
        maxFiles={mode === "chat" ? MAX_CHAT_FILES : 1}
        label={MODES.find((entry) => entry.id === mode)!.label}
        placeholder={placeholder}
        sendLabel={busy ? "Sending" : MODES.find((entry) => entry.id === mode)!.send}
        canSend={!busy && !empty}
        tools={
          <>
            <fieldset className="button-size inline-flex rounded-full border border-foreground/20 p-0.5">
              <legend className="sr-only">What sending does</legend>
              {MODES.map((entry) => (
                <label
                  key={entry.id}
                  className={`cursor-pointer rounded-full px-3 py-1.5 text-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-foreground sm:py-1 ${
                    mode === entry.id ? "bg-foreground font-medium text-background" : "text-foreground/70 hover:text-foreground"
                  }`}
                >
                  <input
                    type="radio"
                    name="dock-mode"
                    value={entry.id}
                    checked={mode === entry.id}
                    onChange={() => {
                      setMode(entry.id);
                      change();
                    }}
                    className="sr-only"
                  />
                  {entry.label}
                </label>
              ))}
            </fieldset>
            {about && mode !== "hold" ? (
              <span className="rounded border border-foreground/20 px-1.5 py-0.5 text-xs text-foreground/70">
                about {about.title}{" "}
                <button type="button" onClick={() => setUnscoped(about.id)} aria-label={`Do not tie this to ${about.title}`} className="underline underline-offset-2">
                  drop
                </button>
              </span>
            ) : null}
          </>
        }
        status={
          busy ? (
            "Sending…"
          ) : error ? (
            <span className="text-red-700 dark:text-red-300">{error}</span>
          ) : (
            saved
          )
        }
      />
    </ComposerBar>
  );
}

/** What is waiting to be filed and what is being held. Shows nothing when both are empty. */
export function InboxPanel() {
  const inbox = useQuery(api.viewer.captures, { now: useNow() });
  if (!inbox || (inbox.pending.length === 0 && inbox.held.length === 0 && inbox.recent.length === 0)) return null;
  return (
    <Panel title="Inbox" icon={Tray} note={inbox.pending.length > 0 ? `${inbox.pending.length}${inbox.morePending ? "+" : ""} to file` : "nothing to file"}>
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
