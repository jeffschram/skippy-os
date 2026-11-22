import type { Metadata } from "next";
import { Suspense } from "react";
import { MemoryPage } from "@/components/memory-page";

export const metadata: Metadata = { title: "Memory · Skippy OS" };

/** The section is read in the browser, so the server sends the same shell for every section. */
export default function Page() {
  return (
    <Suspense fallback={<p className="mx-auto w-full max-w-3xl px-6 py-16">Loading…</p>}>
      <MemoryPage />
    </Suspense>
  );
}
