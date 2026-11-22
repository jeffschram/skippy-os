"use client";

import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { itemHref } from "./item-details";
import { button, Panel, problem, Quiet, showTime, Tag } from "./parts";

/**
 * What ingestion did: the latest passes over the calendar, mail and messages,
 * what each made and where it came from, with a way to take any of it back.
 * An undo can carry a reason, which becomes a rule later passes follow.
 * Settings shows the same rules and the block list, to add to and edit.
 */

type Ingestion = FunctionReturnType<typeof api.viewer.ingestion>;
type Run = Ingestion["runs"][number];
type Made = Run["made"][number];

const SOURCES = { google_calendar: "Calendar", gmail: "Mail", imessage: "Messages" } as const;
const field = "rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm";
const quiet = "text-sm text-foreground/60 underline underline-offset-2";

/** Home's panel. It shows nothing until a first pass has run. */
export function IngestedPanel() {
  const data = useQuery(api.viewer.ingestion, { runs: 8 });
  if (!data || data.runs.length === 0) return null;
  const withSomething = data.runs.filter((run) => run.made.length > 0 || run.status !== "finished" || run.sources.some((source) => source.error));
  return (
    <Panel title="Ingested" note={<Health health={data.health} />}>
      {withSomething.length === 0 ? (
        <Quiet>The latest passes read everything and made nothing new.</Quiet>
      ) : (
        <div className="space-y-6">
          {withSomething.map((run) => (
            <RunBlock key={run.id} run={run} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function Health({ health }: { health: Ingestion["health"] }) {
  return (
    <span>
      {health
        .map((entry) => `${SOURCES[entry.source]} ${entry.coveredAt ? `read ${showTime(entry.coveredAt)}` : "not read yet"}${entry.lastError ? " (problem)" : ""}`)
        .join(" · ")}
    </span>
  );
}

function RunBlock({ run }: { run: Run }) {
  const live = run.made.filter((made) => !made.undone);
  // A first calendar pass can copy a hundred events; keep those behind a fold.
  const calendar = live.filter((made) => made.source === "google_calendar");
  const rest = live.filter((made) => made.source !== "google_calendar");
  const fold = calendar.length > 5;
  const errors = run.sources.filter((source) => source.error);
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-foreground/60">
        {showTime(run.startedAt)}
        {run.pass ? ` · ${run.pass}` : ""}
        {run.status === "running" ? " · running" : run.status === "failed" ? " · failed" : ""}
        {run.sources.length > 0 ? ` · read ${run.sources.map((source) => `${source.read} from ${SOURCES[source.source].toLowerCase()}`).join(", ")}` : ""}
      </h3>
      {errors.map((source) => (
        <p key={source.source} className="mb-2 text-sm text-red-700 dark:text-red-300">
          {SOURCES[source.source]}: {source.error}
        </p>
      ))}
      {run.note ? <p className="mb-2 text-sm text-foreground/70">{run.note}</p> : null}
      {rest.length > 0 ? (
        <ul className="space-y-3">
          {rest.map((made) => (
            <MadeRow key={made.id} made={made} />
          ))}
        </ul>
      ) : null}
      {calendar.length > 0 ? (
        fold ? (
          <details className={rest.length > 0 ? "mt-3" : ""}>
            <summary className="cursor-pointer text-sm text-foreground/70">{calendar.length} events copied from your calendar</summary>
            <ul className="mt-3 space-y-3">
              {calendar.map((made) => (
                <MadeRow key={made.id} made={made} />
              ))}
            </ul>
          </details>
        ) : (
          <ul className={`space-y-3 ${rest.length > 0 ? "mt-3" : ""}`}>
            {calendar.map((made) => (
              <MadeRow key={made.id} made={made} />
            ))}
          </ul>
        )
      ) : null}
      {live.length === 0 && errors.length === 0 && !run.note ? <Quiet>Nothing left from this pass.</Quiet> : null}
    </div>
  );
}

function MadeRow({ made }: { made: Made }) {
  const undo = useMutation(api.viewer.undoIngested);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const href = made.record ? itemHref(made.record.type, made.record.id) : undefined;

  async function run(force: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      const result = await undo({ receiptId: made.id, ...(reason.trim() ? { reason } : {}), ...(force ? { force } : {}) });
      if (result.needsConfirm) setConfirm(result.needsConfirm);
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {made.record && href ? (
          <Link href={href} scroll={false} className="text-base underline-offset-2 hover:underline">
            {made.record.title}
          </Link>
        ) : (
          <span className="text-base">{made.record?.title ?? "(deleted since)"}</span>
        )}
        <Tag>{made.record?.type ?? "gone"}</Tag>
        {made.action === "updated" ? <Tag>added to</Tag> : null}
        <span className="flex-1 text-xs text-foreground/60">
          from {SOURCES[made.source].toLowerCase()}
          {made.url ? (
            <>
              {" · "}
              <a href={made.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                open the original
              </a>
            </>
          ) : null}
        </span>
        {made.action === "created" && made.record && !open ? (
          <button type="button" onClick={() => setOpen(true)} className={quiet}>
            Undo
          </button>
        ) : null}
      </div>
      {made.source === "google_calendar" ? null : <p className="mt-0.5 text-sm text-foreground/70">{made.summary}</p>}
      {open ? (
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void run(false);
          }}
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          {confirm ? (
            <>
              <span className="flex-1 text-sm">{confirm}</span>
              <button type="button" disabled={busy} onClick={() => run(true)} className={button}>
                Delete it anyway
              </button>
            </>
          ) : (
            <>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why, if later passes should learn from it (optional)"
                aria-label="Reason"
                className={`min-w-64 flex-1 ${field}`}
              />
              <button type="submit" disabled={busy} className={button}>
                {busy ? "Undoing…" : "Undo it"}
              </button>
            </>
          )}
          <button type="button" onClick={() => setOpen(false)} className={button}>
            Keep
          </button>
        </form>
      ) : null}
      {error ? <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </li>
  );
}

/** Settings: the rules passes follow and the things they leave out. */
export function IngestionRules() {
  const data = useQuery(api.viewer.ingestion, { runs: 1 });
  const save = useMutation(api.viewer.saveIngestionRule);
  const remove = useMutation(api.viewer.removeIngestionRule);
  const [kind, setKind] = useState<"rule" | "block">("rule");
  const [source, setSource] = useState<"" | keyof typeof SOURCES>("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();

  async function attempt(change: () => Promise<unknown>) {
    setError(undefined);
    try {
      await change();
      return true;
    } catch (caught) {
      setError(problem(caught));
      return false;
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (await attempt(() => save({ kind, text, ...(source ? { source } : {}) }))) setText("");
  }

  if (data === undefined) return <Quiet>Loading…</Quiet>;
  return (
    <div>
      <p className="text-sm text-foreground/70">
        Each pass reads these before it reads anything else. A rule says how to judge; a block names a sender, a conversation or a
        calendar to leave out. An undo with a reason adds a rule here.
      </p>
      <p className="mt-2 text-sm text-foreground/60">
        <Health health={data.health} />
      </p>
      {data.rules.length === 0 ? (
        <div className="mt-4">
          <Quiet>No rules yet. Passes follow the built-in rubric alone.</Quiet>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {data.rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Tag>{rule.kind === "block" ? "leave out" : "rule"}</Tag>
              {rule.source ? <Tag>{SOURCES[rule.source].toLowerCase()}</Tag> : null}
              <span className={`min-w-0 flex-1 text-sm ${rule.active ? "" : "text-foreground/50 line-through"}`}>{rule.text}</span>
              <button type="button" onClick={() => attempt(() => save({ id: rule.id, active: !rule.active }))} className={quiet}>
                {rule.active ? "Switch off" : "Switch on"}
              </button>
              <button type="button" onClick={() => attempt(() => remove({ id: rule.id }))} aria-label={`Remove rule: ${rule.text}`} className={quiet}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="mt-4 flex flex-wrap gap-2">
        <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Kind" className={field}>
          <option value="rule">Rule</option>
          <option value="block">Leave out</option>
        </select>
        <select value={source} onChange={(event) => setSource(event.target.value as typeof source)} aria-label="Source" className={field}>
          <option value="">Everywhere</option>
          {Object.entries(SOURCES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={kind === "block" ? "A sender, a conversation or a calendar, such as news@example.com" : "A rule in plain words, such as: school newsletters never need a task"}
          aria-label="Rule text"
          className={`min-w-64 flex-1 ${field}`}
        />
        <button type="submit" disabled={!text.trim()} className={`${button} disabled:opacity-50`}>
          Add
        </button>
      </form>
      {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </div>
  );
}
