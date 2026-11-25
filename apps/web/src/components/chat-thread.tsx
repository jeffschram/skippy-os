"use client";

import { api } from "@convex/_generated/api";
import type { EntityType } from "@skippy/shared";
import { describeRule } from "@skippy/shared";
import type { FunctionReturnType } from "convex/server";
import { useMutation } from "convex/react";
import Link from "next/link";
import { FilePdf } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Composer, CHAT_FILE_TYPES } from "./composer";
import { showSize, useUpload } from "./files";
import { itemHref } from "./item-href";
import { button, problem, Tag } from "./parts";

/**
 * The parts of a chat that the chat page and a details window share: the
 * messages with their cards, and the box to write the next one in. The owner's
 * message is saved at once; the reply is written by a Claude Code session on
 * the mini and appears as it comes. When the mini is not there, the message
 * waits and says so.
 */

export type Chat = NonNullable<FunctionReturnType<typeof api.viewerChat.chat>>;

/** The mini says "alive" every half minute. Three missed in a row means it is away. */
const AWAY_AFTER_MS = 100_000;

/** The time, every fifteen seconds, to judge how long ago the mini was heard from. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export const replyIsComing = (chat: Chat | null) => chat?.turn != null && ["queued", "claimed", "running"].includes(chat.turn.status);

/**
 * The messages of a chat, oldest first, kept scrolled to the newest. On the
 * chat page the page scrolls, with room left at the bottom for the pinned box;
 * in a details window (`boxed`) the messages scroll in a box of their own,
 * which fills the height the window has left and no more. The owner's
 * messages are on the right in a shaded box, the replies on the left in plain
 * text, with no names or times.
 */
