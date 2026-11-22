"use client";

import { api } from "@convex/_generated/api";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { itemHref } from "./item-details";
import { OwnerPage } from "./owner-page";
import { button, problem, Quiet, showTime, Tag, words } from "./parts";

/**
 * Memory: what is worth remembering, and the people, companies and goals it is
 * about. One page with a section per kind, a search box, and a way to add.
 * A title opens the record's details over the page.
 */

const KINDS = ["note", "link", "memory", "decision", "principle", "question"] as const;
type Kind = (typeof KINDS)[number];

const SECTIONS = [
  { key: "all", label: "Everything" },
  { key: "note", label: "Notes" },
  { key: "link", label: "Links" },
  { key: "memory", label: "Memories" },
  { key: "decision", label: "Decisions" },
  { key: "principle", label: "Principles" },
  { key: "question", label: "Questions" },
  { key: "people", label: "People" },
  { key: "companies", label: "Companies" },
  { key: "goals", label: "Goals" },
] as const;
type Section = (typeof SECTIONS)[number]["key"];

const field = "w-full rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm";
const isKind = (section: Section): section is Kind => (KINDS as readonly string[]).includes(section);
const sectionHref = (section: Section) => (section === "all" ? "/memory" : `/memory/${section}`);

export function MemoryPage() {
  return (
    <OwnerPage wide>
      <Loaded />
    </OwnerPage>
  );
}

