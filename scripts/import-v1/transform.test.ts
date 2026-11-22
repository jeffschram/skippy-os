import { describe, expect, it } from "vitest";
import { transform, unbalanced, type Snapshot } from "./transform.ts";

const at = { createdAt: 1_000, updatedAt: 2_000 };
const ref = (entityType: string, entityId: string) => ({ entityType, entityId });
const link = (id: string, from: object, to: object, type: string) => ({ _id: id, from, to, type, ...at });

/** A small old project: one code project, one ordinary one, and records hanging off each. */
function snapshot(): Snapshot {
  return {
    projects: [
      { _id: "p-shed", title: "Garden Shed", summary: "Build it", status: "in_progress", ...at },
      { _id: "p-app", title: "Some App", kind: "code", status: "in_progress", ...at },
      { _id: "p-old", title: "Old Thing", status: "cancelled", notesPad: "kept notes", ...at },
    ],
    phases: [
      { _id: "ph-shed", projectId: "p-shed", orderNum: 1, title: "Foundation", descriptionMd: "Dig", ...at },
      { _id: "ph-app", projectId: "p-app", orderNum: 1, title: "MVP", descriptionMd: "", ...at },
    ],
    goals: [{ _id: "g-home", title: "A nicer home", status: "active", ...at }],
    tasks: [
      { _id: "t-quotes", title: "Get quotes", status: "todo", phaseId: "ph-shed", area: "household", dueAt: 5_000.4, ...at },
      { _id: "t-paint", title: "Pick paint", status: "done", completedAt: 3_000, resultSummary: "Chose green", ...at },
      { _id: "t-bug", title: "Fix bug", status: "todo", phaseId: "ph-app", prUrl: "https://example.com/pr/1", ...at },
      { _id: "t-life", title: "Renew passport", status: "todo", area: "Personal", commitment: "must", ...at },
      { _id: "t-deploy", title: "Deploy", status: "done", ...at },
    ],
    people: [
      { _id: "pe-sam", name: "Sam Lee", emails: ["Sam@Example.com"], phoneNumbers: [], notes: "Roofer", ...at },
      { _id: "pe-pat", name: "Pat", notes: "", ...at },
    ],
    companies: [{ _id: "c-acme", name: "Acme Roofing", relationshipLabel: "vendor", website: "acme.example", ...at }],
    knowledge: [
      { _id: "k-note", kind: "note", title: "Shed permit", body: "Needs one", sourceRefIds: ["s-mail", "s-extra"], ...at },
      { _id: "k-mem", kind: "memory", memoryType: "memory", title: "Sam prefers calls", body: "…", status: "accepted", captureReason: "Saves time", ...at },
      { _id: "k-dec", kind: "memory", memoryType: "decision", title: "Metal roof", body: "…", status: "accepted", ...at },
      { _id: "k-no", kind: "memory", memoryType: "memory", title: "Wrong", body: "…", status: "rejected", rejectedAt: 9, ...at },
      { _id: "k-link", kind: "link", title: "Shed plans", url: "https://example.com/plans", status: "unread", ...at },
      { _id: "k-gone", kind: "link", title: "Meh", url: "https://example.com/meh", status: "discarded", ...at },
    ],
    relationships: [
      link("r1", ref("task", "t-paint"), ref("project", "p-shed"), "belongs_to"),
      link("r2", ref("task", "t-deploy"), ref("project", "p-app"), "belongs_to"),
      link("r3", ref("note", "k-note"), ref("project", "p-shed"), "related_to"),
      link("r4", ref("memory", "k-mem"), ref("person", "pe-sam"), "mentions"),
      link("r5", ref("note", "k-note"), ref("task", "t-bug"), "related_to"),
      link("r6", ref("task", "t-quotes"), ref("task", "t-paint"), "unblocks"),
      link("r7", ref("project", "p-shed"), ref("goal", "g-home"), "supports"),
      link("r8", ref("person", "pe-sam"), ref("company", "c-acme"), "works_at"),
      link("r9", ref("task", "t-life"), ref("task", "t-paint"), "duplicates"),
    ],
    sourceRefs: [
      { _id: "s-mail", sourceSystem: "gmail", messageId: "m1", excerpt: "x".repeat(1500), ...at },
      { _id: "s-extra", sourceSystem: "web", url: "https://example.com", ...at },
      { _id: "s-code", sourceSystem: "github", externalId: "pr-1", ...at },
    ],
    entitySourceRefs: [
      { _id: "e1", entityRef: ref("note", "k-note"), sourceRefId: "s-mail", relationship: "created_from", ...at },
      { _id: "e2", entityRef: ref("task", "t-bug"), sourceRefId: "s-code", relationship: "created_from", ...at },
    ],
    recurrences: [
      {
        _id: "rec1",
        title: "Pay the water bill",
        rule: { kind: "calendar", rrule: "FREQ=MONTHLY;BYMONTHDAY=31" },
        anchor: "schedule",
        leadTimeDays: 3,
        status: "active",
        spawnTask: true,
        timeZone: "America/New_York",
        // 23:59 on November 30 in New York.
        nextDueAt: Date.parse("2026-12-01T04:59:00Z"),
        history: [{ completedAt: 1000 }, { completedAt: 2000, outcome: "completed", scheduledFor: Date.parse("2026-10-31T04:00:00Z") }],
        ...at,
      },
      { _id: "rec2", title: "No rule", status: "active", ...at },
    ],
    calendarEvents: [
      { _id: "cal1", origin: "google", title: "Dentist", ...at },
      {
        _id: "cal2",
        origin: "skippy",
        title: "Shed day",
        startAt: 5000,
        endAt: 9000,
        status: "cancelled",
        externalId: "skp1",
        relatedEntityRefs: [ref("note", "k-note"), ref("person", "nobody")],
        ...at,
      },
    ],
    projectFiles: [
      { _id: "f1", projectId: "p-shed", fileName: "plan.pdf", mimeType: "application/pdf", storageId: "st1", status: "ready", ...at },
      { _id: "f2", projectId: "p-app", fileName: "out.txt", status: "ready", ...at },
    ],
    chatMessages: [{ _id: "m1" }, { _id: "m2" }],
    somethingNew: [{ _id: "x1" }],
  };
}

