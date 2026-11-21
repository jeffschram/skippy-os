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
  // Phase 0 test tools.
  whoami: { scope: SCOPE_READ },
  capture: { scope: SCOPE_WRITE },
  // Status.
  record_project_status: { scope: SCOPE_WRITE },
  get_project: { scope: SCOPE_READ },
  list_projects: { scope: SCOPE_READ },
  // Records.
  upsert_project: { scope: SCOPE_WRITE },
  create_phase: { scope: SCOPE_WRITE },
  upsert_task: { scope: SCOPE_WRITE },
  complete_task: { scope: SCOPE_WRITE },
  // Read.
  get_today: { scope: SCOPE_READ },
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
