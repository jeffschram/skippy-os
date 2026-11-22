"use client";

import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ChatsAbout } from "./chats-about";
import { Files } from "./files";
import { OwnerPage } from "./owner-page";
import { button } from "./parts";
import { Panel, problem, Quiet, showDay, showTime, staleNote, Tag, words } from "./parts";
import { ClaudeHome } from "./projects-board";
import { AddTask, TaskList, type Task } from "./tasks";
import { useNow } from "./use-now";

/** One project: its status and history, phases, tasks and notes, all editable by the owner. */

type Page = NonNullable<FunctionReturnType<typeof api.viewer.project>>;
type Project = Page["project"];

const STATUSES = ["idea", "active", "paused", "completed", "archived"] as const;
const HEALTHS = ["on_track", "at_risk", "blocked"] as const;
const field = "rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm";

export function ProjectPage() {
  return (
    <OwnerPage>
      <Loaded />
    </OwnerPage>
  );
}

function Loaded() {
  const { slug } = useParams<{ slug: string }>();
  const page = useQuery(api.viewer.project, { slug, now: useNow() });
  if (page === undefined) return <Quiet>Loading…</Quiet>;
  if (page === null) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">No such project</h1>
        <p className="mt-3">
          Nothing is filed under <code className="font-mono text-sm">{slug}</code>.{" "}
          <Link href="/projects" className="underline underline-offset-2">
            See all projects
          </Link>
        </p>
      </div>
    );
  }
  const { project } = page;
  const stale = staleNote(project);
  return (
    <div className="space-y-10">
      <div>
        <Header project={project} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {stale ? <Tag kind="at_risk">{stale}</Tag> : null}
          <Tag>{project.kind === "code" ? "code project" : "general project"}</Tag>
          {project.targetDate ? <Tag>target {showDay(project.targetDate)}</Tag> : null}
          <span className="font-mono text-xs text-foreground/60">{project.slug}</span>
        </div>
        <ClaudeHome home={project.claudeHome} />
        <Settings project={project} />
      </div>

      <Panel title="Status">
        {page.recentUpdates.length === 0 ? (
          <Quiet>No status reports yet. Claude adds one when it works on this project.</Quiet>
        ) : (
          <ul className="space-y-4">
            {page.recentUpdates.map((update, index) => (
              <li key={update.at ?? index}>
                <p className="text-sm text-foreground/60">
                  {update.by}
                  {update.at ? ` · ${showTime(update.at)}` : ""}
                  {update.health ? ` · ${words(update.health)}` : ""}
                </p>
                {update.milestone ? <p className="mt-1 text-sm font-medium">{update.milestone}</p> : null}
                <p className="mt-1 text-base whitespace-pre-wrap">{update.note}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Phases project={project.slug} phases={page.phases} />

      <Panel title="Tasks" note={`${page.openTasks.length} open`}>
        {page.openTasks.length === 0 ? <Quiet>Nothing open.</Quiet> : <ByPhase tasks={page.openTasks} phases={page.phases} />}
        <AddTask project={project.slug} />
        {page.recentlyClosedTasks.length > 0 ? (
          <details className="mt-6">
            <summary className="cursor-pointer text-sm text-foreground/60">
              {page.closedTaskCount} closed
              {page.closedTaskCount > page.recentlyClosedTasks.length ? `, showing the latest ${page.recentlyClosedTasks.length}` : ""}
            </summary>
            <div className="mt-3">
              <TaskList tasks={page.recentlyClosedTasks} />
            </div>
          </details>
        ) : null}
      </Panel>

      <Panel title="Chats">
        <ChatsAbout type="project" id={project.slug} />
      </Panel>

      <Panel title="Files">
        <Files type="project" id={project.slug} />
      </Panel>

      <Notes project={project} />
    </div>
  );
}

/** The title and summary, with an edit form behind a button. */
function Header({ project }: { project: Project }) {
  const save = useMutation(api.viewer.saveProject);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [summary, setSummary] = useState(project.summary ?? "");
  const [target, setTarget] = useState(project.targetDate ?? "");
  const [home, setHome] = useState<HomeDraft>(draftOf(project.claudeHome));
  const [error, setError] = useState<string>();

  if (!editing) {
    return (
      <div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold">{project.title}</h1>
          <button
            type="button"
            onClick={() => {
              setTitle(project.title);
              setSummary(project.summary ?? "");
              setTarget(project.targetDate ?? "");
              setHome(draftOf(project.claudeHome));
              setEditing(true);
            }}
            className="mt-1 text-sm text-foreground/60 underline underline-offset-2"
          >
            Edit
          </button>
        </div>
        {project.summary ? <Summary text={project.summary} /> : null}
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await save({
        slug: project.slug,
        title,
        summary: summary.trim() ? summary : null,
        targetDate: target || null,
        claudeHome: homeOf(home),
      });
      setEditing(false);
    } catch (caught) {
      setError(problem(caught));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} required className={`mt-1 w-full ${field}`} />
      </label>
      <label className="block text-sm">
        Summary
        <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} className={`mt-1 w-full ${field}`} />
      </label>
      <label className="block text-sm">
        Target date
        <input type="date" value={target} onChange={(event) => setTarget(event.target.value)} className={`mt-1 block ${field}`} />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm">Where this project is worked on in Claude</legend>
        <select
          value={home.kind}
          onChange={(event) => setHome({ ...home, kind: event.target.value as HomeDraft["kind"] })}
          aria-label="Kind of Claude home"
          className={field}
        >
          <option value="none">Not set</option>
          <option value="claude_project">A Claude Project</option>
          <option value="code_folder">A code folder</option>
        </select>
        {home.kind !== "none" ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-sm">
              {home.kind === "claude_project" ? "Project name" : "Folder path"}
              <input
                value={home.where}
                onChange={(event) => setHome({ ...home, where: event.target.value })}
                required
                placeholder={home.kind === "claude_project" ? "As it is named in Claude" : "/Users/me/src/project"}
                className={`mt-1 w-full ${field}`}
              />
            </label>
            <label className="block text-sm">
              {home.kind === "claude_project" ? "Link to it in Claude" : "Link to the repository"}
              <input
                type="url"
                value={home.link}
                onChange={(event) => setHome({ ...home, link: event.target.value })}
                placeholder="https://… (optional)"
                className={`mt-1 w-full ${field}`}
              />
            </label>
          </div>
        ) : null}
      </fieldset>
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className={button}>
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)} className={button}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The Claude home as the edit form holds it: one name-or-path box and one link box, whichever kind is chosen. */
type HomeDraft = { kind: "none" | "claude_project" | "code_folder"; where: string; link: string };

function draftOf(home: Project["claudeHome"]): HomeDraft {
  if (!home) return { kind: "none", where: "", link: "" };
  return home.kind === "claude_project"
    ? { kind: home.kind, where: home.name, link: home.url ?? "" }
    : { kind: home.kind, where: home.path, link: home.repoUrl ?? "" };
}

function homeOf(draft: HomeDraft): NonNullable<Project["claudeHome"]> | null {
  const where = draft.where.trim();
  const link = draft.link.trim();
  if (draft.kind === "none" || !where) return null;
  return draft.kind === "claude_project"
    ? { kind: "claude_project", name: where, ...(link ? { url: link } : {}) }
    : { kind: "code_folder", path: where, ...(link ? { repoUrl: link } : {}) };
}

/** A long summary is cut to a few lines until asked for. */
function Summary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 400;
  return (
    <div className="mt-2">
      <p className={`text-base whitespace-pre-wrap text-foreground/80 ${long && !open ? "line-clamp-4" : ""}`}>{text}</p>
      {long ? (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-sm text-foreground/60 underline underline-offset-2">
          {open ? "Show less" : "Show all"}
        </button>
      ) : null}
    </div>
  );
}

/** Open tasks under the phase they belong to, in plan order, with the rest below. */
function ByPhase({ tasks, phases }: { tasks: Task[]; phases: Page["phases"] }) {
  const inPhase = (id: string) => tasks.filter((task) => task.phaseId === id);
  const known = new Set(phases.map((phase) => String(phase.id)));
  const loose = tasks.filter((task) => !task.phaseId || !known.has(task.phaseId));
  const groups = phases.filter((phase) => inPhase(phase.id).length > 0);
  if (groups.length === 0) return <TaskList tasks={tasks} />;
  return (
    <div className="space-y-6">
      {groups.map((phase) => (
        <div key={phase.id}>
          <h3 className="mb-2 text-sm font-medium text-foreground/60">
            {phase.order}. {phase.title}
          </h3>
          <TaskList tasks={inPhase(phase.id)} />
        </div>
      ))}
      {loose.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-medium text-foreground/60">Not in a phase</h3>
          <TaskList tasks={loose} />
        </div>
      ) : null}
    </div>
  );
}

