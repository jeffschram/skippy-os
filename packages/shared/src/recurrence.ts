/**
 * When a recurring thing comes round next. Pure date arithmetic on YYYY-MM-DD
 * days, so the answer does not depend on a clock or a time zone.
 *
 * A rule is either "every N days" or a calendar rule written as a small subset
 * of iCalendar's RRULE: FREQ (DAILY, WEEKLY, MONTHLY, YEARLY), INTERVAL,
 * BYDAY (weekdays, for WEEKLY), BYMONTHDAY (one day) and BYMONTH (one month).
 */

export type RecurrenceRule = { kind: "interval"; everyDays: number } | { kind: "calendar"; rrule: string };

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type Calendar = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  /** 0 is Sunday. */
  weekdays?: number[];
  monthDay?: number;
  month?: number;
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtc(day: string): Date {
  const match = DAY.exec(day);
  if (!match) throw new RuleError(`Not a day: ${day}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== day) throw new RuleError(`Not a day: ${day}`);
  return date;
}

const fromUtc = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
/** The asked-for day of a month, or the month's last day when it is shorter. */
const dayInMonth = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, Math.min(day, daysIn(year, month))));

const wholeNumber = (text: string, name: string, min: number, max: number): number => {
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RuleError(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return value;
};

function parseCalendar(rrule: string): Calendar {
  const parts = new Map<string, string>();
  for (const piece of rrule.trim().replace(/^RRULE:/i, "").split(";")) {
    if (!piece) continue;
    const [key, value] = piece.split("=");
    if (!key || value === undefined) throw new RuleError(`Could not read "${piece}" in the rule.`);
    parts.set(key.toUpperCase(), value.toUpperCase());
  }
  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") {
    throw new RuleError("The rule needs FREQ=DAILY, WEEKLY, MONTHLY or YEARLY.");
  }
  const known = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH"]);
  for (const key of parts.keys()) {
    if (!known.has(key)) throw new RuleError(`${key} is not supported. Use FREQ, INTERVAL, BYDAY, BYMONTHDAY and BYMONTH.`);
  }
  const rule: Calendar = { freq, interval: parts.has("INTERVAL") ? wholeNumber(parts.get("INTERVAL")!, "INTERVAL", 1, 1000) : 1 };
  if (parts.has("BYDAY")) {
    if (freq !== "WEEKLY") throw new RuleError("BYDAY is supported with FREQ=WEEKLY only.");
    rule.weekdays = parts
      .get("BYDAY")!
      .split(",")
      .map((name) => {
        const index = WEEKDAYS.indexOf(name as (typeof WEEKDAYS)[number]);
        if (index < 0) throw new RuleError(`BYDAY takes MO, TU, WE, TH, FR, SA or SU, not "${name}".`);
        return index;
      })
      .sort((a, b) => a - b);
  }
  if (parts.has("BYMONTHDAY")) {
    if (freq !== "MONTHLY" && freq !== "YEARLY") throw new RuleError("BYMONTHDAY is supported with FREQ=MONTHLY or YEARLY only.");
    rule.monthDay = wholeNumber(parts.get("BYMONTHDAY")!, "BYMONTHDAY", 1, 31);
  }
  if (parts.has("BYMONTH")) {
    if (freq !== "YEARLY") throw new RuleError("BYMONTH is supported with FREQ=YEARLY only.");
    rule.month = wholeNumber(parts.get("BYMONTH")!, "BYMONTH", 1, 12);
  }
  return rule;
}

/** Checks a rule and returns it in a tidy form. Throws RuleError with a message a person can act on. */
export function checkRule(rule: RecurrenceRule): RecurrenceRule {
  if (rule.kind === "interval") {
    if (!Number.isInteger(rule.everyDays) || rule.everyDays < 1 || rule.everyDays > 3660) {
      throw new RuleError("everyDays must be a whole number of days, from 1 to 3660.");
    }
    return { kind: "interval", everyDays: rule.everyDays };
  }
  parseCalendar(rule.rrule);
  return { kind: "calendar", rrule: rule.rrule.trim().replace(/^RRULE:/i, "").toUpperCase() };
}

/**
 * The first day the rule lands on strictly after `after`. A calendar rule that
 * names no day of the week, month or year keeps the one `after` falls on.
 */
export function nextOccurrence(rule: RecurrenceRule, after: string): string {
  const from = toUtc(after);
  if (rule.kind === "interval") return fromUtc(addDays(from, checkRule(rule).kind === "interval" ? rule.everyDays : 1));
  const calendar = parseCalendar(rule.rrule);
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  switch (calendar.freq) {
    case "DAILY":
      return fromUtc(addDays(from, calendar.interval));
    case "WEEKLY": {
      const days = calendar.weekdays ?? [from.getUTCDay()];
      // Later this week first; otherwise the first named weekday, `interval` weeks on.
      const laterThisWeek = days.find((weekday) => weekday > from.getUTCDay());
      if (laterThisWeek !== undefined) return fromUtc(addDays(from, laterThisWeek - from.getUTCDay()));
      return fromUtc(addDays(from, 7 * calendar.interval - from.getUTCDay() + days[0]));
    }
    case "MONTHLY": {
      const day = calendar.monthDay ?? from.getUTCDate();
      const thisMonth = dayInMonth(year, month, day);
      if (calendar.monthDay !== undefined && thisMonth > from) return fromUtc(thisMonth);
      const target = month + calendar.interval;
      return fromUtc(dayInMonth(year + Math.floor(target / 12), target % 12, day));
    }
    case "YEARLY": {
      const targetMonth = calendar.month !== undefined ? calendar.month - 1 : month;
      const day = calendar.monthDay ?? from.getUTCDate();
      const thisYear = dayInMonth(year, targetMonth, day);
      if ((calendar.month !== undefined || calendar.monthDay !== undefined) && thisYear > from) return fromUtc(thisYear);
      return fromUtc(dayInMonth(year + calendar.interval, targetMonth, day));
    }
  }
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
const every = (interval: number, unit: string) => (interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`);

/** The rule in words: "Every month on the 22nd", "Every 30 days". */
export function describeRule(rule: RecurrenceRule): string {
  if (rule.kind === "interval") return rule.everyDays === 1 ? "Every day" : `Every ${rule.everyDays} days`;
  let calendar: Calendar;
  try {
    calendar = parseCalendar(rule.rrule);
  } catch {
    return rule.rrule;
  }
  switch (calendar.freq) {
    case "DAILY":
      return every(calendar.interval, "day");
    case "WEEKLY":
      return `${every(calendar.interval, "week")}${calendar.weekdays ? ` on ${calendar.weekdays.map((day) => WEEKDAY_NAMES[day]).join(", ")}` : ""}`;
    case "MONTHLY":
      return `${every(calendar.interval, "month")}${calendar.monthDay ? ` on the ${ordinal(calendar.monthDay)}` : ""}`;
    case "YEARLY": {
      const date = [calendar.month ? MONTH_NAMES[calendar.month - 1] : undefined, calendar.monthDay].filter(Boolean).join(" ");
      return `${every(calendar.interval, "year")}${date ? ` on ${date}` : ""}`;
    }
  }
}
