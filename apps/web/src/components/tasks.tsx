"use client";

import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation } from "convex/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { button } from "./parts";
import { problem, showDay } from "./parts";

/** Task rows the owner can tick off and add to. A title opens the task's details. Every change goes through `viewer.saveTask`. */

export type Task = FunctionReturnType<typeof api.viewer.today>["dueToday"][number];

const field = "w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm";

export function TaskList({ tasks, showProject }: { tasks: Task[]; showProject?: boolean }) {
  return (
    <ul className="space-y-2">
      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} showProject={showProject} />
      ))}
    </ul>
  );
}

export function TaskItem({ task, showProject }: { task: Task; showProject?: boolean }) {
  const save = useMutation(api.viewer.saveTask);
  const [error, setError] = useState<string>();
  const closed = task.status === "done" || task.status === "cancelled";

  async function toggle() {
    setError(undefined);
    try {
      await save({ id: task.id, status: closed ? "todo" : "done" });
    } catch (caught) {
      setError(problem(caught));
    }
  }

  const details = [
    task.status === "in_progress" ? "in progress" : undefined,
    task.status === "cancelled" ? "cancelled" : undefined,
    task.status === "waiting" ? `waiting${task.waitingOn ? ` on ${task.waitingOn}` : ""}` : undefined,
    task.due ? `due ${showDay(task.due.date)}` : undefined,
    task.scheduledFor ? `planned ${showDay(task.scheduledFor.date)}` : undefined,
    task.commitment === "want" ? "optional" : undefined,
  ].filter(Boolean);

  return (
    <li className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={closed}
        onChange={toggle}
        aria-label={closed ? `Reopen "${task.title}"` : `Mark "${task.title}" done`}
        className="mt-1.5 size-4 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <Link
          href={`?task=${task.id}`}
          scroll={false}
          className={`text-base underline-offset-2 hover:underline ${closed ? "text-foreground/60 line-through" : ""}`}
        >
          {task.title}
        </Link>
        <p className="text-sm text-foreground/60">
          {showProject && task.project ? (
            <>
              <Link href={`/projects/${task.project}`} className="underline underline-offset-2">
                {task.project}
              </Link>
              {details.length > 0 ? " · " : ""}
            </>
          ) : null}
          {details.join(" · ")}
        </p>
        {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      </div>
    </li>
  );
}

/** One line to add a task, to a project when a slug is given. */
export function AddTask({ project }: { project?: string }) {
  const save = useMutation(api.viewer.saveTask);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await save({ title, ...(project ? { project } : {}), ...(due ? { dueAt: due } : {}) });
      setTitle("");
      setDue("");
    } catch (caught) {
      setError(problem(caught));
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mt-4">
      <div className="flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task"
          aria-label="New task"
          className={`min-w-48 flex-1 ${field}`}
        />
        <input type="date" value={due} onChange={(event) => setDue(event.target.value)} aria-label="Due date" className={`w-auto ${field}`} />
        <button type="submit" disabled={busy || !title.trim()} className={`${button} disabled:opacity-50`}>
          Add
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </form>
  );
}
