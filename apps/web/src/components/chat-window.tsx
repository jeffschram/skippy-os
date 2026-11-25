"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChatBox, Messages, replyIsComing, type Chat } from "./chat-thread";
import { DetailsWindow, WindowButtons } from "./details-window";
import { itemHref } from "./item-href";
import { button, problem, Quiet, showTime } from "./parts";

/**
 * A chat, opened over whatever page the owner is on by adding `?chat=<id>` to
 * the address, like a task's details. Close, Escape or a click outside goes
 * back to the page underneath. At the top: what it is about, Continue in
 * Claude and Archive; then the messages, scrolling in their own box; then the
 * box to write in. The messages and the box are shared with the details
 * window's chat (`chat-thread.tsx`).
 */

const quiet = "text-foreground/60 underline underline-offset-2";

export function ChatWindow() {
  const id = useSearchParams().get("chat");
  const path = usePathname();
  const router = useRouter();
  const close = () => router.replace(path, { scroll: false });

  useEffect(() => {
    if (!id) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") router.replace(path, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, path, router]);

  if (!id) return null;
  return (
    <DetailsWindow label="Chat" onClose={close}>
      <Loaded key={id} id={id} onClose={close} />
    </DetailsWindow>
  );
}

function Loaded({ id, onClose }: { id: string; onClose: () => void }) {
  const chat = useQuery(api.viewerChat.chat, { id });
  if (chat === undefined) return <Quiet>Loading…</Quiet>;
  if (chat === null) {
    return (
      <div>
        <p>There is no chat at that address.</p>
        <button type="button" onClick={onClose} className={`mt-4 ${button}`}>
          Close
        </button>
      </div>
    );
  }
  return <Conversation chat={chat} onClose={onClose} />;
}

function Conversation({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const brief = useMutation(api.viewerChat.continueInClaude);
  const archive = useMutation(api.viewerChat.archive);
  const [error, setError] = useState<string>();
  const busy = replyIsComing(chat);

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
    <>
      <div className="flex shrink-0 items-start justify-between gap-4 pb-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{chat.title}</h2>
          <p className="mt-1 text-sm text-foreground/60">
            {record ? (
              <>
                About the {record.type}{" "}
                {recordHref ? (
                  <Link href={recordHref} scroll={false} className="underline underline-offset-2">
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
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
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
          {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
        </div>
        <WindowButtons onClose={onClose} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <Messages chat={chat} boxed />
        <ChatBox chat={chat} />
      </div>
    </>
  );
}
