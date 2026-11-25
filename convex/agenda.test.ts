/// <reference types="vite/client" />
import { signEnvelope, type OperationName } from "@skippy/shared";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const SECRET = "test-secret-".repeat(4);
const OWNER = "user_owner";
const RESOURCE = "http://localhost:3000/api/mcp";
// Noon in New York on Wednesday 2026-11-25.
const NOW = new Date("2026-11-25T17:00:00Z").getTime();

beforeEach(() => {
  process.env.SKIPPY_GATEWAY_SECRET = SECRET;
  process.env.SKIPPY_OWNER_CLERK_USER_ID = OWNER;
  process.env.SKIPPY_MCP_RESOURCE_URL = RESOURCE;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

const start = () => convexTest(schema, modules);
type Harness = ReturnType<typeof start>;

async function asClaude<T = Record<string, never>>(t: Harness, operation: OperationName, args: Record<string, unknown>): Promise<T> {
  const principal = {
    kind: "oauth" as const,
    subject: OWNER,
    clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
    resource: RESOURCE,
    scopes: ["skippy:read", "skippy:write"],
  };
  return (await t.action(api.gateway.call, await signEnvelope({ operation, args, principal }, SECRET))) as T;
}

async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ConvexError) return String((error.data as { code?: unknown }).code);
    throw error;
  }
  return "accepted";
}

type Event = { id: string; title: string; allDay: boolean; status: string; start: { at: string; date: string }; end?: { date: string } };
type Recurrence = { id: string; title: string; nextDue: string; overdue: boolean; comingUp: boolean; repeats: string; status: string };
type Today = { events: Event[]; recurrences: Recurrence[] };
type Agenda = { from: string; to: string; events: Event[]; recurrences: Recurrence[]; tasks: { title: string }[] };

