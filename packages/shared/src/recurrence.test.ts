import { describe, expect, it } from "vitest";
import { checkRule, describeRule, nextOccurrence, RuleError, type RecurrenceRule } from "./recurrence";

const calendar = (rrule: string): RecurrenceRule => ({ kind: "calendar", rrule });

describe("nextOccurrence", () => {
  it("counts days for an interval rule", () => {
    expect(nextOccurrence({ kind: "interval", everyDays: 30 }, "2026-11-22")).toBe("2026-12-22");
    expect(nextOccurrence({ kind: "interval", everyDays: 1 }, "2026-12-31")).toBe("2027-01-01");
  });

  it("lands a monthly rule on its day, this month if that is still ahead", () => {
    const rule = calendar("FREQ=MONTHLY;BYMONTHDAY=22");
    expect(nextOccurrence(rule, "2026-11-10")).toBe("2026-11-22");
    expect(nextOccurrence(rule, "2026-11-22")).toBe("2026-12-22");
    expect(nextOccurrence(rule, "2026-12-22")).toBe("2027-01-22");
  });

  it("uses the last day of a month that is too short", () => {
    const rule = calendar("FREQ=MONTHLY;BYMONTHDAY=31");
    expect(nextOccurrence(rule, "2026-10-31")).toBe("2026-11-30");
    expect(nextOccurrence(rule, "2026-11-30")).toBe("2026-12-31");
    expect(nextOccurrence(rule, "2027-01-31")).toBe("2027-02-28");
    expect(nextOccurrence(rule, "2028-01-31")).toBe("2028-02-29");
  });

  it("keeps the day it is given when a monthly rule names none, and honours an interval", () => {
    expect(nextOccurrence(calendar("FREQ=MONTHLY"), "2026-11-05")).toBe("2026-12-05");
    expect(nextOccurrence(calendar("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1"), "2026-11-01")).toBe("2027-02-01");
  });

  it("lands a yearly rule on its date", () => {
    const rule = calendar("FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=3");
    expect(nextOccurrence(rule, "2026-11-03")).toBe("2027-11-03");
    expect(nextOccurrence(rule, "2026-06-01")).toBe("2026-11-03");
    expect(nextOccurrence(calendar("FREQ=YEARLY"), "2024-02-29")).toBe("2025-02-28");
  });

  it("steps through the named weekdays of a weekly rule", () => {
    const rule = calendar("FREQ=WEEKLY;BYDAY=MO,TH");
    // 2026-11-22 is a Sunday.
    expect(nextOccurrence(rule, "2026-11-22")).toBe("2026-11-23");
    expect(nextOccurrence(rule, "2026-11-23")).toBe("2026-11-26");
    expect(nextOccurrence(rule, "2026-11-26")).toBe("2026-11-30");
    expect(nextOccurrence(calendar("FREQ=WEEKLY;INTERVAL=2"), "2026-11-22")).toBe("2026-12-06");
    expect(nextOccurrence(calendar("FREQ=DAILY;INTERVAL=2"), "2026-11-22")).toBe("2026-11-24");
  });
});

describe("checkRule and describeRule", () => {
  it("refuses what it cannot follow, in words", () => {
    expect(() => checkRule(calendar("FREQ=HOURLY"))).toThrow(RuleError);
    expect(() => checkRule(calendar("FREQ=MONTHLY;BYSETPOS=1"))).toThrow(/not supported/);
    expect(() => checkRule(calendar("FREQ=MONTHLY;BYMONTHDAY=32"))).toThrow(/1 to 31/);
    expect(() => checkRule(calendar("FREQ=MONTHLY;BYDAY=MO"))).toThrow(/WEEKLY only/);
    expect(() => checkRule({ kind: "interval", everyDays: 0 })).toThrow(RuleError);
    expect(() => nextOccurrence({ kind: "interval", everyDays: 7 }, "2026-02-30")).toThrow(RuleError);
  });

  it("tidies a rule and says it in words", () => {
    expect(checkRule(calendar(" rrule:freq=monthly;bymonthday=5 "))).toEqual(calendar("FREQ=MONTHLY;BYMONTHDAY=5"));
    expect(describeRule(calendar("FREQ=MONTHLY;BYMONTHDAY=22"))).toBe("Every month on the 22nd");
    expect(describeRule(calendar("FREQ=MONTHLY;BYMONTHDAY=1"))).toBe("Every month on the 1st");
    expect(describeRule(calendar("FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=3"))).toBe("Every year on November 3");
    expect(describeRule(calendar("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH"))).toBe("Every 2 weeks on Monday, Thursday");
    expect(describeRule({ kind: "interval", everyDays: 30 })).toBe("Every 30 days");
  });
});
