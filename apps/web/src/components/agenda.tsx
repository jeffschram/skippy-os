"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { OwnerPage } from "./owner-page";
import { Quiet, showDay } from "./parts";
import { AddTask, TaskList, type Task } from "./tasks";
import { useNow } from "./use-now";

/**
 * Every open task in day order: overdue, today, then each coming day, with
 * undated and waiting tasks at the bottom. A task is placed by its deadline,
 * or by the day it is planned for when it has no deadline.
 */

export function Agenda() {
  return (
    <OwnerPage wide>
      <Days />
    </OwnerPage>
  );
}

const dayOf = (task: Task) => task.due?.date ?? task.scheduledFor?.date;
const byTime = (a: Task, b: Task) => (a.due?.at ?? a.scheduledFor?.at ?? "").localeCompare(b.due?.at ?? b.scheduledFor?.at ?? "");

function Days() {
  const data = useQuery(api.viewer.openTasks, { now: useNow() });
  if (data === undefined) return <Quiet>Loading…</Quiet>;

  const waiting = data.tasks.filter((task) => task.status === "waiting");
  const active = data.tasks.filter((task) => task.status !== "waiting");
  const dated = active.filter((task) => dayOf(task) !== undefined).sort(byTime);
  const overdue = dated.filter((task) => dayOf(task)! < data.today);
  const today = dated.filter((task) => dayOf(task) === data.today);
  const later = new Map<string, Task[]>();
  for (const task of dated.filter((task) => dayOf(task)! > data.today)) {
    later.set(dayOf(task)!, [...(later.get(dayOf(task)!) ?? []), task]);
  }
  const undated = active.filter((task) => dayOf(task) === undefined);

  const groups: [string, Task[]][] = [
    ["Overdue", overdue],
    [`Today · ${showDay(data.today)}`, today],
    ...[...later.entries()].map(([day, tasks]): [string, Task[]] => [showDay(day), tasks]),
    ["No date", undated],
    ["Waiting", waiting],
  ];
  const shown = groups.filter(([, tasks]) => tasks.length > 0);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <p className="text-sm text-foreground/60">{data.tasks.length} open</p>
      </div>
      <AddTask />
      {shown.length === 0 ? (
        <div className="mt-8">
          <Quiet>Nothing is open.</Quiet>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {shown.map(([label, tasks]) => (
            <section key={label}>
              <h2 className="mb-3 border-b border-foreground/15 pb-2 text-sm font-medium text-foreground/70">
                {label} <span className="text-foreground/50">· {tasks.length}</span>
              </h2>
              <TaskList tasks={tasks} showProject />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
