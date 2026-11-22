"use client";

import { api } from "@convex/_generated/api";
import type { presentKnowledge } from "@convex/knowledge";
import type { presentCompany, presentPerson } from "@convex/people";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { button, problem, Quiet, showTime, Tag, words } from "./parts";
import { useNow } from "./use-now";

/**
 * The details of something in Memory (a note, link, memory, decision,
 * principle or question, a person, a company or a goal), opened over whatever
 * page the owner is on by adding `?item=<type>:<id>` to the address. Below the
 * record's own fields are what it is linked to, where it came from and its history.
 */

const TYPES = ["knowledge", "person", "company", "goal"] as const;
type ItemType = (typeof TYPES)[number];
type Bundle = NonNullable<FunctionReturnType<typeof api.viewerMemory.item>>;
type Knowledge = ReturnType<typeof presentKnowledge>;
type Person = Awaited<ReturnType<typeof presentPerson>>;
type Company = ReturnType<typeof presentCompany>;
type Goal = { title: string; description?: string; status: string; horizon?: string };

const KINDS = ["note", "link", "memory", "decision", "principle", "question"] as const;
const LABELS = ["client", "vendor", "employer", "partner", "prospect", "other"] as const;
const field = "w-full rounded-md border border-foreground/20 bg-background px-2 py-1.5 text-sm";

/** Where a record opens: a project has its page, a task its own details, and the rest open here. */
export function itemHref(type: string, id: string): string | undefined {
  if (type === "project") return `/projects/${id}`;
  if (type === "task") return `?task=${id}`;
  if ((TYPES as readonly string[]).includes(type)) return `?item=${type}:${id}`;
  return undefined;
}

export function ItemDetails() {
  const param = useSearchParams().get("item");
  const path = usePathname();
  const router = useRouter();
  const close = () => router.replace(path, { scroll: false });

  useEffect(() => {
    if (!param) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") router.replace(path, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [param, path, router]);

  if (!param) return null;
  const at = param.indexOf(":");
  const type = TYPES.find((value) => value === param.slice(0, at));
  const id = param.slice(at + 1);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-0 sm:p-6" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Details"
        onClick={(event) => event.stopPropagation()}
        className="mx-auto min-h-full w-full max-w-3xl bg-background p-6 sm:min-h-0 sm:rounded-lg sm:border sm:border-foreground/15"
      >
        {type && id ? <Loaded type={type} id={id} onClose={close} /> : <Missing onClose={close} />}
      </div>
    </div>
  );
}

function Missing({ onClose }: { onClose: () => void }) {
  return (
    <div>
      <p>There is nothing at that address.</p>
      <button type="button" onClick={onClose} className={`mt-4 ${button}`}>
        Close
      </button>
    </div>
  );
}

function Loaded({ type, id, onClose }: { type: ItemType; id: string; onClose: () => void }) {
  const bundle = useQuery(api.viewerMemory.item, { type, id, now: useNow() });
  if (bundle === undefined) return <Quiet>Loading…</Quiet>;
  if (bundle === null) return <Missing onClose={onClose} />;
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-semibold">{type === "knowledge" ? words((bundle.record as Knowledge).kind) : type}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="text-sm text-foreground/60 underline underline-offset-2">
          Close
        </button>
      </div>
      {type === "knowledge" ? (
        <KnowledgeForm key={id} item={bundle.record as Knowledge} onClose={onClose} />
      ) : type === "person" ? (
        <PersonForm key={id} person={bundle.record as Person} onClose={onClose} />
      ) : type === "company" ? (
        <CompanyForm key={id} company={bundle.record as Company} onClose={onClose} />
      ) : (
        <GoalView goal={bundle.record as Goal} />
      )}
      <Around bundle={bundle} />
    </div>
  );
}

const text = (value: string) => (value.trim() ? value : null);

function Buttons({ busy, onClose, children }: { busy: boolean; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <button type="submit" disabled={busy} className={button}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onClose} className={button}>
        Cancel
      </button>
      {children}
    </div>
  );
}

