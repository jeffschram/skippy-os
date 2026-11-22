import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";

/**
 * What the owner sees on Home: today's tasks, the projects and the latest
 * activity. It only draws what it is given; `home.tsx` fetches the data.
 * `undefined` means that panel is still loading.
 */

export type TodayData = FunctionReturnType<typeof api.viewer.today>;
export type ProjectsData = FunctionReturnType<typeof api.viewer.projects>;
export type ActivityData = FunctionReturnType<typeof api.viewer.activity>;
type Task = TodayData["dueToday"][number];
type Project = ProjectsData["projects"][number];
type ActivityEvent = ActivityData["events"][number];

export function DashboardView({
  account,
  today,
  projects,
  activity,
}: {
  /** The account menu, shown at the top right. */
  account: ReactNode;
  today: TodayData | undefined;
  projects: ProjectsData | undefined;
  activity: ActivityData | undefined;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Skippy OS</h1>
        {account}
      </header>
      <div className="mt-10 space-y-12">
        <Today today={today} />
        <Projects data={projects} />
        <Activity data={activity} />
      </div>
    </main>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-foreground/15 pb-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {note ? <p className="text-sm text-foreground/60">{note}</p> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => <p className="text-sm text-foreground/60">{children}</p>;

/** A stored day such as 2026-11-27, shown as "Fri, Nov 27" whatever zone the browser is in. */
function showDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function Today({ today }: { today: TodayData | undefined }) {
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
              <h3 className="text-sm font-medium text-foreground/60">{label}</h3>
              <ul className="mt-2 space-y-2">
                {tasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function TaskRow({ task }: { task: Task }) {
  const details = [
    task.project,
    task.due ? `due ${showDay(task.due.date)}` : undefined,
    task.status === "waiting" ? `waiting${task.waitingOn ? ` on ${task.waitingOn}` : ""}` : undefined,
  ].filter(Boolean);
  return (
    <li>
      <p className="text-base">{task.title}</p>
      {details.length > 0 ? <p className="text-sm text-foreground/60">{details.join(" · ")}</p> : null}
    </li>
  );
}

function Projects({ data }: { data: ProjectsData | undefined }) {
  return (
    <Panel title="Projects">
      {data === undefined ? (
        <Quiet>Loading…</Quiet>
      ) : data.projects.length === 0 ? (
        <Quiet>No projects yet. Ask Claude to add one.</Quiet>
      ) : (
        <ul className="space-y-4">
          {data.projects.map((project) => (
            <ProjectRow key={project.slug} project={project} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ProjectRow({ project }: { project: Project }) {
  const details = [
    project.status.replace("_", " "),
    project.health ? project.health.replace("_", " ") : undefined,
    project.stale
      ? project.daysSinceStatus === undefined
        ? "no status update yet"
        : `no status update in ${project.daysSinceStatus} days`
      : undefined,
  ].filter(Boolean);
  return (
    <li>
      <p className="text-base font-medium">{project.title}</p>
      <p className="text-sm text-foreground/60">{details.join(" · ")}</p>
      {project.statusNote ? <p className="mt-1 text-sm">{project.statusNote}</p> : null}
    </li>
  );
}

function Activity({ data }: { data: ActivityData | undefined }) {
  return (
    <Panel title="Recent activity">
      {data === undefined ? (
        <Quiet>Loading…</Quiet>
      ) : data.events.length === 0 ? (
        <Quiet>Nothing has happened yet.</Quiet>
      ) : (
        <ul className="space-y-3">
          {data.events.map((event) => (
            <ActivityRow key={event.id} event={event} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const at = new Date(event.at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <li>
      <p className="text-base">{event.summary}</p>
      <p className="text-sm text-foreground/60">
        {event.by} · {at}
      </p>
    </li>
  );
}