function Loaded() {
  const params = useParams<{ section?: string }>();
  const section = SECTIONS.find((item) => item.key === params.section)?.key ?? "all";
  const [typed, setTyped] = useState("");
  const query = useSettled(typed.trim());

  return (
    <div>
      <h1 className="text-2xl font-semibold">Memory</h1>
      <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Sections">
        {SECTIONS.map((item) => (
          <Link
            key={item.key}
            href={sectionHref(item.key)}
            aria-current={item.key === section ? "page" : undefined}
            className={item.key === section ? "font-semibold underline underline-offset-4" : "text-foreground/70 hover:text-foreground"}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {section === "goals" ? null : (
        <input
          type="search"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={section === "all" ? "Search everything Skippy holds" : `Search ${SECTIONS.find((item) => item.key === section)!.label.toLowerCase()}`}
          aria-label="Search"
          className={`mt-6 text-base ${field}`}
        />
      )}
      <div className="mt-6">
        {query && section !== "goals" ? (
          <Results query={query} section={section} />
        ) : section === "people" ? (
          <People />
        ) : section === "companies" ? (
          <Companies />
        ) : section === "goals" ? (
          <Goals />
        ) : (
          <Saved key={section} kind={isKind(section) ? section : undefined} />
        )}
      </div>
    </div>
  );
}

/** The value once typing has paused, so a search does not run on every keystroke. */
function useSettled(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), 250);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

function Results({ query, section }: { query: string; section: Exclude<Section, "goals"> }) {
  const found = useQuery(api.viewerMemory.search, { query, ...(section === "all" ? {} : { section }) });
  if (found === undefined) return <Quiet>Searching…</Quiet>;
  if (found.results.length === 0) return <Quiet>Nothing matches “{query}”.</Quiet>;
  return (
    <ul className="space-y-4">
      {found.results.map((result) => {
        const href = itemHref(result.type, result.id);
        return (
          <li key={`${result.type}:${result.id}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              {href ? (
                <Link href={href} scroll={false} className="text-base font-medium underline-offset-2 hover:underline">
                  {result.title}
                </Link>
              ) : (
                <span className="text-base font-medium">{result.title}</span>
              )}
              <Tag>{result.kind ?? result.type}</Tag>
              {result.state && result.state !== "active" ? <Tag>{words(result.state)}</Tag> : null}
            </div>
            {result.snippet ? <p className="mt-1 text-sm text-foreground/70">{result.snippet}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

const PAGE = 30;

/** Notes, links, memories, decisions, principles and questions, most recently changed first. */
function Saved({ kind }: { kind?: Kind }) {
  const [archived, setArchived] = useState(false);
  const list = usePaginatedQuery(
    api.viewerMemory.knowledge,
    { ...(kind ? { kind } : {}), ...(archived ? { archived } : {}) },
    { initialNumItems: PAGE },
  );
  return (
    <div>
      <AddKnowledge kind={kind} />
      <label className="mt-4 flex items-center gap-2 text-sm text-foreground/70">
        <input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} className="size-4" />
        Show the archived instead
      </label>
      {list.status === "LoadingFirstPage" ? (
        <div className="mt-6">
          <Quiet>Loading…</Quiet>
        </div>
      ) : list.results.length === 0 ? (
        <div className="mt-6">
          <Quiet>{archived ? "Nothing archived here." : "Nothing saved here yet."}</Quiet>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {list.results.map((item) => (
            <li key={item.id}>
              <div className="flex flex-wrap items-baseline gap-2">
                <Link href={itemHref("knowledge", item.id)!} scroll={false} className="text-base font-medium underline-offset-2 hover:underline">
                  {item.title}
                </Link>
                {kind ? null : <Tag>{item.kind}</Tag>}
                {item.readState === "unread" ? <Tag>unread</Tag> : null}
                {item.updatedAt ? <span className="text-xs text-foreground/60">{showTime(item.updatedAt)}</span> : null}
              </div>
              {item.url ? <p className="mt-0.5 truncate text-xs text-foreground/60">{item.url}</p> : null}
              {item.preview ? <p className="mt-1 text-sm text-foreground/70">{item.preview}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {list.status === "CanLoadMore" || list.status === "LoadingMore" ? (
        <button type="button" disabled={list.status === "LoadingMore"} onClick={() => list.loadMore(PAGE)} className={`mt-6 ${button}`}>
          {list.status === "LoadingMore" ? "Loading…" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

/** A short form for saving something new. A link needs its address; anything else needs a title or some text. */
function AddKnowledge({ kind }: { kind?: Kind }) {
  const save = useMutation(api.viewerMemory.saveKnowledge);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Kind>(kind ?? "note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={button}>
        Add {kind ? `a ${kind}` : "something"}
      </button>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const made = await save({
        kind: chosen,
        ...(title.trim() ? { title } : {}),
        ...(body.trim() ? { body } : {}),
        ...(url.trim() ? { url } : {}),
      });
      setTitle("");
      setBody("");
      setUrl("");
      setOpen(false);
      router.push(itemHref("knowledge", made.id)!, { scroll: false });
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-foreground/15 p-4">
      {kind ? null : (
        <label className="block text-sm">
          Kind
          <select value={chosen} onChange={(event) => setChosen(event.target.value as Kind)} className={`mt-1 ${field}`}>
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-sm">
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={`mt-1 ${field}`} />
      </label>
      {chosen === "link" ? (
        <label className="block text-sm">
          Address
          <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} required placeholder="https://…" className={`mt-1 ${field}`} />
        </label>
      ) : null}
      <label className="block text-sm">
        {chosen === "link" ? "Why keep it" : "Text"}
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} className={`mt-1 ${field}`} />
      </label>
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={button}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={button}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function People() {
  const data = useQuery(api.viewerMemory.people);
  const save = useMutation(api.viewerMemory.savePerson);
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      const made = await save({ name });
      setName("");
      router.push(itemHref("person", made.id)!, { scroll: false });
    } catch (caught) {
      setError(problem(caught));
    }
  }

  return (
    <div>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Add a person by name" aria-label="New person" className={`min-w-48 flex-1 ${field}`} />
        <button type="submit" disabled={!name.trim()} className={`${button} disabled:opacity-50`}>
          Add
        </button>
      </form>
      {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      {data === undefined ? (
        <div className="mt-6">
          <Quiet>Loading…</Quiet>
        </div>
      ) : data.people.length === 0 ? (
        <div className="mt-6">
          <Quiet>Nobody on file yet.</Quiet>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {data.people.map((person) => (
            <li key={person.id}>
              <div className="flex flex-wrap items-baseline gap-2">
                <Link href={itemHref("person", person.id)!} scroll={false} className="text-base font-medium underline-offset-2 hover:underline">
                  {person.name}
                </Link>
                {person.favorite ? <Tag>favourite</Tag> : null}
              </div>
              <p className="text-sm text-foreground/70">
                {[person.roleTitle, person.company?.name, person.relationshipContext].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Companies() {
  const data = useQuery(api.viewerMemory.companies);
  if (data === undefined) return <Quiet>Loading…</Quiet>;
  if (data.companies.length === 0) return <Quiet>No companies yet. One is added when a person is said to work there.</Quiet>;
  return (
    <ul className="space-y-3">
      {data.companies.map((company) => (
        <li key={company.id}>
          <div className="flex flex-wrap items-baseline gap-2">
            <Link href={itemHref("company", company.id)!} scroll={false} className="text-base font-medium underline-offset-2 hover:underline">
              {company.name}
            </Link>
            {company.relationshipLabel ? <Tag>{company.relationshipLabel}</Tag> : null}
          </div>
          {company.website ?? company.domain ? <p className="text-sm text-foreground/70">{company.website ?? company.domain}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function Goals() {
  const data = useQuery(api.viewerMemory.goals);
  if (data === undefined) return <Quiet>Loading…</Quiet>;
  if (data.goals.length === 0) return <Quiet>No goals yet.</Quiet>;
  return (
    <ul className="space-y-4">
      {data.goals.map((goal) => (
        <li key={goal.id}>
          <div className="flex flex-wrap items-baseline gap-2">
            <Link href={itemHref("goal", goal.id)!} scroll={false} className="text-base font-medium underline-offset-2 hover:underline">
              {goal.title}
            </Link>
            <Tag>{goal.status}</Tag>
            {goal.horizon ? <span className="text-xs text-foreground/60">{goal.horizon}</span> : null}
          </div>
          {goal.description ? <p className="mt-1 text-sm text-foreground/70">{goal.description}</p> : null}
        </li>
      ))}
    </ul>
  );
}
