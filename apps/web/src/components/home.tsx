"use client";

import { CalendarDot, ChatsCircle, Eye, HandPalm, Kanban, NewspaperClipping, Pulse } from "@phosphor-icons/react";
import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { EventRow, RecurrenceRow } from "./calendar-parts";
import { InboxPanel } from "./capture";
import { IngestedPanel } from "./ingested";
import { OwnerPage } from "./owner-page";
import { button } from "./parts";
import { Panel, Quiet, showDay, showTime, staleNote, Tag, words } from "./parts";
import { AddTask, TaskList, type Task } from "./tasks";
import { useNow } from "./use-now";

/** Home: the morning briefing, what needs the owner, the inbox, today's tasks, the live projects and the latest activity. Each panel is its own live query. */

export function Home() {
  return (
    <OwnerPage>
      <div className="space-y-12">
        <Briefing />
        <WeeklyReview />
        <NeedsYou />
        <InboxPanel />
        <Today />
        <Chats />
        <SinceLastLook />
        <IngestedPanel />
        <Projects />
        <Activity />
      </div>
    </OwnerPage>
  );
}

/** The morning note. Shown once one has been written; an older one says which day it is from. */
function Briefing() {
  const briefing = useQuery(api.viewer.briefing, { now: useNow() });
  if (!briefing) return null;
  return (
    <Panel title="Briefing" icon={NewspaperClipping} note={briefing.isToday ? showDay(briefing.date) : `from ${showDay(briefing.date)}`}>
      <p className={`text-base leading-7 whitespace-pre-wrap ${briefing.isToday ? "" : "text-foreground/70"}`}>{briefing.text}</p>
      <p className="mt-3 text-xs text-foreground/60">
        {briefing.by} · {showTime(briefing.writtenAt)}
      </p>
    </Panel>
  );
}

/** This week's review, folded away under the briefing. Shown while it is at most eight days old. */
function WeeklyReview() {
  const review = useQuery(api.viewer.weeklyReview, { now: useNow() });
  if (!review) return null;
  return (
    <details>
      <summary className="cursor-pointer border-b border-foreground/15 pb-2 text-lg font-semibold">
        Weekly review <span className="text-sm font-normal text-foreground/60">· {showDay(review.date)}</span>
      </summary>
      <p className="mt-4 text-base leading-7 whitespace-pre-wrap">{review.text}</p>
      <p className="mt-3 text-xs text-foreground/60">
        {review.by} · {showTime(review.writtenAt)}
      </p>
    </details>
  );
}

