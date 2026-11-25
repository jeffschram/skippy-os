"use client";

import { api } from "@convex/_generated/api";
import type { presentGoal } from "@convex/goals";
import type { presentKnowledge } from "@convex/knowledge";
import type { presentCompany, presentPerson } from "@convex/people";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { draftOfRule, EventDoneBox, RuleFields, ruleOfDraft, type EventItem, type RecurrenceItem } from "./calendar-parts";
import { ItemChat } from "./chats-about";
import { Background, ChatSection, DetailsWindow, WindowButtons, WindowLayout } from "./details-window";
import { ITEM_TYPES, itemHref } from "./item-href";
import { Files } from "./files";
import { CompanyView, EventView, GoalView, KnowledgeView, PersonView, RecurrenceView } from "./details-views";
import { button, problem, Quiet, showDay, showTime, Tag, words } from "./parts";
import { useNow } from "./use-now";

/**
 * The details of something in Memory (a note, link, memory, decision,
 * principle or question, a person, a company or a goal) or on the Agenda (an
 * event, or something that recurs), opened over whatever
 * page the owner is on by adding `?item=<type>:<id>` to the address. It opens
 * laid out for reading (`details-views.tsx`); Edit swaps in the form. Below
 * the record are what it is linked to, where it came from and its history.
 */

const TYPES = ITEM_TYPES;
type ItemType = (typeof TYPES)[number];
type Bundle = NonNullable<FunctionReturnType<typeof api.viewerMemory.item>>;
type Knowledge = ReturnType<typeof presentKnowledge>;
type Person = Awaited<ReturnType<typeof presentPerson>>;
type Company = ReturnType<typeof presentCompany>;
type Goal = ReturnType<typeof presentGoal>;