export function Messages({ chat, boxed }: { chat: Chat; boxed?: boolean }) {
  const now = useClock();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const away = chat.miniSeenAt === null || now - chat.miniSeenAt > AWAY_AFTER_MS;
  const last = chat.messages.at(-1);
  const record = chat.scope.kind === "item" ? chat.scope.record : undefined;

  // Keep the newest words in view as they arrive.
  useLayoutEffect(() => {
    if (boxed) {
      if (box.current) box.current.scrollTop = box.current.scrollHeight;
    } else {
      end.current?.scrollIntoView({ block: "end" });
    }
  }, [boxed, chat.messages.length, last?.content.length]);
  // The box changes height with the window and the composer. Keep the newest words at its bottom when it does.
  useEffect(() => {
    const element = box.current;
    if (!boxed || !element) return;
    const watcher = new ResizeObserver(() => {
      element.scrollTop = element.scrollHeight;
    });
    watcher.observe(element);
    return () => watcher.disconnect();
  }, [boxed]);

  const list = (
    <ol className={boxed ? "space-y-6" : "mt-8 space-y-6"}>
      {chat.messages.map((message) => (
        // The owner's messages sit on the right in a box of their own; replies run full width on the left.
        <li key={message.id} className={message.role === "user" ? "ml-auto flex w-fit max-w-[80%] flex-col items-end" : undefined}>
          {message.files.length > 0 ? (
            <ul className={`flex flex-wrap gap-2 ${message.role === "user" ? "mb-1.5 justify-end" : ""}`}>
              {message.files.map((file) => (
                <li key={file.id}>
                  {file.url && file.contentType.startsWith("image/") ? (
                    <a href={file.url} target="_blank" rel="noreferrer" title={`Open ${file.fileName}`}>
                      {/* Storage hands out an address meant for the browser to load as it is. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={file.url} alt={file.fileName} loading="lazy" className="h-28 max-w-56 rounded-lg border border-foreground/15 object-cover" />
                    </a>
                  ) : (
                    <a
                      href={file.url ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-foreground/15 px-2.5 py-2 text-sm hover:bg-foreground/5"
                    >
                      <FilePdf aria-hidden size={24} className="text-foreground/60" />
                      <span>
                        <span className="block max-w-56 truncate">{file.fileName}</span>
                        <span className="block text-xs text-foreground/60">{showSize(file.sizeBytes)}</span>
                      </span>
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {message.content ? (
            message.role === "user" ? (
              <p className="rounded-2xl bg-foreground/10 px-4 py-2.5 text-base leading-7 break-words whitespace-pre-wrap text-foreground">{message.content}</p>
            ) : (
              <p className="text-base leading-7 break-words whitespace-pre-wrap text-foreground/80">{message.content}</p>
            )
          ) : null}
          {message.role === "assistant" && message.id === last?.id ? <Status chat={chat} away={away} /> : null}
          {chat.turn?.kind === "brief" && chat.turn.replyId === message.id && message.status === "done" ? (
            <p className="mt-2 text-sm">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(message.content);
                    setCopied(true);
                  } catch {
                    setError("The browser did not allow copying. Select the brief and copy it by hand.");
                  }
                }}
                className={button}
              >
                {copied ? "Copied" : "Copy the brief"}
              </button>{" "}
              <span className="text-foreground/60">
                Paste it into a new Claude Project or Code session. It is also saved in {record?.type === "project" ? "the project's notes" : "Memory, as a note"}.
              </span>
            </p>
          ) : null}
          {message.cards.length > 0 ? (
            <ul className="mt-3 space-y-3">
              {message.cards.map((card) => (
                <CardView key={card.cardId} messageId={message.id} card={card} />
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
  return (
    <>
      {boxed ? (
        <div ref={box} className="min-h-24 flex-1 basis-0 overflow-y-auto rounded-md border border-foreground/10 p-3">
          {list}
        </div>
      ) : (
        list
      )}
      {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      {/* On the page, room for the box pinned below, so the newest words are never under it. */}
      {boxed ? null : <div ref={end} className="h-44" />}
    </>
  );
}

/**
 * The box to write in, for one chat. With `about`, the message goes to that
 * record's one chat, which the server starts if there is none yet and brings
 * back if it was archived; `chat` is then that chat, or null before it exists.
 */
export function ChatBox({ chat, about }: { chat: Chat | null; about?: { type: EntityType; id: string } }) {
  const send = useMutation(api.viewerChat.send);
  const start = useMutation(api.viewerChat.start);
  const cancel = useMutation(api.viewerChat.cancel);
  const upload = useUpload();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const busy = replyIsComing(chat);
  const closed = !about && chat?.state === "archived";

  async function submit() {
    if ((!text.trim() && files.length === 0) || busy || sending || closed) return;
    setError(undefined);
    setSending(true);
    const words = text;
    const attached = files;
    setText("");
    try {
      const sent = await Promise.all(attached.map((file) => upload(file)));
      const withFiles = sent.length > 0 ? { files: sent } : {};
      if (about) await start({ text: words, about, ...withFiles });
      else if (chat) await send({ chatId: chat.id, text: words, ...withFiles });
      setFiles([]);
    } catch (caught) {
      setText(words);
      setError(caught instanceof Error && !("data" in caught) ? caught.message : problem(caught));
    } finally {
      setSending(false);
    }
  }

  return (
    <Composer
      text={text}
      onText={setText}
      files={files}
      onFiles={setFiles}
      onSend={submit}
      onStop={busy && chat ? () => cancel({ chatId: chat.id }) : undefined}
      accept={CHAT_FILE_TYPES}
      refusal={about ? "A chat reads images and PDFs. Add any other file under Files." : "A chat reads images and PDFs. Keep any other file with Capture, from another page."}
      label="Message"
      placeholder={closed ? "This chat is archived." : busy ? "Waiting for the reply…" : about && !chat ? "Ask or say something about this" : "Say something"}
      sendLabel="Send"
      canSend={!busy && !sending && !closed && (text.trim() !== "" || files.length > 0)}
      disabled={closed}
      status={sending ? "Sending…" : error ? <span className="text-red-700 dark:text-red-300">{error}</span> : undefined}
    />
  );
}

/** Under the reply that is still to come: what is happening to it. */
function Status({ chat, away }: { chat: Chat; away: boolean }) {
  const turn = chat.turn;
  if (!turn) return null;
  if (turn.status === "queued") {
    return (
      <p className="mt-1 text-sm text-foreground/60">
        {chat.miniSeenAt === null
          ? "No Mac mini has ever connected to this copy of Skippy OS, so no reply will come here. Chats are answered on the live site."
          : away
            ? "Waiting for the Mac mini. Your message is saved and will be answered when it is back."
            : "Sent to the Mac mini…"}
      </p>
    );
  }
  if (turn.status === "claimed" || turn.status === "running") {
    return <p className="mt-1 text-sm text-foreground/60">{turn.activity ?? "Starting"}…</p>;
  }
  if (turn.status === "failed" || turn.status === "cancelled") {
    return <p className="mt-1 text-sm text-red-700 dark:text-red-300">{turn.error ?? "This one did not get an answer."}</p>;
  }
  return null;
}

type Card = Chat["messages"][number]["cards"][number];
type Draft = Card["draft"];
const small = "w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm";
const KIND_WORDS: Record<Card["kind"], string> = {
  task: "task",
  event: "event",
  project: "project",
  note: "note",
  person: "person",
  recurrence: "repeating item",
};

/**
 * Something Claude offered to create. The owner can change it, create it with
 * one click, or put it aside. A card lives only in the chat it came from.
 */
function CardView({ messageId, card }: { messageId: string; card: Card }) {
  const accept = useMutation(api.viewerChat.acceptCard);
  const dismiss = useMutation(api.viewerChat.dismissCard);
  const [draft, setDraft] = useState<Draft>(card.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (change: Partial<Draft>) => setDraft({ ...draft, ...change });
  const words = KIND_WORDS[card.kind];

  if (card.state === "accepted") {
    const href = card.result ? itemHref(card.result.type, card.result.id) : undefined;
    return (
      <li className="rounded-md border border-foreground/15 px-3 py-2 text-sm">
        <Tag>{words}</Tag>{" "}
        {card.result && href ? (
          <Link href={href} scroll={false} className="underline underline-offset-2">
            {card.result.title}
          </Link>
        ) : (
          (card.result?.title ?? card.draft.title ?? card.draft.name)
        )}
        <span className="text-foreground/60"> · {card.result ? "created" : "created, and deleted since"}</span>
      </li>
    );
  }
  if (card.state === "dismissed") {
    return (
      <li className="rounded-md border border-foreground/10 px-3 py-2 text-sm text-foreground/50">
        <Tag>{words}</Tag> {card.draft.title ?? card.draft.name} · put aside
      </li>
    );
  }

  async function run(change: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await change();
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  }
  // Empty boxes are left out, so a cleared field is not sent as an empty one.
  const cleaned = () => Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== "" && value !== undefined)) as Draft;

  return (
    <li className="space-y-2 rounded-md border border-foreground/25 p-3">
      <p className="text-xs text-foreground/60">Create a {words}?</p>
      {card.kind === "person" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={draft.name ?? ""} onChange={(event) => set({ name: event.target.value })} aria-label="Name" placeholder="Name" className={small} />
          <input value={draft.email ?? ""} onChange={(event) => set({ email: event.target.value })} aria-label="Email" placeholder="Email (optional)" className={small} />
        </div>
      ) : (
        <input value={draft.title ?? ""} onChange={(event) => set({ title: event.target.value })} aria-label="Title" className={`font-medium ${small}`} />
      )}
      {card.kind === "task" ? (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Due
          <input type="date" value={draft.dueAt?.slice(0, 10) ?? ""} onChange={(event) => set({ dueAt: event.target.value })} className={`w-auto ${small}`} />
          {draft.project ? <span className="text-foreground/60">in {draft.project}</span> : null}
        </label>
      ) : null}
      {card.kind === "event" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={draft.startAt ?? ""} onChange={(event) => set({ startAt: event.target.value })} aria-label="Starts" placeholder="2026-11-25 or 2026-11-25T15:00" className={small} />
          <input value={draft.location ?? ""} onChange={(event) => set({ location: event.target.value })} aria-label="Where" placeholder="Where (optional)" className={small} />
        </div>
      ) : null}
      {card.kind === "project" ? (
        <textarea value={draft.summary ?? ""} onChange={(event) => set({ summary: event.target.value })} rows={2} aria-label="Summary" placeholder="What it is, in a sentence or two" className={small} />
      ) : null}
      {card.kind === "note" ? (
        <textarea value={draft.body ?? ""} onChange={(event) => set({ body: event.target.value })} rows={3} aria-label="Text" className={small} />
      ) : null}
      {card.kind === "recurrence" && draft.rule ? (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {describeRule(draft.rule)}, first due
          <input type="date" value={draft.nextDue ?? ""} onChange={(event) => set({ nextDue: event.target.value })} className={`w-auto ${small}`} />
        </label>
      ) : null}
      {(card.kind === "task" || card.kind === "event") && draft.description ? <p className="text-sm text-foreground/70">{draft.description}</p> : null}
      {card.kind === "project" && draft.notes ? <p className="line-clamp-3 text-sm text-foreground/70">Notes to start it with: {draft.notes}</p> : null}
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(() => accept({ messageId, cardId: card.cardId, draft: cleaned() }))} className={button}>
          {busy ? "Creating…" : `Create ${words}`}
        </button>
        <button type="button" disabled={busy} onClick={() => run(() => dismiss({ messageId, cardId: card.cardId }))} className={button}>
          Not now
        </button>
      </div>
    </li>
  );
}