/** The latest chats. Shown once there is one. */
function Chats() {
  const data = useQuery(api.viewerChat.chats, { limit: 5 });
  if (!data || data.chats.length === 0) return null;
  return (
    <Panel title="Chats" icon={ChatsCircle}>
      <ul className="space-y-2">
        {data.chats.map((chat) => (
          <li key={chat.id} className="flex flex-wrap items-baseline gap-x-3">
            <Link href={`/chat/${chat.id}`} className="text-base underline-offset-2 hover:underline">
              {chat.title}
            </Link>
            <span className="text-xs text-foreground/60">
              {chat.scope.kind === "item" && chat.scope.record ? `${chat.scope.record.title} · ` : ""}
              {showTime(chat.updatedAt)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Today() {
  const today = useQuery(api.viewer.today, { now: useNow() });
  if (today === undefined) {
    return (
      <Panel title="Today" icon={CalendarDot}>
        <Quiet>Loading…</Quiet>
      </Panel>
    );
  }
  const groups: [string, Task[]][] = [
    ["Overdue", today.overdue],
    ["Due today", today.dueToday],
    ["Planned for today", today.scheduled],
    ["Waiting", today.waiting],
  ];
  const shown = groups.filter(([, tasks]) => tasks.length > 0);
  return (
    <Panel title="Today" icon={CalendarDot} note={showDay(today.date)}>
      {shown.length + today.events.length + today.recurrences.length === 0 ? (
        <Quiet>Nothing needs you today.</Quiet>
      ) : (
        <div className="space-y-6">
          {today.events.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground/60">On today</h3>
              <ul className="space-y-2">
                {today.events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
            </div>
          ) : null}
          {today.recurrences.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground/60">Coming round</h3>
              <ul className="space-y-2">
                {today.recurrences.map((item) => (
                  <RecurrenceRow key={item.id} item={item} showDue />
                ))}
              </ul>
            </div>
          ) : null}
          {shown.map(([label, tasks]) => (
            <div key={label}>
              <h3 className="mb-2 text-sm font-medium text-foreground/60">{label}</h3>
              <TaskList tasks={tasks} showProject />
            </div>
          ))}
        </div>
      )}
      <AddTask />
    </Panel>
  );
}

/**
 * What will not move until the owner does something: a project in trouble or
 * gone quiet, a pass that failed, the mini not answering. Not shown when empty.
 */
function NeedsYou() {
  const data = useQuery(api.viewer.needsYou, { now: useNow() });
  const save = useMutation(api.viewer.saveProject);
  if (!data || data.items.length === 0) return null;
  return (
    <Panel title="Needs you" icon={HandPalm}>
      <ul className="space-y-3">
        {data.items.map((item) => {
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
          if (item.kind === "project_quiet") {
            return (
              <li key={`quiet:${item.slug}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span>
                  <Link href={`/projects/${item.slug}`} className="font-medium underline underline-offset-2">
                    {item.title}
                  </Link>{" "}
                  has gone quiet
                  <span className="text-foreground/60">
                    {" "}
                    · {item.days === undefined ? "no status report yet" : `no status report in ${item.days} days`}
                  </span>
                </span>
                <button type="button" onClick={() => void save({ slug: item.slug, status: "paused" })} className={button}>
                  Pause
                </button>
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
    </Panel>
  );
}

/** What Claude and other agents recorded since the owner last cleared this list. */
function SinceLastLook() {
  const data = useQuery(api.viewer.sinceLastLook);
  const markSeen = useMutation(api.viewer.markSeen);
  if (data === undefined) {
    return (
      <Panel title="Since you last looked" icon={Eye}>
        <Quiet>Loading…</Quiet>
      </Panel>
    );
  }
  const newest = data.newestAt;
  return (
    <Panel
      title="Since you last looked"
      icon={Eye}
      note={data.count > 0 ? `${data.count} from Claude` : data.seenAt ? `cleared ${showTime(data.seenAt)}` : undefined}
    >
      {data.events.length === 0 || newest === undefined ? (
        <Quiet>Nothing new from Claude.</Quiet>
      ) : (
        <>
          <ul className="space-y-3">
            {data.events.map((event) => (
              <li key={event.id}>
                <p className="line-clamp-4 text-base">{event.summary}</p>
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
          {data.count > data.events.length ? (
            <p className="mt-3 text-sm text-foreground/60">And {data.count - data.events.length} older ones.</p>
          ) : null}
          <button type="button" onClick={() => markSeen({ through: newest })} className={`mt-4 ${button}`}>
            Mark all as seen
          </button>
        </>
      )}
    </Panel>
  );
}

function Projects() {
  const data = useQuery(api.viewer.projects, { now: useNow() });
  const live = data?.projects.filter((project) => project.status === "active");
  return (
    <Panel title="Projects" icon={Kanban} note={<Link href="/projects" className="underline underline-offset-2">All projects</Link>}>
      {live === undefined ? (
        <Quiet>Loading…</Quiet>
      ) : live.length === 0 ? (
        <Quiet>No active projects.</Quiet>
      ) : (
        <ul className="space-y-4">
          {live.map((project) => (
            <li key={project.slug}>
              <p className="flex flex-wrap items-center gap-2">
                <Link href={`/projects/${project.slug}`} className="text-base font-medium underline-offset-2 hover:underline">
                  {project.title}
                </Link>
                {project.health ? <Tag kind={project.health}>{words(project.health)}</Tag> : null}
                {staleNote(project) ? <Tag kind="at_risk">{staleNote(project)}</Tag> : null}
              </p>
              {project.statusNote ? <p className="mt-1 line-clamp-3 text-sm">{project.statusNote}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Activity() {
  const data = useQuery(api.viewer.activity, { limit: 20 });
  return (
    <Panel title="Recent activity" icon={Pulse}>
      {data === undefined ? (
        <Quiet>Loading…</Quiet>
      ) : data.events.length === 0 ? (
        <Quiet>Nothing has happened yet.</Quiet>
      ) : (
        <ul className="space-y-3">
          {data.events.map((event) => (
            <li key={event.id}>
              <p className="text-base">{event.summary}</p>
              <p className="text-sm text-foreground/60">
                {event.by} · {showTime(event.at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
