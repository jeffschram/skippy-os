"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AddToCalendar, EventRow, RecurrenceRow, type EventItem, type RecurrenceItem } from "./calendar-parts";
import { OwnerPage } from "./owner-page";
import { problem, Quiet, showDay } from "./parts";
import { AddTask, TaskList, type Task } from "./tasks";
import { useNow } from "./use-now";

/**
 * Everything with a day, in day order: events, things that recur, and open
 * tasks. Overdue first, then today, then each coming day, with undated and
 * waiting tasks at the bottom. A task is placed by its deadline, or by the day
 * it is planned for when it has no deadline. An event that began earlier and
 * is still running is shown under today.
 *
 * Three views: Schedule (all of it), Tasks only, and Board (open tasks in
 * columns by status). A project can be picked to narrow any of them. The
 * choice of view and project is remembered in this browser.
 */

const VIEWS = [
  { key: "schedule", label: "Schedule" },
  { key: "tasks", label: "Tasks only" },
  { key: "board", label: "Board" },
] as const;
type View = (typeof VIEWS)[number]["key"];
const NO_PROJECT = "(none)";
const NO_AREA = "(none)";

/** A choice kept in this browser. It is a convenience: the page works the same without it. */
function useRemembered<T extends string>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after the first render, so the server and the browser agree on the first paint
      if (stored !== null) setValue(stored as T);
    } catch {
      // Storage can be blocked. The default stands.
    }
  }, [key]);
  return [
    value,
    (next) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Not remembered, and that is fine.
      }
    },
  ];
}

export function Agenda() {
  return (
    <OwnerPage wide>
      <Days />
    </OwnerPage>
  );
}

type Day = { events: EventItem[]; recurrences: RecurrenceItem[]; tasks: Task[] };
const dayOf = (task: Task) => task.due?.date ?? task.scheduledFor?.date;
const byTime = (a: Task, b: Task) => (a.due?.at ?? a.scheduledFor?.at ?? "").localeCompare(b.due?.at ?? b.scheduledFor?.at ?? "");
const count = (day: Day) => day.events.length + day.recurrences.length + day.tasks.length;