describe("events", () => {
  it("are added by Claude or the owner, read back by day, changed and called off", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const pat = await asClaude<{ person: { id: string } }>(t, "upsert_person", { name: "Pat Jones" });
    const dentist = await asClaude<{ created: boolean; event: Event }>(t, "upsert_event", {
      title: "Dentist",
      startAt: "2026-11-25T15:00",
      endAt: "2026-11-25T16:00",
      location: "12 Main St",
      about: [{ type: "person", id: pat.person.id }],
    });
    expect(dentist.created).toBe(true);
    expect(dentist.event).toMatchObject({ allDay: false, status: "confirmed", start: { at: "2026-11-25T20:00:00.000Z", date: "2026-11-25" } });
    const trip = await owner.mutation(api.viewer.saveEvent, { title: "Kalamazoo trip", startAt: "2026-11-25", endAt: "2026-11-28" });
    await owner.mutation(api.viewer.saveEvent, { title: "Next month", startAt: "2026-12-20T09:00" });

    const today = await asClaude<Today>(t, "get_today", {});
    expect(today.events.map((event) => [event.title, event.allDay])).toEqual([
      ["Kalamazoo trip", true],
      ["Dentist", false],
    ]);
    // The trip is still on two days later; the dentist is not.
    const friday = await asClaude<Today>(t, "get_today", { date: "2026-11-27" });
    expect(friday.events.map((event) => event.title)).toEqual(["Kalamazoo trip"]);
    const agenda = await asClaude<Agenda>(t, "get_agenda", { days: 30 });
    expect([agenda.from, agenda.to]).toEqual(["2026-11-25", "2026-12-24"]);
    expect(agenda.events.map((event) => event.title)).toEqual(["Kalamazoo trip", "Dentist", "Next month"]);

    // Saying the same thing again changes nothing; a real change is logged once.
    expect(await asClaude(t, "upsert_event", { id: dentist.event.id, location: "12 Main St" })).toMatchObject({ changed: false });
    expect(await asClaude(t, "upsert_event", { id: dentist.event.id, startAt: "2026-11-25T15:30", endAt: "2026-11-25T16:30" })).toMatchObject({ changed: true });
    expect(await refusal(asClaude(t, "upsert_event", { id: dentist.event.id, endAt: "2026-11-25T10:00" }))).toBe("invalid_arguments");
    expect(await refusal(asClaude(t, "upsert_event", { title: "No time" }))).toBe("invalid_arguments");

    const found = await asClaude<{ results: { type: string; title: string }[] }>(t, "search", { query: "dentist" });
    expect(found.results).toEqual([expect.objectContaining({ type: "event", title: "Dentist" })]);
    const details = await owner.query(api.viewerMemory.item, { type: "event", id: dentist.event.id, now: NOW });
    expect(details!.links.map((link) => [link.relation, link.record.title])).toEqual([["related_to", "Pat Jones"]]);

    await owner.mutation(api.viewer.saveEvent, { id: trip.id, status: "cancelled" });
    expect((await owner.query(api.viewer.calendar, { now: NOW })).events.map((event) => event.title)).toEqual(["Dentist", "Next month"]);
  });

  it("copied from Google are changed there, but take a project here", async () => {
    const t = start();
    const id = await t.run((ctx) =>
      ctx.db.insert("calendarEvents", {
        title: "From Google",
        startAt: NOW,
        status: "confirmed",
        origin: "google",
        createdBy: { kind: "import", source: "google" },
        updatedBy: { kind: "import", source: "google" },
        updatedAt: NOW,
      }),
    );
    expect(await refusal(asClaude(t, "upsert_event", { id, title: "Mine now" }))).toBe("read_only");
    expect(await refusal(asClaude(t, "upsert_event", { id, project: "trip", location: "Here" }))).toBe("read_only");

    await asClaude(t, "upsert_project", { slug: "trip", title: "Trip" });
    expect(await asClaude(t, "upsert_event", { id, project: "trip" })).toMatchObject({ changed: true, event: { project: "trip", origin: "google" } });
    // The owner sets it from the event's window too.
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.saveEvent, { id, project: null });
    await owner.mutation(api.viewer.saveEvent, { id, project: "trip" });

    // The project lists its events still to come, and not those that are over or called off.
    await owner.mutation(api.viewer.saveEvent, { title: "Last week", startAt: "2026-11-18T10:00", project: "trip" });
    const off = await owner.mutation(api.viewer.saveEvent, { title: "Called off", startAt: "2026-11-27T10:00", project: "trip" });
    await owner.mutation(api.viewer.saveEvent, { id: off.id, status: "cancelled" });
    await owner.mutation(api.viewer.saveEvent, { title: "Flight home", startAt: "2026-11-28T11:58", project: "trip" });
    const page = await owner.query(api.viewer.project, { slug: "trip", now: NOW });
    expect(page!.events.map((event) => event.title)).toEqual(["From Google", "Flight home"]);
  });

  it("say when they are over, and can be ticked off early, Google copies too", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewer.saveEvent, { title: "Dentist", startAt: "2026-11-25T15:00", endAt: "2026-11-25T16:00" });
    await owner.mutation(api.viewer.saveEvent, { title: "Call", startAt: "2026-11-25T09:00" });
    await owner.mutation(api.viewer.saveEvent, { title: "Trip", startAt: "2026-11-25" });
    const google = await t.run((ctx) =>
      ctx.db.insert("calendarEvents", {
        title: "From Google",
        startAt: NOW + 3_600_000,
        status: "confirmed",
        origin: "google",
        createdBy: { kind: "import", source: "google" },
        updatedBy: { kind: "import", source: "google" },
        updatedAt: NOW,
      }),
    );

    const overAt = async () =>
      Object.fromEntries((await owner.query(api.viewer.calendar, { now: NOW })).events.map((event) => [event.title, [event.overAt, event.doneAt]]));
    // Its end; an hour after the start when it has none; the end of the day when all day.
    expect(await overAt()).toEqual({
      Call: ["2026-11-25T15:00:00.000Z", undefined],
      Trip: ["2026-11-26T04:59:59.999Z", undefined],
      Dentist: ["2026-11-25T21:00:00.000Z", undefined],
      "From Google": ["2026-11-25T19:00:00.000Z", undefined],
    });

    expect(await owner.mutation(api.viewer.markEventDone, { id: google, done: true })).toEqual({ changed: true });
    expect(await owner.mutation(api.viewer.markEventDone, { id: google, done: true })).toEqual({ changed: false });
    expect((await overAt())["From Google"][1]).toMatch(/^2026-11-25T17:00/);
    await owner.mutation(api.viewer.markEventDone, { id: google, done: false });
    expect((await overAt())["From Google"][1]).toBeUndefined();

    const { events } = await owner.query(api.viewer.activityLog, {});
    expect(events.filter((event) => event.type.startsWith("event.") && event.type !== "event.created").map((event) => event.summary)).toEqual([
      'Took the done mark off event "From Google"',
      'Marked event "From Google" done',
    ]);
  });
});

