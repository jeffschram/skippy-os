/**
 * The kinds of record that can be pointed at, linked together and found by
 * search. Convex and the MCP tools both read these lists.
 */
export const ENTITY_TYPES = [
  "project",
  "phase",
  "task",
  "goal",
  "area",
  "person",
  "company",
  "knowledge",
  "event",
  "recurrence",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Where ingestion reads from. */
export const INGEST_SOURCES = ["google_calendar", "gmail", "imessage"] as const;
export type IngestSource = (typeof INGEST_SOURCES)[number];

/** The kinds that search covers. */
export const SEARCHABLE_TYPES = ["project", "task", "person", "company", "knowledge", "event", "recurrence"] as const;
export type SearchableType = (typeof SEARCHABLE_TYPES)[number];

export const KNOWLEDGE_KINDS = ["note", "link", "memory", "decision", "principle", "question"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/** How two records can be related. Read as "from <relation> to". */
export const RELATIONS = [
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
] as const;
export type Relation = (typeof RELATIONS)[number];
