"use client";

import { api } from "@convex/_generated/api";
import { describeRule } from "@skippy/shared";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { itemHref } from "./item-details";
import { OwnerPage } from "./owner-page";
import { button, problem, Quiet, showTime, Tag } from "./parts";

/**
 * One chat. The owner's message is saved at once; the reply is written by a
 * Claude Code session on the mini and appears here as it comes. When the mini
 * is not there, the message waits and the page says so.
 */

type Chat = NonNullable<FunctionReturnType<typeof api.viewerChat.chat>>;

/** The mini says "alive" every half minute. Three missed in a row means it is away. */
const AWAY_AFTER_MS = 100_000;
const field = "w-full resize-none rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base";
const quiet = "text-foreground/60 underline underline-offset-2";

export function ChatPage() {
  return (
    <OwnerPage dock={false}>
      <Loaded />
    </OwnerPage>
  );
}

/** The time, every fifteen seconds, to judge how long ago the mini was heard from. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Loaded() {
  const { id } = useParams<{ id: string }>();
  const chat = useQuery(api.viewerChat.chat, { id });
  if (chat === undefined) return <Quiet>Loading…</Quiet>;
  if (chat === null) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">No such chat</h1>
        <p className="mt-3">
          <Link href="/" className="underline underline-offset-2">
            Back to Home
          </Link>
        </p>
      </div>
    );
  }
  return <Conversation chat={chat} />;
}

function Conversation({ chat }: { chat: Chat }) {
  const send = useMutation(api.viewerChat.send);
  const cancel = useMutation(api.viewerChat.cancel);
  const brief = useMutation(api.viewerChat.continueInClaude);
  const archive = useMutation(api.viewerChat.archive);
  const [copied, setCopied] = useState(false);
  const now = useClock();
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const end = useRef<HTMLDivElement>(null);
  const busy = chat.turn !== null && ["queued", "claimed", "running"].includes(chat.turn.status);
  const away = chat.miniSeenAt === null || now - chat.miniSeenAt > AWAY_AFTER_MS;
  const last = chat.messages.at(-1);

  // Keep the newest words in view as they arrive.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [chat.messages.length, last?.content.length]);

  async function submit() {
    if (!text.trim() || busy) return;
    setError(undefined);
    const sending = text;
    setText("");
    try {
      await send({ chatId: chat.id, text: sending });
    } catch (caught) {
      setText(sending);
      setError(problem(caught));
    }
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  async function attempt(change: () => Promise<unknown>) {
    setError(undefined);
    try {
      await change();
    } catch (caught) {
      setError(problem(caught));
    }
  }

  const record = chat.scope.kind === "item" ? chat.scope.record : undefined;
  const recordHref = record ? itemHref(record.type, record.id) : undefined;
  return (
    <div>
      <h1 className="text-2xl font-semibold">{chat.title}</h1>
      <p className="mt-1 text-sm text-foreground/60">
        {record ? (
          <>
            About the {record.type}{" "}
            {recordHref ? (
              <Link href={recordHref} className="underline underline-offset-2">
                {record.title}
              </Link>
            ) : (
              record.title
            )}
          </>
        ) : (
          "An idea chat"
        )}
        {chat.continuedAt ? ` · continued in Claude ${showTime(chat.continuedAt)}` : ""}
        {chat.state === "archived" ? " · archived" : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {chat.state === "archived" ? (
          <button type="button" onClick={() => attempt(() => archive({ chatId: chat.id, restore: true }))} className={quiet}>
            Bring it back
          </button>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => attempt(() => brief({ chatId: chat.id }))} className={`${quiet} disabled:opacity-40`}>
              Continue in Claude
            </button>
            <button type="button" onClick={() => attempt(() => archive({ chatId: chat.id }))} className={quiet}>
              Archive
            </button>
          </>
        )}
      </div>

      <ol className="mt-8 space-y-6">
        {chat.messages.map((message) => (
          <li key={message.id}>
            <p className="text-xs text-foreground/60">
              {message.role === "user" ? "You" : "Skippy"} · {showTime(message.at)}
            </p>
            {message.content ? (
              <p className={`mt-1 text-base leading-7 whitespace-pre-wrap ${message.role === "user" ? "" : "text-foreground/90"}`}>{message.content}</p>
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
      <div ref={end} />

      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void submit();
        }}
        className="sticky bottom-0 mt-8 border-t border-foreground/15 bg-background py-3"
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKey}
          rows={Math.min(Math.max(text.split("\n").length, 1), 8)}
          disabled={chat.state === "archived"}
          placeholder={chat.state === "archived" ? "This chat is archived." : busy ? "Waiting for the reply…" : "Say something. Enter sends it."}
          aria-label="Message"
          className={field}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy || !text.trim()} className={`${button} disabled:opacity-50`}>
            Send
          </button>
          {busy ? (
            <button type="button" onClick={() => cancel({ chatId: chat.id })} className={button}>
              Stop waiting
            </button>
          ) : null}
          {error ? <span className="text-sm text-red-700 dark:text-red-300">{error}</span> : null}
        </div>
      </form>
    </div>
  );
}

/** Under the reply that is still to come: what is happening to it. */
function Status({ chat, away }: { chat: Chat; away: boolean }) {
  const turn = chat.turn;
  if (!turn) return null;
  if (turn.status === "queued") {
    return (
      <p className="mt-1 text-sm text-foreground/60">
        {away ? "Waiting for the Mac mini. Your message is saved and will be answered when it is back." : "Sent to the Mac mini…"}
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
