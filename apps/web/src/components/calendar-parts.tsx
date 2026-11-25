"use client";

import { api } from "@convex/_generated/api";
import type { RecurrenceRule } from "@skippy/shared";
import type { FunctionReturnType } from "convex/server";
import { useMutation } from "convex/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { button, doneBox, problem, showClock, showDay } from "./parts";
import { PlaceLink } from "./place";
import { useNow } from "./use-now";

/** Rows and forms for events and for things that recur. Shared by Home, the Agenda and the details view. */

type Calendar = FunctionReturnType<typeof api.viewer.calendar>;
export type EventItem = Calendar["events"][number];
export type RecurrenceItem = Calendar["recurrences"][number];

const field = "rounded-md border border-foreground/20 bg-transparent px-2 py-1.5 text-sm";

/** "3:00 PM – 4:00 PM", "all day", or "until Sat, Nov 28" for one that runs over days. */
export function eventTime(event: EventItem): string {
  const longer = event.end && event.end.date !== event.start.date ? ` until ${showDay(event.end.date)}` : "";
  if (event.allDay) return `all day${longer}`;
  const end = event.end && !longer ? ` – ${showClock(event.end.time)}` : "";
  return `${showClock(event.start.time)}${end}${longer}`;
}

/** Whether an event is over by the clock. */
export const eventIsOver = (event: EventItem, now: number) => Date.parse(event.overAt) <= now;

/**
 * Whether an event is done, and the tick that marks it. It is done once it is
 * over by the clock; before then the owner can tick it off early, or take that back.
 */
