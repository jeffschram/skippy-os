"use client";

import { api } from "@convex/_generated/api";
import type { presentGoal } from "@convex/goals";
import type { presentKnowledge } from "@convex/knowledge";
import type { presentCompany, presentPerson } from "@convex/people";
import type { FunctionReturnType } from "convex/server";
import { useQuery } from "convex/react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { eventTime, type EventItem, type RecurrenceItem } from "./calendar-parts";
import { showDay, showTime, Tag, words } from "./parts";
import { useNow } from "./use-now";

/**
 * A record laid out to be read. This is what a details window opens on; the
 * form it used to open on is one press of Edit away. Only what has a value is
 * shown, so a short record stays short.
 */

type TaskDetails = NonNullable<FunctionReturnType<typeof api.viewer.task>>;
type Knowledge = ReturnType<typeof presentKnowledge>;
type Person = Awaited<ReturnType<typeof presentPerson>>;
type Company = ReturnType<typeof presentCompany>;
type Goal = ReturnType<typeof presentGoal>;

const link = "underline underline-offset-2";

function Title({ children, tags }: { children: ReactNode; tags?: ReactNode }) {
  return (
    <div>
      <h2 className="text-xl leading-snug font-semibold text-balance">{children}</h2>
      {tags ? <div className="mt-2 flex flex-wrap gap-1.5">{tags}</div> : null}
    </div>
  );
}

