"use client";

import { api } from "@convex/_generated/api";
import type { EntityType } from "@skippy/shared";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { button, problem, showTime } from "./parts";

/** The chats about one record, and a box to start another. A chat opens on its own page. */
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
