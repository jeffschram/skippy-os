"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ChatBox, Messages, replyIsComing, type Chat } from "./chat-thread";
import { ComposerBar } from "./composer";
import { itemHref } from "./item-href";
import { OwnerPage } from "./owner-page";
import { problem, Quiet, showTime } from "./parts";

/**
 * One chat on its own page: what it is about, Continue in Claude and Archive,
 * the messages, and the box pinned to the bottom. The messages and the box are
 * shared with the details window (`chat-thread.tsx`).
 */

const quiet = "text-foreground/60 underline underline-offset-2";

export function ChatPage() {
  return (
    <OwnerPage dock={false}>
      <Loaded />
    </OwnerPage>
  );
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
      {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <Messages chat={chat} />
      <ComposerBar>
        <ChatBox chat={chat} />
      </ComposerBar>
    </div>
  );
}
