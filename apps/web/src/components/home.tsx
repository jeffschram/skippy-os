"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import Link from "next/link";
import { OwnerPage } from "./owner-page";
import { Panel, Quiet, showDay, showTime, staleNote, Tag, words } from "./parts";
import { AddTask, TaskList, type Task } from "./tasks";
import { useNow } from "./use-now";

/** Home: today's tasks, the live projects and the latest activity. Each panel is its own live query. */

export function Home() {
  return (
    <OwnerPage>
      <div className="space-y-12">
        <Today />
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
      {shown.length === 0 ? (
        <Quiet>Nothing needs you today.</Quiet>
      ) : (
        <div className="space-y-6">
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
