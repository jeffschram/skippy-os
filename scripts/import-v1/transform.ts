/**
 * Decides what comes across from a snapshot of the old project, and reshapes
 * it for the new schema (spec §10). Pure: it reads nothing and writes nothing,
 * so the dry run and the real run work from exactly the same decisions.
 *
 * Records keep their old ids here. `convex/importV1.ts` turns them into new
 * ones as it loads them.
 */

/** A table from the snapshot: one object per document, as exported. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OldDoc = Record<string, any>;
export type Snapshot = Record<string, OldDoc[]>;

export type OldRef = { table: string; id: string };

/** The batches, in the order they must be loaded: a record is loaded after everything it points at. */
export const LOAD_ORDER = [
  "areas",
  "goals",
  "projects",
  "phases",
  "tasks",
  "people",
  "companies",
  "knowledge",
  "sources",
  "attachments",
  "links",
] as const;
export type BatchName = (typeof LOAD_ORDER)[number];

export type Batches = Record<BatchName, Record<string, unknown>[]>;

/** What the plan does with one old table. The parts always add up to `exported`. */
export type TableReport = {
  exported: number;
  toImport: number;
  /** Planned for import, but its table does not exist yet. Reason → count. */
  deferred: Record<string, number>;
  /** Not coming across. Reason → count. */
  skipped: Record<string, number>;
};

export type Plan = {
  batches: Batches;
  /** One entry for every table in the snapshot. */
  report: Record<string, TableReport>;
  /** Things worth knowing that are not a skip, such as fields left behind. Note → count. */
  notes: Record<string, number>;
};

const PROJECT_STATUS: Record<string, string> = {
  idea: "idea",
  planned: "idea",
  in_progress: "active",
  active: "active",
  paused: "paused",
  completed: "completed",
  done: "completed",
  cancelled: "archived",
  archived: "archived",
};
const TASK_STATUS = new Set(["todo", "in_progress", "waiting", "done", "cancelled"]);
const GOAL_STATUS = new Set(["active", "paused", "achieved", "abandoned"]);
const COMPANY_LABELS = new Set(["client", "vendor", "employer", "partner", "prospect", "other"]);
const READ_STATES = new Set(["saved", "unread", "read"]);
const SOURCE_LINKS = new Set(["created_from", "updated_from", "mentioned_in", "evidence_for"]);
const RELATIONS = new Set([
  "belongs_to",
  "supports",
  "related_to",
  "mentions",
  "assigned_to",
  "works_at",
  "client_of",
  "depends_on",
  "blocked_by",
  "waiting_on",
  "follow_up_with",
  "spawned_from",
]);

/** Which old table an old entity type lives in. Notes, memories and links were one table. */
const ENTITY_TABLES: Record<string, string> = {
  project: "projects",
  task: "tasks",
  person: "people",
  company: "companies",
  goal: "goals",
  note: "knowledge",
  memory: "knowledge",
  link: "knowledge",
  knowledge: "knowledge",
};

