"use client";

import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ItemChat } from "./chats-about";
import { TaskView } from "./details-views";
import { Background, ChatSection, DetailsWindow, WindowButtons, WindowLayout } from "./details-window";
import { Files } from "./files";
import { button } from "./parts";
import { doneBox, problem, Quiet, showTime } from "./parts";
import { useNow } from "./use-now";

/**
 * A task's details, opened over whatever page the owner is on by adding
 * `?task=<id>` to the address. The address can be bookmarked or opened on
 * another device. It opens laid out for reading; Edit swaps in the form.
 * Saving sends only the fields that were changed, so a deadline with a time
 * of day is not flattened by an edit to something else.
 */

type Details = NonNullable<FunctionReturnType<typeof api.viewer.task>>;
type Task = Details["task"];

const STATUSES: [Task["status"], string][] = [
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["waiting", "Waiting"],
  ["done", "Done"],
  ["cancelled", "Cancelled"],
];
const field = "w-full rounded-md border border-foreground/20 bg-background px-2 py-1.5 text-sm";

export function TaskDetails() {
  const id = useSearchParams().get("task");
  const path = usePathname();
  const router = useRouter();
  const close = () => router.replace(path, { scroll: false });

  useEffect(() => {
    if (!id) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") router.replace(path, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, path, router]);

  if (!id) return null;
  return (
    <DetailsWindow label="Task details" onClose={close}>
      <Loaded id={id} onClose={close} />
    </DetailsWindow>
  );
}

function Loaded({ id, onClose }: { id: string; onClose: () => void }) {
  const details = useQuery(api.viewer.task, { id });
  if (details === undefined) return <Quiet>Loading…</Quiet>;
  if (details === null) {
    return (
      <div>
        <p>There is no task with that address.</p>
        <button type="button" onClick={onClose} className={`mt-4 ${button}`}>
          Close
        </button>
      </div>
    );
  }
  return <Opened key={details.task.id} details={details} onClose={onClose} />;
}

/** The task for reading, or its form once Edit is pressed, with its chats, files and history below either. */
function Opened({ details, onClose }: { details: Details; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const { task } = details;
  const closed = task.status === "done" || task.status === "cancelled";
  return (
    <WindowLayout
      header={
        <>
          {editing ? <h2 className="text-lg font-semibold">Edit task</h2> : <p className="text-sm text-foreground/60">Task</p>}
          <div className="flex items-center gap-4">
            {editing ? null : <DoneBox task={task} />}
            <WindowButtons onEdit={editing ? undefined : () => setEditing(true)} onClose={onClose} />
          </div>
        </>
      }
    >
      {editing ? <Form details={details} onDone={() => setEditing(false)} onClose={onClose} /> : <TaskView details={details} />}
      <ChatSection>
        <ItemChat type="task" id={task.id} delegable={!closed} />
      </ChatSection>
      <Files type="task" id={task.id} folded />
      <Background parts={details.history.length > 0 ? ["History"] : []}>
        <ul className="space-y-2">
          {details.history.map((event) => (
            <li key={event.id} className="text-sm">
              {event.summary}
              <span className="text-foreground/60">
                {" "}
                · {event.by} · {showTime(event.at)}
              </span>
            </li>
          ))}
        </ul>
      </Background>
    </WindowLayout>
  );
}

/** Ticks the task off, or opens it again. */
function DoneBox({ task }: { task: Task }) {
  const save = useMutation(api.viewer.saveTask);
  const [error, setError] = useState<string>();
  const done = task.status === "done";
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm" title={error}>
      <input
        type="checkbox"
        checked={done}
        onChange={async () => {
          setError(undefined);
          try {
            await save({ id: task.id, status: done ? "todo" : "done" });
          } catch (caught) {
            setError(problem(caught));
          }
        }}
        className={doneBox(done)}
      />
      <span className={error ? "text-red-700 dark:text-red-300" : ""}>{error ? "Not saved" : "Done"}</span>
    </label>
  );
}

/** `onDone` goes back to reading; `onClose` shuts the window, which is what deleting does. */
function Form({ details, onDone, onClose }: { details: Details; onDone: () => void; onClose: () => void }) {
  const { task } = details;
  const save = useMutation(api.viewer.saveTask);
  const remove = useMutation(api.viewer.deleteTask);
  const now = useNow();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState(task.status);
  const [project, setProject] = useState(task.project ?? "");
  const [phaseId, setPhaseId] = useState<string>(task.phaseId ?? "");
  const [area, setArea] = useState(task.area ?? "");
  const [commitment, setCommitment] = useState(task.commitment);
  const [due, setDue] = useState(task.due?.date ?? "");
  const [planned, setPlanned] = useState(task.scheduledFor?.date ?? "");
  const [waitingOn, setWaitingOn] = useState(task.waitingOn ?? "");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();

  const projects = useQuery(api.viewer.projects, { now });
  const areas = useQuery(api.viewer.areas, {})?.areas ?? [];
  const chosen = useQuery(api.viewer.project, project ? { slug: project, now } : "skip");
  const phases = chosen?.phases ?? [];
  // The task's own project stays in the list even when it is archived.
  const options = [...(projects?.projects ?? []).map((item) => ({ slug: item.slug, title: item.title }))];
  if (task.project && !options.some((item) => item.slug === task.project)) {
    options.push({ slug: task.project, title: details.projectTitle ?? task.project });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = (value: string) => (value.trim() ? value : null);
    const changes: Parameters<typeof save>[0] = { id: task.id };
    if (title !== task.title) changes.title = title;
    if (description !== (task.description ?? "")) changes.description = text(description);
    if (status !== task.status) changes.status = status;
    if (project !== (task.project ?? "")) changes.project = project || null;
    if (phaseId !== (task.phaseId ?? "")) changes.phaseId = phaseId || null;
    if (area !== (task.area ?? "")) changes.area = area || null;
    if (commitment !== task.commitment) changes.commitment = commitment;
    if (due !== (task.due?.date ?? "")) changes.dueAt = due || null;
    if (planned !== (task.scheduledFor?.date ?? "")) changes.scheduledFor = planned || null;
    if (waitingOn !== (task.waitingOn ?? "")) changes.waitingOn = text(waitingOn);
    if (Object.keys(changes).length === 1) return onDone();
    setBusy(true);
    setError(undefined);
    try {
      await save(changes);
      onDone();
    } catch (caught) {
      setError(problem(caught));
      setBusy(false);
    }
  }

  async function destroy() {
    setBusy(true);
    setError(undefined);
    try {
      await remove({ id: task.id });
      onClose();
    } catch (caught) {
      setError(problem(caught));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm">
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} required className={`mt-1 text-base ${field}`} />
      </label>
      <label className="block text-sm">
        Details
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} className={`mt-1 ${field}`} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as Task["status"])} className={`mt-1 ${field}`}>
            {STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Waiting on
          <input
            value={waitingOn}
            onChange={(event) => setWaitingOn(event.target.value)}
            placeholder="Who or what, when it is waiting"
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block text-sm">
          Due
          <input type="date" value={due} onChange={(event) => setDue(event.target.value)} className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          Planned for
          <input type="date" value={planned} onChange={(event) => setPlanned(event.target.value)} className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          Project
          <select
            value={project}
            onChange={(event) => {
              setProject(event.target.value);
              setPhaseId("");
            }}
            className={`mt-1 ${field}`}
          >
            <option value="">No project</option>
            {options.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        {areas.length > 0 ? (
          <label className="block text-sm">
            Area
            <select value={area} onChange={(event) => setArea(event.target.value)} className={`mt-1 ${field}`}>
              <option value="">No area</option>
              {areas.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {phases.length > 0 ? (
          <label className="block text-sm">
            Phase
            <select value={phaseId} onChange={(event) => setPhaseId(event.target.value)} className={`mt-1 ${field}`}>
              <option value="">No phase</option>
              {phases.map((phase) => (
                <option key={phase.id} value={phase.id}>
                  {phase.order}. {phase.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block text-sm">
          How firm
          <select value={commitment} onChange={(event) => setCommitment(event.target.value as Task["commitment"])} className={`mt-1 ${field}`}>
            <option value="must">Must happen</option>
            <option value="want">Optional</option>
          </select>
        </label>
      </div>
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      {deleting ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-sm">Delete this task for good? This cannot be undone. To keep a record, cancel it instead.</p>
          <button type="button" disabled={busy} onClick={destroy} className={`${button} border-red-600/50 text-red-700 dark:text-red-300`}>
            Delete task
          </button>
          <button type="button" onClick={() => setDeleting(false)} className={button}>
            Keep
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button type="submit" disabled={busy} className={button}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onDone} className={button}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setDeleting(true)}
            className="ml-auto text-sm text-foreground/60 underline underline-offset-2"
          >
            Delete
          </button>
        </div>
      )}
    </form>
  );
}
