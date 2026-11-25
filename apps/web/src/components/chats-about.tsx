"use client";

import { Robot } from "@phosphor-icons/react";
import { api } from "@convex/_generated/api";
import type { EntityType } from "@skippy/shared";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ChatBox, Messages, replyIsComing } from "./chat-thread";
import { button, problem, Quiet, showTime } from "./parts";

/** The chats about a project, and a box to start another. A project can have many chats, and each opens on its own page. */
export function ChatsAbout({ type, id }: { type: EntityType; id: string }) {
  const data = useQuery(api.viewerChat.chatsAbout, { type, id });
  const start = useMutation(api.viewerChat.start);
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const { chatId } = await start({ text, about: { type, id } });
      router.push(`/chat/${chatId}`);
    } catch (caught) {
      setError(problem(caught));
      setBusy(false);
    }
  }

  return (
    <div>
      {data && data.chats.length > 0 ? (
        <ul className="mb-3 space-y-1.5">
          {data.chats.map((chat) => (
            <li key={chat.id} className="flex flex-wrap items-baseline gap-x-3">
              <Link href={`/chat/${chat.id}`} className="text-base underline-offset-2 hover:underline">
                {chat.title}
              </Link>
              <span className="text-xs text-foreground/60">{showTime(chat.updatedAt)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Ask or say something about this"
          aria-label="Start a chat about this"
          className="min-w-48 flex-1 rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm"
        />
        <button type="submit" disabled={busy || !text.trim()} className={`${button} disabled:opacity-50`}>
          Chat
        </button>
      </form>
      {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </div>
  );
}

/**
 * The one chat about a task, an event or anything else that opens in a
 * details window, shown in the window itself, with the same box as the chat
 * page. The first message starts the chat; later ones go on the end of it.
 * A task's box also has "Delegate to Skippy": the session works on the task
 * and writes what it finds here as it goes. `delegable` is false for a
 * closed task.
 */
export function ItemChat({ type, id, delegable }: { type: EntityType; id: string; delegable?: boolean }) {
  const data = useQuery(api.viewerChat.itemChat, { type, id });
  const brief = useMutation(api.viewerChat.continueInClaude);
  const delegate = useMutation(api.viewerChat.delegate);
  const [error, setError] = useState<string>();
  if (data === undefined) return <Quiet>Loading…</Quiet>;
  const { chat, earlier } = data;

  async function handOver() {
    setError(undefined);
    try {
      await delegate({ taskId: id });
    } catch (caught) {
      setError(problem(caught));
    }
  }

  async function continueInClaude() {
    if (!chat) return;
    setError(undefined);
    try {
      await brief({ chatId: chat.id });
    } catch (caught) {
      setError(problem(caught));
    }
  }

  return (
    <div className="flex flex-1 flex-col justify-end gap-3">
      {chat ? (
        <>
          <Messages chat={chat} boxed />
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <button
              type="button"
              disabled={replyIsComing(chat)}
              onClick={continueInClaude}
              className="text-foreground/60 underline underline-offset-2 disabled:opacity-40"
            >
              Continue in Claude
            </button>
          </p>
          {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
        </>
      ) : null}
      <ChatBox
        chat={chat}
        about={{ type, id }}
        tools={
          type === "task"
            ? (busy) => (
                <button
                  type="button"
                  disabled={busy || !delegable}
                  onClick={handOver}
                  title={delegable ? "Skippy works on the task and reports here as it goes" : "Reopen the task to hand it over"}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full border border-foreground/20 px-3 text-sm text-foreground/80 hover:bg-foreground/5 hover:text-foreground disabled:opacity-40 sm:h-9"
                >
                  <Robot aria-hidden size={16} />
                  Delegate to Skippy
                </button>
              )
            : undefined
        }
      />
      {earlier.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm text-foreground/60">Earlier chats about this</summary>
          <ul className="mt-2 space-y-1.5">
            {earlier.map((old) => (
              <li key={old.id} className="flex flex-wrap items-baseline gap-x-3">
                <Link href={`/chat/${old.id}`} className="text-sm underline-offset-2 hover:underline">
                  {old.title}
                </Link>
                <span className="text-xs text-foreground/60">{showTime(old.updatedAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
