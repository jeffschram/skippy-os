import { normalizePhone, type Actor } from "@skippy/shared";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Ref } from "./entities";
import { ensureLink } from "./links";

/**
 * People named in other records. A task, an event, a note, a recurrence or a
 * project whose words name someone on file, by their full name, one of their
 * other names or one of their numbers, is linked to them as "mentions". It
 * happens on every write to such a record, and for every record already on
 * file when a person is added or gains a name or a number. A first name alone
 * is not enough, since several people can share one; those show on the
 * person's window under "Mentioned in" for the owner to link.
 */

/** Who makes the links. */
export const NAMING: Actor = { kind: "import", source: "names" };

/** The kinds of record that are linked to the people they name. */
const NAMING_TYPES = new Set<string>(["task", "event", "knowledge", "recurrence", "project"]);
export const namesPeople = (type: string) => NAMING_TYPES.has(type);

type Named = Pick<Doc<"people">, "name" | "aliases" | "phoneNumbers">;

/** A person's full name and their other names, each at least three letters. */
export function namesOf(person: Pick<Doc<"people">, "name" | "aliases">): string[] {
  const names = [person.name, ...(person.aliases ?? [])].map((name) => name.trim()).filter((name) => name.length >= 3);
  return [...new Map(names.map((name) => [name.toLowerCase(), name])).values()];
}

/** A person's first name, when it is not already one of their names. */
export function firstNameOf(person: Pick<Doc<"people">, "name" | "aliases">): string | undefined {
  const first = person.name.trim().split(/\s+/)[0];
  if (!first || first.length < 3 || /[^\p{L}'-]/u.test(first)) return undefined;
  return namesOf(person).some((name) => name.toLowerCase() === first.toLowerCase()) ? undefined : first;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where the words stand in the text as whole words, any case, or -1. */
export function findWords(text: string, words: string): number {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(words.trim()).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");
  return text.search(pattern);
}

const PHONE = /\+?\d[\d ().-]{5,}\d/g;

/** The phone numbers written in a text, in the form people's numbers are kept in. */
function phonesIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.match(PHONE) ?? []) {
    try {
      found.add(normalizePhone(match));
    } catch {
      // Not a phone number after all: a date, an order number.
    }
  }
  return found;
}

/** What in the text names the person: one of their names or numbers. Undefined when nothing does. */
export function nameIn(text: string, person: Named): string | undefined {
  for (const name of namesOf(person)) if (findWords(text, name) >= 0) return name;
  if (person.phoneNumbers.length === 0) return undefined;
  const phones = phonesIn(text);
  return person.phoneNumbers.find((phone) => phones.has(phone));
}

const personRef = (person: Doc<"people">): Ref => ({ entityType: "person", entityId: person._id });

/** Links a record to everyone its words name. Called with the record's searchable text on every write. */
export async function linkPeopleNamed(ctx: MutationCtx, ref: Ref, text: string): Promise<void> {
  if (!namesPeople(ref.entityType)) return;
  const at = Date.now();
  for (const person of await ctx.db.query("people").collect()) {
    const named = nameIn(text, person);
    if (named) await ensureLink(ctx, { from: ref, to: personRef(person), type: "mentions", actor: NAMING, at, reason: `Names ${named}` });
  }
}

/** The search words that find the records naming a person: their names, and the last four digits of each number. */
function searchTermsOf(person: Named): string[] {
  return [...namesOf(person), ...person.phoneNumbers.map((phone) => phone.slice(-4))];
}

/** Links every record on file that names the person. Called when a person is added or changes. */
export async function linkRecordsNaming(ctx: MutationCtx, person: Doc<"people">): Promise<void> {
  const at = Date.now();
  const seen = new Set<string>();
  for (const term of searchTermsOf(person)) {
    const docs = await ctx.db
      .query("searchDocs")
      .withSearchIndex("by_text", (q) => q.search("text", term))
      .take(200);
    for (const doc of docs) {
      if (seen.has(doc.entityId) || !namesPeople(doc.entityType)) continue;
      seen.add(doc.entityId);
      const named = nameIn(doc.text, person);
      if (!named) continue;
      await ensureLink(ctx, {
        from: { entityType: doc.entityType, entityId: doc.entityId },
        to: personRef(person),
        type: "mentions",
        actor: NAMING,
        at,
        reason: `Names ${named}`,
      });
    }
  }
}

/**
 * Records whose words name the person but are not linked to them, either way:
 * those that use their first name only, and any written before they were on
 * file under that name. At most `limit`, each with the name it uses and a few
 * words around it.
 */
export async function unlinkedMentionsOf(
  ctx: QueryCtx,
  person: Doc<"people">,
  limit = 50,
): Promise<{ type: string; entityId: string; named: string; excerpt: string }[]> {
  const linked = new Set<string>([person._id]);
  for (const row of await ctx.db.query("relationships").withIndex("by_from", (q) => q.eq("from.entityId", person._id)).take(500)) {
    linked.add(row.to.entityId);
  }
  for (const row of await ctx.db.query("relationships").withIndex("by_to", (q) => q.eq("to.entityId", person._id)).take(500)) {
    linked.add(row.from.entityId);
  }
  const first = firstNameOf(person);
  const found: { type: string; entityId: string; named: string; excerpt: string }[] = [];
  for (const term of [...searchTermsOf(person), ...(first ? [first] : [])]) {
    const docs = await ctx.db
      .query("searchDocs")
      .withSearchIndex("by_text", (q) => q.search("text", term))
      .take(200);
    for (const doc of docs) {
      if (found.length >= limit) return found;
      if (linked.has(doc.entityId) || !namesPeople(doc.entityType)) continue;
      const named = nameIn(doc.text, person) ?? (first && findWords(doc.text, first) >= 0 ? first : undefined);
      if (!named) continue;
      linked.add(doc.entityId);
      found.push({ type: doc.entityType, entityId: doc.entityId, named, excerpt: excerpt(doc.text, named) });
    }
  }
  return found;
}

/** About a line of text around where the name stands. */
function excerpt(text: string, named: string): string {
  const flat = text.replace(/\s+/g, " ");
  const at = Math.max(0, findWords(flat, named));
  const start = Math.max(0, at - 70);
  const end = Math.min(flat.length, at + named.length + 90);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}
