"use client";

import { CalendarBlank, CalendarDot, ChatsCircle, HandPalm, NewspaperClipping } from "@phosphor-icons/react";
import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { AllDayLine, EventRow, RecurrenceRow, type EventItem, type RecurrenceItem } from "./calendar-parts";
import { BriefingText } from "./briefing-text";
import { OwnerPage } from "./owner-page";
import { button } from "./parts";
import { Panel, Quiet, showDay, showTime } from "./parts";
import { TaskItem, TaskList, type Task } from "./tasks";
import { useNow } from "./use-now";

/**
 * Home: the day's briefing, today and the next seven days in time order, the
 * weekly review, the latest chats, then what needs the owner. The inbox and
 * what the passes made are on Activity; the projects have their own page.
 * Each panel is its own live query.
 */

export function Home() {
  return (
    <OwnerPage>
      <div className="space-y-12">
        <Briefing />
        <Today />
        <Upcoming />
        <WeeklyReview />
        <Chats />
        <NeedsYou />
      </div>
    </OwnerPage>
  );
}

/**
 * The day's note. Shown once one has been written; an older one says which day
 * it is from. With no note for today and a failed last pass, it says why.
 */
function Briefing() {
  const data = useQuery(api.viewer.briefing, { now: useNow() });
  if (!data) return null;
  const briefing = "text" in data ? data : null;
  const problem = "problem" in data ? data.problem : null;
  return (
    <Panel
      title="Briefing"
      icon={NewspaperClipping}
      note={briefing ? (briefing.isToday ? showDay(briefing.date) : `from ${showDay(briefing.date)}`) : undefined}
    >
      {problem ? (
        <p className="mb-4 rounded-md border border-red-600/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          Today&apos;s briefing has not been written: the {problem.pass ? `${problem.pass} ` : ""}ingestion pass failed at {showTime(problem.at)}.
          {problem.note ? ` ${problem.note}` : ""}
        </p>
      ) : null}
      {briefing ? (
        <>
          <BriefingText text={briefing.text} className={briefing.isToday ? "" : "text-foreground/70"} />
          <p className="mt-3 text-xs text-foreground/60">
            {briefing.by} · {showTime(briefing.writtenAt)}
          </p>
        </>
      ) : null}
    </Panel>
  );
}

/** This week's review, folded away under the briefing. Shown while it is at most eight days old. */
function WeeklyReview() {
  const review = useQuery(api.viewer.weeklyReview, { now: useNow() });
  if (!review) return null;
  return (
    <details>
      <summary className="cursor-pointer border-b border-foreground/15 pb-2 text-lg font-semibold">
        Weekly review <span className="text-sm font-normal text-foreground/60">· {showDay(review.date)}</span>
      </summary>
      <BriefingText text={review.text} className="mt-4" />
      <p className="mt-3 text-xs text-foreground/60">
        {review.by} · {showTime(review.writtenAt)}
      </p>
    </details>
  );
}

