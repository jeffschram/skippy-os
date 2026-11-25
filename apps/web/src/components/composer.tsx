"use client";

import { ArrowUp, FilePdf, File as FileIcon, Plus, Stop, X } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { showSize } from "./files";

/**
 * The box things are typed into: on the chat page and docked at the bottom of
 * every other page. One rounded box, two lines tall to start, that grows with the words, with a row of
 * buttons inside it: add a file on the left, send on the right. Files come in
 * by the button, by pasting, or by being dragged onto the box, and each shows
 * as a chip that can be taken off again before sending.
 *
 * It holds no words or files of its own: the page that uses it does, and
 * decides what sending means.
 */

/** What a chat's session can read. The same list is checked again when the message is saved. */
export const CHAT_FILE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"];
export const MAX_CHAT_FILES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** The bar a composer sits in when it is pinned to the bottom of the screen. */
export function ComposerBar({ wide, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-background before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6 before:bg-linear-to-t before:from-background before:to-transparent">
      <div className={`mx-auto w-full px-6 pt-1 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.75rem))] sm:pb-6 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>{children}</div>
    </div>
  );
}

// One address per file being shown, made once and given back when the file leaves the box.
const previews = new Map<File, string>();
function preview(file: File): string {
  let url = previews.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    previews.set(file, url);
  }
  return url;
}
function forget(keep: readonly File[]) {
  for (const [file, url] of previews) {
    if (keep.includes(file)) continue;
    URL.revokeObjectURL(url);
    previews.delete(file);
  }
}

export function Composer({
  text,
  onText,
  files,
  onFiles,
  onSend,
  onStop,
  accept,
  refusal = "That kind of file cannot be added here.",
  maxFiles = MAX_CHAT_FILES,
  label,
  placeholder,
  sendLabel,
  canSend,
  disabled,
  tools,
  status,
}: {
  text: string;
  onText: (text: string) => void;
  files: File[];
  onFiles: (files: File[]) => void;
  onSend: () => void;
  /** When given, the send button becomes a stop button: a reply is on its way. */
  onStop?: () => void;
  /** The content types that can be added. Leave out to take any file. */
  accept?: readonly string[];
  /** What to say when a file is not one of them. */
  refusal?: string;
  maxFiles?: number;
  label: string;
  placeholder: string;
  sendLabel: string;
  canSend: boolean;
  disabled?: boolean;
  /** Controls that sit beside the add-file button, such as the switch on the dock. */
  tools?: ReactNode;
  /** A line about what just happened, or what went wrong. */
  status?: ReactNode;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [notice, setNotice] = useState<string>();

  // The box is as tall as its words, up to the limit the stylesheet sets.
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [text, placeholder]);
  // The same words take more or fewer lines when the box changes width, as it does when the page first lays out.
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    let width = element.clientWidth;
    const watcher = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    });
    watcher.observe(element);
    return () => watcher.disconnect();
  }, []);

  useEffect(() => forget(files), [files]);
  useEffect(() => () => forget([]), []);

  function add(incoming: File[]) {
    if (incoming.length === 0 || disabled) return;
    const fits = incoming.filter((file) => (!accept || accept.includes(file.type)) && file.size <= MAX_FILE_BYTES);
    const room = Math.max(maxFiles - files.length, 0);
    setNotice(
      fits.length < incoming.length
        ? incoming.some((file) => file.size > MAX_FILE_BYTES)
          ? "A file can be up to 25 MB."
          : refusal
        : fits.length > room
          ? maxFiles === 1
            ? "One file at a time here. Take the first one off to add another."
            : `Up to ${maxFiles} files at a time.`
          : undefined,
    );
    if (fits.length > 0 && room > 0) onFiles([...files, ...fits.slice(0, room)]);
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter starts a new line.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) onSend();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = [...event.clipboardData.files];
    if (pasted.length === 0) return;
    event.preventDefault();
    add(pasted);
  }

  const dragging = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      <div
        onDragOver={(event) => {
          if (!dragging(event)) return;
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          if (!dragging(event)) return;
          event.preventDefault();
          setOver(false);
          add([...event.dataTransfer.files]);
        }}
        className={`rounded-2xl border bg-background px-3 pt-3 pb-2.5 shadow-sm focus-within:border-foreground/45 ${over ? "border-foreground/60 bg-foreground/5" : "border-foreground/20"}`}
      >
        {files.length > 0 ? (
          <ul className="mb-2 flex flex-wrap gap-2">
            {files.map((file, index) => (
              <li key={`${file.name}-${file.lastModified}-${index}`} className="flex max-w-full items-center gap-2 rounded-lg border border-foreground/15 py-1 pr-1 pl-1.5 text-sm">
                {file.type.startsWith("image/") ? (
                  // A picture still on this device: there is no address for the image component to load it from.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview(file)} alt="" className="size-9 rounded object-cover" />
                ) : file.type === "application/pdf" ? (
                  <FilePdf aria-hidden size={28} className="text-foreground/60" />
                ) : (
                  <FileIcon aria-hidden size={28} className="text-foreground/60" />
                )}
                <span className="min-w-0">
                  <span className="block max-w-44 truncate">{file.name}</span>
                  <span className="block text-xs text-foreground/60">{showSize(file.size)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setNotice(undefined);
                    onFiles(files.filter((_, at) => at !== index));
                  }}
                  aria-label={`Take off ${file.name}`}
                  className="inline-flex size-8 items-center justify-center rounded-md text-foreground/60 hover:bg-foreground/5 hover:text-foreground"
                >
                  <X aria-hidden size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={area}
          value={text}
          onChange={(event) => onText(event.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={label}
          enterKeyHint="send"
          className="block min-h-14 max-h-[40vh] w-full resize-none overflow-y-auto bg-transparent px-1 text-base leading-7 outline-none placeholder:text-foreground/50"
        />
        <div className="mt-2 flex items-center gap-2">
          <input
            ref={picker}
            type="file"
            multiple={maxFiles > 1}
            accept={accept?.join(",")}
            onChange={(event) => {
              add([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
            className="hidden"
            tabIndex={-1}
            aria-hidden
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => picker.current?.click()}
            aria-label={accept ? "Add an image or a PDF" : "Add a file"}
            title={accept ? "Add an image or a PDF" : "Add a file"}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-foreground/20 text-foreground/70 hover:bg-foreground/5 hover:text-foreground disabled:opacity-40 sm:size-9"
          >
            <Plus aria-hidden size={18} />
          </button>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">{tools}</div>
          {onStop ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop waiting for the reply"
              title="Stop waiting for the reply"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-foreground/30 hover:bg-foreground/5 sm:size-9"
            >
              <Stop aria-hidden size={16} weight="fill" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label={sendLabel}
              title={sendLabel}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-30 sm:size-9"
            >
              <ArrowUp aria-hidden size={18} weight="bold" />
            </button>
          )}
        </div>
      </div>
      {notice || status ? (
        <p aria-live="polite" className="mt-1.5 min-h-5 px-1 text-sm text-foreground/60">
          {notice ? <span className="text-red-700 dark:text-red-300">{notice} </span> : null}
          {status}
        </p>
      ) : null}
    </form>
  );
}