function Days() {
  const now = useNow();
  const all = useQuery(api.viewer.openTasks, { now });
  const whole = useQuery(api.viewer.calendar, { now });
  const [storedView, setView] = useRemembered<View>("skippy.agenda.view", "schedule");
  const [project, setProject] = useRemembered<string>("skippy.agenda.project", "");
  const [area, setArea] = useRemembered<string>("skippy.agenda.area", "");
  if (all === undefined || whole === undefined) return <Quiet>Loading…</Quiet>;
  const view = VIEWS.some((item) => item.key === storedView) ? storedView : "schedule";
  const today = all.today;

  // The projects that have something open, for the filter.
  const projects = [...new Set(all.tasks.map((task) => task.project).filter((slug): slug is string => Boolean(slug)))].sort();
  const chosen = project === NO_PROJECT || projects.includes(project) ? project : "";
  const inProject = (slug: string | undefined) => chosen === "" || (chosen === NO_PROJECT ? !slug : slug === chosen);
  // The areas that have something in them, for the second filter.
  const areas = [...new Set([...all.tasks, ...whole.recurrences].map((item) => item.area).filter((name): name is string => Boolean(name)))].sort();
  const chosenArea = area === NO_AREA || areas.includes(area) ? area : "";
  const inArea = (name: string | undefined) => chosenArea === "" || (chosenArea === NO_AREA ? !name : name === chosenArea);
  const data = { ...all, tasks: all.tasks.filter((task) => inProject(task.project) && inArea(task.area)) };
  // Recurrences belong to no project, so they show only when no project is picked.
  // Events have no area, so they show only when no area is picked.
  const withCalendar = view === "schedule";
  const calendar = {
    events: withCalendar && chosenArea === "" ? whole.events.filter((event) => inProject(event.project)) : [],
    recurrences: withCalendar && (chosen === "" || chosen === NO_PROJECT) ? whole.recurrences.filter((item) => inArea(item.area)) : [],
  };

  const days = new Map<string, Day>();
  const at = (key: string) => {
    if (!days.has(key)) days.set(key, { events: [], recurrences: [], tasks: [] });
    return days.get(key)!;
  };
  const keyOf = (day: string) => (day < today ? "overdue" : day);

  for (const event of calendar.events) at(event.start.date < today ? today : event.start.date).events.push(event);
  const live = calendar.recurrences.filter((item) => item.status === "active");
  for (const item of live) at(keyOf(item.nextDue)).recurrences.push(item);
  const waiting = data.tasks.filter((task) => task.status === "waiting");
  const active = data.tasks.filter((task) => task.status !== "waiting");
  for (const task of active.filter((task) => dayOf(task) !== undefined).sort(byTime)) at(keyOf(dayOf(task)!)).tasks.push(task);
  const undated = active.filter((task) => dayOf(task) === undefined);
  const paused = calendar.recurrences.filter((item) => item.status === "paused");

  const later = [...days.keys()].filter((key) => key !== "overdue" && key !== today).sort();
  const groups: [string, Day, boolean][] = [
    ["Overdue", days.get("overdue") ?? at("overdue"), true],
    [`Today · ${showDay(today)}`, days.get(today) ?? at(today), false],
    ...later.map((key): [string, Day, boolean] => [showDay(key), days.get(key)!, false]),
    ["No date", { events: [], recurrences: [], tasks: undated }, false],
    ["Waiting", { events: [], recurrences: [], tasks: waiting }, false],
    ["Paused", { events: [], recurrences: paused, tasks: [] }, true],
  ];
  const shown = groups.filter(([, day]) => count(day) > 0);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <p className="text-sm text-foreground/60">
          {data.tasks.length} open tasks · {whole.events.length} events ahead · {whole.recurrences.filter((item) => item.status === "active").length} repeating
        </p>
      </div>
      <AddTask />
      <AddToCalendar />
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm" role="group" aria-label="View">
          {VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={view === item.key}
              onClick={() => setView(item.key)}
              className={view === item.key ? "font-semibold underline underline-offset-4" : "text-foreground/70 hover:text-foreground"}
            >
              {item.label}
            </button>
          ))}
        </div>
        <select
          value={chosen}
          onChange={(event) => setProject(event.target.value)}
          aria-label="Project"
          className="ml-auto rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm"
        >
          <option value="">All projects</option>
          <option value={NO_PROJECT}>No project</option>
          {projects.map((slug) => (
            <option key={slug} value={slug}>
              {slug}
            </option>
          ))}
        </select>
        {areas.length > 0 ? (
          <select
            value={chosenArea}
            onChange={(event) => setArea(event.target.value)}
            aria-label="Area"
            className="rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="">All areas</option>
            <option value={NO_AREA}>No area</option>
            {areas.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {view === "board" ? (
        <Board tasks={data.tasks} />
      ) : shown.length === 0 ? (
        <div className="mt-8">
          <Quiet>Nothing is open.</Quiet>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {shown.map(([label, day, showDue]) => (
            <section key={label}>
              <h2 className="mb-3 border-b border-foreground/15 pb-2 text-sm font-medium text-foreground/70">
                {label} <span className="text-foreground/50">· {count(day)}</span>
              </h2>
              <div className="space-y-2">
                {day.events.length > 0 ? (
                  <ul className="space-y-2">
                    {day.events.map((event) => (
                      <EventRow key={event.id} event={event} />
                    ))}
                  </ul>
                ) : null}
                {day.recurrences.length > 0 ? (
                  <ul className="space-y-2">
                    {day.recurrences.map((item) => (
                      <RecurrenceRow key={item.id} item={item} showDue={showDue} />
                    ))}
                  </ul>
                ) : null}
                {day.tasks.length > 0 ? <TaskList tasks={day.tasks} showProject /> : null}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

const COLUMNS = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "waiting", label: "Waiting" },
] as const;

/** Open tasks in a column for each status. A task moves by changing its status in place. */
function Board({ tasks }: { tasks: Task[] }) {
  const save = useMutation(api.viewer.saveTask);
  const [error, setError] = useState<string>();

  async function move(task: Task, status: Task["status"]) {
    setError(undefined);
    try {
      await save({ id: task.id, status });
    } catch (caught) {
      setError(problem(caught));
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="mt-8">
        <Quiet>Nothing is open.</Quiet>
      </div>
    );
  }
  return (
    <div className="mt-8">
      {error ? <p className="mb-3 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <div className="grid gap-6 md:grid-cols-3">
        {COLUMNS.map((column) => {
          const mine = tasks
            .filter((task) => task.status === column.status)
            .sort((a, b) => (a.due?.at ?? a.scheduledFor?.at ?? "9").localeCompare(b.due?.at ?? b.scheduledFor?.at ?? "9"));
          return (
            <section key={column.status}>
              <h2 className="mb-3 border-b border-foreground/15 pb-2 text-sm font-medium text-foreground/70">
                {column.label} <span className="text-foreground/50">· {mine.length}</span>
              </h2>
              <ul className="space-y-3">
                {mine.map((task) => (
                  <li key={task.id} className="rounded-md border border-foreground/15 p-3">
                    <Link href={`?task=${task.id}`} scroll={false} className="text-base underline-offset-2 hover:underline">
                      {task.title}
                    </Link>
                    <p className="mt-1 text-xs text-foreground/60">
                      {[
                        task.project,
                        task.due ? `due ${showDay(task.due.date)}` : task.scheduledFor ? `planned ${showDay(task.scheduledFor.date)}` : undefined,
                        task.status === "waiting" && task.waitingOn ? `on ${task.waitingOn}` : undefined,
                        task.commitment === "want" ? "optional" : undefined,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <select
                      value={task.status}
                      onChange={(event) => move(task, event.target.value as Task["status"])}
                      aria-label={`Status of ${task.title}`}
                      className="mt-2 rounded-md border border-foreground/20 bg-transparent px-2 py-1 text-xs"
                    >
                      <option value="todo">To do</option>
                      <option value="in_progress">In progress</option>
                      <option value="waiting">Waiting</option>
                      <option value="done">Done</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
