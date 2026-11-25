"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { InboxPanel } from "./capture";
import { OwnerPage } from "./owner-page";
import { button, Quiet, showTime } from "./parts";

/**
 * The inbox of captures waiting to be filed, then who changed what, newest first, filtered to the owner's own changes or to
 * what agents did. The ingestion passes have their own list: every pass, with
 * what it read and its own note, including the ones that made nothing.
 */

const FILTERS = [
  { who: undefined, label: "Everything" },
  { who: "agents", label: "Claude and other agents" },
  { who: "owner", label: "You" },
] as const;
const STEP = 50;
const SOURCES = { google_calendar: "calendar", gmail: "mail", imessage: "messages" } as const;

export function ActivityPage() {
  return (
    <OwnerPage wide>
      <div className="space-y-12">
        <InboxPanel />
        <Log />
      </div>
    </OwnerPage>
  );
}

/** Every ingestion pass, newest first: when, what it read, how much it made, and what it said. */
function Passes() {
  const data = useQuery(api.viewer.ingestion, { runs: 30 });
  if (data === undefined) return <Quiet>Loading…</Quiet>;
  if (data.runs.length === 0) return <Quiet>No ingestion pass has run yet.</Quiet>;
  return (
    <ul className="space-y-4">
      {data.runs.map((run) => {
        const made = run.made.filter((entry) => !entry.undone).length;
        const failed = run.status === "failed" || run.sources.some((source) => source.error);
        return (
          <li key={run.id} className="border-b border-foreground/10 pb-4">
            <p>
              <span className="font-medium">{showTime(run.startedAt)}</span>
              {run.pass ? ` · ${run.pass}` : ""}
              <span className={failed ? "text-red-700 dark:text-red-300" : "text-foreground/60"}>
                {" "}
                · {run.status === "running" ? "running" : run.status === "failed" ? "failed" : `made ${made} ${made === 1 ? "record" : "records"}`}
              </span>
            </p>
            {run.sources.length > 0 ? (
              <p className="text-sm text-foreground/60">
                Read {run.sources.map((source) => `${source.read} from ${SOURCES[source.source]}${source.skipped > 0 ? ` (${source.skipped} left out)` : ""}`).join(", ")}
              </p>
            ) : null}
            {run.sources
              .filter((source) => source.error)
              .map((source) => (
                <p key={source.source} className="text-sm text-red-700 dark:text-red-300">
                  {SOURCES[source.source]}: {source.error}
                </p>
              ))}
            {run.note ? <p className="mt-1 text-sm text-foreground/80">{run.note}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

function Log() {
  const [who, setWho] = useState<(typeof FILTERS)[number]["who"]>(undefined);
  const [passes, setPasses] = useState(false);
  const [limit, setLimit] = useState(STEP);
  const data = useQuery(api.viewer.activityLog, passes ? "skip" : { limit, ...(who ? { who } : {}) });
  return (
    <div>
      <h1 className="text-2xl font-semibold">Activity</h1>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="What to show">
        {FILTERS.map((filter) => (
          <button
            key={filter.label}
            type="button"
            aria-pressed={!passes && who === filter.who}
            onClick={() => {
              setPasses(false);
              setWho(filter.who);
              setLimit(STEP);
            }}
            className={`${button} ${!passes && who === filter.who ? "bg-foreground/10" : ""}`}
          >
            {filter.label}
          </button>
        ))}
        <button type="button" aria-pressed={passes} onClick={() => setPasses(true)} className={`${button} ${passes ? "bg-foreground/10" : ""}`}>
          Ingestion passes
        </button>
      </div>
      <div className="mt-6">
        {passes ? (
          <Passes />
        ) : data === undefined ? (
          <Quiet>Loading…</Quiet>
        ) : data.events.length === 0 ? (
          <Quiet>Nothing here yet.</Quiet>
        ) : (
          <>
            <ul className="space-y-3">
              {data.events.map((event) => (
                <li key={event.id} className="border-b border-foreground/10 pb-3">
                  <p className="line-clamp-5 text-base">{event.summary}</p>
                  <p className="text-sm text-foreground/60">
                    {event.by} · {showTime(event.at)}
                    {event.project ? (
                      <>
                        {" · "}
                        <Link href={`/projects/${event.project}`} className="underline underline-offset-2">
                          {event.project}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
            {data.more && limit < 500 ? (
              <button type="button" onClick={() => setLimit(Math.min(limit + STEP, 500))} className={`mt-4 ${button}`}>
                Show more
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
