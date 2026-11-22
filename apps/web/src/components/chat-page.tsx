"use client";

import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { itemHref } from "./item-details";
import { OwnerPage } from "./owner-page";
import { button, problem, Quiet, showTime } from "./parts";

/**
 * One chat. The owner's message is saved at once; the reply is written by a
 * Claude Code session on the mini and appears here as it comes. When the mini
 * is not there, the message waits and the page says so.
 */

type Chat = NonNullable<FunctionReturnType<typeof api.viewerChat.chat>>;

/** The mini says "alive" every half minute. Three missed in a row means it is away. */
const AWAY_AFTER_MS = 100_000;
const field = "w-full resize-none rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base";

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
      </p>

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
          placeholder={busy ? "Waiting for the reply…" : "Say something. Enter sends it."}
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
