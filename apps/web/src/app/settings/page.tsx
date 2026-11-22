import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsPage } from "@/components/settings-page";

export const metadata: Metadata = { title: "Settings · Skippy OS" };

export default function Page() {
  // The page reads the address in the browser (`?task=` opens a task), which needs this boundary.
  return (
    <Suspense fallback={<p className="mx-auto w-full max-w-3xl px-6 py-16">Loading…</p>}>
      <SettingsPage />
    </Suspense>
  );
}