/** Old tables the new system has no place for, and why. */
const LEFT_BEHIND: Record<string, string> = {
  activityEvents: "the old activity log is not carried over",
  agentApprovals: "agent runs are not carried over",
  agentConfigs: "agent runs are not carried over",
  agentHosts: "agent runs are not carried over",
  agentRunEvents: "agent runs are not carried over",
  agentRuns: "agent runs are not carried over",
  aiProcessingRuns: "runtime state",
  brainConfigs: "settings of the old app",
  brainInstances: "settings of the old app",
  chatMessages: "old chats are not carried over",
  chatTurnEvents: "old chats are not carried over",
  chatTurns: "old chats are not carried over",
  connectors: "settings of the old app",
  entityEmbeddings: "rebuilt when search by meaning is added",
  financialAccounts: "finance is out of scope",
  financialBudgets: "finance is out of scope",
  financialDailyBalances: "finance is out of scope",
  financialDebts: "finance is out of scope",
  financialTransactions: "finance is out of scope",
  focusItemActions: "the focus feature is retired",
  focusSummaries: "the focus feature is retired",
  harnessSkills: "settings of the old app",
  ingestionReceipts: "ingestion starts fresh in Phase 5",
  ingestionRuns: "ingestion starts fresh in Phase 5",
  ingestionWindowHistory: "ingestion starts fresh in Phase 5",
  interviewResponses: "the interview feature is retired",
  interviews: "the interview feature is retired",
  maintenanceJobs: "runtime state",
  mcpBridgeNonces: "runtime state",
  mcpTokens: "the old MCP's tokens are not reused",
  nativeSkills: "settings of the old app",
  notificationDeliveries: "runtime state",
  occurrenceActions: "runtime state",
  operatingRules: "settings of the old app",
  pendingActions: "runtime state",
  pluginCatalogs: "settings of the old app",
  pluginCommands: "settings of the old app",
  projectChats: "old chats are not carried over",
  projectExecutionConfigs: "agent runs are not carried over",
  projectPlans: "agent runs are not carried over",
  pushSubscriptions: "runtime state",
  quickCaptures: "already handled or discarded in the old app",
  reviewQueueMigrations: "runtime state",
  sourceSyncStatuses: "ingestion starts fresh in Phase 5",
  triageItems: "the triage feature is retired",
  userProfileMemories: "empty in the old app",
  users: "the new app has one owner, set in its settings",
  viewerContext: "runtime state",
};

const PHASE_4 = "waits for its table in Phase 4";

const text = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};
const time = (value: unknown): number | undefined => (typeof value === "number" ? Math.round(value) : undefined);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Leaves out keys whose value is undefined, so the loaders' validators see only what is there. */
function compact<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function stamps(doc: OldDoc) {
  const createdAt = time(doc.createdAt) ?? time(doc._creationTime) ?? 0;
  return { createdAt, updatedAt: time(doc.updatedAt) ?? createdAt };
}

