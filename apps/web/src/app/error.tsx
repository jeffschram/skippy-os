"use client";

import { useEffect } from "react";

export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Skippy OS</h1>
      <p className="mt-3 text-base leading-7">Something went wrong while loading this page.</p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-6 rounded-md border border-foreground/20 px-4 py-2 text-sm font-medium hover:bg-foreground/5"
      >
        Try again
      </button>
    </main>
  );
}
