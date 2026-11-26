import {
  AGENT_SURFACES,
  ENTITY_TYPES,
  INGEST_SOURCES,
  KNOWLEDGE_KINDS,
  RELATIONS,
  SEARCHABLE_TYPES,
  type OperationName,
} from "@skippy/shared";
import { z } from "zod";

/**
 * What each MCP tool is called, what it says about itself and what it accepts.
 * The scope each one needs lives in OPERATIONS in @skippy/shared, which Convex
 * also reads, so a tool cannot be offered with a weaker scope than Convex enforces.
 */
export type ToolDefinition = {
  title: string;
  description: string;
  input: Record<string, z.ZodType>;
  /** A read changes nothing. A write is safe to repeat when it is marked idempotent. */
  kind: "read" | "write";
  idempotent?: boolean;
};

const projectSlug = z
  .string()
  .describe('The project\'s slug, for example "kitchen-remodel". Use list_projects to find it.');
const when = (what: string) =>
  z
    .string()
    .describe(
      `${what} A date like 2026-11-25, a local time like 2026-11-25T15:00, or a full ISO time. Dates and local times are read in the owner's time zone.`,
    );
const clearable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();
/**
 * A list that also takes its JSON text. A client holding a tool definition from
 * before the field existed does not know it is a list, and sends it as a string.
 */
const list = <T extends z.ZodType>(schema: z.ZodArray<T>) =>
  z.preprocess((value) => {
    if (typeof value !== "string" || !value.trim().startsWith("[")) return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }, schema);

const projectStatus = z.enum(["idea", "active", "paused", "completed", "archived"]);
const projectHealth = z.enum(["on_track", "at_risk", "blocked"]);
const claudeHome = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("claude_project"),
    name: z.string().describe("The Claude Project's name."),
    url: z.string().optional(),
  }),
  z.object({
    kind: z.literal("code_folder"),
    path: z.string().describe("The folder's path on the Mac mini."),
    repoUrl: z.string().optional(),
  }),
]);

const record = (what: string) =>
  z
    .object({
      type: z.enum(ENTITY_TYPES),
      id: z.string().describe("The record's id. For a project, its slug."),
    })
    .describe(what);
const source = z
  .object({
    system: z.string().max(40).describe('Where it came from, for example "gmail", "imessage", "web" or "conversation".'),
    url: z.string().max(2000).optional().describe("A link back to the original."),
    externalId: z.string().max(500).optional().describe("The original's id in that system, if it has one."),
    messageId: z.string().max(500).optional(),
    threadId: z.string().max(500).optional(),
    excerpt: z.string().max(1000).optional().describe("A short quote from the original. Never the whole thing."),
    summary: z.string().max(1000).optional().describe("One or two sentences on what the original says."),
    at: when("When the original was written or sent.").optional(),
  })
  .describe("Where this came from: a pointer back and a short excerpt or summary.");