function useEventDone(event: EventItem) {
  const mark = useMutation(api.viewer.markEventDone);
  const over = eventIsOver(event, useNow());
  const done = over || event.doneAt !== undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function toggle() {
    // Over by the clock: there is nothing to take back.
    if (over || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await mark({ id: event.id, done: !done });
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  }

  const label = over ? `"${event.title}" is over` : done ? `Take the done mark off "${event.title}"` : `Mark "${event.title}" done`;
  return { over, done, toggle, label, error };
}

/** The box itself. Once the event is over it stays ticked and looks like any other tick. */
function EventBox({ state, className = "" }: { state: ReturnType<typeof useEventDone>; className?: string }) {
  return (
    <input
      type="checkbox"
      checked={state.done}
      onChange={state.toggle}
      aria-disabled={state.over || undefined}
      title={state.over ? "Over" : undefined}
      aria-label={state.label}
      className={`${doneBox(state.done)} ${state.over ? "cursor-default" : ""} ${className}`}
    />
  );
}

export function EventRow({ event, showProject = true }: { event: EventItem; showProject?: boolean }) {
  const state = useEventDone(event);
  return (
    <li className="flex items-start gap-3">
      <EventBox state={state} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <Link
          href={`?item=event:${event.id}`}
          scroll={false}
          className={`text-base underline-offset-2 hover:underline ${state.done ? "text-foreground/60 line-through" : ""}`}
        >
          {event.title}
        </Link>
        <p className="truncate text-sm text-foreground/60">
          {eventTime(event)}
          {event.location ? (
            <>
              {" · "}
              <PlaceLink location={event.location} />
            </>
          ) : null}
          {showProject && event.project ? ` · ${event.project}` : null}
        </p>
        {state.error ? <p className="mt-1 text-sm text-red-700 dark:text-red-300">{state.error}</p> : null}
      </div>
    </li>
  );
}

/** A Done box for an event's window. */
export function EventDoneBox({ event }: { event: EventItem }) {
  const state = useEventDone(event);
  return (
    <label className={`flex items-center gap-2 text-sm ${state.over ? "" : "cursor-pointer"}`} title={state.error}>
      <EventBox state={state} />
      <span className={state.error ? "text-red-700 dark:text-red-300" : ""}>{state.error ? "Not saved" : state.over ? "Over" : "Done"}</span>
    </label>
  );
}

/**
 * The day's all-day events on one line, such as someone's out-of-office: they
 * are background, not something to do. Each opens in its window, where it can be ticked off.
 */
export function AllDayLine({ events }: { events: EventItem[] }) {
  const now = useNow();
  return (
    <p className="text-sm text-foreground/60">
      All day:{" "}
      {events.map((event, index) => {
        const done = eventIsOver(event, now) || event.doneAt !== undefined;
        const longer = event.end && event.end.date !== event.start.date ? ` (until ${showDay(event.end.date)})` : "";
        return (
          <span key={event.id}>
            {index > 0 ? " · " : ""}
            <Link
              href={`?item=event:${event.id}`}
              scroll={false}
              className={`underline-offset-2 hover:underline ${done ? "line-through" : "text-foreground/80"}`}
            >
              {event.title}
            </Link>
            {longer}
          </span>
        );
      })}
    </p>
  );
}

/** A recurring thing with a box to tick this round off. The tick names the round, so it cannot count twice. */
export function RecurrenceRow({ item, showDue }: { item: RecurrenceItem; showDue?: boolean }) {
  const complete = useMutation(api.viewer.completeRecurrence);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(skip: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      await complete({ id: item.id, due: item.nextDue, ...(skip ? { skip } : {}) });
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={false}
        disabled={busy || item.status !== "active"}
        onChange={() => run(false)}
        aria-label={`Mark "${item.title}" done for ${item.nextDue}`}
        className="mt-1.5 size-4 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <Link href={`?item=recurrence:${item.id}`} scroll={false} className="text-base underline-offset-2 hover:underline">
          {item.title}
        </Link>
        <p className="text-sm text-foreground/60">
          {[
            item.status === "paused" ? "paused" : undefined,
            showDue ? `${item.overdue ? "was due" : "due"} ${showDay(item.nextDue)}` : undefined,
            item.repeats.toLowerCase(),
          ]
            .filter(Boolean)
            .join(" · ")}
          {item.status === "active" ? (
            <>
              {" · "}
              <button type="button" disabled={busy} onClick={() => run(true)} className="underline underline-offset-2">
                skip this one
              </button>
            </>
          ) : null}
        </p>
        {error ? <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      </div>
    </li>
  );
}

const WEEKDAYS = [
  ["MO", "Monday"],
  ["TU", "Tuesday"],
  ["WE", "Wednesday"],
  ["TH", "Thursday"],
  ["FR", "Friday"],
  ["SA", "Saturday"],
  ["SU", "Sunday"],
] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** How a rule is held while it is being edited: one of four plain shapes, or the raw rule text. */
export type RuleDraft = {
  mode: "days" | "weekly" | "monthly" | "yearly" | "custom";
  days: string;
  weekday: string;
  monthDay: string;
  month: string;
  custom: string;
};

export function draftOfRule(rule?: RecurrenceRule): RuleDraft {
  const draft: RuleDraft = { mode: "monthly", days: "30", weekday: "MO", monthDay: "1", month: "1", custom: "" };
  if (!rule) return draft;
  if (rule.kind === "interval") return { ...draft, mode: "days", days: String(rule.everyDays) };
  const weekly = /^FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU)$/.exec(rule.rrule);
  if (weekly) return { ...draft, mode: "weekly", weekday: weekly[1] };
  const monthly = /^FREQ=MONTHLY;BYMONTHDAY=(\d{1,2})$/.exec(rule.rrule);
  if (monthly) return { ...draft, mode: "monthly", monthDay: monthly[1] };
  const yearly = /^FREQ=YEARLY;BYMONTH=(\d{1,2});BYMONTHDAY=(\d{1,2})$/.exec(rule.rrule);
  if (yearly) return { ...draft, mode: "yearly", month: yearly[1], monthDay: yearly[2] };
  return { ...draft, mode: "custom", custom: rule.rrule };
}

export function ruleOfDraft(draft: RuleDraft): RecurrenceRule {
  switch (draft.mode) {
    case "days":
      return { kind: "interval", everyDays: Number(draft.days) };
    case "weekly":
      return { kind: "calendar", rrule: `FREQ=WEEKLY;BYDAY=${draft.weekday}` };
    case "monthly":
      return { kind: "calendar", rrule: `FREQ=MONTHLY;BYMONTHDAY=${Number(draft.monthDay)}` };
    case "yearly":
      return { kind: "calendar", rrule: `FREQ=YEARLY;BYMONTH=${Number(draft.month)};BYMONTHDAY=${Number(draft.monthDay)}` };
    case "custom":
      return { kind: "calendar", rrule: draft.custom };
  }
}

export function RuleFields({ draft, onChange }: { draft: RuleDraft; onChange: (draft: RuleDraft) => void }) {
  const set = (change: Partial<RuleDraft>) => onChange({ ...draft, ...change });
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select value={draft.mode} onChange={(event) => set({ mode: event.target.value as RuleDraft["mode"] })} aria-label="How it repeats" className={field}>
        <option value="days">Every so many days</option>
        <option value="weekly">Every week</option>
        <option value="monthly">Every month</option>
        <option value="yearly">Every year</option>
        <option value="custom">Another rule</option>
      </select>
      {draft.mode === "days" ? (
        <label className="flex items-center gap-2">
          every
          <input type="number" min={1} max={3660} value={draft.days} onChange={(event) => set({ days: event.target.value })} required className={`w-20 ${field}`} />
          days
        </label>
      ) : null}
      {draft.mode === "weekly" ? (
        <label className="flex items-center gap-2">
          on
          <select value={draft.weekday} onChange={(event) => set({ weekday: event.target.value })} className={field}>
            {WEEKDAYS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {draft.mode === "yearly" ? (
        <label className="flex items-center gap-2">
          in
          <select value={draft.month} onChange={(event) => set({ month: event.target.value })} className={field}>
            {MONTHS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {draft.mode === "monthly" || draft.mode === "yearly" ? (
        <label className="flex items-center gap-2">
          on day
          <input type="number" min={1} max={31} value={draft.monthDay} onChange={(event) => set({ monthDay: event.target.value })} required className={`w-16 ${field}`} />
        </label>
      ) : null}
      {draft.mode === "custom" ? (
        <input
          value={draft.custom}
          onChange={(event) => set({ custom: event.target.value })}
          required
          placeholder="FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15"
          aria-label="Rule"
          className={`min-w-64 flex-1 font-mono ${field}`}
        />
      ) : null}
    </div>
  );
}

/** Two small forms behind buttons: add an event, add something that recurs. */
export function AddToCalendar() {
  const [open, setOpen] = useState<"event" | "recurrence">();
  if (open === "event") return <NewEvent onDone={() => setOpen(undefined)} />;
  if (open === "recurrence") return <NewRecurrence onDone={() => setOpen(undefined)} />;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={() => setOpen("event")} className={button}>
        Add an event
      </button>
      <button type="button" onClick={() => setOpen("recurrence")} className={button}>
        Add something that repeats
      </button>
    </div>
  );
}

function NewEvent({ onDone }: { onDone: () => void }) {
  const save = useMutation(api.viewer.saveEvent);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await save({
        title,
        startAt: from ? `${day}T${from}` : day,
        ...(from && to ? { endAt: `${day}T${to}` } : {}),
        ...(location.trim() ? { location } : {}),
      });
      onDone();
    } catch (caught) {
      setError(problem(caught));
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-md border border-foreground/15 p-4">
      <input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="What is it" aria-label="Event title" className={`w-full ${field}`} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input type="date" value={day} onChange={(event) => setDay(event.target.value)} required aria-label="Day" className={field} />
        <label className="flex items-center gap-2">
          from
          <input type="time" value={from} onChange={(event) => setFrom(event.target.value)} className={field} />
        </label>
        <label className="flex items-center gap-2">
          to
          <input type="time" value={to} onChange={(event) => setTo(event.target.value)} disabled={!from} className={field} />
        </label>
        <span className="text-foreground/60">Leave the times empty for all day.</span>
      </div>
      <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Where (optional)" aria-label="Where" className={`w-full ${field}`} />
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className={button}>
          Add event
        </button>
        <button type="button" onClick={onDone} className={button}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function NewRecurrence({ onDone }: { onDone: () => void }) {
  const save = useMutation(api.viewer.saveRecurrence);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState(draftOfRule());
  const [first, setFirst] = useState("");
  const [lead, setLead] = useState("0");
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await save({ title, rule: ruleOfDraft(draft), ...(first ? { nextDue: first } : {}), leadTimeDays: Number(lead) || 0 });
      onDone();
    } catch (caught) {
      setError(problem(caught));
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-md border border-foreground/15 p-4">
      <input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="What comes round, such as Pay the water bill" aria-label="Title" className={`w-full ${field}`} />
      <RuleFields draft={draft} onChange={setDraft} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          first due
          <input type="date" value={first} onChange={(event) => setFirst(event.target.value)} className={field} />
        </label>
        <label className="flex items-center gap-2">
          show it
          <input type="number" min={0} max={365} value={lead} onChange={(event) => setLead(event.target.value)} className={`w-16 ${field}`} />
          days ahead
        </label>
      </div>
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className={button}>
          Add
        </button>
        <button type="button" onClick={onDone} className={button}>
          Cancel
        </button>
      </div>
    </form>
  );
}
