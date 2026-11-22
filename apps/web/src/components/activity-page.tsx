"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { OwnerPage } from "./owner-page";
import { button, Quiet, showTime } from "./parts";

/** Who changed what, newest first. Filter to the owner's own changes or to what agents did. */

const FILTERS = [
  { who: undefined, label: "Everything" },
  { who: "agents", label: "Claude and other agents" },
  { who: "owner", label: "You" },
] as const;
const STEP = 50;

export function ActivityPage() {
  return (
    <OwnerPage wide>
      <Log />
    </OwnerPage>
  );
}

function Log() {
  const [who, setWho] = useState<(typeof FILTERS)[number]["who"]>(undefined);
  const [limit, setLimit] = useState(STEP);
  const data = useQuery(api.viewer.activityLog, { limit, ...(who ? { who } : {}) });
  return (
    <div>
      <h1 className="text-2xl font-semibold">Activity</h1>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Whose changes to show">
        {FILTERS.map((filter) => (
          <button
            key={filter.label}
            type="button"
            aria-pressed={who === filter.who}
            onClick={() => {
              setWho(filter.who);
              setLimit(STEP);
            }}
            className={`${button} ${who === filter.who ? "bg-foreground/10" : ""}`}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {data === undefined ? (
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
