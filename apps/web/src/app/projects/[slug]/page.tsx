import { Suspense } from "react";
import { ProjectPage } from "@/components/project-page";

/**
 * The slug is read in the browser, so the server sends the same shell for every
 * project and never reads project data itself. The Suspense boundary is what
 * lets that shell be prepared ahead of the request.
 */
export default function Page() {
  return (
    <Suspense fallback={<p className="mx-auto w-full max-w-3xl px-6 py-16">Loading…</p>}>
      <ProjectPage />
    </Suspense>
  );
}
