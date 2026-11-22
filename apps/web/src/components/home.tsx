"use client";

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

/** Home: the inbox, today's tasks, the live projects and the latest activity. Each panel is its own live query. */

export function Home() {
  return (
    <OwnerPage>
      <div className="space-y-12">
        <InboxPanel />
        <Today />
        <SinceLastLook />
        <IngestedPanel />
        <Projects />
        <Activity />
      </div>
    </OwnerPage>
  );
}

function Today() {
  const today = useQuery(api.viewer.today, { now: useNow() });
  if (today === undefined) {
    return (
      <Panel title="Today">
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
    <Panel title="Today" note={showDay(today.date)}>
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

/** What Claude and other agents recorded since the owner last cleared this list. */
function SinceLastLook() {
  const data = useQuery(api.viewer.sinceLastLook);
  const markSeen = useMutation(api.viewer.markSeen);
  if (data === undefined) {
    return (
      <Panel title="Since you last looked">
        <Quiet>Loading…</Quiet>
      </Panel>
    );
  }
  const newest = data.newestAt;
  return (
    <Panel
      title="Since you last looked"
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
    <Panel title="Projects" note={<Link href="/projects" className="underline underline-offset-2">All projects</Link>}>
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
    <Panel title="Recent activity">
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