const ids = (records: Record<string, unknown>[]) => records.map((record) => record.oldId);

describe("the import plan", () => {
  const plan = transform(snapshot());

  it("accounts for every record in every table", () => {
    expect(unbalanced(plan.report)).toEqual([]);
    expect(Object.keys(plan.report).sort()).toEqual(Object.keys(snapshot()).sort());
  });

  it("leaves code projects behind, with their phases and tasks", () => {
    expect(ids(plan.batches.projects)).toEqual(["p-shed", "p-old"]);
    expect(ids(plan.batches.phases)).toEqual(["ph-shed"]);
    expect(ids(plan.batches.tasks)).toEqual(["t-quotes", "t-paint", "t-life"]);
    expect(plan.report.tasks.skipped).toEqual({ "in a code project": 2 });
    expect(plan.report.projects).toMatchObject({ exported: 3, toImport: 2 });
  });

  it("maps old statuses and keeps the notes pad", () => {
    expect(plan.batches.projects).toMatchObject([
      { oldId: "p-shed", status: "active", notesPad: "", goalOldId: "g-home" },
      { oldId: "p-old", status: "archived", notesPad: "kept notes" },
    ]);
  });

  it("finds a task's project from its link or its phase, and drops agent fields", () => {
    expect(plan.batches.tasks).toMatchObject([
      { oldId: "t-quotes", projectOldId: "p-shed", phaseOldId: "ph-shed", areaOldId: "household", dueAt: 5_000 },
      { oldId: "t-paint", projectOldId: "p-shed", status: "done", completedAt: 3_000 },
      { oldId: "t-life", areaOldId: "personal", commitment: "must" },
    ]);
    expect(plan.batches.tasks[1]).not.toHaveProperty("resultSummary");
    expect(plan.batches.tasks[2]).not.toHaveProperty("projectOldId");
    expect(plan.notes['tasks: agent field "resultSummary" left behind']).toBe(1);
  });

  it("turns the area word on tasks into areas", () => {
    expect(plan.batches.areas).toMatchObject([
      { oldId: "household", name: "Household" },
      { oldId: "personal", name: "Personal" },
    ]);
  });

  it("drops rejected knowledge and sorts the rest into kinds", () => {
    expect(plan.batches.knowledge).toMatchObject([
      { oldId: "k-note", kind: "note", lifecycle: "active" },
      { oldId: "k-mem", kind: "memory", whyItMatters: "Saves time" },
      { oldId: "k-dec", kind: "decision" },
      { oldId: "k-link", kind: "link", url: "https://example.com/plans", readState: "unread" },
      { oldId: "k-gone", kind: "link", lifecycle: "archived", readState: "saved" },
    ]);
    expect(plan.report.knowledge.skipped).toEqual({ "rejected in the old app": 1 });
  });

  it("keeps only links between records that both came across", () => {
    expect(ids(plan.batches.links)).toEqual(["r1", "r3", "r4", "r6", "r7", "r8", "cal2:about:0"]);
    expect(plan.batches.links[1]).toMatchObject({ from: { table: "knowledge", id: "k-note" }, to: { table: "projects", id: "p-shed" } });
    // "t-quotes unblocks t-paint" becomes "t-paint is blocked by t-quotes".
    expect(plan.batches.links[3]).toMatchObject({ type: "blocked_by", from: { id: "t-paint" }, to: { id: "t-quotes" } });
    expect(plan.report.relationships.skipped).toEqual({
      "touches a record that was not imported": 2,
      'a link type the new system does not have ("duplicates")': 1,
    });
  });

  it("brings sources only where something imported uses them", () => {
    expect(ids(plan.batches.sources)).toEqual(["s-mail", "s-extra"]);
    expect((plan.batches.sources[0].excerpt as string).length).toBe(1000);
    expect(plan.batches.attachments).toMatchObject([
      { oldId: "e1", entity: { table: "knowledge", id: "k-note" }, sourceOldId: "s-mail", relationship: "created_from" },
      { entity: { table: "knowledge", id: "k-note" }, sourceOldId: "s-extra", relationship: "created_from" },
    ]);
    expect(plan.report.sourceRefs.skipped).toEqual({ "only used by records that were not imported": 1 });
    expect(plan.report.entitySourceRefs).toMatchObject({ exported: 2, toImport: 1 });
  });

  it("holds back what has no table yet, and says why the rest stays behind", () => {
    expect(plan.report.calendarEvents).toMatchObject({ toImport: 1, skipped: { "synced again from Google": 1 } });
    expect(plan.report.projectFiles).toMatchObject({ toImport: 1, skipped: { "in a code project": 1 } });
    expect(plan.batches.files).toEqual([
      expect.objectContaining({ oldId: "f1", projectOldId: "p-shed", oldStorageId: "st1", fileName: "plan.pdf", contentType: "application/pdf" }),
    ]);
    expect(plan.report.chatMessages.skipped).toEqual({ "old chats are not carried over": 2 });
    expect(plan.report.somethingNew.skipped).toEqual({ "not part of the import plan": 1 });
  });

  it("sends nothing undefined, which the loaders would refuse", () => {
    for (const records of Object.values(plan.batches)) {
      for (const record of records) expect(Object.values(record)).not.toContain(undefined);
    }
  });
});

