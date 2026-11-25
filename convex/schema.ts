import { ENTITY_TYPES, INGEST_SOURCES, KNOWLEDGE_KINDS, RELATIONS, SEARCHABLE_TYPES } from "@skippy/shared";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Who made a write. Mirrors `Actor` in @skippy/shared. */
export const actor = v.union(
  v.object({ kind: v.literal("user") }),
  v.object({
    kind: v.literal("agent"),
    harness: v.union(v.literal("claude"), v.literal("chatgpt"), v.literal("codex"), v.literal("other")),
    clientId: v.string(),
    surface: v.optional(
      v.union(
        v.literal("web_chat"),
        v.literal("claude_project"),
        v.literal("claude_code"),
        v.literal("scheduled"),
      ),
    ),
    ref: v.optional(v.string()),
  }),
  v.object({ kind: v.literal("import"), source: v.string() }),
);

/** One of a fixed list of strings, as a validator. */
const oneOf = <T extends readonly [string, string, ...string[]]>(values: T) =>
  v.union(...(values.map((value) => v.literal(value)) as { [K in keyof T]: ReturnType<typeof v.literal<T[K]>> }));

export const entityType = oneOf(ENTITY_TYPES);

/** A pointer to any record, used by the activity log, relationships and sources. */
export const entityRef = v.object({ entityType, entityId: v.string() });

export const projectStatus = v.union(
  v.literal("idea"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("completed"),
  v.literal("archived"),
);
export const projectHealth = v.union(v.literal("on_track"), v.literal("at_risk"), v.literal("blocked"));
export const projectKind = v.union(v.literal("code"), v.literal("general"));
/** Where a project's work happens in Claude. */
export const claudeHome = v.union(
  v.object({ kind: v.literal("claude_project"), name: v.string(), url: v.optional(v.string()) }),
  v.object({ kind: v.literal("code_folder"), path: v.string(), repoUrl: v.optional(v.string()) }),
);
export const phaseStatus = v.union(v.literal("planned"), v.literal("active"), v.literal("done"));
export const taskStatus = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("waiting"),
  v.literal("done"),
  v.literal("cancelled"),
);
export const commitment = v.union(v.literal("must"), v.literal("want"));
export const ingestSource = oneOf(INGEST_SOURCES);
export const goalStatus = v.union(v.literal("active"), v.literal("paused"), v.literal("achieved"), v.literal("abandoned"));
export const recurrenceRule = v.union(
  v.object({ kind: v.literal("interval"), everyDays: v.number() }),
  v.object({ kind: v.literal("calendar"), rrule: v.string() }),
);
export const recurrenceStatus = v.union(v.literal("active"), v.literal("paused"), v.literal("retired"));
export const eventStatus = v.union(v.literal("confirmed"), v.literal("cancelled"));
/** "remember": to be filed. "hold": a private hand-off between devices that lapses. */
export const captureIntent = v.union(v.literal("remember"), v.literal("hold"));

export const knowledgeKind = oneOf(KNOWLEDGE_KINDS);
export const readState = v.union(v.literal("saved"), v.literal("unread"), v.literal("read"));
export const lifecycle = v.union(v.literal("active"), v.literal("archived"));
export const relation = oneOf(RELATIONS);
export const searchableType = oneOf(SEARCHABLE_TYPES);
export const companyLabel = v.union(
  v.literal("client"),
  v.literal("vendor"),
  v.literal("employer"),
  v.literal("partner"),
  v.literal("prospect"),
  v.literal("other"),
);
export const sourceLink = v.union(
  v.literal("created_from"),
  v.literal("updated_from"),
  v.literal("mentioned_in"),
  v.literal("evidence_for"),
);

/**
 * Carried by every record: who made it, who last changed it, and when.
 * `createdAt` is set only when a record is older than its row here, as an
 * imported record is. Otherwise the row's own creation time is the answer.
 */
const authored = { createdBy: actor, updatedBy: actor, updatedAt: v.number(), createdAt: v.optional(v.number()) };

export const cardKind = v.union(
  v.literal("task"),
  v.literal("event"),
  v.literal("project"),
  v.literal("note"),
  v.literal("person"),
  v.literal("recurrence"),
);

/** What a card would create. The fields for its kind are filled and the rest left out. */
export const cardDraft = v.object({
  /** A task, an event, a project, a note or a recurrence. */
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  // A task
  dueAt: v.optional(v.string()),
  project: v.optional(v.string()),
  // An event
  startAt: v.optional(v.string()),
  endAt: v.optional(v.string()),
  location: v.optional(v.string()),
  // A project
  summary: v.optional(v.string()),
  notes: v.optional(v.string()),
  // A note
  body: v.optional(v.string()),
  // A person
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  company: v.optional(v.string()),
  // A recurrence
  rule: v.optional(recurrenceRule),
  nextDue: v.optional(v.string()),
});