function KnowledgeForm({ item, onClose }: { item: Knowledge; onClose: () => void }) {
  const save = useMutation(api.viewerMemory.saveKnowledge);
  const [kind, setKind] = useState(item.kind);
  const [title, setTitle] = useState(item.title ?? "");
  const [body, setBody] = useState(item.body ?? "");
  const [summary, setSummary] = useState(item.summary ?? "");
  const [url, setUrl] = useState(item.url ?? "");
  const [why, setWhy] = useState(item.whyItMatters ?? "");
  const [readState, setReadState] = useState(item.readState ?? "saved");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(changes: Parameters<typeof save>[0]) {
    setBusy(true);
    setError(undefined);
    try {
      await save(changes);
      onClose();
    } catch (caught) {
      setError(problem(caught));
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const changes: Parameters<typeof save>[0] = { id: item.id };
    if (kind !== item.kind) changes.kind = kind;
    if (title !== (item.title ?? "")) changes.title = text(title);
    if (body !== (item.body ?? "")) changes.body = text(body);
    if (summary !== (item.summary ?? "")) changes.summary = text(summary);
    if (url !== (item.url ?? "")) changes.url = text(url);
    if (why !== (item.whyItMatters ?? "")) changes.whyItMatters = text(why);
    if (kind === "link" && readState !== (item.readState ?? "saved")) changes.readState = readState;
    if (Object.keys(changes).length === 1) return onClose();
    void run(changes);
  }

  const archived = item.lifecycle === "archived";
  return (
    <form onSubmit={submit} className="space-y-4">
      {archived ? <Tag>archived</Tag> : null}
      <label className="block text-sm">
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={`mt-1 text-base ${field}`} />
      </label>
      {kind === "link" || url ? (
        <label className="block text-sm">
          Address
          <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} className={`mt-1 ${field}`} />
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-foreground/60 underline underline-offset-2">
              Open it
            </a>
          ) : null}
        </label>
      ) : null}
      <label className="block text-sm">
        Text
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={Math.min(Math.max(body.split("\n").length + 1, 5), 24)}
          className={`mt-1 ${field}`}
        />
      </label>
      <label className="block text-sm">
        Summary
        <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={2} className={`mt-1 ${field}`} />
      </label>
      <label className="block text-sm">
        Why it matters
        <input value={why} onChange={(event) => setWhy(event.target.value)} className={`mt-1 ${field}`} />
      </label>
      {item.decision ? (
        <div className="text-sm">
          <p className="text-foreground/60">Decision</p>
          {item.decision.chosen ? <p className="mt-1">Chosen: {item.decision.chosen}</p> : null}
          {item.decision.options?.length ? <p className="mt-1">Options: {item.decision.options.join("; ")}</p> : null}
          {item.decision.rationale ? <p className="mt-1 whitespace-pre-wrap">Why: {item.decision.rationale}</p> : null}
          {item.decision.revisitOn ? <p className="mt-1">Revisit on {item.decision.revisitOn}</p> : null}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          Kind
          <select value={kind} onChange={(event) => setKind(event.target.value as Knowledge["kind"])} className={`mt-1 ${field}`}>
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {kind === "link" ? (
          <label className="block text-sm">
            Read
            <select value={readState} onChange={(event) => setReadState(event.target.value as typeof readState)} className={`mt-1 ${field}`}>
              <option value="saved">saved</option>
              <option value="unread">unread</option>
              <option value="read">read</option>
            </select>
          </label>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <Buttons busy={busy} onClose={onClose}>
        <button
          type="button"
          disabled={busy}
          onClick={() => run({ id: item.id, lifecycle: archived ? "active" : "archived" })}
          className="ml-auto text-sm text-foreground/60 underline underline-offset-2"
        >
          {archived ? "Restore" : "Archive"}
        </button>
      </Buttons>
      <p className="text-xs text-foreground/60">
        Saved by {item.savedBy}
        {item.updatedAt ? ` · last changed ${showTime(item.updatedAt)}` : ""}
      </p>
    </form>
  );
}

function PersonForm({ person, onClose }: { person: Person; onClose: () => void }) {
  const save = useMutation(api.viewerMemory.savePerson);
  const [name, setName] = useState(person.name);
  const [role, setRole] = useState(person.roleTitle ?? "");
  const [company, setCompany] = useState(person.company?.name ?? "");
  const [context, setContext] = useState(person.relationshipContext ?? "");
  const [birthday, setBirthday] = useState(person.birthday ?? "");
  const [notes, setNotes] = useState(person.notes ?? "");
  const [favorite, setFavorite] = useState(person.favorite ?? false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const changes: Parameters<typeof save>[0] = { id: person.id };
    if (name !== person.name) changes.name = name;
    if (role !== (person.roleTitle ?? "")) changes.roleTitle = text(role);
    if (company !== (person.company?.name ?? "")) changes.company = text(company);
    if (context !== (person.relationshipContext ?? "")) changes.relationshipContext = text(context);
    if (birthday !== (person.birthday ?? "")) changes.birthday = text(birthday);
    if (notes !== (person.notes ?? "")) changes.notes = text(notes);
    if (favorite !== (person.favorite ?? false)) changes.favorite = favorite;
    if (email.trim()) changes.emails = [email];
    if (phone.trim()) changes.phoneNumbers = [phone];
    if (Object.keys(changes).length === 1) return onClose();
    setBusy(true);
    setError(undefined);
    try {
      await save(changes);
      onClose();
    } catch (caught) {
      setError(problem(caught));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm">
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} required className={`mt-1 text-base ${field}`} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          Role
          <input value={role} onChange={(event) => setRole(event.target.value)} className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          Company
          <input value={company} onChange={(event) => setCompany(event.target.value)} className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm sm:col-span-2">
          How you know them
          <input value={context} onChange={(event) => setContext(event.target.value)} className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          Birthday
          <input value={birthday} onChange={(event) => setBirthday(event.target.value)} placeholder="1984-03-09 or 03-09" className={`mt-1 ${field}`} />
        </label>
        <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
          <input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} className="size-4" />
          Favourite
        </label>
      </div>
      <div className="text-sm">
        <p className="text-foreground/60">Email and phone</p>
        {person.emails.length + person.phoneNumbers.length === 0 ? <p className="mt-1">None on file.</p> : null}
        <ul className="mt-1 space-y-0.5">
          {[...person.emails, ...person.phoneNumbers].map((handle) => (
            <li key={handle}>{handle}</li>
          ))}
        </ul>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Add an email" aria-label="Add an email" className={field} />
          <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Add a phone number" aria-label="Add a phone number" className={field} />
        </div>
      </div>
      <label className="block text-sm">
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={5} className={`mt-1 ${field}`} />
      </label>
      {person.lastContact ? <p className="text-xs text-foreground/60">Last in touch {person.lastContact}</p> : null}
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <Buttons busy={busy} onClose={onClose} />
    </form>
  );
}

function CompanyForm({ company, onClose }: { company: Company; onClose: () => void }) {
  const save = useMutation(api.viewerMemory.saveCompany);
  const [name, setName] = useState(company.name);
  const [website, setWebsite] = useState(company.website ?? "");
  const [domain, setDomain] = useState(company.domain ?? "");
  const [label, setLabel] = useState<string>(company.relationshipLabel ?? "");
  const [notes, setNotes] = useState(company.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const changes: Parameters<typeof save>[0] = { id: company.id };
    if (name !== company.name) changes.name = name;
    if (website !== (company.website ?? "")) changes.website = text(website);
    if (domain !== (company.domain ?? "")) changes.domain = text(domain);
    if (label !== (company.relationshipLabel ?? "")) changes.relationshipLabel = (label || null) as (typeof LABELS)[number] | null;
    if (notes !== (company.notes ?? "")) changes.notes = text(notes);
    if (Object.keys(changes).length === 1) return onClose();
    setBusy(true);
    setError(undefined);
    try {
      await save(changes);
      onClose();
    } catch (caught) {
      setError(problem(caught));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm">
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} required className={`mt-1 text-base ${field}`} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          Website
          <input value={website} onChange={(event) => setWebsite(event.target.value)} className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          Email domain
          <input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com" className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          What they are to you
          <select value={label} onChange={(event) => setLabel(event.target.value)} className={`mt-1 ${field}`}>
            <option value="">not set</option>
            {LABELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={5} className={`mt-1 ${field}`} />
      </label>
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <Buttons busy={busy} onClose={onClose} />
    </form>
  );
}

function GoalView({ goal }: { goal: Goal }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-base font-medium">{goal.title}</p>
        <Tag>{goal.status}</Tag>
        {goal.horizon ? <span className="text-xs text-foreground/60">{goal.horizon}</span> : null}
      </div>
      {goal.description ? <p className="mt-2 text-base whitespace-pre-wrap">{goal.description}</p> : null}
    </div>
  );
}

/** What surrounds a record: its links, where it came from, and what has happened to it. */
function Around({ bundle }: { bundle: Bundle }) {
  return (
    <>
      {bundle.links.length > 0 ? (
        <section className="border-t border-foreground/15 pt-4">
          <h3 className="text-sm font-medium text-foreground/60">Linked to</h3>
          <ul className="mt-2 space-y-1.5">
            {bundle.links.map((link, index) => {
              const href = itemHref(link.record.type, link.record.id);
              return (
                <li key={index} className="text-sm">
                  <span className="text-foreground/60">
                    {link.direction === "outgoing" ? words(link.relation) : `${words(link.relation)} (from)`}{" "}
                  </span>
                  {href ? (
                    <Link href={href} scroll={false} className="underline underline-offset-2">
                      {link.record.title}
                    </Link>
                  ) : (
                    link.record.title
                  )}
                  <span className="text-foreground/60"> · {link.record.type}</span>
                  {link.reason ? <span className="text-foreground/60"> · {link.reason}</span> : null}
                </li>
              );
            })}
          </ul>
          {bundle.moreLinks ? <p className="mt-2 text-xs text-foreground/60">There are more links than are shown here.</p> : null}
        </section>
      ) : null}
      {bundle.sources.length > 0 ? (
        <section className="border-t border-foreground/15 pt-4">
          <h3 className="text-sm font-medium text-foreground/60">Where it came from</h3>
          <ul className="mt-2 space-y-2">
            {bundle.sources.map((source, index) => (
              <li key={index} className="text-sm">
                <span className="text-foreground/60">
                  {words(source.relationship)} · {words(source.system)}
                  {source.at ? ` · ${showTime(source.at)}` : ""}
                </span>
                {source.summary ?? source.excerpt ? <p className="mt-0.5">{source.summary ?? source.excerpt}</p> : null}
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer" className="text-xs text-foreground/60 underline underline-offset-2">
                    Open the source
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {bundle.recentActivity.length > 0 ? (
        <section className="border-t border-foreground/15 pt-4">
          <h3 className="text-sm font-medium text-foreground/60">History</h3>
          <ul className="mt-2 space-y-2">
            {bundle.recentActivity.map((event, index) => (
              <li key={index} className="text-sm">
                {event.summary}
                <span className="text-foreground/60">
                  {" "}
                  · {event.by} · {showTime(event.at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