const PHASE_STATUSES = ["planned", "active", "done"] as const;

/** The plan: a phase can be added, renamed, moved up or down and removed, and its status changed in place. */
function Phases({ project, phases }: { project: string; phases: Page["phases"] }) {
  const save = useMutation(api.viewer.savePhase);
  const move = useMutation(api.viewer.movePhase);
  const remove = useMutation(api.viewer.removePhase);
  const [title, setTitle] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; title: string }>();
  const [removing, setRemoving] = useState<string>();
  const [error, setError] = useState<string>();

  async function attempt(change: () => Promise<unknown>) {
    setError(undefined);
    try {
      await change();
      return true;
    } catch (caught) {
      setError(problem(caught));
      return false;
    }
  }
  const run = (change: Parameters<typeof save>[0]) => attempt(() => save(change));
  const quiet = "text-sm text-foreground/60 underline underline-offset-2 disabled:no-underline disabled:opacity-40";

  async function add(event: FormEvent) {
    event.preventDefault();
    if (title.trim() && (await run({ project, title }))) setTitle("");
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (renaming && (await run({ id: renaming.id, title: renaming.title }))) setRenaming(undefined);
  }

  return (
    <Panel title="Phases">
      {phases.length === 0 ? <Quiet>No phases. Add one to lay out a plan.</Quiet> : null}
      <ol className="space-y-2">
        {phases.map((phase, index) => (
          <li key={phase.id} className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {removing === phase.id ? (
              <>
                <span className="flex-1 text-base">
                  Remove “{phase.title}”? Its tasks stay in the project. This cannot be undone.
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await attempt(() => remove({ id: phase.id }));
                    setRemoving(undefined);
                  }}
                  className={button}
                >
                  Remove phase
                </button>
                <button type="button" onClick={() => setRemoving(undefined)} className={button}>
                  Keep
                </button>
              </>
            ) : renaming?.id === phase.id ? (
              <form onSubmit={rename} className="flex flex-1 flex-wrap gap-2">
                <input
                  value={renaming.title}
                  onChange={(event) => setRenaming({ id: phase.id, title: event.target.value })}
                  aria-label="Phase title"
                  required
                  className={`min-w-48 flex-1 ${field}`}
                />
                <button type="submit" className={button}>
                  Save
                </button>
                <button type="button" onClick={() => setRenaming(undefined)} className={button}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className={`flex-1 text-base ${phase.status === "done" ? "text-foreground/60" : ""}`}>
                  {phase.order}. {phase.title}
                </span>
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => attempt(() => move({ id: phase.id, direction: "up" }))}
                  aria-label={`Move phase ${phase.title} up`}
                  className={quiet}
                >
                  Up
                </button>
                <button
                  type="button"
                  disabled={index === phases.length - 1}
                  onClick={() => attempt(() => move({ id: phase.id, direction: "down" }))}
                  aria-label={`Move phase ${phase.title} down`}
                  className={quiet}
                >
                  Down
                </button>
                <button type="button" onClick={() => setRenaming({ id: phase.id, title: phase.title })} className={quiet}>
                  Rename
                </button>
                <button type="button" onClick={() => setRemoving(phase.id)} aria-label={`Remove phase ${phase.title}`} className={quiet}>
                  Remove
                </button>
                <select
                  value={phase.status}
                  onChange={(event) => run({ id: phase.id, status: event.target.value as (typeof PHASE_STATUSES)[number] })}
                  aria-label={`Status of phase ${phase.title}`}
                  className={field}
                >
                  {PHASE_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </>
            )}
          </li>
        ))}
      </ol>
      <form onSubmit={add} className="mt-4 flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a phase"
          aria-label="New phase"
          className={`min-w-48 flex-1 ${field}`}
        />
        <button type="submit" disabled={!title.trim()} className={`${button} disabled:opacity-50`}>
          Add
        </button>
      </form>
      {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </Panel>
  );
}

