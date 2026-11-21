/**
 * Who made a write. Every stored record carries one as `createdBy` and
 * `updatedBy`, and every activity event has one.
 *
 * The spec's first draft named the second kind "claude". The MCP is open to
 * any harness that signs in through OAuth, so it is "agent" with the harness
 * recorded, worked out from the OAuth client that made the call.
 */
export const AGENT_SURFACES = ["web_chat", "claude_project", "claude_code", "scheduled"] as const;
export type AgentSurface = (typeof AGENT_SURFACES)[number];

export const HARNESSES = ["claude", "chatgpt", "codex", "other"] as const;
export type Harness = (typeof HARNESSES)[number];

export type UserActor = { kind: "user" };
export type AgentActor = {
  kind: "agent";
  harness: Harness;
  /** The OAuth client id the call was made with. */
  clientId: string;
  /** Where in the harness the agent was working, when it said so. */
  surface?: AgentSurface;
  /** A pointer the agent gave to its own session or run. */
  ref?: string;
};
export type Actor = UserActor | AgentActor;

const HARNESS_HOSTS: Record<string, Harness> = {
  "claude.ai": "claude",
  "claude.com": "claude",
  "anthropic.com": "claude",
  "chatgpt.com": "chatgpt",
  "openai.com": "chatgpt",
};

/**
 * Which harness an OAuth client id belongs to. A client that registers itself
 * by CIMD uses a URL as its id, so the host says who it is. Anything else is
 * "other" until a real client shows what its id looks like.
 */
export function harnessForClient(clientId: string): Harness {
  let host: string;
  try {
    host = new URL(clientId).hostname.toLowerCase();
  } catch {
    return "other";
  }
  for (const [suffix, harness] of Object.entries(HARNESS_HOSTS)) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return harness;
  }
  return "other";
}

const HARNESS_LABELS: Record<Harness, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  codex: "Codex",
  other: "An agent",
};

/** A short name for an actor, for activity lists. */
export function actorLabel(actor: Actor): string {
  return actor.kind === "user" ? "You" : HARNESS_LABELS[actor.harness];
}
