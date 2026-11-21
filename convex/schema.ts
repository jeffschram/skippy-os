import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** The Phase 0 actor, kept only for the `captures` test table until Phase 4 reshapes it. */
export const phase0Actor = v.object({
  kind: v.literal("oauth"),
  /** The Clerk user id of the owner the client acted for. */
  subject: v.string(),
  /** The OAuth client that made the call, for example Claude or ChatGPT. */
  clientId: v.string(),
});

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
);

/** A pointer to any record, used by the activity log and, later, by relationships. */
export const entityRef = v.object({
  entityType: v.union(
    v.literal("project"),
    v.literal("phase"),
    v.literal("task"),
    v.literal("goal"),
    v.literal("area"),
  ),
  entityId: v.string(),
});

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

/** Carried by every record: who made it, who last changed it, and when. */
const authored = { createdBy: actor, updatedBy: actor, updatedAt: v.number() };

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
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("achieved"), v.literal("abandoned")),
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
    completedAt: v.optional(v.number()),
    ...authored,
  })
    .index("by_project", ["projectId"])
    .index("by_status", ["status"]),

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
    updatedAt: v.number(),
  }),

  // Phase 0 only. Phase 4 replaces it with the real captures table.
  captures: defineTable({
    text: v.string(),
    actor: phase0Actor,
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),

  // Nonces of gateway envelopes already used, kept until the envelope expires.
  gatewayNonces: defineTable({
    nonce: v.string(),
    expiresAt: v.number(),
  })
    .index("by_nonce", ["nonce"])
    .index("by_expiry", ["expiresAt"]),
});
