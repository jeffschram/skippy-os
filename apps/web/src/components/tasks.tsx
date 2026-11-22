"use client";

import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation } from "convex/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { button } from "./owner-page";
import { problem, showDay } from "./parts";

/** Task rows the owner can tick off, edit and add to. Every change goes through `viewer.saveTask`. */

export type Task = FunctionReturnType<typeof api.viewer.today>["dueToday"][number];

const STATUSES = ["todo", "in_progress", "waiting", "done", "cancelled"] as const;
const STATUS_LABEL: Record<Task["status"], string> = {
  todo: "To do",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
  cancelled: "Cancelled",
};
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

function TaskItem({ task, showProject }: { task: Task; showProject?: boolean }) {
  const save = useMutation(api.viewer.saveTask);
  const [editing, setEditing] = useState(false);
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

  if (editing) return <TaskForm task={task} onDone={() => setEditing(false)} />;

  const details = [
    task.status === "in_progress" ? "in progress" : undefined,
    task.status === "cancelled" ? "cancelled" : undefined,
    task.status === "waiting" ? `waiting${task.waitingOn ? ` on ${task.waitingOn}` : ""}` : undefined,
    task.due ? `due ${showDay(task.due.date)}` : undefined,
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
        <p className={`text-base ${closed ? "text-foreground/60 line-through" : ""}`}>{task.title}</p>
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
      <button type="button" onClick={() => setEditing(true)} className="text-sm text-foreground/60 underline underline-offset-2">
        Edit
      </button>
    </li>
  );
}

function TaskForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const save = useMutation(api.viewer.saveTask);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState(task.status);
  const [due, setDue] = useState(task.due?.date ?? "");
  const [waitingOn, setWaitingOn] = useState(task.waitingOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await save({
        id: task.id,
        title,
        description: description.trim() ? description : null,
        status,
        dueAt: due || null,
        waitingOn: status === "waiting" && waitingOn.trim() ? waitingOn : null,
      });
      onDone();
    } catch (caught) {
      setError(problem(caught));
      setBusy(false);
    }
  }

  return (
    <li>
      <form onSubmit={submit} className="space-y-3 rounded-md border border-foreground/15 p-3">
        <label className="block text-sm">
          Task
          <input value={title} onChange={(event) => setTitle(event.target.value)} required className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          Details
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className={`mt-1 ${field}`} />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="block text-sm">
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value as Task["status"])} className={`mt-1 ${field}`}>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Due
            <input type="date" value={due} onChange={(event) => setDue(event.target.value)} className={`mt-1 ${field}`} />
          </label>
          {status === "waiting" ? (
            <label className="block flex-1 text-sm">
              Waiting on
              <input value={waitingOn} onChange={(event) => setWaitingOn(event.target.value)} className={`mt-1 ${field}`} />
            </label>
          ) : null}
        </div>
        {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className={button}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onDone} className={button}>
            Cancel
          </button>
        </div>
      </form>
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
