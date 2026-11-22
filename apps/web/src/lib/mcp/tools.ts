import {
  AGENT_SURFACES,
  ENTITY_TYPES,
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
      "Shows which Skippy owner and client this connection acts as, the scopes it was granted, and the five most recent test captures.",
    input: {},
    kind: "read",
  },
  capture: {
    title: "Capture",
    description: "Saves a short note to Skippy. Use it for a thought, a link or a reminder worth keeping.",
    input: { text: z.string().trim().min(1).max(4000).describe("The note to save, in plain text.") },
    kind: "write",
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
      "Reads one project in full: its details and notes, phases, open tasks, recently closed tasks and the last five status reports.",
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
      kind: z.enum(["code", "general"]).optional().describe('"code" for a software project, otherwise "general".'),
      status: projectStatus.optional().describe('Defaults to "active" for a new project.'),
      health: clearable(projectHealth),
      claudeHome: clearable(claudeHome).describe("Where the work happens in Claude."),
      targetDate: clearable(when("When the project should be finished.")),
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
      phaseId: clearable(z.string()).describe("A phase of the same project, from get_project."),
      commitment: clearable(z.enum(["must", "want"])).describe('"must" when it has to happen, "want" when it is optional.'),
      dueAt: clearable(when("The deadline.")),
      scheduledFor: clearable(when("When the owner plans to do it.")),
      waitingOn: clearable(z.string().max(300)).describe("Who or what the task is waiting on."),
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
      "Adds a person to the owner's address book, or updates one. Without an id, a person is found by any email or phone number given; if one matches, that person is updated and their name is left as it is. Emails and phone numbers are added to what is on file, never replaced. Pass only the fields that change, and null to clear an optional field. Search first when you only have a name.",
    input: {
      id: z.string().optional().describe("The id of the person to update."),
      name: z.string().max(200).optional().describe("Their full name. Required for a new person."),
      emails: z.array(z.string().max(320)).max(20).optional().describe("Email addresses to add."),
      phoneNumbers: z.array(z.string().max(40)).max(20).optional().describe("Phone numbers to add."),
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
      "Finds projects, tasks, people, companies and saved knowledge by the words in them, best match first. Each result has a type and an id; pass them to get_context_bundle to read the record in full. Search matches words, not meaning, so try the plainest words that would appear in the record.",
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
  get_today: {
    title: "Today",
    description:
      "Shows what needs attention on a day: overdue tasks, tasks due that day, tasks planned for that day or earlier and still open, and tasks waiting on someone.",
    input: { date: z.string().optional().describe("A date like 2026-11-25. Defaults to today in the owner's time zone.") },
    kind: "read",
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
