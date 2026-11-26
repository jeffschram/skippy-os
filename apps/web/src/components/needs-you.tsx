"use client";

import { ArrowSquareOut, Check, HandPalm, X } from "@phosphor-icons/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { itemHref } from "./item-href";
import { fromToday, Panel, Quiet, showDay, showTime } from "./parts";
import { useNow } from "./use-now";

/**
 * The top of Home: what needs the owner, so a glance says whether anything
 * does. What a pass or a chat flagged comes first, each line with links to
 * where it came from (the email, the calendar event, the record) and buttons
 * to tick it off or dismiss it. Then a plan within two weeks of its date with
 * things still to arrange, a project in trouble, the projects gone
 * quiet as one line, a pass that failed and the mini not answering.
 */
export function NeedsYou() {
  const data = useQuery(api.viewer.needsYou, { now: useNow() });
  const resolve = useMutation(api.viewer.resolveFlag);
  if (!data) return null;
  return (
    <Panel title="Needs you" icon={HandPalm}>
      {data.items.length === 0 ? (
        <Quiet>Nothing needs you right now.</Quiet>
      ) : (
        <ul className="space-y-4">
          {data.items.map((item) => {
            if (item.kind === "flag") {
              const href = item.about ? itemHref(item.about.type, item.about.id) : undefined;
              const close = (status: "done" | "dismissed") => void resolve({ id: item.id as Id<"flags">, status });
              return (
                <li key={item.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{item.title}</p>
                    {item.detail ? <p className="mt-0.5 text-sm text-foreground/70">{item.detail}</p> : null}
                    {href || item.links.length > 0 ? (
                      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {href && item.about ? (
                          <Link href={href} scroll={false} className="underline underline-offset-2">
                            {item.about.title}
                          </Link>
                        ) : null}
                        {item.links.map((link) => (
                          <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                            {link.label}
                            <ArrowSquareOut aria-hidden size="0.9em" className="ml-0.5 inline-block align-[-0.1em] text-foreground/60" />
                          </a>
                        ))}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => close("done")} className={iconButton} aria-label={`Done: ${item.title}`} title="Done">
                      <Check aria-hidden size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() => close("dismissed")}
                      className={iconButton}
                      aria-label={`Dismiss: ${item.title}`}
                      title="Dismiss"
                    >
                      <X aria-hidden size={18} />
                    </button>
                  </div>
                </li>
              );
            }
            if (item.kind === "plan_due") {
              return (
                <li key={`plan:${item.slug}`}>
                  <Link href={`/projects/${item.slug}`} className="font-medium underline underline-offset-2">
                    {item.title}
                  </Link>{" "}
                  is {fromToday(item.date)}
                  <span className="text-foreground/60"> · {showDay(item.date)}</span>
                  <p className="mt-1 text-sm text-foreground/70">
                    {item.open === 1 ? "One thing is" : `${item.open} things are`} still to arrange.
                  </p>
                </li>
              );
            }
            if (item.kind === "project_health") {
              return (
                <li key={`health:${item.slug}`}>
                  <Link href={`/projects/${item.slug}`} className="font-medium underline underline-offset-2">
                    {item.title}
                  </Link>{" "}
                  is {item.health === "blocked" ? "blocked" : "at risk"}
                  {item.since ? <span className="text-foreground/60"> · since {showTime(item.since)}</span> : null}
                  {item.note ? <p className="mt-1 line-clamp-2 text-sm text-foreground/70">{item.note}</p> : null}
                </li>
              );
            }
            if (item.kind === "projects_quiet") {
              const more = item.count - item.titles.length;
              return (
                <li key="quiet">
                  <Link href="/projects" className="font-medium underline underline-offset-2">
                    {item.count === 1 ? "A project has" : `${item.count} projects have`} gone quiet
                  </Link>
                  <p className="mt-1 text-sm text-foreground/70">
                    {item.titles.join(", ")}
                    {more > 0 ? ` and ${more} more` : ""}: no status report lately.
                  </p>
                </li>
              );
            }
            if (item.kind === "pass_failed") {
              return (
                <li key="pass">
                  <Link href="/activity" className="font-medium underline underline-offset-2">
                    The {item.pass ? `${item.pass} ` : ""}ingestion pass failed
                  </Link>
                  <span className="text-foreground/60"> · {showTime(item.at)}</span>
                  {item.note ? <p className="mt-1 line-clamp-2 text-sm text-foreground/70">{item.note}</p> : null}
                </li>
              );
            }
            return (
              <li key="mini">
                <span className="font-medium">The Mac mini has not checked in</span>
                <span className="text-foreground/60"> · since {showTime(item.since)}</span>
                <p className="mt-1 text-sm text-foreground/70">Chats wait until it is back.</p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

const iconButton = "grid size-8 place-items-center rounded-md border border-foreground/20 text-foreground/70 hover:bg-foreground/5 hover:text-foreground";
