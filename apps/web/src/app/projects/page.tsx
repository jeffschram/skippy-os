import type { Metadata } from "next";
import { Suspense } from "react";
import { ProjectsBoard } from "@/components/projects-board";

export const metadata: Metadata = { title: "Projects · Skippy OS" };

export default function Page() {
  // The page reads the address in the browser (`?task=` opens a task), which needs this boundary.
  return (
    <Suspense fallback={<p className="mx-auto w-full max-w-3xl px-6 py-16">Loading…</p>}>
      <ProjectsBoard />
    </Suspense>
  );
}
