/** OAuth scopes the Skippy MCP understands. Each operation needs exactly one. */
export const SCOPE_READ = "skippy:read";
export const SCOPE_WRITE = "skippy:write";
export const SCOPES = [SCOPE_READ, SCOPE_WRITE] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * Every operation the MCP route may ask Convex to run, with the scope it needs.
 * The MCP route and the Convex gateway both read this table, so a tool cannot
 * reach Convex with a weaker scope than the one listed here.
 */
export const OPERATIONS = {
  whoami: { scope: SCOPE_READ },
  // The inbox.
  capture: { scope: SCOPE_WRITE },
  list_captures: { scope: SCOPE_READ },
  resolve_capture: { scope: SCOPE_WRITE },
  // Status.
  record_project_status: { scope: SCOPE_WRITE },
  get_project: { scope: SCOPE_READ },
  list_projects: { scope: SCOPE_READ },
  // Records.
  upsert_project: { scope: SCOPE_WRITE },
  create_phase: { scope: SCOPE_WRITE },
  update_phase: { scope: SCOPE_WRITE },
  upsert_task: { scope: SCOPE_WRITE },
  complete_task: { scope: SCOPE_WRITE },
  upsert_person: { scope: SCOPE_WRITE },
  upsert_knowledge: { scope: SCOPE_WRITE },
  link_entities: { scope: SCOPE_WRITE },
  upsert_event: { scope: SCOPE_WRITE },
  upsert_recurrence: { scope: SCOPE_WRITE },
  complete_recurrence: { scope: SCOPE_WRITE },
  // Ingestion: the scheduled pass over calendar, mail and messages.
  get_importance_rubric: { scope: SCOPE_READ },
  record_ingestion_run: { scope: SCOPE_WRITE },
  advance_source_cursor: { scope: SCOPE_WRITE },
  sync_calendar: { scope: SCOPE_WRITE },
  ingest_objects: { scope: SCOPE_WRITE },
  record_briefing: { scope: SCOPE_WRITE },
  // Dashboard chats.
  propose_promotion: { scope: SCOPE_WRITE },
  // Read.
  search: { scope: SCOPE_READ },
  get_context_bundle: { scope: SCOPE_READ },
  get_today: { scope: SCOPE_READ },
  get_agenda: { scope: SCOPE_READ },
  list_goals: { scope: SCOPE_READ },
  get_changes_since: { scope: SCOPE_READ },
} as const satisfies Record<string, { scope: Scope }>;

export type OperationName = keyof typeof OPERATIONS;

export function isOperationName(name: string): name is OperationName {
  return Object.hasOwn(OPERATIONS, name);
}

/** Whether `granted` allows `operation`. Write access never implies read access. */
export function scopesAllow(granted: readonly string[], operation: OperationName): boolean {
  return granted.includes(OPERATIONS[operation].scope);
}