/** The latest chats. Shown once there is one. */
function Chats() {
  const data = useQuery(api.viewerChat.chats, { limit: 5 });
  if (!data || data.chats.length === 0) return null;
  return (
    <Panel title="Chats" icon={ChatsCircle}>
      <ul className="space-y-2">
        {data.chats.map((chat) => (
          <li key={chat.id} className="flex flex-wrap items-baseline gap-x-3">
            <Link href={`/chat/${chat.id}`} className="text-base underline-offset-2 hover:underline">
              {chat.title}
            </Link>
            <span className="text-xs text-foreground/60">
              {chat.scope.kind === "item" && chat.scope.record ? `${chat.scope.record.title} · ` : ""}
              {showTime(chat.updatedAt)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** One line in a day: an event, a task or something that recurs, with the instant it is placed at. */
type Entry =
  | { kind: "event"; at: number; event: EventItem }
  | { kind: "task"; at: number; task: Task }
  | { kind: "recurrence"; at: number; item: RecurrenceItem };

const KIND_ORDER = { event: 0, task: 1, recurrence: 2 } as const;
// A task with only a date is stored at the end of its day, so it falls after the timed things.
// A recurrence has only a date, so it goes there too.
const endOfDay = (date: string) => new Date(`${date}T23:59:59`).getTime();
const taskAt = (task: Task) => Date.parse(task.due?.at ?? task.scheduledFor?.at ?? "");

function timeline(events: EventItem[], tasks: Task[], recurrences: RecurrenceItem[]): Entry[] {
  return [
    ...events.map((event): Entry => ({ kind: "event", at: Date.parse(event.start.at), event })),
    ...tasks.map((task): Entry => ({ kind: "task", at: taskAt(task), task })),
    ...recurrences.map((item): Entry => ({ kind: "recurrence", at: endOfDay(item.nextDue), item })),
  ].sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

const isAllDay = (entry: Entry) => entry.kind === "event" && entry.event.allDay;

/** A day's entries in time order, with its all-day events folded into one line at the top, where they would sort anyway. */
function EntryList({ entries }: { entries: Entry[] }) {
  const allDay = entries.flatMap((entry) => (entry.kind === "event" && entry.event.allDay ? [entry.event] : []));
  return (
    <div className="space-y-2">
      {allDay.length > 0 ? <AllDayLine events={allDay} /> : null}
      <EntryRows entries={entries.filter((entry) => !isAllDay(entry))} />
    </div>
  );
}

function EntryRows({ entries }: { entries: Entry[] }) {
  return (
    <ul className="space-y-2">
      {entries.map((entry) =>
        entry.kind === "event" ? (
          <EventRow key={`event:${entry.event.id}`} event={entry.event} />
        ) : entry.kind === "recurrence" ? (
          <RecurrenceRow key={`recurrence:${entry.item.id}`} item={entry.item} showDue />
        ) : (
          <TaskItem key={`task:${entry.task.id}`} task={entry.task} showProject />
        ),
      )}
    </ul>
  );
}

/** What has an id, so Upcoming can leave out what Today already shows. */
const ids = (items: { id: string }[]) => new Set(items.map((item) => item.id));

/** Today's tasks and events in time order, overdue ones first, with waiting tasks that have no date at the bottom. */
function Today() {
  const today = useQuery(api.viewer.today, { now: useNow() });
  if (today === undefined) {
    return (
      <Panel title="Today" icon={CalendarDot}>
        <Quiet>Loading…</Quiet>
      </Panel>
    );
  }
  // A waiting task with a date is listed on its day, here or under Upcoming. Only the undated ones are left for the bottom.
  const entries = timeline(today.events, [...today.overdue, ...today.dueToday, ...today.scheduled], today.recurrences);
  const waiting = today.waiting.filter((task) => !task.due && !task.scheduledFor);
  return (
    <Panel title="Today" icon={CalendarDot} note={showDay(today.date)}>
      {entries.length + waiting.length === 0 ? (
        <Quiet>Nothing needs you today.</Quiet>
      ) : (
        <div className="space-y-6">
          {entries.length > 0 ? <EntryList entries={entries} /> : null}
          {waiting.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground/60">Waiting</h3>
              <TaskList tasks={waiting} showProject />
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/** The seven days after today, one heading a day, each in time order. Leaves out what Today already shows. */
function Upcoming() {
  const now = useNow();
  const today = useQuery(api.viewer.today, { now });
  const data = useQuery(api.viewer.upcoming, { now });
  if (data === undefined || today === undefined) return null;
  const shownEvents = ids(today.events);
  const shownTasks = ids([...today.overdue, ...today.dueToday, ...today.scheduled]);
  const shownRecurrences = ids(today.recurrences);
  const days = new Map<string, Entry[]>();
  const entries = timeline(
    data.events.filter((event) => !shownEvents.has(event.id)),
    data.tasks.filter((task) => !shownTasks.has(task.id)),
    data.recurrences.filter((item) => !shownRecurrences.has(item.id)),
  );
  for (const entry of entries) {
    const date = entry.kind === "event" ? entry.event.start.date : entry.kind === "recurrence" ? entry.item.nextDue : (entry.task.due?.date ?? entry.task.scheduledFor?.date);
    // An event that began before tomorrow and is still running goes under tomorrow.
    const key = date === undefined || date < data.from ? data.from : date;
    days.set(key, [...(days.get(key) ?? []), entry]);
  }
  const keys = [...days.keys()].sort();
  return (
    <Panel title="Upcoming" icon={CalendarBlank} note={<Link href="/agenda" className="underline underline-offset-2">Agenda</Link>}>
      {keys.length === 0 ? (
        <Quiet>Nothing in the next seven days.</Quiet>
      ) : (
        <div className="space-y-6">
          {keys.map((key) => (
            <div key={key}>
              <h3 className="mb-2 text-sm font-medium text-foreground/60">{showDay(key)}</h3>
              <EntryList entries={days.get(key)!} />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * What will not move until the owner does something: a project in trouble or
 * gone quiet, a pass that failed, the mini not answering. Not shown when empty.
 */
function NeedsYou() {
  const data = useQuery(api.viewer.needsYou, { now: useNow() });
  const save = useMutation(api.viewer.saveProject);
  if (!data || data.items.length === 0) return null;
  return (
    <Panel title="Needs you" icon={HandPalm}>
      <ul className="space-y-3">
        {data.items.map((item) => {
          if (item.kind === "project_health") {
            return (
              <li key={`health:${item.slug}`}>
                <Link href={`/projects/${item.slug}`} className="font-medium underline underline-offset-2">
                  {item.title}
                </Link>{" "}
                is {item.health === "blocked" ? "blocked" : "at risk"}
                {item.since ? <span className="text-foreground/60"> · since {showTime(item.since)}</span> : null}
                {item.note ? <p className="mt-1 line-clamp-2 text-sm text-foreground/70">{item.note}</p> : null}
              </li>
            );
          }
          if (item.kind === "project_quiet") {
            return (
              <li key={`quiet:${item.slug}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span>
                  <Link href={`/projects/${item.slug}`} className="font-medium underline underline-offset-2">
                    {item.title}
                  </Link>{" "}
                  has gone quiet
                  <span className="text-foreground/60">
                    {" "}
                    · {item.days === undefined ? "no status report yet" : `no status report in ${item.days} days`}
                  </span>
                </span>
                <button type="button" onClick={() => void save({ slug: item.slug, status: "paused" })} className={button}>
                  Pause
                </button>
              </li>
            );
          }
          if (item.kind === "pass_failed") {
            return (
              <li key="pass">
                <Link href="/activity" className="font-medium underline underline-offset-2">
                  The {item.pass ? `${item.pass} ` : ""}ingestion pass failed
                </Link>
                <span className="text-foreground/60"> · {showTime(item.at)}</span>
                {item.note ? <p className="mt-1 line-clamp-2 text-sm text-foreground/70">{item.note}</p> : null}
              </li>
            );
          }
          return (
            <li key="mini">
              <span className="font-medium">The Mac mini has not checked in</span>
              <span className="text-foreground/60"> · since {showTime(item.since)}</span>
              <p className="mt-1 text-sm text-foreground/70">Chats wait until it is back.</p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
