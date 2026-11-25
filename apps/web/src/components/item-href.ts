/** The kinds of record that open in the details window (`?item=<type>:<id>`). */
export const ITEM_TYPES = ["knowledge", "person", "company", "goal", "event", "recurrence"] as const;

/** Where a chat opens: in a window over the page the owner is on. */
export function chatHref(id: string): string {
  return `?chat=${encodeURIComponent(id)}`;
}

/** Where a record opens: a project has its page, a task its own details, and the rest open in the details window. */
export function itemHref(type: string, id: string): string | undefined {
  if (type === "project") return `/projects/${id}`;
  if (type === "task") return `?task=${id}`;
  if ((ITEM_TYPES as readonly string[]).includes(type)) return `?item=${type}:${id}`;
  return undefined;
}
