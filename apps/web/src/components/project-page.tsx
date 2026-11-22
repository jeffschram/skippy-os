"use client";

import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { button, OwnerPage } from "./owner-page";
import { Panel, problem, Quiet, showTime, staleNote, Tag, words } from "./parts";
import { ClaudeHome } from "./projects-board";
import { AddTask, TaskList } from "./tasks";
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

      {page.phases.length > 0 ? (
        <Panel title="Phases">
          <ol className="space-y-2">
            {page.phases.map((phase) => (
              <li key={phase.id} className="flex flex-wrap items-baseline gap-2">
                <span className="text-base">
                  {phase.order}. {phase.title}
                </span>
                <Tag>{phase.status}</Tag>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      <Panel title="Tasks" note={`${page.openTasks.length} open`}>
        {page.openTasks.length === 0 ? <Quiet>Nothing open.</Quiet> : <TaskList tasks={page.openTasks} />}
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
              setEditing(true);
            }}
            className="mt-1 text-sm text-foreground/60 underline underline-offset-2"
          >
            Edit
          </button>
        </div>
        {project.summary ? <p className="mt-2 text-base text-foreground/80">{project.summary}</p> : null}
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await save({ slug: project.slug, title, summary: summary.trim() ? summary : null });
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
