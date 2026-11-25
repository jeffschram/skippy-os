"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * The old address of a chat, `/chat/<id>`. A chat now opens in a window over
 * Home (`?chat=<id>`, see `chat-window.tsx`), so a bookmark or an old link
 * goes there.
 */
export function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/?chat=${encodeURIComponent(id)}`);
  }, [id, router]);
  return <p className="mx-auto w-full max-w-3xl px-6 py-16">Opening the chat…</p>;
}
