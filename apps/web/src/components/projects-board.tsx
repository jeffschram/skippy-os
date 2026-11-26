"use client";

import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { OwnerPage } from "./owner-page";
import { button, fromToday, PLAN_STAGES, problem, Quiet, showDay, staleNote, Tag, words } from "./parts";
import { useNow } from "./use-now";

/**
 * Every project and plan in one list, one row each: labels for what it is and
 * where it stands, and a line on what comes next. Plans show their date and
 * how far off it is. Finished ones, and plans whose day has passed, fold away.
 */

type Project = FunctionReturnType<typeof api.viewer.board>["projects"][number];

export function ProjectsBoard() {
  return (
    <OwnerPage wide>
      <Board />
    </OwnerPage>
  );
}

const finished = (project: Project) => project.status === "archived" || project.status === "completed" || project.stage === "happened";

function Board() {
  const data = useQuery(api.viewer.board, { now: useNow() });
  const [showFinished, setShowFinished] = useState(false);
  if (data === undefined) return <Quiet>Loading…</Quiet>;
  const current = data.projects.filter((project) => !finished(project));
  const done = data.projects.filter(finished);
  return (
    <div>
      <h1 className="text-2xl font-semibold">Projects</h1>
      <NewProject />
      {current.length === 0 ? (
        <div className="mt-6">
          <Quiet>No projects yet. Ask Claude to add one.</Quiet>
        </div>
      ) : (
        <Rows projects={current} />
      )}
      {done.length > 0 ? (
        <div className="mt-8">
          <button type="button" onClick={() => setShowFinished(!showFinished)} className="text-sm underline underline-offset-2">
            {showFinished ? "Hide" : "Show"} {done.length} finished, archived or past
          </button>
          {showFinished ? <Rows projects={done} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function Rows({ projects }: { projects: Project[] }) {
  return (
    <ul className="mt-4 divide-y divide-foreground/10 border-y border-foreground/10">
      {projects.map((project) => (
        <Row key={project.slug} project={project} />
      ))}
    </ul>
  );
}

/** One line to start a project or a plan. It opens the new one's page, where the rest is filled in. */
function NewProject() {
  const create = useMutation(api.viewer.createProject);
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Project["kind"]>("general");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const { slug } = await create({ title, kind, ...(kind === "plan" && date ? { targetDate: date } : {}) });
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
          placeholder={kind === "plan" ? "New plan" : "New project"}
          aria-label="New project title"
          className={`min-w-48 flex-1 ${field}`}
        />
        <select value={kind} onChange={(event) => setKind(event.target.value as Project["kind"])} aria-label="Kind" className={field}>
          <option value="general">Project</option>
          <option value="plan">Plan</option>
          <option value="code">Code</option>
        </select>
        {kind === "plan" ? (
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="The plan's date" className={field} />
        ) : null}
        <button type="submit" disabled={busy || !title.trim()} className={`${button} disabled:opacity-50`}>
          Add
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </form>
  );
}

/** What comes next on a row: for a plan, its date and what is left to arrange; otherwise the next task. */
function nextLine(project: Project): string | undefined {
  const next = project.nextTasks[0];
  const todo = next ? `${project.openTaskCount} to do · next: ${next.title}` : undefined;
  if (project.kind === "plan") {
    const when = project.targetDate ? `${showDay(project.targetDate)}, ${fromToday(project.targetDate)}` : "no date yet";
    if (project.stage === "set") return `${when} · everything is done`;
    if (project.stage === "intention") return `${when} · nothing to arrange yet`;
    return todo ? `${when} · ${todo}` : when;
  }
  return todo;
}

function Row({ project }: { project: Project }) {
  const stale = staleNote(project);
  const stage = project.stage ? PLAN_STAGES[project.stage] : undefined;
  const about = project.kind === "plan" ? project.summary : (project.statusNote ?? project.summary);
  const next = nextLine(project);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link href={`/projects/${project.slug}`} className="font-semibold underline-offset-2 hover:underline">
          {project.title}
        </Link>
        {project.kind === "plan" ? <Tag>plan</Tag> : project.kind === "code" ? <Tag>code</Tag> : null}
        {stage ? <Tag kind={stage.tag}>{stage.label}</Tag> : null}
        {project.status !== "active" && !(project.kind === "plan" && project.status === "idea") ? <Tag>{words(project.status)}</Tag> : null}
        {project.health ? <Tag kind={project.health}>{words(project.health)}</Tag> : null}
        {stale ? <Tag kind="at_risk">{stale}</Tag> : null}
      </div>
      {next ? <p className="mt-1 truncate text-sm">{next}</p> : null}
      {about ? <p className="mt-0.5 line-clamp-1 text-sm text-foreground/60">{about}</p> : null}
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
          {home.repoUrl ? (
            <>
              {" · "}
              <a href={home.repoUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                Repository
              </a>
            </>
          ) : null}
        </>
      )}
    </p>
  );
}