export function transform(snapshot: Snapshot): Plan {
  const table = (name: string): OldDoc[] => snapshot[name] ?? [];
  const report: Record<string, TableReport> = {};
  const notes: Record<string, number> = {};
  const note = (what: string, count = 1) => {
    if (count > 0) notes[what] = (notes[what] ?? 0) + count;
  };
  const entry = (name: string): TableReport =>
    (report[name] ??= { exported: table(name).length, toImport: 0, deferred: {}, skipped: {} });
  const skip = (name: string, reason: string) => {
    const row = entry(name);
    row.skipped[reason] = (row.skipped[reason] ?? 0) + 1;
  };
  const defer = (name: string, reason: string) => {
    const row = entry(name);
    row.deferred[reason] = (row.deferred[reason] ?? 0) + 1;
  };
  const keep = (name: string) => {
    entry(name).toImport++;
  };

  const batches = Object.fromEntries(LOAD_ORDER.map((name) => [name, []])) as unknown as Batches;

  // Projects: code projects stay behind, and take their phases, tasks and files with them.
  const codeProjects = new Set<string>();
  const keptProjects = new Set<string>();
  for (const project of table("projects")) {
    if (project.kind === "code") codeProjects.add(project._id);
    else keptProjects.add(project._id);
  }

  // A project's goal was a "supports" link in the old data. The new project record names it directly.
  const goalOf = new Map<string, string>();
  for (const link of table("relationships")) {
    if (link.type === "supports" && link.from?.entityType === "project" && link.to?.entityType === "goal") {
      if (!goalOf.has(link.from.entityId)) goalOf.set(link.from.entityId, link.to.entityId);
    }
  }

  for (const goal of table("goals")) {
    keep("goals");
    if (!GOAL_STATUS.has(goal.status)) note(`goal status "${goal.status}" became "active"`);
    batches.goals.push(
      compact({
        oldId: goal._id,
        title: text(goal.title) ?? "Untitled goal",
        description: text(goal.description),
        status: GOAL_STATUS.has(goal.status) ? goal.status : "active",
        ...stamps(goal),
      }),
    );
  }

  for (const project of table("projects")) {
    if (codeProjects.has(project._id)) {
      skip("projects", "a code project, recreated from its folder instead");
      continue;
    }
    keep("projects");
    const status = PROJECT_STATUS[project.status];
    if (!status) note(`project status "${project.status}" became "archived"`);
    batches.projects.push(
      compact({
        oldId: project._id,
        title: text(project.title) ?? "Untitled project",
        summary: text(project.summary),
        status: status ?? "archived",
        notesPad: typeof project.notesPad === "string" ? project.notesPad : "",
        goalOldId: goalOf.get(project._id),
        ...stamps(project),
      }),
    );
  }

  const phaseProject = new Map<string, string>();
  for (const phase of table("phases")) {
    phaseProject.set(phase._id, phase.projectId);
    if (!keptProjects.has(phase.projectId)) {
      skip("phases", codeProjects.has(phase.projectId) ? "in a code project" : "its project is missing");
      continue;
    }
    keep("phases");
    batches.phases.push(
      compact({
        oldId: phase._id,
        projectOldId: phase.projectId,
        order: typeof phase.orderNum === "number" ? phase.orderNum : 0,
        title: text(phase.title) ?? "Untitled phase",
        description: text(phase.descriptionMd),
        ...stamps(phase),
      }),
    );
  }

  // The old tasks table had no project field. A task's project is its "belongs_to" link, or its phase's project.
  const taskProjects = new Map<string, Set<string>>();
  for (const link of table("relationships")) {
    if (link.type === "belongs_to" && link.from?.entityType === "task" && link.to?.entityType === "project") {
      const set = taskProjects.get(link.from.entityId) ?? new Set<string>();
      set.add(link.to.entityId);
      taskProjects.set(link.from.entityId, set);
    }
  }
  const keptTasks = new Set<string>();
  const areaNames = new Map<string, OldDoc>();
  for (const task of table("tasks")) {
    const projects = new Set(taskProjects.get(task._id) ?? []);
    const phaseOwner = task.phaseId ? phaseProject.get(task.phaseId) : undefined;
    if (phaseOwner) projects.add(phaseOwner);
    if ([...projects].some((id) => codeProjects.has(id))) {
      skip("tasks", "in a code project");
      continue;
    }
    const home = [...projects].find((id) => keptProjects.has(id));
    if (projects.size > 0 && !home) {
      skip("tasks", "its project is missing");
      continue;
    }
    keep("tasks");
    keptTasks.add(task._id);
    if (!TASK_STATUS.has(task.status)) note(`task status "${task.status}" became "todo"`);
    const area = text(task.area)?.toLowerCase();
    if (area && !areaNames.has(area)) areaNames.set(area, task);
    for (const field of ["resultSummary", "acceptanceCriteria", "executionBrief", "resultUrl"]) {
      const value = task[field];
      if (Array.isArray(value) ? value.length > 0 : text(value)) note(`tasks: agent field "${field}" left behind`);
    }
    batches.tasks.push(
      compact({
        oldId: task._id,
        title: text(task.title) ?? "Untitled task",
        description: text(task.description),
        status: TASK_STATUS.has(task.status) ? task.status : "todo",
        projectOldId: home,
        phaseOldId: task.phaseId && phaseOwner && phaseOwner === home ? task.phaseId : undefined,
        areaOldId: area,
        commitment: task.commitment === "must" || task.commitment === "want" ? task.commitment : undefined,
        dueAt: time(task.dueAt),
        completedAt: time(task.completedAt),
        ...stamps(task),
      }),
    );
  }
  // Areas were a word on each task. They become records, one per word.
  for (const [name, firstTask] of [...areaNames].sort(([a], [b]) => a.localeCompare(b))) {
    batches.areas.push({ oldId: name, name: titleCase(name), ...stamps(firstTask) });
  }
  note("areas made from the area word on tasks", batches.areas.length);

  for (const person of table("people")) {
    keep("people");
    const emails = strings(person.emails);
    const phoneNumbers = strings(person.phoneNumbers);
    if (emails.length === 0 && phoneNumbers.length === 0) note("people with no email or phone number, matched by name only");
    batches.people.push(
      compact({
        oldId: person._id,
        name: text(person.name) ?? "Unnamed",
        emails,
        phoneNumbers,
        roleTitle: text(person.roleTitle),
        relationshipContext: text(person.relationshipContext),
        notes: text(person.notes),
        favorite: person.favorite === true ? true : undefined,
        ...stamps(person),
      }),
    );
  }

  for (const company of table("companies")) {
    keep("companies");
    batches.companies.push(
      compact({
        oldId: company._id,
        name: text(company.name) ?? "Unnamed",
        website: text(company.website),
        relationshipLabel: COMPANY_LABELS.has(company.relationshipLabel) ? company.relationshipLabel : undefined,
        notes: text(company.notes),
        ...stamps(company),
      }),
    );
  }

  const keptKnowledge = new Set<string>();
  for (const item of table("knowledge")) {
    if (item.rejectedAt || item.status === "rejected" || item.reviewState === "rejected") {
      skip("knowledge", "rejected in the old app");
      continue;
    }
    keep("knowledge");
    keptKnowledge.add(item._id);
    const kind =
      item.kind === "memory"
        ? ["decision", "principle", "question"].includes(item.memoryType)
          ? item.memoryType
          : "memory"
        : item.kind === "link"
          ? "link"
          : "note";
    const archived = Boolean(item.archivedAt) || item.status === "archived" || item.status === "discarded";
    if (archived) note("knowledge archived or discarded in the old app, imported as archived");
    batches.knowledge.push(
      compact({
        oldId: item._id,
        kind,
        title: text(item.title),
        body: text(item.body),
        summary: text(item.summary),
        url: kind === "link" ? text(item.url) : undefined,
        readState: kind === "link" ? (READ_STATES.has(item.status) ? item.status : "saved") : undefined,
        lifecycle: archived ? "archived" : "active",
        whyItMatters: text(item.captureReason),
        ...stamps(item),
      }),
    );
  }

  const kept: Record<string, Set<string>> = {
    projects: keptProjects,
    tasks: keptTasks,
    knowledge: keptKnowledge,
    people: new Set(table("people").map((doc) => doc._id)),
    companies: new Set(table("companies").map((doc) => doc._id)),
    goals: new Set(table("goals").map((doc) => doc._id)),
  };
  /** The old record an old pointer names, or undefined when that record is not coming across. */
  const follow = (ref: { entityType?: string; entityId?: string } | undefined): OldRef | undefined => {
    const name = ref?.entityType ? ENTITY_TABLES[ref.entityType] : undefined;
    if (!name || !ref?.entityId || !kept[name]?.has(ref.entityId)) return undefined;
    return { table: name, id: ref.entityId };
  };

  // Sources come across only where something that came across uses them.
  const usedSources = new Set<string>();
  const attached = new Set<string>();
  const attach = (oldId: string, entity: OldRef, sourceOldId: string, relationship: string) => {
    const key = `${entity.id}|${sourceOldId}`;
    if (attached.has(key)) return false;
    attached.add(key);
    usedSources.add(sourceOldId);
    batches.attachments.push({ oldId, entity, sourceOldId, relationship });
    return true;
  };
  const sourceIds = new Set(table("sourceRefs").map((doc) => doc._id));
  for (const row of table("entitySourceRefs")) {
    const entity = follow(row.entityRef);
    if (!entity) {
      skip("entitySourceRefs", "on a record that was not imported");
      continue;
    }
    if (!sourceIds.has(row.sourceRefId)) {
      skip("entitySourceRefs", "its source is missing");
      continue;
    }
    if (attach(row._id, entity, row.sourceRefId, SOURCE_LINKS.has(row.relationship) ? row.relationship : "evidence_for")) {
      keep("entitySourceRefs");
    } else {
      skip("entitySourceRefs", "the same source attached to the same record twice");
    }
  }
  // Knowledge also listed its sources on the record itself. Any not already attached are attached here.
  for (const item of table("knowledge")) {
    if (!keptKnowledge.has(item._id)) continue;
    for (const sourceId of strings(item.sourceRefIds)) {
      if (!sourceIds.has(sourceId)) continue;
      if (attach(`${item._id}|${sourceId}`, { table: "knowledge", id: item._id }, sourceId, "created_from")) {
        note("sources listed on a knowledge record only, attached as well");
      }
    }
  }
  for (const source of table("sourceRefs")) {
    if (!usedSources.has(source._id)) {
      skip("sourceRefs", "only used by records that were not imported");
      continue;
    }
    keep("sourceRefs");
    batches.sources.push(
      compact({
        oldId: source._id,
        sourceSystem: text(source.sourceSystem) ?? "unknown",
        externalId: text(source.externalId),
        threadId: text(source.threadId),
        messageId: text(source.messageId),
        eventId: text(source.eventId),
        sourceTimestamp: time(source.sourceTimestamp),
        participants: Array.isArray(source.participants) ? strings(source.participants) : undefined,
        url: text(source.url),
        deepLink: text(source.deepLink),
        excerpt: text(source.excerpt)?.slice(0, 1000),
        summary: text(source.summary)?.slice(0, 1000),
        createdAt: stamps(source).createdAt,
      }),
    );
  }

  for (const link of table("relationships")) {
    // "A unblocks B" is the new schema's "B is blocked by A".
    const flipped = link.type === "unblocks";
    const type = flipped ? "blocked_by" : link.type;
    if (!RELATIONS.has(type)) {
      skip("relationships", `a link type the new system does not have ("${link.type}")`);
      continue;
    }
    const from = follow(flipped ? link.to : link.from);
    const to = follow(flipped ? link.from : link.to);
    if (!from || !to) {
      skip("relationships", "touches a record that was not imported");
      continue;
    }
    if (flipped) note('links of type "unblocks" turned round into "blocked_by"');
    keep("relationships");
    batches.links.push(
      compact({
        oldId: link._id,
        from,
        to,
        type,
        confidence: typeof link.confidence === "number" ? link.confidence : undefined,
        reason: text(link.reason),
        createdAt: stamps(link).createdAt,
      }),
    );
  }

  // Planned for import, but their tables arrive in Phase 4.
  for (let n = table("recurrences").length; n > 0; n--) defer("recurrences", PHASE_4);
  for (const event of table("calendarEvents")) {
    if (event.origin === "skippy") defer("calendarEvents", PHASE_4);
    else skip("calendarEvents", "synced again from Google");
  }
  for (const file of table("projectFiles")) {
    if (codeProjects.has(file.projectId)) skip("projectFiles", "in a code project");
    else if (!keptProjects.has(file.projectId)) skip("projectFiles", "its project is missing");
    else if (file.deletedAt || file.status === "deleted") skip("projectFiles", "deleted in the old app");
    else defer("projectFiles", PHASE_4);
  }
  for (const snapshotNote of table("projectNoteSnapshots")) {
    if (keptProjects.has(snapshotNote.projectId)) defer("projectNoteSnapshots", PHASE_4);
    else skip("projectNoteSnapshots", "in a code project");
  }

  // Every other table is accounted for too, so the counts cover the whole snapshot.
  for (const name of Object.keys(snapshot)) {
    if (report[name]) continue;
    const row = entry(name);
    if (row.exported > 0) row.skipped[LEFT_BEHIND[name] ?? "not part of the import plan"] = row.exported;
  }

  return { batches, report, notes };
}

/** The tables whose parts do not add up to what was exported. Empty when the plan is sound. */
export function unbalanced(report: Record<string, TableReport>): string[] {
  const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, count) => total + count, 0);
  return Object.entries(report)
    .filter(([, row]) => row.toImport + sum(row.deferred) + sum(row.skipped) !== row.exported)
    .map(([name]) => name);
}