export const promotionCard = v.object({
  cardId: v.string(),
  kind: cardKind,
  draft: cardDraft,
  state: v.union(v.literal("offered"), v.literal("accepted"), v.literal("dismissed")),
  resultRef: v.optional(entityRef),
});

export default defineSchema({
  // Areas of life, such as Home or Work. Data, not a fixed list.
  areas: defineTable({
    name: v.string(),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    order: v.number(),
    ...authored,
  }).index("by_order", ["order"]),

  goals: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    areaId: v.optional(v.id("areas")),
    horizon: v.optional(v.string()),
    status: goalStatus,
    measures: v.optional(v.array(v.object({ label: v.string(), target: v.number(), current: v.number() }))),
    ...authored,
  }).index("by_status", ["status"]),

  projects: defineTable({
    title: v.string(),
    /** What Claude Projects and CLAUDE.md files use to name the project. Never changes. */
    slug: v.string(),
    summary: v.optional(v.string()),
    kind: projectKind,
    status: projectStatus,
    health: v.optional(projectHealth),
    claudeHome: v.optional(claudeHome),
    /** The latest status report, copied from projectUpdates. */
    statusNote: v.optional(v.string()),
    statusUpdatedAt: v.optional(v.number()),
    statusUpdatedBy: v.optional(actor),
    /** The nightly sweep's high-water mark, for code projects. */
    lastSweptAt: v.optional(v.number()),
    notesPad: v.string(),
    goalId: v.optional(v.id("goals")),
    areaId: v.optional(v.id("areas")),
    targetDate: v.optional(v.number()),
    ...authored,
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"]),

  // The history of status reports. The latest is copied onto its project.
  projectUpdates: defineTable({
    projectId: v.id("projects"),
    note: v.string(),
    health: v.optional(projectHealth),
    milestone: v.optional(v.string()),
    actor,
    at: v.number(),
  }).index("by_project", ["projectId", "at"]),

  phases: defineTable({
    projectId: v.id("projects"),
    order: v.number(),
    title: v.string(),
    description: v.optional(v.string()),
    status: phaseStatus,
    ...authored,
  }).index("by_project", ["projectId", "order"]),

  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    status: taskStatus,
    projectId: v.optional(v.id("projects")),
    phaseId: v.optional(v.id("phases")),
    areaId: v.optional(v.id("areas")),
    /** Missing means "must". */
    commitment: v.optional(commitment),
    dueAt: v.optional(v.number()),
    /** When I plan to do it. */
    scheduledFor: v.optional(v.number()),
    /** Who or what the task is waiting on, in words. */
    waitingOn: v.optional(v.string()),
    /** Where it gets done, such as a shop's address. The app links it to Google Maps. */
    location: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    ...authored,
  })
    .index("by_project", ["projectId"])
    .index("by_status", ["status"]),

  // Things that come round again: a bill, a filter change, a check-in.
  recurrences: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    rule: recurrenceRule,
    /** "schedule": the next one is counted from the day this one was due. "completion": from the day it was done. */
    anchor: v.union(v.literal("schedule"), v.literal("completion")),
    /** How many days before it is due it starts to show under Today. */
    leadTimeDays: v.optional(v.number()),
    status: recurrenceStatus,
    /** The day it next falls due, as YYYY-MM-DD in the owner's zone. */
    nextDue: v.string(),
    lastCompletedAt: v.optional(v.number()),
    /** The latest times it was done or skipped, oldest first. */
    history: v.optional(
      v.array(
        v.object({
          at: v.number(),
          outcome: v.union(v.literal("completed"), v.literal("skipped")),
          due: v.optional(v.string()),
        }),
      ),
    ),
    areaId: v.optional(v.id("areas")),
    ...authored,
  }).index("by_status", ["status", "nextDue"]),

  // Appointments and other things with a time. Skippy's own events live here;
  // Google's calendar joins as a read-only mirror in Phase 5.
  calendarEvents: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
    status: eventStatus,
    origin: v.union(v.literal("skippy"), v.literal("google")),
    /** How the same event is known in a calendar outside Skippy. */
    externalId: v.optional(v.string()),
    calendarId: v.optional(v.string()),
    htmlLink: v.optional(v.string()),
    /** Google copies only: the ingestion run that last saw the event in the calendar. */
    seenInRun: v.optional(v.id("ingestionRuns")),
    /**
     * When the owner ticked it off before it was over. Skippy's own mark, so it
     * is kept on Google copies too and a pass never touches it.
     */
    doneAt: v.optional(v.number()),
    projectId: v.optional(v.id("projects")),
    ...authored,
  })
    .index("by_start", ["startAt"])
    .index("by_external", ["externalId"])
    .index("by_project", ["projectId", "startAt"]),

  // A light address book. Emails and phone numbers are also kept in
  // personHandles, where one can be looked up to find its person.
  people: defineTable({
    name: v.string(),
    /** The name lowercased, for matching. */
    nameKey: v.string(),
    emails: v.array(v.string()),
    phoneNumbers: v.array(v.string()),
    roleTitle: v.optional(v.string()),
    /** How I know them, in words. */
    relationshipContext: v.optional(v.string()),
    /** "1984-03-09", or "03-09" when the year is not known. */
    birthday: v.optional(v.string()),
    notes: v.optional(v.string()),
    favorite: v.optional(v.boolean()),
    lastContactAt: v.optional(v.number()),
    /** How often I want to be in touch, in days. */
    contactCadenceDays: v.optional(v.number()),
    ...authored,
  }).index("by_name_key", ["nameKey"]),

  personHandles: defineTable({
    personId: v.id("people"),
    kind: v.union(v.literal("email"), v.literal("phone")),
    /** Normalised, so one address or number has one spelling. */
    value: v.string(),
  })
    .index("by_value", ["kind", "value"])
    .index("by_person", ["personId"]),

  companies: defineTable({
    name: v.string(),
    nameKey: v.string(),
    domain: v.optional(v.string()),
    website: v.optional(v.string()),
    relationshipLabel: v.optional(companyLabel),
    notes: v.optional(v.string()),
    ...authored,
  }).index("by_name_key", ["nameKey"]),

  // Everything worth remembering, in one table: notes, links, memories,
  // decisions, principles and open questions.
  knowledge: defineTable({
    kind: knowledgeKind,
    title: v.optional(v.string()),
    /** Markdown. */
    body: v.optional(v.string()),
    summary: v.optional(v.string()),
    url: v.optional(v.string()),
    normalizedUrl: v.optional(v.string()),
    /** Links only. Kept apart from lifecycle. */
    readState: v.optional(readState),
    lifecycle,
    whyItMatters: v.optional(v.string()),
    /** Decisions only. */
    decision: v.optional(
      v.object({
        options: v.optional(v.array(v.string())),
        chosen: v.optional(v.string()),
        rationale: v.optional(v.string()),
        revisitAt: v.optional(v.number()),
      }),
    ),
    ...authored,
  })
    .index("by_kind", ["kind"])
    .index("by_updated", ["updatedAt"])
    .index("by_kind_updated", ["kind", "updatedAt"])
    .index("by_normalized_url", ["normalizedUrl"]),

  // The graph: any record can be related to any other. Read as "from <type> to".
  relationships: defineTable({
    from: entityRef,
    to: entityRef,
    type: relation,
    confidence: v.optional(v.number()),
    reason: v.optional(v.string()),
    createdBy: actor,
    createdAt: v.number(),
  })
    .index("by_from", ["from.entityId", "type"])
    .index("by_to", ["to.entityId", "type"]),

  // Where something came from: an email, a message, a web page, a conversation.
  // Holds a pointer back and a short excerpt, never the full original.
  sourceRefs: defineTable({
    sourceSystem: v.string(),
    externalId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    eventId: v.optional(v.string()),
    sourceTimestamp: v.optional(v.number()),
    participants: v.optional(v.array(v.string())),
    url: v.optional(v.string()),
    deepLink: v.optional(v.string()),
    excerpt: v.optional(v.string()),
    summary: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_external", ["sourceSystem", "externalId"])
    .index("by_message", ["sourceSystem", "messageId"])
    .index("by_event", ["sourceSystem", "eventId"]),

  entitySourceRefs: defineTable({
    entityRef,
    sourceRefId: v.id("sourceRefs"),
    relationship: sourceLink,
  })
    .index("by_entity", ["entityRef.entityId"])
    .index("by_source", ["sourceRefId"]),

  // One row per searchable record, holding its words. Kept in step by every
  // write, so one text index covers every kind of record.
  searchDocs: defineTable({
    entityType: searchableType,
    entityId: v.string(),
    title: v.string(),
    text: v.string(),
  })
    .index("by_entity", ["entityId"])
    .searchIndex("by_text", { searchField: "text", filterFields: ["entityType"] }),

  // Who changed what. Powers the "Overnight" panel and get_changes_since.
  activityEvents: defineTable({
    entityRef: v.optional(entityRef),
    activityType: v.string(),
    actor,
    at: v.number(),
    summary: v.string(),
    /** Changed fields, each with its value before and after. */
    diff: v.optional(v.record(v.string(), v.object({ from: v.optional(v.any()), to: v.optional(v.any()) }))),
  })
    .index("by_at", ["at"])
    .index("by_entity", ["entityRef.entityId", "at"]),

  // One row. Owner-wide settings.
  settings: defineTable({
    timeZone: v.string(),
    /** Days without a status update before an active project is flagged stale. */
    stalenessDays: v.number(),
    /** No notifications from this hour to that one, by the owner's clock (0 to 23). */
    quietFrom: v.optional(v.number()),
    quietTo: v.optional(v.number()),
    /** Where "Home" is in a place such as "Home → HPN", for directions. Kept here, never in the code. */
    homeAddress: v.optional(v.string()),
    updatedAt: v.number(),
  }),

  // Chats in the dashboard. Each is a Claude Code session on the mini: the
  // page queues a turn, the chat runner claims it and writes the reply back.
  // See chats.ts and runner.ts.
  chats: defineTable({
    /** "home" is an idea chat. "item" is a chat about one record. */
    scope: v.union(v.object({ kind: v.literal("home") }), v.object({ kind: v.literal("item"), entityRef })),
    title: v.string(),
    /** The Claude Code session that holds the conversation. Chosen here, so a retried first turn reuses it. */
    sessionId: v.string(),
    /** Set once the session exists on the mini, so later turns resume it. */
    sessionStarted: v.optional(v.boolean()),
    state: v.union(v.literal("open"), v.literal("promoted"), v.literal("archived")),
    promotedTo: v.optional(entityRef),
    /** When a brief was last written to carry this chat on in the Claude app. */
    continuedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_updated", ["updatedAt"])
    .index("by_item", ["scope.entityRef.entityId", "updatedAt"]),

  chatMessages: defineTable({
    chatId: v.id("chats"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    /** An assistant message is "waiting" until the mini starts on it, "writing" while it does. */
    status: v.union(v.literal("done"), v.literal("waiting"), v.literal("writing"), v.literal("failed")),
    /** Records Claude offered to make while writing this message. They live here and nowhere else. */
    cards: v.optional(v.array(promotionCard)),
    createdAt: v.number(),
  }).index("by_chat", ["chatId", "createdAt"]),

  // One per message the owner sends. The runner holds a lease on the turn it
  // is working on; a lease that runs out means the runner died, and the turn fails.
  chatTurns: defineTable({
    chatId: v.id("chats"),
    userMessageId: v.id("chatMessages"),
    assistantMessageId: v.id("chatMessages"),
    status: v.union(
      v.literal("queued"),
      v.literal("claimed"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    leaseUntil: v.optional(v.number()),
    host: v.optional(v.string()),
    /**
     * "brief": the reply is a hand-off brief, saved to the project's notes or as a note when it is done.
     * "delegate": the owner handed the chat's task to the session to work on.
     */
    kind: v.optional(v.union(v.literal("brief"), v.literal("delegate"))),
    /** What the session is asked, when it is not the owner's message as shown in the chat. */
    prompt: v.optional(v.string()),
    /** What the session is doing right now, in a few words. */
    activity: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_chat", ["chatId", "createdAt"]),

  // The machines that run chats. A heartbeat every half minute says the mini is there.
  agentHosts: defineTable({
    host: v.string(),
    lastSeenAt: v.number(),
    version: v.optional(v.string()),
  }).index("by_host", ["host"]),

  // The morning note, one a day, written by the day's first ingestion pass.
  briefings: defineTable({
    /** The day it is for, as YYYY-MM-DD in the owner's zone. */
    date: v.string(),
    /** Missing means the daily morning note. "weekly" is the weekly review, kept on the day it was written. */
    kind: v.optional(v.literal("weekly")),
    text: v.string(),
    runId: v.optional(v.id("ingestionRuns")),
    ...authored,
  }).index("by_date", ["date"]),

  // A browser or an installed app that asked for notifications.
  pushSubscriptions: defineTable({
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
    enabled: v.boolean(),
    createdAt: v.number(),
    lastSentAt: v.optional(v.number()),
  }).index("by_endpoint", ["endpoint"]),

  // Every notification that was meant to go out, and what became of it. The
  // key stops the same one going twice: "briefing:2026-11-21".
  notificationDeliveries: defineTable({
    dedupeKey: v.string(),
    type: v.string(),
    title: v.string(),
    body: v.string(),
    url: v.string(),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    /** Why it was skipped or failed, in words. */
    reason: v.optional(v.string()),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
  })
    .index("by_key", ["dedupeKey"])
    .index("by_created", ["createdAt"]),

  // One row. How far down the activity log the owner has read on the dashboard.
  viewerState: defineTable({
    activitySeenAt: v.number(),
  }),

  // Ingestion. A scheduled Claude task reads the owner's calendar, mail and
  // messages and writes what matters here through the MCP. See ingestion.ts.

  // How far each source has been read.
  sourceCursors: defineTable({
    source: ingestSource,
    cursor: v.string(),
    updatedAt: v.number(),
    runId: v.optional(v.id("ingestionRuns")),
  }).index("by_source", ["source"]),

  // One row per pass: when it ran, what it read and what went wrong.
  ingestionRuns: defineTable({
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    status: v.union(v.literal("running"), v.literal("finished"), v.literal("failed")),
    /** Which pass of the day, in the agent's words: "9am". */
    pass: v.optional(v.string()),
    actor,
    sources: v.array(
      v.object({
        source: ingestSource,
        read: v.number(),
        skipped: v.number(),
        error: v.optional(v.string()),
      }),
    ),
    note: v.optional(v.string()),
  }).index("by_started", ["startedAt"]),

  // What ingestion made from one thing in a source. It is the record's origin
  // (source, pointer back, summary, run), it makes a replay create nothing
  // twice, and it is what undo works from.
  ingestionReceipts: defineTable({
    runId: v.id("ingestionRuns"),
    source: ingestSource,
    /** The thing's id in its source, and what was made from it. One source item can make several records. */
    key: v.string(),
    entityRef,
    action: v.union(v.literal("created"), v.literal("updated")),
    /** One or two lines: what the original says and why this was made. */
    summary: v.string(),
    url: v.optional(v.string()),
    at: v.number(),
    undoneAt: v.optional(v.number()),
    undoReason: v.optional(v.string()),
  })
    .index("by_key", ["source", "key"])
    .index("by_run", ["runId"])
    .index("by_at", ["at"]),

  // What ingestion is told: things to leave out ("block"), and how to judge ("rule").
  // The owner writes them in Settings, and an undo with a reason adds one.
  ingestionRules: defineTable({
    kind: v.union(v.literal("block"), v.literal("rule")),
    /** One source, or every source when missing. */
    source: v.optional(ingestSource),
    text: v.string(),
    active: v.boolean(),
    /** The undo that made the rule, when one did. */
    fromReceiptId: v.optional(v.id("ingestionReceipts")),
    ...authored,
  }),

  // Files the owner has put in. The bytes are in Convex file storage. See files.ts.
  files: defineTable({
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    note: v.optional(v.string()),
    /** The record the file belongs to. */
    attachedTo: v.optional(entityRef),
    /** Set while the file waits in the inbox on a capture. */
    captureId: v.optional(v.id("captures")),
    /** Set when the owner sent the file with a chat message, for the chat's session to read. */
    messageId: v.optional(v.id("chatMessages")),
    ...authored,
  })
    .index("by_entity", ["attachedTo.entityId"])
    .index("by_capture", ["captureId"])
    .index("by_message", ["messageId"]),

  // The inbox: things dropped in quickly, to be filed later. See captures.ts.
  captures: defineTable({
    text: v.optional(v.string()),
    url: v.optional(v.string()),
    intent: captureIntent,
    /** The record the capture was made about, such as the project whose page it was typed on. */
    about: v.optional(entityRef),
    status: v.union(v.literal("pending"), v.literal("processed"), v.literal("discarded")),
    createdBy: actor,
    createdAt: v.number(),
    processedBy: v.optional(actor),
    processedAt: v.optional(v.number()),
    /** What it was filed as. */
    resultRefs: v.optional(v.array(entityRef)),
    /** What was done with it, in words. */
    outcome: v.optional(v.string()),
    /** Held captures only: when the hand-off lapses. */
    expiresAt: v.optional(v.number()),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_expiry", ["expiresAt"]),

  // Nonces of gateway envelopes already used, kept until the envelope expires.
  gatewayNonces: defineTable({
    nonce: v.string(),
    expiresAt: v.number(),
  })
    .index("by_nonce", ["nonce"])
    .index("by_expiry", ["expiresAt"]),
});