describe("recurrences", () => {
  it("advance exactly once when the owner and Claude both complete the same round", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const made = await asClaude<{ recurrence: Recurrence }>(t, "upsert_recurrence", {
      title: "Pay the car loan",
      rule: { kind: "calendar", rrule: "FREQ=MONTHLY;BYMONTHDAY=22" },
      nextDue: "2026-11-22",
    });
    expect(made.recurrence).toMatchObject({ nextDue: "2026-11-22", overdue: true, comingUp: true, repeats: "Every month on the 22nd" });
    const today = await asClaude<Today>(t, "get_today", {});
    expect(today.recurrences.map((item) => item.title)).toEqual(["Pay the car loan"]);

    const first = await owner.mutation(api.viewer.completeRecurrence, { id: made.recurrence.id, due: "2026-11-22" });
    const second = await asClaude<{ changed: boolean; recurrence: Recurrence }>(t, "complete_recurrence", {
      id: made.recurrence.id,
      due: "2026-11-22",
    });
    expect(first).toEqual({ changed: true, nextDue: "2026-12-22" });
    expect(second.changed).toBe(false);
    expect(second.recurrence).toMatchObject({ nextDue: "2026-12-22", overdue: false, comingUp: false });
    expect((await asClaude<Today>(t, "get_today", {})).recurrences).toEqual([]);

    const { events } = await owner.query(api.viewer.activityLog, {});
    expect(events.filter((event) => event.type === "recurrence.completed").map((event) => event.summary)).toEqual([
      'Completed "Pay the car loan" for 2026-11-22; next due 2026-12-22',
    ]);
    const details = await owner.query(api.viewerMemory.item, { type: "recurrence", id: made.recurrence.id, now: NOW });
    expect(details!.record).toMatchObject({ nextDue: "2026-12-22", history: [{ outcome: "completed", due: "2026-11-22" }] });
  });

  it("count from the day it was done, or the day it was due, as the anchor says", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const filter = await owner.mutation(api.viewer.saveRecurrence, {
      title: "Change the furnace filter",
      rule: { kind: "interval", everyDays: 30 },
      nextDue: "2026-11-20",
    });
    const bill = await owner.mutation(api.viewer.saveRecurrence, {
      title: "Pay rent",
      rule: { kind: "calendar", rrule: "FREQ=MONTHLY;BYMONTHDAY=1" },
      nextDue: "2026-11-01",
    });
    // Done five days late: the filter's next round is thirty days from today, the rent's is the next first of the month.
    expect(await owner.mutation(api.viewer.completeRecurrence, { id: filter.id, due: "2026-11-20" })).toEqual({ changed: true, nextDue: "2026-12-25" });
    expect(await owner.mutation(api.viewer.completeRecurrence, { id: bill.id, due: "2026-11-01", skip: true })).toEqual({ changed: true, nextDue: "2026-12-01" });
    const { events } = await owner.query(api.viewer.activityLog, {});
    expect(events.map((event) => event.type)).toContain("recurrence.skipped");
  });

  it("start on the rule's next day, show inside their lead time, and stop when paused", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const made = await asClaude<{ recurrence: Recurrence }>(t, "upsert_recurrence", {
      title: "Renew the car registration",
      rule: { kind: "calendar", rrule: "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=5" },
      leadTimeDays: 14,
    });
    expect(made.recurrence).toMatchObject({ nextDue: "2026-12-05", overdue: false, comingUp: true });
    const calendar = await owner.query(api.viewer.calendar, { now: NOW });
    expect(calendar.recurrences.map((item) => [item.title, item.nextDue])).toEqual([["Renew the car registration", "2026-12-05"]]);
    const agenda = await asClaude<Agenda>(t, "get_agenda", { days: 14 });
    expect(agenda.recurrences.map((item) => item.title)).toEqual(["Renew the car registration"]);

    await owner.mutation(api.viewer.saveRecurrence, { id: made.recurrence.id, status: "paused" });
    expect((await asClaude<Today>(t, "get_today", {})).recurrences).toEqual([]);
    await owner.mutation(api.viewer.saveRecurrence, { id: made.recurrence.id, status: "retired" });
    expect((await owner.query(api.viewer.calendar, { now: NOW })).recurrences).toEqual([]);
    expect(await refusal(asClaude(t, "complete_recurrence", { id: made.recurrence.id, due: "2026-12-05" }))).toBe("invalid_arguments");
  });

  it("refuse a rule they cannot follow, and anyone but the owner", async () => {
    const t = start();
    expect(
      await refusal(asClaude(t, "upsert_recurrence", { title: "x", rule: { kind: "calendar", rrule: "FREQ=HOURLY" } })),
    ).toBe("invalid_arguments");
    expect(await refusal(asClaude(t, "upsert_recurrence", { title: "x" }))).toBe("invalid_arguments");
    expect(await refusal(asClaude(t, "complete_recurrence", { id: "nope", due: "2026-11-22" }))).toBe("not_found");
    expect(await refusal(t.query(api.viewer.calendar, { now: NOW }))).toBe("not_signed_in");
    expect(await refusal(t.mutation(api.viewer.saveEvent, { title: "x", startAt: "2026-11-25" }))).toBe("not_signed_in");
    expect(await refusal(t.mutation(api.viewer.completeRecurrence, { id: "x", due: "2026-11-22" }))).toBe("not_signed_in");
  });
});