/** Status and health. Each saves as soon as it is changed. */
function Settings({ project }: { project: Project }) {
  const save = useMutation(api.viewer.saveProject);
  const [error, setError] = useState<string>();

  async function change(fields: { status?: Project["status"]; health?: NonNullable<Project["health"]> | null }) {
    setError(undefined);
    try {
      await save({ slug: project.slug, ...fields });
    } catch (caught) {
      setError(problem(caught));
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-4">
        <label className="text-sm">
          Status{" "}
          <select
            value={project.status}
            onChange={(event) => change({ status: event.target.value as Project["status"] })}
            className={field}
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {words(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Health{" "}
          <select
            value={project.health ?? ""}
            onChange={(event) => change({ health: (event.target.value || null) as NonNullable<Project["health"]> | null })}
            className={field}
          >
            <option value="">not set</option>
            {HEALTHS.map((value) => (
              <option key={value} value={value}>
                {words(value)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </div>
  );
}

/** The project's free-form notes. Claude reads and writes the same pad. */
function Notes({ project }: { project: Project & { notesPad: string } }) {
  const save = useMutation(api.viewer.saveProject);
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  const text = draft ?? project.notesPad;
  const changed = draft !== undefined && draft !== project.notesPad;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await save({ slug: project.slug, notesPad: text });
      setDraft(undefined);
    } catch (caught) {
      setError(problem(caught));
    }
  }

  return (
    <Panel title="Notes">
      <form onSubmit={submit}>
        <textarea
          value={text}
          onChange={(event) => setDraft(event.target.value)}
          rows={Math.min(Math.max(text.split("\n").length + 1, 6), 30)}
          aria-label="Project notes"
          placeholder="Working notes. Claude reads these at the start of a session."
          className={`w-full font-mono ${field}`}
        />
        {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
        {changed ? (
          <div className="mt-2 flex gap-2">
            <button type="submit" className={button}>
              Save notes
            </button>
            <button type="button" onClick={() => setDraft(undefined)} className={button}>
              Discard
            </button>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}