/** Text as it was written, with its line breaks, and with any web address in it made a link. Long text scrolls in place. */
function Prose({ children, quiet }: { children: string | undefined | null; quiet?: boolean }) {
  if (!children?.trim()) return null;
  return (
    // Kept short, with its own scroll, so a details window fits on the screen, unless the chat is on its own pane.
    <p className={`max-h-[16dvh] max-w-prose overflow-y-auto in-data-[pane=details]:max-h-none text-base leading-7 break-words whitespace-pre-wrap ${quiet ? "text-foreground/70" : ""}`}>
      {children.split(/(https?:\/\/[^\s<>"]+)/g).map((part, index) =>
        index % 2 === 1 ? (
          <a key={index} href={part} target="_blank" rel="noreferrer" className={link}>
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

type Row = [label: string, value: ReactNode];

/** The short facts about a record, as a list of name and value. Empty ones are left out. */
function Facts({ rows }: { rows: Row[] }) {
  const shown = rows.filter(([, value]) => value !== undefined && value !== null && value !== false && value !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
      {shown.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-foreground/60">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

const TASK_STATUS: Record<TaskDetails["task"]["status"], string> = {
  todo: "to do",
  in_progress: "in progress",
  waiting: "waiting",
  done: "done",
  cancelled: "cancelled",
};

export function TaskView({ details }: { details: TaskDetails }) {
  const { task } = details;
  const now = useNow();
  // Only asked for when the task is in a phase, to show the phase by name.
  const project = useQuery(api.viewer.project, task.project && task.phaseId ? { slug: task.project, now } : "skip");
  const phase = project?.phases.find((entry) => entry.id === task.phaseId);
  return (
    <div className="space-y-4">
      <Title
        tags={
          <>
            <Tag>{TASK_STATUS[task.status]}</Tag>
            {task.commitment === "want" ? <Tag>optional</Tag> : null}
          </>
        }
      >
        {task.title}
      </Title>
      <Prose>{task.description}</Prose>
      <Facts
        rows={[
          ["Due", task.due ? showDay(task.due.date) : null],
          ["Planned for", task.scheduledFor ? showDay(task.scheduledFor.date) : null],
          ["Waiting on", task.waitingOn],
          [
            "Project",
            task.project ? (
              <Link href={`/projects/${task.project}`} className={link}>
                {details.projectTitle ?? task.project}
              </Link>
            ) : null,
          ],
          ["Phase", phase ? `${phase.order}. ${phase.title}` : null],
          ["Area", task.area],
          ["Finished", task.completedAt ? showTime(task.completedAt) : null],
        ]}
      />
    </div>
  );
}

/** A web address without its scheme, cut short, for showing as a link's words. */
function shortAddress(url: string): string {
  const plain = url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
  return plain.length > 60 ? `${plain.slice(0, 59)}…` : plain;
}

export function KnowledgeView({ item }: { item: Knowledge }) {
  return (
    <div className="space-y-4">
      <Title
        tags={
          item.lifecycle === "archived" || (item.kind === "link" && item.readState) ? (
            <>
              {item.lifecycle === "archived" ? <Tag>archived</Tag> : null}
              {item.kind === "link" && item.readState ? <Tag>{item.readState}</Tag> : null}
            </>
          ) : undefined
        }
      >
        {item.title ?? `Untitled ${item.kind}`}
      </Title>
      {item.url ? (
        <p className="text-sm">
          <a href={item.url} target="_blank" rel="noreferrer" className={link}>
            {shortAddress(item.url)}
          </a>
        </p>
      ) : null}
      <Prose quiet>{item.summary}</Prose>
      <Prose>{item.body}</Prose>
      <Facts
        rows={[
          ["Why it matters", item.whyItMatters],
          ["Chosen", item.decision?.chosen],
          ["Options", item.decision?.options?.length ? item.decision.options.join("; ") : null],
          ["Reasoning", item.decision?.rationale ? <span className="whitespace-pre-wrap">{item.decision.rationale}</span> : null],
          ["Revisit on", item.decision?.revisitOn ? showDay(item.decision.revisitOn) : null],
        ]}
      />
      <p className="text-xs text-foreground/60">
        Saved by {item.savedBy}
        {item.updatedAt ? ` · last changed ${showTime(item.updatedAt)}` : ""}
      </p>
    </div>
  );
}

export function PersonView({ person }: { person: Person }) {
  const role = [person.roleTitle, person.company?.name].filter(Boolean).join(", ");
  return (
    <div className="space-y-4">
      <Title tags={person.favorite ? <Tag>favourite</Tag> : undefined}>{person.name}</Title>
      {role ? <p className="text-base text-foreground/70">{role}</p> : null}
      <Facts
        rows={[
          ["How you know them", person.relationshipContext],
          [
            "Email",
            person.emails.length > 0 ? (
              <ul className="space-y-0.5">
                {person.emails.map((value) => (
                  <li key={value}>
                    <a href={`mailto:${value}`} className={link}>
                      {value}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null,
          ],
          [
            "Phone",
            person.phoneNumbers.length > 0 ? (
              <ul className="space-y-0.5">
                {person.phoneNumbers.map((value) => (
                  <li key={value}>
                    <a href={`tel:${value.replace(/[^\d+]/g, "")}`} className={link}>
                      {value}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null,
          ],
          ["Birthday", person.birthday],
          ["Last in touch", person.lastContact ? showDay(person.lastContact) : null],
        ]}
      />
      <Prose>{person.notes}</Prose>
    </div>
  );
}

export function CompanyView({ company }: { company: Company }) {
  const site = company.website ? (/^https?:\/\//i.test(company.website) ? company.website : `https://${company.website}`) : undefined;
  return (
    <div className="space-y-4">
      <Title tags={company.relationshipLabel ? <Tag>{company.relationshipLabel}</Tag> : undefined}>{company.name}</Title>
      <Facts
        rows={[
          [
            "Website",
            site ? (
              <a href={site} target="_blank" rel="noreferrer" className={link}>
                {shortAddress(site)}
              </a>
            ) : null,
          ],
          ["Email domain", company.domain],
        ]}
      />
      <Prose>{company.notes}</Prose>
    </div>
  );
}

export function EventView({ event }: { event: EventItem }) {
  return (
    <div className="space-y-4">
      <Title tags={event.status === "cancelled" ? <Tag>cancelled</Tag> : undefined}>{event.title}</Title>
      <Facts
        rows={[
          ["When", `${showDay(event.start.date)}, ${eventTime(event)}`],
          ["Where", event.location],
          [
            "Project",
            event.project ? (
              <Link href={`/projects/${event.project}`} className={link}>
                {event.project}
              </Link>
            ) : null,
          ],
        ]}
      />
      <Prose>{event.description}</Prose>
      {event.origin !== "skippy" ? (
        <p className="text-sm text-foreground/60">
          This is a copy from your calendar, so it is changed there; only its project can be set here.
          {event.link ? (
            <>
              {" "}
              <a href={event.link} target="_blank" rel="noreferrer" className={link}>
                Open it in the calendar
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

export function RecurrenceView({ item }: { item: RecurrenceItem }) {
  return (
    <div className="space-y-4">
      <Title
        tags={
          item.status !== "active" || item.overdue ? (
            <>
              {item.status !== "active" ? <Tag>{item.status}</Tag> : null}
              {item.overdue ? <Tag kind="at_risk">overdue</Tag> : null}
            </>
          ) : undefined
        }
      >
        {item.title}
      </Title>
      <Prose>{item.description}</Prose>
      <Facts
        rows={[
          ["Repeats", item.repeats],
          ["Next due", showDay(item.nextDue)],
          ["Shows up", item.leadTimeDays > 0 ? `${item.leadTimeDays} ${item.leadTimeDays === 1 ? "day" : "days"} ahead` : null],
          ["Counted from", item.anchor === "completion" ? "the day the last one was done" : "the day the last one was due"],
          ["Area", item.area],
          [
            "Last rounds",
            item.history.length > 0 ? (
              <ul className="space-y-0.5">
                {item.history.map((entry, index) => (
                  <li key={index}>
                    {words(entry.outcome)}
                    {entry.due ? ` for ${showDay(entry.due)}` : ` ${showTime(entry.at)}`}
                  </li>
                ))}
              </ul>
            ) : null,
          ],
        ]}
      />
    </div>
  );
}

export function GoalView({ goal }: { goal: Goal }) {
  return (
    <div className="space-y-4">
      <Title tags={<Tag>{goal.status}</Tag>}>{goal.title}</Title>
      <Prose>{goal.description}</Prose>
      <Facts
        rows={[
          ["When it is for", goal.horizon],
          [
            "Measures",
            goal.measures?.length ? (
              <ul className="space-y-0.5">
                {goal.measures.map((measure) => (
                  <li key={measure.label}>
                    {measure.label}: {measure.current} of {measure.target}
                  </li>
                ))}
              </ul>
            ) : null,
          ],
        ]}
      />
    </div>
  );
}
