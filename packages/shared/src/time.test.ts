import { describe, expect, it } from "vitest";
import { dayBounds, localDate, parseWhen, WhenError, zoneOffsetMs } from "./time";

const NY = "America/New_York";

describe("time in the owner's zone", () => {
  it("knows New York's offset in winter and summer", () => {
    expect(zoneOffsetMs(Date.UTC(2026, 0, 15, 12), NY)).toBe(-5 * 3_600_000);
    expect(zoneOffsetMs(Date.UTC(2026, 6, 15, 12), NY)).toBe(-4 * 3_600_000);
  });

  it("reads a date-only deadline as the last minute of that local day", () => {
    expect(new Date(parseWhen("2026-11-25", NY, "end")).toISOString()).toBe("2026-11-26T04:59:00.000Z");
  });

  it("reads a date-only plan as the first minute of that local day", () => {
    expect(new Date(parseWhen("2026-11-25", NY, "start")).toISOString()).toBe("2026-11-25T05:00:00.000Z");
  });

  it("reads a time with no offset as local wall-clock time", () => {
    expect(new Date(parseWhen("2026-07-04T15:30", NY, "end")).toISOString()).toBe("2026-07-04T19:30:00.000Z");
  });

  it("keeps an exact instant exact", () => {
    expect(parseWhen("2026-11-25T15:00:00Z", NY, "end")).toBe(Date.UTC(2026, 10, 25, 15));
    expect(parseWhen("2026-11-25T15:00:00-08:00", NY, "end")).toBe(Date.UTC(2026, 10, 25, 23));
  });

  it("refuses text that is not a date", () => {
    expect(() => parseWhen("next Tuesday", NY, "end")).toThrow(WhenError);
    expect(() => parseWhen("11/25/2026", NY, "end")).toThrow(WhenError);
  });

  it("gives a 23-hour day when clocks go forward and a 25-hour day when they go back", () => {
    const spring = dayBounds("2026-03-08", NY);
    const autumn = dayBounds("2026-11-01", NY);
    expect(spring.end - spring.start + 1).toBe(23 * 3_600_000);
    expect(autumn.end - autumn.start + 1).toBe(25 * 3_600_000);
  });

  it("names the local date for an instant near midnight UTC", () => {
    expect(localDate(Date.UTC(2026, 10, 26, 2), NY)).toBe("2026-11-25");
    expect(localDate(Date.UTC(2026, 10, 26, 6), NY)).toBe("2026-11-26");
  });
});
