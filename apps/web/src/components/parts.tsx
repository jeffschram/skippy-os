import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

/** Small pieces the dashboard pages share. */

export const button = "rounded-md border border-foreground/20 px-3 py-1.5 text-sm font-medium hover:bg-foreground/5";

/** A done box's look: the same grey tick for a task or an event, however it got ticked. */
export const doneBox = (done: boolean) => `size-4 shrink-0 ${done ? "accent-neutral-500" : ""}`;

export function Panel({ title, icon: TitleIcon, note, children }: { title: string; icon: Icon; note?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 border-b border-foreground/15 pb-2">
        <h2 className="text-lg font-semibold">
          <TitleIcon aria-hidden size="1.15em" className="mr-2 inline-block align-[-0.2em] text-foreground/60" />
          {title}
        </h2>
        {note ? <div className="text-sm text-foreground/60">{note}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export const Quiet = ({ children }: { children: ReactNode }) => <p className="text-sm text-foreground/60">{children}</p>;

/** A stored day such as 2026-11-27, shown as "Fri, Nov 27" whatever zone the browser is in. */
export function showDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** How far a day is from today: "today", "tomorrow", "in 12 days", "3 days ago". */
export function fromToday(date: string): string {
  const today = new Date();
  const noon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).getTime();
  const days = Math.round((new Date(`${date}T12:00:00`).getTime() - noon) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** How a project ends, in words, for its tag and the choice on its page. */
export const FINISHES = {
  tasks: { label: "ends when done", choice: "When its tasks are done" },
  date: { label: "ends on a date", choice: "On a date" },
  ongoing: { label: "ongoing", choice: "Never: it is ongoing" },
} as const;

/** The parts a project can switch on, in the order they show. */
export const PARTS = {
  options: "Options",
  budget: "Budget",
  schedule: "Schedule",
} as const;

/** An amount of money in dollars, with cents only when there are some. */
export function showMoney(amount: number): string {
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** What each stage of a project that ends on a date is called, and its tag's look. */
export const PLAN_STAGES = {
  intention: { label: "intention", tag: undefined },
  planning: { label: "planning", tag: undefined },
  set: { label: "all set", tag: "on_track" },
  happened: { label: "happened", tag: undefined },
} as const;

export function showTime(at: string): string {
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** A clock time such as 15:00, shown as "3:00 PM" or "15:00" as the browser's language prefers. */
export function showClock(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export const words = (value: string) => value.replaceAll("_", " ");

/** "no status update in 9 days", or nothing when the project is not stale. */
export function staleNote(project: { stale: boolean; daysSinceStatus?: number }): string | undefined {
  if (!project.stale) return undefined;
  return project.daysSinceStatus === undefined ? "no status update yet" : `no status update in ${project.daysSinceStatus} days`;
}

const HEALTH_STYLE: Record<string, string> = {
  on_track: "border-green-700/40 text-green-800 dark:text-green-300",
  at_risk: "border-amber-600/50 text-amber-800 dark:text-amber-300",
  blocked: "border-red-600/50 text-red-700 dark:text-red-300",
};

export function Tag({ kind, children }: { kind?: string; children: ReactNode }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-xs ${(kind && HEALTH_STYLE[kind]) || "border-foreground/20 text-foreground/70"}`}>
      {children}
    </span>
  );
}

/** What a failed save says. Convex refusals carry a message written for a person. */
export function problem(error: unknown): string {
  const data = (error as { data?: { message?: unknown } } | undefined)?.data;
  return typeof data?.message === "string" ? data.message : "That did not save. Try again.";
}
