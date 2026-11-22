import type { ReactNode } from "react";

/** Small pieces the dashboard pages share. */

export function Panel({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 border-b border-foreground/15 pb-2">
        <h2 className="text-lg font-semibold">{title}</h2>
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

export function showTime(at: string): string {
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