const KINDS = ["note", "link", "memory", "decision", "principle", "question"] as const;
const LABELS = ["client", "vendor", "employer", "partner", "prospect", "other"] as const;
const field = "w-full rounded-md border border-foreground/20 bg-background px-2 py-1.5 text-sm";

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
    <DetailsWindow label="Details" onClose={close}>
      {type && id ? <Loaded key={param} type={type} id={id} onClose={close} /> : <Missing onClose={close} />}
    </DetailsWindow>
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
  // The window opens for reading. Edit swaps in the form; saving or cancelling comes back here.
  const [editing, setEditing] = useState(false);
  if (bundle === undefined) return <Quiet>Loading…</Quiet>;
  if (bundle === null) return <Missing onClose={onClose} />;
  const kind = type === "knowledge" ? words((bundle.record as Knowledge).kind) : type === "recurrence" ? "repeating" : type;
  const done = () => setEditing(false);
  return (
    <WindowLayout
      editing={editing}
      header={
        <>
          {editing ? <h2 className="text-lg font-semibold">Edit {kind}</h2> : <p className="text-sm text-foreground/60 first-letter:uppercase">{kind}</p>}
          <div className="flex items-center gap-4">
            {type === "event" && !editing ? <EventDoneBox event={bundle.record as EventItem} /> : null}
            <WindowButtons onEdit={editing ? undefined : () => setEditing(true)} onClose={onClose} />
          </div>
        </>
      }
      record={
        !editing ? (
          type === "knowledge" ? (
            <KnowledgeView item={bundle.record as Knowledge} />
          ) : type === "person" ? (
            <PersonView person={bundle.record as Person} />
          ) : type === "company" ? (
            <CompanyView company={bundle.record as Company} />
          ) : type === "event" ? (
            <EventView event={bundle.record as EventItem} />
          ) : type === "recurrence" ? (
            <RecurrenceView item={bundle.record as RecurrenceItem} />
          ) : (
            <GoalView goal={bundle.record as Goal} />
          )
        ) : type === "knowledge" ? (
          <KnowledgeForm item={bundle.record as Knowledge} onClose={done} />
        ) : type === "person" ? (
          <PersonForm person={bundle.record as Person} onClose={done} />
        ) : type === "company" ? (
          <CompanyForm company={bundle.record as Company} onClose={done} />
        ) : type === "event" ? (
          <EventForm event={bundle.record as EventItem} onClose={done} />
        ) : type === "recurrence" ? (
          <RecurrenceForm item={bundle.record as RecurrenceItem} onClose={done} />
        ) : (
          <GoalForm goal={bundle.record as Goal} onClose={done} />
        )
      }
      chat={
        <ChatSection>
          <ItemChat type={type} id={id} />
        </ChatSection>
      }
      rest={
        <>
          <Files type={type} id={id} folded />
          <Around bundle={bundle} />
        </>
      }
    />
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
          {[
            ...person.emails.map((value) => ({ value, change: { removeEmails: [value] } })),
            ...person.phoneNumbers.map((value) => ({ value, change: { removePhoneNumbers: [value] } })),
          ].map((handle) => (
            <li key={handle.value} className="flex flex-wrap items-baseline gap-3">
              {handle.value}
              <button
                type="button"
                onClick={async () => {
                  setError(undefined);
                  try {
                    await save({ id: person.id, ...handle.change });
                  } catch (caught) {
                    setError(problem(caught));
                  }
                }}
                aria-label={`Remove ${handle.value}`}
                className="text-xs text-foreground/60 underline underline-offset-2"
              >
                remove
              </button>
            </li>
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

/** The project picker for an event. An archived project the event already belongs to stays in the list. */
function ProjectField({ value, current, onChange }: { value: string; current?: string; onChange: (slug: string) => void }) {
  const projects = useQuery(api.viewer.projects, { now: useNow() });
  const options = (projects?.projects ?? []).map((item) => ({ slug: item.slug, title: item.title }));
  if (current && !options.some((item) => item.slug === current)) options.push({ slug: current, title: current });
  return (
    <label className="block text-sm">
      Project
      <select value={value} onChange={(change) => onChange(change.target.value)} className={`mt-1 ${field}`}>
        <option value="">No project</option>
        {options.map((item) => (
          <option key={item.slug} value={item.slug}>
            {item.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function EventForm({ event, onClose }: { event: EventItem; onClose: () => void }) {
  const save = useMutation(api.viewer.saveEvent);
  const copy = event.origin !== "skippy";
  const [project, setProject] = useState(event.project ?? "");
  const [title, setTitle] = useState(event.title);
  const [day, setDay] = useState(event.start.date);
  const [from, setFrom] = useState(event.allDay ? "" : event.start.time);
  const [endDay, setEndDay] = useState(event.end?.date ?? "");
  const [to, setTo] = useState(event.allDay || !event.end ? "" : event.end.time);
  const [location, setLocation] = useState(event.location ?? "");
  const [description, setDescription] = useState(event.description ?? "");
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

  function submit(submitted: FormEvent) {
    submitted.preventDefault();
    const changes: Parameters<typeof save>[0] = { id: event.id };
    if (project !== (event.project ?? "")) changes.project = project || null;
    // A copy from the owner's calendar takes only its project here; the rest is changed in the calendar.
    if (copy) {
      if (Object.keys(changes).length === 1) return onClose();
      return void run(changes);
    }
    if (title !== event.title) changes.title = title;
    if (location !== (event.location ?? "")) changes.location = text(location);
    if (description !== (event.description ?? "")) changes.description = text(description);
    // Times are sent together, and only when one of them was touched, so an untouched event keeps its exact times.
    const was = [event.start.date, event.allDay ? "" : event.start.time, event.end?.date ?? "", event.allDay || !event.end ? "" : event.end.time];
    if ([day, from, endDay, to].some((value, index) => value !== was[index])) {
      changes.startAt = from ? `${day}T${from}` : day;
      changes.allDay = !from;
      const lastDay = endDay || day;
      changes.endAt = from ? (to ? `${lastDay}T${to}` : null) : lastDay !== day ? lastDay : null;
    }
    if (Object.keys(changes).length === 1) return onClose();
    void run(changes);
  }

  const cancelled = event.status === "cancelled";
  if (copy) {
    return (
      <form onSubmit={submit} className="space-y-4">
        <p className="text-base font-medium">{event.title}</p>
        <ProjectField value={project} current={event.project} onChange={setProject} />
        <p className="text-sm text-foreground/60">
          This is a copy from your calendar, so its title, time and details are changed there. The project is kept in Skippy only.
        </p>
        {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
        <Buttons busy={busy} onClose={onClose} />
      </form>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {cancelled ? <Tag>cancelled</Tag> : null}
      <label className="block text-sm">
        Title
        <input value={title} onChange={(change) => setTitle(change.target.value)} required className={`mt-1 text-base ${field}`} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          Day
          <input type="date" value={day} onChange={(change) => setDay(change.target.value)} required className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          Starts (empty for all day)
          <input type="time" value={from} onChange={(change) => setFrom(change.target.value)} className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          Last day, if it runs over days
          <input type="date" value={endDay} onChange={(change) => setEndDay(change.target.value)} className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          Ends
          <input type="time" value={to} onChange={(change) => setTo(change.target.value)} disabled={!from} className={`mt-1 ${field}`} />
        </label>
      </div>
      <label className="block text-sm">
        Where
        <input value={location} onChange={(change) => setLocation(change.target.value)} className={`mt-1 ${field}`} />
      </label>
      <ProjectField value={project} current={event.project} onChange={setProject} />
      <label className="block text-sm">
        Details
        <textarea value={description} onChange={(change) => setDescription(change.target.value)} rows={5} className={`mt-1 ${field}`} />
      </label>
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <Buttons busy={busy} onClose={onClose}>
        <button
          type="button"
          disabled={busy}
          onClick={() => run({ id: event.id, status: cancelled ? "confirmed" : "cancelled" })}
          className="ml-auto text-sm text-foreground/60 underline underline-offset-2"
        >
          {cancelled ? "Put it back on" : "Call it off"}
        </button>
      </Buttons>
    </form>
  );
}

function RecurrenceForm({ item, onClose }: { item: RecurrenceItem; onClose: () => void }) {
  const save = useMutation(api.viewer.saveRecurrence);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [draft, setDraft] = useState(draftOfRule(item.rule));
  const [anchor, setAnchor] = useState(item.anchor);
  const [lead, setLead] = useState(String(item.leadTimeDays));
  const [nextDue, setNextDue] = useState(item.nextDue);
  const [status, setStatus] = useState(item.status);
  const [area, setArea] = useState(item.area ?? "");
  const areas = useQuery(api.viewer.areas, {})?.areas ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(submitted: FormEvent) {
    submitted.preventDefault();
    const changes: Parameters<typeof save>[0] = { id: item.id };
    if (title !== item.title) changes.title = title;
    if (description !== (item.description ?? "")) changes.description = text(description);
    const rule = ruleOfDraft(draft);
    if (JSON.stringify(rule) !== JSON.stringify(ruleOfDraft(draftOfRule(item.rule)))) changes.rule = rule;
    if (anchor !== item.anchor) changes.anchor = anchor;
    if (Number(lead) !== item.leadTimeDays) changes.leadTimeDays = Number(lead) || 0;
    if (nextDue !== item.nextDue) changes.nextDue = nextDue;
    if (status !== item.status) changes.status = status;
    if (area !== (item.area ?? "")) changes.area = area || null;
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
        Title
        <input value={title} onChange={(change) => setTitle(change.target.value)} required className={`mt-1 text-base ${field}`} />
      </label>
      <div className="text-sm">
        <p className="mb-1">Repeats</p>
        <RuleFields draft={draft} onChange={setDraft} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          Next due
          <input type="date" value={nextDue} onChange={(change) => setNextDue(change.target.value)} required className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          Show it this many days ahead
          <input type="number" min={0} max={365} value={lead} onChange={(change) => setLead(change.target.value)} className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          The next one is counted from
          <select value={anchor} onChange={(change) => setAnchor(change.target.value as typeof anchor)} className={`mt-1 ${field}`}>
            <option value="schedule">the day this one was due</option>
            <option value="completion">the day this one was done</option>
          </select>
        </label>
        <label className="block text-sm">
          Status
          <select value={status} onChange={(change) => setStatus(change.target.value as typeof status)} className={`mt-1 ${field}`}>
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="retired">retired</option>
          </select>
        </label>
        {areas.length > 0 ? (
          <label className="block text-sm">
            Area
            <select value={area} onChange={(change) => setArea(change.target.value)} className={`mt-1 ${field}`}>
              <option value="">No area</option>
              {areas.map((entry) => (
                <option key={entry.id} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <label className="block text-sm">
        Details
        <textarea value={description} onChange={(change) => setDescription(change.target.value)} rows={5} className={`mt-1 ${field}`} />
      </label>
      {item.history.length > 0 ? (
        <p className="text-xs text-foreground/60">
          Last rounds:{" "}
          {item.history
            .map((entry) => `${entry.outcome}${entry.due ? ` for ${showDay(entry.due)}` : ` ${showTime(entry.at)}`}`)
            .join("; ")}
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <Buttons busy={busy} onClose={onClose} />
    </form>
  );
}

const GOAL_STATUSES = ["active", "paused", "achieved", "abandoned"] as const;

function GoalForm({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const save = useMutation(api.viewerMemory.saveGoal);
  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description ?? "");
  const [horizon, setHorizon] = useState(goal.horizon ?? "");
  const [status, setStatus] = useState(goal.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const changes: Parameters<typeof save>[0] = { id: goal.id };
    if (title !== goal.title) changes.title = title;
    if (description !== (goal.description ?? "")) changes.description = text(description);
    if (horizon !== (goal.horizon ?? "")) changes.horizon = text(horizon);
    if (status !== goal.status) changes.status = status;
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
        Goal
        <input value={title} onChange={(event) => setTitle(event.target.value)} required className={`mt-1 text-base ${field}`} />
      </label>
      <label className="block text-sm">
        What it means
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} className={`mt-1 ${field}`} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          When it is for
          <input value={horizon} onChange={(event) => setHorizon(event.target.value)} placeholder="This year, by June…" className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as Goal["status"])} className={`mt-1 ${field}`}>
            {GOAL_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {goal.measures?.length ? (
        <ul className="text-sm text-foreground/70">
          {goal.measures.map((measure) => (
            <li key={measure.label}>
              {measure.label}: {measure.current} of {measure.target}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <Buttons busy={busy} onClose={onClose} />
    </form>
  );
}

/** What surrounds a record: its links, where it came from, and what has happened to it. */
function Around({ bundle }: { bundle: Bundle }) {
  const parts = [
    bundle.links.length > 0 ? "Links" : undefined,
    bundle.sources.length > 0 ? "Source" : undefined,
    bundle.recentActivity.length > 0 ? "History" : undefined,
  ].filter((part): part is string => part !== undefined);
  return (
    <Background parts={parts}>
      {bundle.links.length > 0 ? (
        <section>
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
        <section>
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
        <section>
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
    </Background>
  );
}