export const TOOLS: Record<OperationName, ToolDefinition> = {
  whoami: {
    title: "Who am I",
    description:
      "Shows which Skippy owner and client this connection acts as, the scopes it was granted, and the five most recent captures.",
    input: {},
    kind: "read",
  },
  capture: {
    title: "Capture",
    description:
      "Drops something into the owner's inbox to be filed later. Use it when the owner says to capture or hold something and you cannot tell what kind of record it is, or have no time to file it. When you do know, save it directly instead: upsert_task for something to do, upsert_knowledge for something to remember, upsert_person for a person.",
    input: {
      text: z.string().trim().max(4000).optional().describe("What to capture, in the owner's words."),
      url: z.string().trim().max(2000).optional().describe("A web address, when the capture is a link."),
      about: record("The project or other record this capture concerns, when there is one.").optional(),
      intent: z
        .enum(["remember", "hold"])
        .optional()
        .describe('"remember" (the default) is filed later. "hold" is a private hand-off between the owner\'s devices: never filed, gone after seven days.'),
    },
    kind: "write",
  },
  list_captures: {
    title: "List captures",
    description:
      "Lists what is waiting in the inbox, oldest first. To file one: save it as the right record (upsert_task, upsert_knowledge, upsert_person), then call resolve_capture with what it became. Held captures are listed only when intent is \"hold\", and are never filed.",
    input: {
      status: z.enum(["pending", "processed", "discarded"]).optional().describe('Defaults to "pending".'),
      intent: z.enum(["remember", "hold"]).optional().describe('Defaults to "remember".'),
      limit: z.number().int().min(1).max(100).optional().describe("How many to return. Defaults to 25."),
    },
    kind: "read",
  },
  resolve_capture: {
    title: "Resolve capture",
    description:
      "Marks a capture as dealt with. Use outcome \"processed\" with the records it was filed as, or \"discarded\" with a short reason when it is a duplicate or not worth keeping. Resolving the same capture again changes nothing.",
    input: {
      id: z.string().describe("The capture's id, from list_captures."),
      outcome: z.enum(["processed", "discarded"]),
      results: z
        .array(z.object({ type: z.enum(ENTITY_TYPES), id: z.string() }))
        .max(10)
        .optional()
        .describe("What the capture became. Required when processed."),
      note: z.string().max(300).optional().describe("Why it was discarded, or anything worth saying about how it was filed."),
    },
    kind: "write",
    idempotent: true,
  },

  list_projects: {
    title: "List projects",
    description:
      "Lists the owner's projects with status, health, the latest status note and whether each is stale (active with no status report for a week). Leaves out archived projects unless asked for them.",
    input: { status: projectStatus.optional().describe("Only projects with this status.") },
    kind: "read",
  },
  get_project: {
    title: "Get project",
    description:
      "Reads one project in full: its details (with how it ends and the parts switched on), description and notes, phases, open tasks, recently closed tasks, its events still to come, its decisions with their options, its budget lines with the totals, the last five status reports, and what files it holds. Files are listed by name and size only; they are opened from the dashboard.",
    input: { project: projectSlug },
    kind: "read",
  },
  upsert_project: {
    title: "Create or update project",
    description:
      "Creates a project, or updates one when `slug` names an existing project. To create, give a title; the slug is made from it unless you pass one. To update, pass the slug and only the fields that change. Send null to clear an optional field.",
    input: {
      slug: z.string().optional().describe("Lowercase letters, digits and hyphens. Names the project to update."),
      title: z.string().optional().describe("Required when creating."),
      summary: clearable(z.string()).describe("One or two sentences on what the project is."),
      description: clearable(z.string().max(20_000)).describe(
        "The longer account of the project in Markdown: goals, scope, background, links. Replaces the whole description. Working notes go in notesPad.",
      ),
      kind: z
        .enum(["code", "general", "plan"])
        .optional()
        .describe(
          '"code" for a software project, which is a type of its own; "general" for everything else. ("plan" is the older name for a general project with finish "date".)',
        ),
      finish: z
        .enum(["ongoing", "date", "tasks"])
        .optional()
        .describe(
          'How a general project ends. "ongoing": never, a part of life to keep up (the house, the car, health). "date": on its date, which is fixed, such as a trip, a holiday or a party; targetDate is the day (the last day, for several), and it starts with the schedule part. "tasks" (the default): when its work is done, with targetDate as an optional aim, such as a remodel.',
        ),
      roughDate: clearable(z.string().max(100)).describe('Roughly when, in words, until there is a date: "early spring", "before the holidays".'),
      parts: list(z.array(z.enum(["options", "budget", "schedule"])).max(3))
        .optional()
        .describe(
          'The parts switched on, each a panel on its page. Replaces the list. "options": questions to decide, each with options side by side (upsert_decision, upsert_option). "budget": lines planned against spent, which double as the shopping list (upsert_budget_line). "schedule": its events by day, the itinerary for a trip (upsert_event with project). Adding a decision or a budget line switches its part on.',
        ),
      budget: clearable(z.number().min(0)).describe("The budget part's total to stay within, in the owner's currency."),
      status: projectStatus.optional().describe('Defaults to "active" for a new project.'),
      health: clearable(projectHealth),
      claudeHome: clearable(claudeHome).describe("Where the work happens in Claude."),
      targetDate: clearable(when("For finish \"date\", the day it happens; otherwise when it should be finished.")),
      notesPad: z.string().optional().describe("Free-form working notes. Replaces the whole pad."),
    },
    kind: "write",
    idempotent: true,
  },
  record_project_status: {
    title: "Record project status",
    description:
      "Records a status report for a project: what happened and where it stands. Call it when a milestone is reached, a decision is made, something gets blocked, or a working session ends. The newest report becomes the project's current status.",
    input: {
      project: projectSlug,
      note: z.string().trim().min(1).max(4000).describe("One short paragraph, written for the owner."),
      health: projectHealth.optional().describe("Set it when the project's health has changed."),
      milestone: z.string().max(200).optional().describe("The milestone reached, if any."),
      surface: z.enum(AGENT_SURFACES).optional().describe("Where you are working, if you know."),
      ref: z.string().max(300).optional().describe("A pointer to your session or run, if you have one."),
    },
    kind: "write",
  },
  create_phase: {
    title: "Add phase",
    description: "Adds a phase to the end of a project's plan.",
    input: {
      project: projectSlug,
      title: z.string().trim().min(1).max(200),
      description: z.string().max(4000).optional(),
      status: z.enum(["planned", "active", "done"]).optional().describe('Defaults to "planned".'),
    },
    kind: "write",
  },
  update_phase: {
    title: "Update phase",
    description:
      'Changes a phase of a project\'s plan: its status, title or description. Set the status to "active" when work on the phase starts and "done" when it is finished. Pass only the fields that change, and null to clear the description.',
    input: {
      id: z.string().describe("The phase's id, from get_project."),
      title: z.string().trim().min(1).max(200).optional(),
      description: clearable(z.string().max(4000)),
      status: z.enum(["planned", "active", "done"]).optional(),
    },
    kind: "write",
    idempotent: true,
  },
  upsert_decision: {
    title: "Create or update decision",
    description:
      'Adds a question to decide to a project\'s options part, or changes one when `id` is given. Add the options with upsert_option, weighed against `criteria`. To decide, pass `chosen` with an option\'s id and `why`: the decision is then saved to Memory, linked to the project. Pass chosen: null to open it again, and status "dropped" when it no longer needs deciding. Pass only the fields that change.',
    input: {
      id: z.string().optional().describe("The decision's id, from get_project, to change it."),
      project: projectSlug.optional().describe("Required when adding one."),
      question: z.string().trim().min(1).max(300).optional().describe('Required when adding one, such as "Where to stay?"'),
      criteria: clearable(z.string().max(4000)).describe("What matters in choosing: price, location, timing and so on."),
      status: z.enum(["open", "decided", "dropped"]).optional(),
      chosen: clearable(z.string()).describe("The id of the chosen option."),
      why: clearable(z.string().max(4000)).describe("Why it won."),
    },
    kind: "write",
    idempotent: true,
  },
  upsert_option: {
    title: "Create or update option",
    description:
      "Adds an option to a decision, or changes one when `id` is given. Write what it is and how it measures up against the decision's criteria in `details`. Pass only the fields that change, and null to clear one.",
    input: {
      id: z.string().optional().describe("The option's id, from get_project, to change it."),
      decision: z.string().optional().describe("The decision's id. Required when adding one."),
      title: z.string().trim().min(1).max(200).optional().describe("Required when adding one."),
      details: clearable(z.string().max(4000)).describe("Short Markdown: what it is, pros and cons."),
      url: clearable(z.string().max(2000)).describe("A link to it."),
      price: clearable(z.number().min(0)).describe("What it costs, in the owner's currency."),
    },
    kind: "write",
    idempotent: true,
  },
  upsert_budget_line: {
    title: "Create or update budget line",
    description:
      "Adds a line to a project's budget, or changes one when `id` is given: something to pay for or buy, with what is planned and what was spent. The lines are also the shopping list, so mark one bought when it is. Pass only the fields that change, and null to clear one.",
    input: {
      id: z.string().optional().describe("The line's id, from get_project, to change it."),
      project: projectSlug.optional().describe("Required when adding one."),
      title: z.string().trim().min(1).max(200).optional().describe("Required when adding one."),
      planned: clearable(z.number().min(0)).describe("What it should cost."),
      spent: clearable(z.number().min(0)).describe("What it did cost."),
      bought: z.boolean().optional().describe("Paid for or bought."),
      url: clearable(z.string().max(2000)).describe("Where to buy it, or the booking."),
      note: clearable(z.string().max(1000)),
    },
    kind: "write",
    idempotent: true,
  },
  upsert_task: {
    title: "Create or update task",
    description:
      "Creates a task, or updates one when `id` is given. To create, give a title. To update, pass the id and only the fields that change. Send null to clear an optional field. A task can stand alone or belong to a project.",
    input: {
      id: z.string().optional().describe("The id of the task to update."),
      title: z.string().optional().describe("Required when creating. Start with a verb."),
      description: clearable(z.string().max(4000)),
      status: z
        .enum(["todo", "in_progress", "waiting", "done", "cancelled"])
        .optional()
        .describe('Defaults to "todo". Use "waiting" with waitingOn when it depends on someone else.'),
      project: clearable(projectSlug),
      area: clearable(z.string().max(60)).describe('The area of life it belongs to, by name, such as "Household". Areas are the owner\'s list: a name that is not on it is refused, and the refusal lists the names.'),
      phaseId: clearable(z.string()).describe("A phase of the same project, from get_project."),
      commitment: clearable(z.enum(["must", "want"])).describe('"must" when it has to happen, "want" when it is optional.'),
      dueAt: clearable(when("The deadline.")),
      scheduledFor: clearable(when("When the owner plans to do it.")),
      waitingOn: clearable(z.string().max(300)).describe("Who or what the task is waiting on."),
      location: clearable(z.string().max(500)).describe('Where it gets done, such as a shop or an office, with its address when known. The app links it to Google Maps. For a trip write "From → To", such as "Home → City Airport"; Home means the owner\'s home address.'),
    },
    kind: "write",
    idempotent: true,
  },
  complete_task: {
    title: "Complete task",
    description: "Marks a task as done. Completing a task that is already done changes nothing.",
    input: {
      id: z.string().describe("The id of the task."),
      note: z.string().max(500).optional().describe("How it was finished, if worth saying."),
    },
    kind: "write",
    idempotent: true,
  },
  upsert_person: {
    title: "Create or update person",
    description:
      "Adds a person to the owner's address book, or updates one. Without an id, a person is found by any email or phone number given; if one matches, that person is updated and their name is left as it is. Emails and phone numbers are added to what is on file, never replaced; a wrong one is taken off with removeEmails or removePhoneNumbers. Pass only the fields that change, and null to clear an optional field. Search first when you only have a name.",
    input: {
      id: z.string().optional().describe("The id of the person to update."),
      name: z.string().max(200).optional().describe("Their full name. Required for a new person."),
      aliases: clearable(list(z.array(z.string().max(100)).max(20))).describe(
        'Other names they go by, such as the first name the owner calls them by ("Kate") or another spelling ("Cate"). Replaces the list on file. Every record whose words use their full name, one of these names or one of their numbers is linked to them by itself, so give a name here only when it means this person and no one else on file.',
      ),
      emails: z.array(z.string().max(320)).max(20).optional().describe("Email addresses to add."),
      phoneNumbers: z.array(z.string().max(40)).max(20).optional().describe("Phone numbers to add."),
      separate: z.boolean().optional().describe("Without an id, a new address or number under a name that exactly one person on file has is added to that person. Set this to true only when it is a different person who shares the name."),
      removeEmails: z.array(z.string().max(320)).max(20).optional().describe("Email addresses to take off this person, when one is wrong. Needs id."),
      removePhoneNumbers: z.array(z.string().max(40)).max(20).optional().describe("Phone numbers to take off this person, when one is wrong. Needs id."),
      company: clearable(z.string().max(200)).describe(
        "The name of the company they work at. A company not on file yet is added.",
      ),
      roleTitle: clearable(z.string().max(200)).describe("Their job title or role."),
      relationshipContext: clearable(z.string().max(1000)).describe("How the owner knows them."),
      birthday: clearable(z.string()).describe("Like 1984-03-09, or 03-09 when the year is not known."),
      notes: clearable(z.string().max(8000)).describe("Free-form notes. Replaces the notes on file."),
      favorite: clearable(z.boolean()),
      lastContactAt: clearable(when("When the owner was last in touch with them.")),
      contactCadenceDays: clearable(z.number().int().min(1).max(3650)).describe(
        "How often the owner wants to be in touch, in days.",
      ),
    },
    kind: "write",
    idempotent: true,
  },
  upsert_knowledge: {
    title: "Save or update knowledge",
    description:
      'Saves something worth remembering, or updates it when `id` is given. Kinds: "note" (free-form), "link" (a web page; needs a url, and the same url saved twice is one link), "memory" (a fact about the owner or their world), "decision" (what was decided and why), "principle" (a rule the owner works by) and "question" (something still open). Search first so the same thing is not saved twice. Use `about` to tie it to the people, projects or other records it concerns.',
    input: {
      id: z.string().optional().describe("The id of the item to update."),
      kind: z.enum(KNOWLEDGE_KINDS).optional().describe("Required when saving something new."),
      title: clearable(z.string().max(300)),
      body: clearable(z.string().max(50_000)).describe("The content, in Markdown."),
      summary: clearable(z.string().max(1000)).describe("One or two sentences."),
      url: clearable(z.string().max(2000)),
      readState: z.enum(["saved", "unread", "read"]).optional().describe('Links only. Defaults to "saved".'),
      lifecycle: z.enum(["active", "archived"]).optional().describe("Archive something that no longer holds."),
      whyItMatters: clearable(z.string().max(1000)).describe("Why this is worth keeping."),
      decision: clearable(
        z.object({
          options: z.array(z.string().max(500)).max(20).optional().describe("What was considered."),
          chosen: z.string().max(500).optional().describe("What was decided."),
          rationale: z.string().max(4000).optional().describe("Why."),
          revisitAt: when("When to look at the decision again.").optional(),
        }),
      ).describe('Decisions only. Replaces the decision details on file.'),
      about: z.array(record("A record this is about.")).max(20).optional(),
      source: source.optional(),
    },
    kind: "write",
    idempotent: true,
  },
  link_entities: {
    title: "Link two records",
    description:
      'Relates one record to another, read as "from <relation> to": a person works_at a company, a task is blocked_by another task, a note belongs_to a project. Linking the same two records the same way again changes nothing. Pass remove: true to take a link away.',
    input: {
      from: record("The record the link starts from."),
      relation: z.enum(RELATIONS),
      to: record("The record the link points to."),
      reason: z.string().max(500).optional().describe("Why they are related, if it is not obvious."),
      confidence: z.number().min(0).max(1).optional().describe("How sure you are, from 0 to 1, when it is a guess."),
      remove: z.boolean().optional().describe("Take the link away instead of making it."),
    },
    kind: "write",
    idempotent: true,
  },

  search: {
    title: "Search",
    description:
      "Finds projects, tasks, people, companies and saved knowledge by the words in them, best match first. Each result has a type and an id; pass them to get_context_bundle to read the record in full. A result of type \"capture\" is something in the inbox that has not been filed yet; read those with list_captures. Search matches words, not meaning, so try the plainest words that would appear in the record.",
    input: {
      query: z.string().trim().min(1).max(200).describe("Words to look for."),
      type: z.enum(SEARCHABLE_TYPES).optional().describe("Only this kind of record."),
      limit: z.number().int().min(1).max(25).optional().describe("How many to return. Defaults to 10."),
    },
    kind: "read",
  },
  get_context_bundle: {
    title: "Get context bundle",
    description:
      "Reads one record together with what surrounds it: the record in full, every record linked to it and how, where it came from, and its last five changes. Use it after search, or before working on something, to see what Skippy already knows. For a project's phases and tasks, use get_project.",
    input: {
      type: z.enum(ENTITY_TYPES),
      id: z.string().describe("The record's id. For a project, its slug."),
    },
    kind: "read",
  },
  get_importance_rubric: {
    title: "Ingestion rubric",
    description:
      "For an ingestion pass. Returns how to judge what is read (the rubric), the owner's own rules, the block list of senders, conversations and calendars to leave out, where each source was left (its cursor, or null when it has never been read), today's briefing as it stands (null until the day's first pass writes it), today's date and the owner's time zone. Read it at the start of every pass.",
    input: {},
    kind: "read",
  },
  record_ingestion_run: {
    title: "Record ingestion run",
    description:
      "Opens an ingestion run, or closes one. Call it with status \"started\" before reading anything: it returns the runId every other ingestion tool needs. If it answers that another run is in progress, stop. At the end call it with the runId, status \"finished\" (or \"failed\"), and for each source how many things were read and how many were left out.",
    input: {
      status: z.enum(["started", "finished", "failed"]),
      runId: z.string().optional().describe("Required when finishing or failing a run."),
      pass: z.string().max(40).optional().describe('Which pass this is, when starting: "9am", "manual".'),
      sources: z
        .array(
          z.object({
            source: z.enum(INGEST_SOURCES),
            read: z.number().int().min(0).describe("How many things were read from the source."),
            skipped: z.number().int().min(0).describe("How many of those were left out."),
            error: z.string().max(500).optional().describe("What went wrong with this source, if anything did."),
          }),
        )
        .max(3)
        .optional()
        .describe("One entry per source the run read. For finishing or failing."),
      note: z.string().max(1000).optional().describe("Anything the owner should know about this run."),
    },
    kind: "write",
  },
  advance_source_cursor: {
    title: "Advance source cursor",
    description:
      "Notes how far a source has been read, so the next pass starts there. Call it once per source, after everything read from it has been sent. The cursor is yours to choose and read back: a time, or the source's own marker.",
    input: {
      runId: z.string(),
      source: z.enum(INGEST_SOURCES),
      cursor: z.string().max(500).describe("For example the ISO time of the newest thing read."),
    },
    kind: "write",
    idempotent: true,
  },
  sync_calendar: {
    title: "Sync calendar",
    description:
      "Copies a stretch of one Google calendar into Skippy OS as read-only events. Send every event in the stretch from `from` to `to`, up to 100 at a time, with more: true on every call but the last. On the last call, events copied before that are no longer in the calendar are marked cancelled. Sending the same events again changes nothing. Give each event's start and end exactly as the calendar gives them.",
    input: {
      runId: z.string(),
      calendarId: z.string().max(300).describe("The calendar's id, as the calendar connector names it."),
      from: z.string().describe("The first day of the stretch that was read, like 2026-11-08."),
      to: z.string().describe("The last day of the stretch that was read, like 2027-02-20."),
      events: z
        .array(
          z.object({
            id: z.string().max(300).describe("The event's id in the calendar."),
            title: z.string().max(500),
            start: z.string().describe("A date (2026-11-25) for an all-day event, or a time with its offset (2026-11-25T15:00:00-05:00)."),
            end: z.string().optional().describe("As the calendar gives it. For an all-day event that is the day after its last day."),
            location: z.string().max(500).optional(),
            description: z.string().max(1000).optional().describe("A short description. Leave out long text, links to calls and boilerplate."),
            url: z.string().max(1000).optional().describe("The link that opens the event in the calendar."),
            cancelled: z.boolean().optional().describe("True when the calendar lists the event as cancelled."),
          }),
        )
        .max(100),
      more: z.boolean().optional().describe("True when more events from the same stretch follow in another call."),
    },
    kind: "write",
    idempotent: true,
  },
  ingest_objects: {
    title: "Ingest objects",
    description:
      "For an ingestion pass over mail or messages. Makes records from what was read: a task, an event, a person, or something to remember. Each item names the thing it came from by externalId, with a one or two line summary and a link back; never the original's text. The same thing sent again makes nothing, even if the owner has since changed or undone what it made. Up to 50 items a call. Each item's outcome comes back: created, updated, already, undone or refused.",
    input: {
      runId: z.string(),
      source: z.enum(INGEST_SOURCES),
      items: z
        .array(
          z
            .object({
              kind: z.enum(["task", "event", "person", "knowledge"]),
              externalId: z.string().max(300).describe("The id of the email, message or thread in its source."),
              part: z.string().max(40).optional().describe("Tells apart two records of one kind made from the same thing."),
              url: z.string().max(1000).optional().describe("A link back to the original."),
              at: z.string().optional().describe("When the original was sent, as an ISO time."),
              summary: z.string().max(600).describe("One or two lines: what the original says and why this was made."),
              title: z.string().max(300).optional().describe("For a task, an event or knowledge. A task's title starts with a verb."),
              description: z.string().max(2000).optional().describe("For a task or an event."),
              dueAt: z.string().optional().describe("For a task with a real deadline. A date like 2026-11-25."),
              project: z.string().optional().describe("For a task: the slug of the project it belongs to."),
              waitingOn: z.string().max(300).optional().describe("For a task the owner is waiting on someone for."),
              startAt: z.string().optional().describe("For an event. A date, a local time or a full ISO time."),
              endAt: z.string().optional().describe("For an event."),
              allDay: z.boolean().optional().describe("For an event."),
              location: z.string().max(500).optional().describe("For an event."),
              name: z.string().max(200).optional().describe("For a person: their full name."),
              emails: z.array(z.string().max(320)).max(10).optional().describe("For a person."),
              phoneNumbers: z.array(z.string().max(40)).max(10).optional().describe("For a person."),
              company: z.string().max(200).optional().describe("For a person."),
              roleTitle: z.string().max(200).optional().describe("For a person."),
              relationshipContext: z.string().max(1000).optional().describe("For a person: how the owner knows them."),
              knowledgeKind: z.enum(KNOWLEDGE_KINDS).optional().describe('For knowledge. Usually "memory".'),
              body: z.string().max(4000).optional().describe("For knowledge: the fact or note, in your own words."),
              linkUrl: z.string().max(2000).optional().describe('For knowledge of kind "link".'),
            })
            .describe("Fill the fields for its kind and leave the rest out."),
        )
        .min(1)
        .max(50),
    },
    kind: "write",
    idempotent: true,
  },
  propose_promotion: {
    title: "Propose promotion",
    description:
      "Only inside a chat in the owner's Skippy OS dashboard, where your instructions give you a chatId. Offers the owner a record to create, shown as a card under your reply that they can edit, accept or ignore. Nothing is created until they accept. Use it whenever something in the conversation should become a task, an event, a project, a note, a person or a recurrence, rather than creating the record yourself. Fill the draft's fields for its kind and leave the rest out.",
    input: {
      chatId: z.string().describe("The id of the dashboard chat you are answering in, from your instructions."),
      kind: z.enum(["task", "event", "project", "note", "person", "recurrence"]),
      draft: z
        .object({
          title: z.string().max(300).optional().describe("For everything but a person. A task's title starts with a verb."),
          description: z.string().max(2000).optional().describe("For a task, an event or a recurrence."),
          dueAt: z.string().optional().describe("For a task with a real deadline: a date like 2026-11-25."),
          project: z.string().optional().describe("For a task: the slug of an existing project it belongs to. Leave out for a task of a project offered in this same chat; it joins that project when the owner accepts both."),
          startAt: z.string().optional().describe("For an event: a date, or a local time like 2026-11-25T15:00."),
          endAt: z.string().optional().describe("For an event."),
          location: z.string().max(500).optional().describe("For an event."),
          summary: z.string().max(1000).optional().describe("For a project: one or two sentences on what it is."),
          notes: z.string().max(6000).optional().describe("For a project: the idea as worked out in this chat, to seed the project's notes."),
          body: z.string().max(6000).optional().describe("For a note."),
          name: z.string().max(200).optional().describe("For a person."),
          email: z.string().max(320).optional().describe("For a person."),
          phone: z.string().max(40).optional().describe("For a person."),
          company: z.string().max(200).optional().describe("For a person."),
          rule: z
            .union([
              z.object({ kind: z.literal("interval"), everyDays: z.number().int().min(1).max(3660) }),
              z.object({ kind: z.literal("calendar"), rrule: z.string().max(200) }),
            ])
            .optional()
            .describe("For a recurrence: every N days, or an RRULE such as FREQ=MONTHLY;BYMONTHDAY=1."),
          nextDue: z.string().optional().describe("For a recurrence: the day it first falls due."),
        })
        .describe("What the card would create."),
    },
    kind: "write",
    idempotent: true,
  },
  record_briefing: {
    title: "Record briefing",
    description:
      "Saves the owner's briefing for a day. The first ingestion pass of the day writes it, and every later pass rewrites it from what get_importance_rubric returns as `briefing`, so it stays current. For the daily briefing: up to two sections, **Since yesterday** and **Worth knowing**, each a bold label on its own line followed by lines that start with a hyphen and a space, about 80 words at most, no # headings, links or tables; it says what moved and what is worth knowing, and does not repeat the Today list shown under it. Anything the owner has to act on goes to flag_for_owner instead. The weekly review follows its own skill. Writing a day's briefing again replaces it. The first save of today's sends the owner one notification; rewrites send none.",
    input: {
      text: z.string().trim().min(1).max(6000).describe("The note, written to the owner."),
      date: z.string().optional().describe("The day it is for, like 2026-11-25. Defaults to today."),
      runId: z.string().optional().describe("The ingestion run that wrote it, when one did."),
      kind: z.enum(["weekly"]).optional().describe('Pass "weekly" only when saving the weekly review. Leave out for the daily briefing.'),
    },
    kind: "write",
    idempotent: true,
  },
  flag_for_owner: {
    title: "Flag for the owner",
    description:
      "Puts something at the top of the owner's Home, under \"Needs you\": a thing to decide, answer or do soon that they would otherwise miss, such as two meetings at the same time, a check-in that has opened, or an email that asks them a question. Not every task: Home lists tasks already, so flag a task only when something makes it pressing that its row does not show, and pass it as `about`. Give `sources` so the owner can open the email or calendar event in one tap. Calling again with the same `key` updates the flag; `status: \"done\"` closes it once it is handled. It also stops showing after `until`, or once the record it is about is finished. get_importance_rubric lists the open ones. A flag the owner closed stays closed.",
    input: {
      key: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .describe('Your own stable name for it, such as "clash-2026-11-30-design-review" or "checkin-hotel-2026-11-25". The same key updates the same flag.'),
      title: z.string().trim().max(160).optional().describe("What needs doing, as one short line starting with a verb. Required when raising a new one."),
      detail: clearable(z.string().max(500)).describe("Why, in a sentence, when the title does not say it."),
      about: clearable(record("The record it concerns, such as the event or the task.")),
      sources: list(
        z
          .array(
            z.object({
              system: z.string().describe('Where it came from: "gmail", "google_calendar", "imessage", "web"…'),
              url: z.string().optional().describe("The link that opens it, such as the email's or the calendar event's."),
              threadId: z.string().optional().describe("For mail without a link: the Gmail thread id."),
              messageId: z.string().optional(),
            }),
          )
          .max(5),
      )
        .optional()
        .describe("Where it came from, so Home can link to it. The record in `about` adds its own links."),
      until: clearable(when("When it stops mattering; it stops showing then.")),
      status: z.enum(["open", "done", "dismissed"]).optional().describe('"done" once it has been handled, "dismissed" if it turned out not to matter. Leave out to raise or update.'),
    },
    kind: "write",
    idempotent: true,
  },
  list_goals: {
    title: "List goals",
    description: "Lists the owner's goals that are not abandoned, live ones first: what each is, when it is for, and its status.",
    input: {},
    kind: "read",
  },
  get_today: {
    title: "Today",
    description:
      "Shows what needs attention on a day: that day's events, recurring things that are due or coming up, overdue tasks, tasks due that day, tasks planned for that day or earlier and still open, and tasks waiting on someone.",
    input: { date: z.string().optional().describe("A date like 2026-11-25. Defaults to today in the owner's time zone.") },
    kind: "read",
  },
  get_agenda: {
    title: "Agenda",
    description:
      "Shows what is on over a run of days: events, recurring things falling due, and tasks with a deadline or a planned day in it. Use it to see what is coming, to find an event's or a recurrence's id, or to check for a clash before adding an event.",
    input: {
      from: z.string().optional().describe("The first day, like 2026-11-25. Defaults to today in the owner's time zone."),
      days: z.number().int().min(1).max(120).optional().describe("How many days to cover. Defaults to 14."),
    },
    kind: "read",
  },
  upsert_event: {
    title: "Create or update event",
    description:
      "Adds an event to the owner's Skippy calendar, or changes one when `id` is given: an appointment, a trip, a call, anything with a time. A start given as a bare date makes an all-day event. To call an event off, set status to \"cancelled\". Events copied from the owner's Google calendar are changed there; here only their project and links can be set. Use get_agenda first so the same event is not added twice.",
    input: {
      id: z.string().optional().describe("The event to change."),
      title: z.string().max(300).optional().describe("Required for a new event."),
      startAt: when("When it starts. Required for a new event.").optional(),
      endAt: clearable(when("When it ends.")),
      allDay: z.boolean().optional().describe("Defaults to true when startAt is a bare date."),
      location: clearable(z.string().max(500)).describe('Where it is, with the address when known. The app links it to Google Maps. For travel write "From → To", such as "Home → City Airport"; Home means the owner\'s home address.'),
      description: clearable(z.string().max(4000)),
      status: z.enum(["confirmed", "cancelled"]).optional(),
      project: clearable(projectSlug),
      about: z
        .array(record("A person, project or other record this event concerns."))
        .max(10)
        .optional()
        .describe("Links the event to these records."),
    },
    kind: "write",
    idempotent: true,
  },
  upsert_recurrence: {
    title: "Create or update recurrence",
    description:
      "Adds something that comes round again (a bill, a filter change, a check-in with someone), or changes one when `id` is given. The rule is either every N days, or a calendar rule written as an RRULE using FREQ (DAILY, WEEKLY, MONTHLY, YEARLY), INTERVAL, BYDAY (with WEEKLY), BYMONTHDAY and BYMONTH: for example FREQ=MONTHLY;BYMONTHDAY=22. To stop one, set status to \"paused\" or \"retired\".",
    input: {
      id: z.string().optional().describe("The recurrence to change."),
      title: z.string().max(300).optional().describe("Required for a new recurrence. Starts with a verb, like a task."),
      description: clearable(z.string().max(4000)),
      rule: z
        .union([
          z.object({ kind: z.literal("interval"), everyDays: z.number().int().min(1).max(3660) }),
          z.object({ kind: z.literal("calendar"), rrule: z.string().max(200) }),
        ])
        .optional()
        .describe("Required for a new recurrence."),
      anchor: z
        .enum(["schedule", "completion"])
        .optional()
        .describe('"schedule": the next one is counted from the day this one was due (a bill). "completion": from the day it was done (a filter change). Defaults to schedule for a calendar rule and completion for an interval.'),
      leadTimeDays: clearable(z.number().int().min(0).max(365)).describe("How many days before it is due it starts to show under Today."),
      status: z.enum(["active", "paused", "retired"]).optional(),
      nextDue: z.string().optional().describe("The day it next falls due, like 2026-12-01. Defaults to the rule's next day."),
      area: clearable(z.string().max(60)).describe('The area of life it belongs to, by name, such as "Household". A name that is not on the owner\'s list is refused, and the refusal lists the names.'),
    },
    kind: "write",
    idempotent: true,
  },
  complete_recurrence: {
    title: "Complete recurrence",
    description:
      "Marks one round of a recurrence done and moves it to its next day. Pass the `nextDue` day you read as `due`: if the recurrence has already moved on from that day, nothing changes, so the same round is never counted twice. Pass skip: true when this round was not done and will not be.",
    input: {
      id: z.string().describe("The recurrence's id, from get_today or get_agenda."),
      due: z.string().describe("The round being completed: the recurrence's nextDue day, like 2026-11-22."),
      skip: z.boolean().optional().describe("True to pass over this round without counting it as done."),
      note: z.string().max(300).optional().describe("Anything worth saying about this round."),
    },
    kind: "write",
    idempotent: true,
  },
  get_changes_since: {
    title: "Changes since",
    description:
      "Lists what changed in Skippy after a point in time, oldest first: who made each change, what it was, and the record it touched. Use it to catch up on what the owner or another agent did.",
    input: {
      since: when("Only changes after this."),
      limit: z.number().int().min(1).max(500).optional().describe("How many to return. Defaults to 100."),
    },
    kind: "read",
  },
};
