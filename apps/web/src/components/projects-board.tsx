"use client";

import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { OwnerPage } from "./owner-page";
import { button, problem, Quiet, showDay, showTime, staleNote, Tag, words } from "./parts";
import { useNow } from "./use-now";

/** Every project on one page: where it stands, who last reported and when, and what comes next. */

type Project = FunctionReturnType<typeof api.viewer.board>["projects"][number];

export function ProjectsBoard() {
  return (
    <OwnerPage wide>
      <Board />
    </OwnerPage>
  );
}

function Board() {
  const data = useQuery(api.viewer.board, { now: useNow() });
  const [showArchived, setShowArchived] = useState(false);
  if (data === undefined) return <Quiet>Loading…</Quiet>;
  const current = data.projects.filter((project) => project.status !== "archived" && project.status !== "completed");
  const finished = data.projects.filter((project) => project.status === "archived" || project.status === "completed");
  return (
    <div>
      <h1 className="text-2xl font-semibold">Projects</h1>
      <NewProject />
      {current.length === 0 ? (
        <div className="mt-6">
          <Quiet>No projects yet. Ask Claude to add one.</Quiet>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {current.map((project) => (
            <Card key={project.slug} project={project} />
          ))}
        </ul>
      )}
      {finished.length > 0 ? (
        <div className="mt-10">
          <button type="button" onClick={() => setShowArchived(!showArchived)} className="text-sm underline underline-offset-2">
            {showArchived ? "Hide" : "Show"} {finished.length} completed and archived
          </button>
          {showArchived ? (
            <ul className="mt-4 grid gap-4 md:grid-cols-2">
              {finished.map((project) => (
                <Card key={project.slug} project={project} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One line to start a project. It opens the new project's page, where the rest is filled in. */
function NewProject() {
  const create = useMutation(api.viewer.createProject);
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"general" | "code">("general");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const { slug } = await create({ title, kind });
      router.push(`/projects/${slug}`);
    } catch (caught) {
      setError(problem(caught));
      setBusy(false);
    }
  }

  const field = "rounded-md border border-foreground/20 bg-background px-2 py-1.5 text-sm";
  return (
    <form onSubmit={submit} className="mt-4">
      <div className="flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="New project"
          aria-label="New project title"
          className={`min-w-48 flex-1 ${field}`}
        />
        <select value={kind} onChange={(event) => setKind(event.target.value as "general" | "code")} aria-label="Kind" className={field}>
          <option value="general">General</option>
          <option value="code">Code</option>
        </select>
        <button type="submit" disabled={busy || !title.trim()} className={`${button} disabled:opacity-50`}>
          Add
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </form>
  );
}

function Card({ project }: { project: Project }) {
  const stale = staleNote(project);
  return (
    <li className="rounded-lg border border-foreground/15 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/projects/${project.slug}`} className="text-lg font-semibold underline-offset-2 hover:underline">
          {project.title}
        </Link>
        <Tag>{words(project.status)}</Tag>
        {project.health ? <Tag kind={project.health}>{words(project.health)}</Tag> : null}
        {stale ? <Tag kind="at_risk">{stale}</Tag> : null}
      </div>
      {project.statusNote ? (
        <div className="mt-3">
          <p className="line-clamp-4 text-sm">{project.statusNote}</p>
          {project.statusUpdatedAt ? (
            <p className="mt-1 text-xs text-foreground/60">
              {project.statusUpdatedBy} · {showTime(project.statusUpdatedAt)}
            </p>
          ) : null}
        </div>
      ) : project.summary ? (
        <p className="mt-3 line-clamp-3 text-sm text-foreground/70">{project.summary}</p>
      ) : null}
      {project.nextTasks.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-medium text-foreground/60">
            Next{project.openTaskCount > project.nextTasks.length ? ` · ${project.openTaskCount} open` : ""}
          </p>
          <ul className="mt-1 space-y-1 text-sm">
            {project.nextTasks.map((task) => (
              <li key={task.id}>
                {task.title}
                {task.due ? <span className="text-foreground/60"> · due {showDay(task.due.date)}</span> : null}
                {task.status === "waiting" ? <span className="text-foreground/60"> · waiting</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ClaudeHome home={project.claudeHome} />
    </li>
  );
}

/** Where the project's work happens in Claude. A Claude Project with a link opens it. */
export function ClaudeHome({ home }: { home: Project["claudeHome"] }) {
  if (!home) return null;
  return (
    <p className="mt-3 text-xs text-foreground/60">
      {home.kind === "claude_project" ? (
        home.url ? (
          <a href={home.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Open in Claude: {home.name}
          </a>
        ) : (
          <>Claude Project: {home.name}</>
        )
      ) : (
        <>
          Code folder: <code className="font-mono">{home.path}</code>
        </>
      )}
    </p>
  );
}
