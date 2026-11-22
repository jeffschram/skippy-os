"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { AddToCalendar, EventRow, RecurrenceRow, type EventItem, type RecurrenceItem } from "./calendar-parts";
import { OwnerPage } from "./owner-page";
import { Quiet, showDay } from "./parts";
import { AddTask, TaskList, type Task } from "./tasks";
import { useNow } from "./use-now";

/**
 * Everything with a day, in day order: events, things that recur, and open
 * tasks. Overdue first, then today, then each coming day, with undated and
 * waiting tasks at the bottom. A task is placed by its deadline, or by the day
 * it is planned for when it has no deadline. An event that began earlier and
 * is still running is shown under today.
 */

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
  const data = useQuery(api.viewer.openTasks, { now });
  const calendar = useQuery(api.viewer.calendar, { now });
  if (data === undefined || calendar === undefined) return <Quiet>Loading…</Quiet>;
  const today = data.today;

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
          {data.tasks.length} open tasks · {calendar.events.length} events ahead · {live.length} repeating
        </p>
      </div>
      <AddTask />
      <AddToCalendar />
      {shown.length === 0 ? (
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
