import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatPage } from "@/components/chat-page";

export const metadata: Metadata = { title: "Chat · Skippy OS" };

/** The chat's id is read in the browser, so the server sends the same shell for every chat. */
export default function Page() {
  return (
    <Suspense fallback={<p className="mx-auto w-full max-w-3xl px-6 py-16">Loading…</p>}>
      <ChatPage />
    </Suspense>
  );
}