describe("recurrences and events", () => {
  const plan = transform(snapshot());

  it("brings a recurrence across with its rule, its next day in its own time zone, and its history", () => {
    expect(plan.report.recurrences).toMatchObject({ exported: 2, toImport: 1 });
    expect(plan.report.recurrences.skipped).toEqual({ "has no rule or no next day the new system can read": 1 });
    expect(plan.batches.recurrences).toEqual([
      expect.objectContaining({
        oldId: "rec1",
        title: "Pay the water bill",
        rule: { kind: "calendar", rrule: "FREQ=MONTHLY;BYMONTHDAY=31" },
        anchor: "schedule",
        leadTimeDays: 3,
        status: "active",
        nextDue: "2026-11-30",
        history: [
          { at: 1000, outcome: "completed" },
          { at: 2000, outcome: "completed", due: "2026-10-31" },
        ],
      }),
    ]);
    expect(plan.batches.recurrences[0]).not.toHaveProperty("spawnTask");
  });

  it("brings Skippy's own events across, with a link to each record they were about", () => {
    expect(plan.batches.events).toEqual([
      expect.objectContaining({ oldId: "cal2", title: "Shed day", startAt: 5000, endAt: 9000, status: "cancelled", externalId: "skp1" }),
    ]);
    expect(plan.batches.links).toContainEqual({
      oldId: "cal2:about:0",
      from: { table: "calendarEvents", id: "cal2" },
      to: { table: "knowledge", id: "k-note" },
      type: "related_to",
      createdAt: expect.any(Number),
    });
    expect(plan.notes["events: a record an event was about did not come across"]).toBe(1);
  });
});
