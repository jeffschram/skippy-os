/**
 * Date handling for one owner in one time zone. Times are stored as epoch
 * milliseconds; "today" and date-only inputs are read in the owner's zone.
 */

export class WhenError extends Error {
  constructor(public readonly input: string) {
    super(`Not a date or time Skippy understands: ${input}`);
    this.name = "WhenError";
  }
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** How far `timeZone` is ahead of UTC at instant `at`, in milliseconds. */
export function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The instant at which the wall clock in `timeZone` reads the given local time. */
export function zonedTimeToMs(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two passes settle the offset on either side of a daylight-saving change.
  let at = wall - zoneOffsetMs(wall, timeZone);
  at = wall - zoneOffsetMs(at, timeZone);
  return at;
}

/** The calendar date in `timeZone` at instant `at`, as YYYY-MM-DD. */
export function localDate(at: number, timeZone: string): string {
  const shifted = new Date(at + zoneOffsetMs(at, timeZone));
  return shifted.toISOString().slice(0, 10);
}

/** The first and last millisecond of a YYYY-MM-DD day in `timeZone`. */
export function dayBounds(date: string, timeZone: string): { start: number; end: number } {
  const match = DATE_ONLY.exec(date);
  if (!match) throw new WhenError(date);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const start = zonedTimeToMs(timeZone, year, month, day);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const end =
    zonedTimeToMs(timeZone, nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate()) - 1;
  return { start, end };
}

/**
 * Reads a date or time the way a person would write it for the owner:
 * - `2026-11-25` is that day in the owner's zone: its last minute for a
 *   deadline (`edge: "end"`), its first for a plan (`edge: "start"`).
 * - `2026-11-25T15:00` is that wall-clock time in the owner's zone.
 * - Anything with an offset or `Z` is an exact instant.
 */
export function parseWhen(input: string, timeZone: string, edge: "start" | "end"): number {
  const text = input.trim();
  const dateOnly = DATE_ONLY.exec(text);
  if (dateOnly) {
    const bounds = dayBounds(text, timeZone);
    if (Number.isNaN(bounds.start)) throw new WhenError(input);
    // The last whole minute, so a deadline reads as 23:59 and not 23:59:59.999.
    return edge === "start" ? bounds.start : bounds.end - 59_999;
  }
  const local = LOCAL_DATE_TIME.exec(text);
  if (local) {
    const at = zonedTimeToMs(
      timeZone,
      Number(local[1]),
      Number(local[2]),
      Number(local[3]),
      Number(local[4]),
      Number(local[5]),
      Number(local[6] ?? 0),
    );
    if (Number.isNaN(at)) throw new WhenError(input);
    return at;
  }
  const exact = Date.parse(text);
  if (Number.isNaN(exact) || !/^\d{4}-\d{2}-\d{2}T/.test(text)) throw new WhenError(input);
  return exact;
}
