"use client";

import { Article, CalendarBlank, ChatsCircle, CheckSquare, Files as FilesIcon, Flag, NotePencil, Steps } from "@phosphor-icons/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { EventRow } from "./calendar-parts";
import { ChatsAbout } from "./chats-about";
import { Files } from "./files";
import { MarkdownText } from "./markdown";
import { OwnerPage } from "./owner-page";
import { button, FINISHES, PARTS } from "./parts";
import { fromToday, Panel, PLAN_STAGES, problem, Quiet, showDay, showTime, staleNote, Tag, words } from "./parts";
import { BudgetPart, OptionsPart } from "./project-parts";
import { ClaudeHome } from "./projects-board";
import { AddTask, TaskList, type Task } from "./tasks";
import { useNow } from "./use-now";

/**
 * One project: its status and history, phases, tasks and notes, and the parts
 * switched on (options, budget, schedule), all editable by the owner. Code is
 * a type of its own; any other project is ongoing, ends on a date, or ends
 * when its tasks are done.
 */

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
  // A project that ends on a date: a trip, a holiday, a party.
  const plan = project.finish === "date";
  const stage = project.stage ? PLAN_STAGES[project.stage] : undefined;
  const has = (part: keyof typeof PARTS) => project.parts.includes(part);
  const events =
    page.events.length > 0 || has("schedule") ? (
      <Events events={page.events} title={has("schedule") ? (plan ? "Itinerary" : "Schedule") : "Coming up"} />
    ) : null;
  const parts = (
    <>
      {has("options") ? <OptionsPart project={project.slug} decisions={page.decisions} /> : null}
      {has("budget") ? <BudgetPart project={project.slug} budget={page.budget} /> : null}
    </>
  );
  const tasks = (
    <Panel title={plan ? "To arrange" : "Tasks"} icon={CheckSquare} note={`${page.openTasks.length} open`}>
      {page.openTasks.length === 0 ? (
        <Quiet>{plan ? (project.stage === "intention" ? "Nothing to arrange yet: add what needs booking or deciding." : "Everything is done.") : "Nothing open."}</Quiet>
      ) : (
        <ByPhase tasks={page.openTasks} phases={page.phases} />
      )}
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
  );
  return (
    <div className="space-y-10">
      <div>
        <Header project={project} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {stale ? <Tag kind="at_risk">{stale}</Tag> : null}
          <Tag>{project.finish ? FINISHES[project.finish].label : "code"}</Tag>
          {stage ? <Tag kind={stage.tag}>{stage.label}</Tag> : null}
          {project.finish === "ongoing" ? null : project.targetDate ? (
            <Tag>{plan ? `${showDay(project.targetDate)}, ${fromToday(project.targetDate)}` : `target ${showDay(project.targetDate)}`}</Tag>
          ) : project.roughDate ? (
            <Tag>{project.roughDate}</Tag>
          ) : plan ? (
            <Tag kind="at_risk">no date yet</Tag>
          ) : null}
          <span className="font-mono text-xs text-foreground/60">{project.slug}</span>
        </div>
        <ClaudeHome home={project.claudeHome} />
        <Settings project={project} />
      </div>

      <Description project={project} />

      {/* Once a plan is set, its itinerary is what matters; until then, what is left to arrange. */}
      {plan && project.stage === "set" ? (
        <>
          {events}
          {tasks}
          {parts}
        </>
      ) : (
        <>
          {tasks}
          {parts}
          {events}
        </>
      )}

      {plan && page.recentUpdates.length === 0 ? null : (
        <Panel title="Status" icon={Flag}>
          {page.recentUpdates.length === 0 ? (
            <Quiet>No status reports yet. Claude adds one when it works on this project.</Quiet>
          ) : (
            <ul className="space-y-4">
              {page.recentUpdates.map((update, index) => (
                <li key={update.at ?? index}>
                  <p className="text-sm text-foreground/60">
                    {update.by}
                    {update.fromSweep ? " · from the nightly sweep, written from commits" : ""}
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
      )}

      {plan && page.phases.length === 0 ? null : <Phases project={project.slug} phases={page.phases} />}

      <Panel title="Chats" icon={ChatsCircle}>
        <ChatsAbout type="project" id={project.slug} />
      </Panel>

      <Panel title="Files" icon={FilesIcon}>
        <Files type="project" id={project.slug} />
      </Panel>

      <Notes project={project} />
    </div>
  );
}

/** The title and summary, with an edit form behind a button. */
/** The project's events still to come, by day. */
function Events({ events, title }: { events: Page["events"]; title: string }) {
  const days = new Map<string, Page["events"]>();
  for (const event of events) days.set(event.start.date, [...(days.get(event.start.date) ?? []), event]);
  return (
    <Panel title={title} icon={CalendarBlank} note={`${events.length} ${events.length === 1 ? "event" : "events"}`}>
      {events.length === 0 ? <Quiet>No times or bookings yet. Events filed under this project show here, by day.</Quiet> : null}
      <div className="space-y-6">
        {[...days].map(([day, list]) => (
          <div key={day}>
            <h3 className="mb-2 text-sm font-medium text-foreground/60">{showDay(day)}</h3>
            <ul className="space-y-2">
              {list.map((event) => (
                <EventRow key={event.id} event={event} showProject={false} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Header({ project }: { project: Project }) {
  const save = useMutation(api.viewer.saveProject);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [summary, setSummary] = useState(project.summary ?? "");
  const [target, setTarget] = useState(project.targetDate ?? "");
  const [rough, setRough] = useState(project.roughDate ?? "");
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
              setRough(project.roughDate ?? "");
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
        roughDate: rough.trim() ? rough : null,
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
      {project.finish === "ongoing" ? null : (
        <div className="flex flex-wrap gap-4">
          <label className="block text-sm">
            {project.finish === "date" ? "Date (the last day, for more than one)" : "Target date"}
            <input type="date" value={target} onChange={(event) => setTarget(event.target.value)} className={`mt-1 block ${field}`} />
          </label>
          <label className="block text-sm">
            Or roughly when
            <input
              value={rough}
              onChange={(event) => setRough(event.target.value)}
              placeholder="early spring"
              maxLength={100}
              className={`mt-1 block ${field}`}
            />
          </label>
        </div>
      )}
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
    <Panel title="Phases" icon={Steps}>
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

/** Type, how it ends, status, health and the parts switched on. Each saves as soon as it is changed. */
function Settings({ project }: { project: Project }) {
  const save = useMutation(api.viewer.saveProject);
  const [error, setError] = useState<string>();

  async function change(fields: {
    kind?: Project["kind"];
    finish?: NonNullable<Project["finish"]>;
    parts?: Project["parts"];
    status?: Project["status"];
    health?: NonNullable<Project["health"]> | null;
  }) {
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
          Type{" "}
          <select value={project.kind} onChange={(event) => change({ kind: event.target.value as Project["kind"] })} className={field}>
            <option value="general">Project</option>
            <option value="code">Code</option>
          </select>
        </label>
        {project.finish ? (
          <label className="text-sm">
            Ends{" "}
            <select
              value={project.finish}
              onChange={(event) => change({ finish: event.target.value as NonNullable<Project["finish"]> })}
              className={field}
            >
              {(Object.keys(FINISHES) as (keyof typeof FINISHES)[]).map((value) => (
                <option key={value} value={value}>
                  {FINISHES[value].choice}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
        {project.finish === "date" ? null : (
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
        )}
      </div>
      <fieldset className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <legend className="float-left mr-1">Parts</legend>
        {(Object.keys(PARTS) as (keyof typeof PARTS)[]).map((part) => (
          <label key={part} className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={project.parts.includes(part)}
              onChange={(event) =>
                change({
                  parts: event.target.checked ? [...project.parts, part] : project.parts.filter((item) => item !== part),
                })
              }
              className="size-4"
            />
            {PARTS[part]}
          </label>
        ))}
      </fieldset>
      {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </div>
  );
}

/**
 * The longer account of the project, written in Markdown and shown formatted.
 * A long one is cut to a screen until asked for. Editing has a preview.
 */
function Description({ project }: { project: Project }) {
  const save = useMutation(api.viewer.saveProject);
  const [draft, setDraft] = useState<string>();
  const [preview, setPreview] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const text = project.description ?? "";
  const long = text.length > 1200 || text.split("\n").length > 24;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await save({ slug: project.slug, description: draft?.trim() ? draft : null });
      setDraft(undefined);
      setPreview(false);
    } catch (caught) {
      setError(problem(caught));
    }
  }

  const edit = (
    <button type="button" onClick={() => setDraft(text)} className="underline underline-offset-2">
      {text ? "Edit" : "Write one"}
    </button>
  );

  if (draft === undefined) {
    return (
      <Panel title="Description" icon={Article} note={edit}>
        {text ? (
          <div>
            <div className={long && !open ? "relative max-h-96 overflow-hidden" : undefined}>
              <MarkdownText text={text} page className="text-base" />
              {long && !open ? <div className="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-background" /> : null}
            </div>
            {long ? (
              <button type="button" onClick={() => setOpen(!open)} className="mt-2 text-sm text-foreground/60 underline underline-offset-2">
                {open ? "Show less" : "Show all"}
              </button>
            ) : null}
          </div>
        ) : (
          <Quiet>No description yet: what the project is for, its scope and anything worth knowing.</Quiet>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Description" icon={Article}>
      <form onSubmit={submit}>
        <div className="mb-2 flex gap-4 text-sm" role="tablist">
          {(["Write", "Preview"] as const).map((label) => {
            const selected = (label === "Preview") === preview;
            return (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setPreview(label === "Preview")}
                className={selected ? "font-medium underline underline-offset-4" : "text-foreground/60"}
              >
                {label}
              </button>
            );
          })}
        </div>
        {preview ? (
          <div className="min-h-32 rounded-md border border-foreground/20 px-3 py-2">
            {draft.trim() ? <MarkdownText text={draft} page className="text-base" /> : <Quiet>Nothing to preview.</Quiet>}
          </div>
        ) : (
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={Math.min(Math.max(draft.split("\n").length + 2, 10), 40)}
            aria-label="Project description"
            placeholder={"## Goal\nWhat this project is for.\n\n## Scope\n- In\n- Out\n\nLinks: [the brief](https://…)"}
            autoFocus
            className={`w-full font-mono ${field}`}
          />
        )}
        <p className="mt-1 text-xs text-foreground/60">Markdown: ## headings, **bold**, *italics*, - lists, - [ ] checklists, [links](https://…), tables.</p>
        {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
        <div className="mt-2 flex gap-2">
          <button type="submit" className={button}>
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(undefined);
              setPreview(false);
              setError(undefined);
            }}
            className={button}
          >
            Cancel
          </button>
        </div>
      </form>
    </Panel>
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
    <Panel title="Notes" icon={NotePencil}>
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
