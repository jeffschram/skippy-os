import { AGENT_SURFACES, type OperationName } from "@skippy/shared";
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
