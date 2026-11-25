"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { EntityType } from "@skippy/shared";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState, type ChangeEvent } from "react";
import { button, problem, showTime } from "./parts";

/**
 * Files on a record: a list to open them from, a button to add more, and a
 * way to delete one. The bytes go straight from the browser to Convex file
 * storage; the page then tells Skippy what they are and where they belong.
 */

const quiet = "text-sm text-foreground/60 underline underline-offset-2";

export function showSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Sends one file to storage and returns what to call it by. */
export function useUpload() {
  const uploadUrl = useMutation(api.viewer.uploadUrl);
  return async (file: File): Promise<{ storageId: Id<"_storage">; fileName: string }> => {
    const response = await fetch(await uploadUrl(), {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!response.ok) throw new Error("The upload did not go through.");
    const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
    return { storageId, fileName: file.name };
  };
}

/**
 * A record's files. On a project's page the list sits above an "Add a file"
 * button. In a details window (`folded`) there is no button, since the chat
 * box below the record takes files and they land here; the list is folded
 * away under a "Files" line, and nothing at all is shown while there are none.
 */
export function Files({ type, id, folded }: { type: EntityType; id: string; folded?: boolean }) {
  const data = useQuery(api.viewer.files, { type, id });
  const add = useMutation(api.viewer.addFile);
  const remove = useMutation(api.viewer.removeFile);
  const upload = useUpload();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [error, setError] = useState<string>();

  async function chosen(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])];
    event.target.value = "";
    if (picked.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      for (const file of picked) await add({ ...(await upload(file)), to: { type, id } });
    } catch (caught) {
      setError(caught instanceof Error && !("data" in caught) ? caught.message : problem(caught));
    } finally {
      setBusy(false);
    }
  }

  const list =
    data && data.files.length > 0 ? (
      <ul className={folded ? "mt-3 space-y-2" : "mb-3 space-y-2"}>
        {data.files.map((file) => (
          <li key={file.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {removing === file.id ? (
              <>
                <span className="flex-1 text-sm">Delete “{file.fileName}” for good? This cannot be undone.</span>
                <button
                  type="button"
                  onClick={async () => {
                    setError(undefined);
                    try {
                      await remove({ id: file.id });
                    } catch (caught) {
                      setError(problem(caught));
                    }
                    setRemoving(undefined);
                  }}
                  className={button}
                >
                  Delete file
                </button>
                <button type="button" onClick={() => setRemoving(undefined)} className={button}>
                  Keep
                </button>
              </>
            ) : (
              <>
                {file.url ? (
                  <a href={file.url} target="_blank" rel="noreferrer" className="text-base underline underline-offset-2">
                    {file.fileName}
                  </a>
                ) : (
                  <span className="text-base">{file.fileName}</span>
                )}
                <span className="flex-1 text-xs text-foreground/60">
                  {showSize(file.sizeBytes)}
                  {file.addedAt ? ` · ${showTime(file.addedAt)}` : ""} · {file.addedBy}
                  {file.note ? ` · ${file.note}` : ""}
                </span>
                <button type="button" onClick={() => setRemoving(file.id)} aria-label={`Delete file ${file.fileName}`} className={quiet}>
                  Delete
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    ) : null;
  const problemLine = error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null;

  if (folded) {
    if (!data || data.files.length === 0) return null;
    return (
      <section className="border-t border-foreground/15 pt-4">
        <details>
          <summary className="cursor-pointer text-sm font-medium text-foreground/60">
            Files <span className="font-normal">· {data.files.length}</span>
          </summary>
          {list}
          {problemLine}
        </details>
      </section>
    );
  }
  return (
    <div>
      {list}
      <input ref={input} type="file" multiple onChange={chosen} className="hidden" aria-label="Choose files to add" />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className={`${button} disabled:opacity-50`}>
        {busy ? "Adding…" : "Add a file"}
      </button>
      {problemLine}
    </div>
  );
}
