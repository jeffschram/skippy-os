import type { Metadata } from "next";
import { Suspense } from "react";
import { MemoryPage } from "@/components/memory-page";

export const metadata: Metadata = { title: "Memory · Skippy OS" };

export default function Page() {
  // The page reads the address in the browser (`?item=` opens a record), which needs this boundary.
  return (
    <Suspense fallback={<p className="mx-auto w-full max-w-3xl px-6 py-16">Loading…</p>}>
      <MemoryPage />
    </Suspense>
  );
}
