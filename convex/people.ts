import { IdentityError, normalizeEmail, normalizePhone, type Actor } from "@skippy/shared";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { buildPatch, cleanText, getSettings, iso, logActivity, refuse, requireText, showWhen, when } from "./lib/common";
import type { Ref } from "./lib/entities";
import { ensureLink, linksFrom } from "./lib/links";
import { indexCompany, indexPerson } from "./lib/searchIndex";
import { actor, companyLabel } from "./schema";

/** People and the companies they work at. Internal: run through `gateway.call` or the web app's own functions. */

const nullable = <T extends Parameters<typeof v.optional>[0]>(validator: T) => v.optional(v.union(validator, v.null()));
const BIRTHDAY = /^(\d{4}-)?(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const personRef = (id: Id<"people">): Ref => ({ entityType: "person", entityId: id });

/** Normalises a list of addresses or numbers, dropping repeats. */
function handles(values: string[] | undefined, normalize: (value: string) => string): string[] {
  try {
    return [...new Set((values ?? []).map(normalize))];
  } catch (error) {
    if (error instanceof IdentityError) throw refuse("invalid_arguments", error.message);
    throw error;
  }
}

async function owners(ctx: QueryCtx, kind: "email" | "phone", values: string[]): Promise<Map<string, Id<"people">>> {
  const found = new Map<string, Id<"people">>();
  for (const value of values) {
    const row = await ctx.db
      .query("personHandles")
      .withIndex("by_value", (q) => q.eq("kind", kind).eq("value", value))
      .first();
    if (row) found.set(value, row.personId);
  }
  return found;
}

async function companyOf(ctx: QueryCtx, id: Id<"people">): Promise<Doc<"companies"> | null> {
  const [link] = await linksFrom(ctx, personRef(id), "works_at");
  const companyId = link ? ctx.db.normalizeId("companies", link.to.entityId) : null;
  return companyId ? await ctx.db.get(companyId) : null;
}

export function presentCompany(company: Doc<"companies">) {
  return {
    id: company._id,
    name: company.name,
    domain: company.domain,
    website: company.website,
    relationshipLabel: company.relationshipLabel,
    notes: company.notes,
  };
}

export async function presentPerson(ctx: QueryCtx, person: Doc<"people">, timeZone: string) {
  const company = await companyOf(ctx, person._id);
  return {
    id: person._id,
    name: person.name,
    emails: person.emails,
    phoneNumbers: person.phoneNumbers,
    company: company ? { id: company._id, name: company.name } : undefined,
    roleTitle: person.roleTitle,
    relationshipContext: person.relationshipContext,
    birthday: person.birthday,
    notes: person.notes,
    favorite: person.favorite,
    lastContact: showWhen(person.lastContactAt, timeZone)?.date,
    contactCadenceDays: person.contactCadenceDays,
    updatedAt: iso(person.updatedAt),
  };
}

/**
 * Sets, changes or clears where a person works. A company that is not on file
 * yet is created. Returns what changed in words, or null when nothing did.
 */
async function setCompany(
  ctx: MutationCtx,
  person: Id<"people">,
  name: string | null,
  by: Actor,
  now: number,
): Promise<string | null> {
  const current = await linksFrom(ctx, personRef(person), "works_at");
  if (name === null) {
    for (const link of current) await ctx.db.delete(link._id);
    return current.length > 0 ? "no longer at a company" : null;
  }
  const nameKey = name.toLowerCase();
  let company = await ctx.db
    .query("companies")
    .withIndex("by_name_key", (q) => q.eq("nameKey", nameKey))
    .first();
  if (!company) {
    const id = await ctx.db.insert("companies", { name, nameKey, createdBy: by, updatedBy: by, updatedAt: now });
    company = (await ctx.db.get(id))!;
    await indexCompany(ctx, company);
    await logActivity(ctx, {
      entityType: "company",
      entityId: id,
      activityType: "company.created",
      actor: by,
      at: now,
      summary: `Added company "${name}"`,
    });
  }
  const companyId = company._id;
  let changed = false;
  for (const link of current) {
    if (link.to.entityId === companyId) continue;
    await ctx.db.delete(link._id);
    changed = true;
  }
  const made = await ensureLink(ctx, {
    from: personRef(person),
    to: { entityType: "company", entityId: companyId },
    type: "works_at",
    actor: by,
    at: now,
  });
  return made || changed ? `works at "${company.name}"` : null;
}

export const upsert = internalMutation({
  args: {
    actor,
    id: v.optional(v.string()),
    name: v.optional(v.string()),
    emails: v.optional(v.array(v.string())),
    phoneNumbers: v.optional(v.array(v.string())),
    /** Addresses and numbers to take off the person. Only with an id. */
    removeEmails: v.optional(v.array(v.string())),
    removePhoneNumbers: v.optional(v.array(v.string())),
    /** True when this is a different person who shares a name with one on file. */
    separate: v.optional(v.boolean()),
    company: nullable(v.string()),
    roleTitle: nullable(v.string()),
    relationshipContext: nullable(v.string()),
    birthday: nullable(v.string()),
    notes: nullable(v.string()),
    favorite: nullable(v.boolean()),
    lastContactAt: nullable(v.string()),
    contactCadenceDays: nullable(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const settings = await getSettings(ctx);
    const emails = handles(args.emails, normalizeEmail);
    const phones = handles(args.phoneNumbers, normalizePhone);
    const dropEmails = new Set(handles(args.removeEmails, normalizeEmail));
    const dropPhones = new Set(handles(args.removePhoneNumbers, normalizePhone));
    if ((dropEmails.size > 0 || dropPhones.size > 0) && args.id === undefined) {
      throw refuse("invalid_arguments", "Give the person's id to take an email or number off them.");
    }
    const emailOwners = await owners(ctx, "email", emails);
    const phoneOwners = await owners(ctx, "phone", phones);
    const known = [...new Set([...emailOwners.values(), ...phoneOwners.values()])];

    let existing: Doc<"people"> | null = null;
    // Found by an address or number, not by id. The name on file is then left alone,
    // so a nickname in an email header cannot overwrite a full name.
    let matchedByHandle = false;
    if (args.id !== undefined) {
      const id = ctx.db.normalizeId("people", args.id);
      existing = id ? await ctx.db.get(id) : null;
      if (!existing) throw refuse("not_found", `There is no person with the id "${args.id}".`);
      const taken = known.find((owner) => owner !== existing!._id);
      if (taken) {
        const other = await ctx.db.get(taken);
        throw refuse(
          "handle_in_use",
          `One of those addresses or numbers already belongs to "${other?.name}" (id ${taken}).`,
        );
      }
    } else if (known.length > 1) {
      throw refuse(
        "ambiguous_person",
        `Those addresses and numbers belong to ${known.length} different people (ids ${known.join(", ")}). Pass the id of the one you mean.`,
      );
    } else if (known.length === 1) {
      existing = await ctx.db.get(known[0]);
      matchedByHandle = true;
    } else if (args.name !== undefined && args.name.trim() !== "" && (emails.length > 0 || phones.length > 0) && !args.separate) {
      // One person, several addresses: the same person arrives as an email
      // address in mail and as a phone number in messages. A new address under
      // a name that exactly one person on file has is added to that person,
      // not made into a second one.
      const sameName = await ctx.db
        .query("people")
        .withIndex("by_name_key", (q) => q.eq("nameKey", args.name!.trim().toLowerCase()))
        .take(2);
      if (sameName.length === 1) {
        existing = sameName[0];
        matchedByHandle = true;
      }
    }

    if (args.birthday && !BIRTHDAY.test(args.birthday.trim())) {
      throw refuse("invalid_arguments", "birthday must look like 1984-03-09, or 03-09 when the year is not known.");
    }
    if (args.contactCadenceDays != null && (!Number.isInteger(args.contactCadenceDays) || args.contactCadenceDays < 1)) {
      throw refuse("invalid_arguments", "contactCadenceDays must be a whole number of days, 1 or more.");
    }
    const name = args.name === undefined || matchedByHandle ? undefined : requireText(args.name, "name");
    const fields = {
      name,
      nameKey: name?.toLowerCase(),
      roleTitle: cleanText(args.roleTitle),
      relationshipContext: cleanText(args.relationshipContext),
      birthday: cleanText(args.birthday),
      notes: cleanText(args.notes),
      favorite: args.favorite,
      lastContactAt: when(args.lastContactAt, settings.timeZone, "start", "lastContactAt"),
      contactCadenceDays: args.contactCadenceDays,
    };
    const company = args.company === undefined ? undefined : cleanText(args.company);

    if (existing) {
      const personId = existing._id;
      const newEmails = emails.filter((email) => !emailOwners.has(email));
      const newPhones = phones.filter((phone) => !phoneOwners.has(phone));
      const { patch, diff } = buildPatch(existing, {
        ...fields,
        emails: [...existing.emails, ...newEmails].filter((email) => !dropEmails.has(email)),
        phoneNumbers: [...existing.phoneNumbers, ...newPhones].filter((phone) => !dropPhones.has(phone)),
      });
      const companyChange = company === undefined ? null : await setCompany(ctx, personId, company, args.actor, now);
      if (Object.keys(patch).length === 0 && !companyChange) {
        return { created: false, changed: false, person: await presentPerson(ctx, existing, settings.timeZone) };
      }
      await ctx.db.patch(personId, { ...patch, updatedBy: args.actor, updatedAt: now });
      for (const value of newEmails) await ctx.db.insert("personHandles", { personId, kind: "email", value });
      for (const value of newPhones) await ctx.db.insert("personHandles", { personId, kind: "phone", value });
      // What was taken off no longer finds this person.
      for (const row of await ctx.db
        .query("personHandles")
        .withIndex("by_person", (q) => q.eq("personId", personId))
        .collect()) {
        if ((row.kind === "email" ? dropEmails : dropPhones).has(row.value)) await ctx.db.delete(row._id);
      }
      const updated = (await ctx.db.get(personId))!;
      await indexPerson(ctx, updated);
      delete diff.nameKey;
      const what = [...Object.keys(diff), ...(companyChange ? [companyChange] : [])].join(", ");
      await logActivity(ctx, {
        entityType: "person",
        entityId: personId,
        activityType: "person.updated",
        actor: args.actor,
        at: now,
        summary: `Updated ${updated.name}: ${what}`,
        diff,
      });
      return { created: false, changed: true, person: await presentPerson(ctx, updated, settings.timeZone) };
    }

    const newName = requireText(args.name, "name");
    if (emails.length === 0 && phones.length === 0 && !args.separate) {
      const sameName = await ctx.db
        .query("people")
        .withIndex("by_name_key", (q) => q.eq("nameKey", newName.toLowerCase()))
        .take(5);
      if (sameName.length > 0) {
        throw refuse(
          "person_exists",
          `There is already a person named "${newName}" (id ${sameName.map((row) => row._id).join(", ")}). Pass that id to update them. If this is a different person with the same name, pass separate: true.`,
        );
      }
    }
    const personId = await ctx.db.insert("people", {
      name: newName,
      nameKey: newName.toLowerCase(),
      emails,
      phoneNumbers: phones,
      ...(fields.roleTitle ? { roleTitle: fields.roleTitle } : {}),
      ...(fields.relationshipContext ? { relationshipContext: fields.relationshipContext } : {}),
      ...(fields.birthday ? { birthday: fields.birthday } : {}),
      ...(fields.notes ? { notes: fields.notes } : {}),
      ...(typeof fields.favorite === "boolean" ? { favorite: fields.favorite } : {}),
      ...(typeof fields.lastContactAt === "number" ? { lastContactAt: fields.lastContactAt } : {}),
      ...(typeof fields.contactCadenceDays === "number" ? { contactCadenceDays: fields.contactCadenceDays } : {}),
      createdBy: args.actor,
      updatedBy: args.actor,
      updatedAt: now,
    });
    for (const value of emails) await ctx.db.insert("personHandles", { personId, kind: "email", value });
    for (const value of phones) await ctx.db.insert("personHandles", { personId, kind: "phone", value });
    const companyChange = company ? await setCompany(ctx, personId, company, args.actor, now) : null;
    const created = (await ctx.db.get(personId))!;
    await indexPerson(ctx, created);
    await logActivity(ctx, {
      entityType: "person",
      entityId: personId,
      activityType: "person.created",
      actor: args.actor,
      at: now,
      summary: `Added ${newName}${companyChange ? `, who ${companyChange}` : ""}`,
    });
    return { created: true, changed: true, person: await presentPerson(ctx, created, settings.timeZone) };
  },
});

/** Changes a company. Only the fields passed change; null clears one. */
export const updateCompany = internalMutation({
  args: {
    actor,
    id: v.string(),
    name: v.optional(v.string()),
    domain: nullable(v.string()),
    website: nullable(v.string()),
    relationshipLabel: nullable(companyLabel),
    notes: nullable(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = ctx.db.normalizeId("companies", args.id);
    const company = id ? await ctx.db.get(id) : null;
    if (!company) throw refuse("not_found", `There is no company with the id "${args.id}".`);
    const name = args.name === undefined ? undefined : requireText(args.name, "name");
    if (name && name.toLowerCase() !== company.nameKey) {
      const clash = await ctx.db
        .query("companies")
        .withIndex("by_name_key", (q) => q.eq("nameKey", name.toLowerCase()))
        .first();
      if (clash) throw refuse("company_exists", `There is already a company named "${clash.name}".`);
    }
    const { patch, diff } = buildPatch(company, {
      name,
      nameKey: name?.toLowerCase(),
      domain: cleanText(args.domain),
      website: cleanText(args.website),
      relationshipLabel: args.relationshipLabel,
      notes: cleanText(args.notes),
    });
    if (Object.keys(patch).length === 0) return { changed: false, company: presentCompany(company) };
    await ctx.db.patch(company._id, { ...patch, updatedBy: args.actor, updatedAt: now });
    const updated = (await ctx.db.get(company._id))!;
    await indexCompany(ctx, updated);
    delete diff.nameKey;
    await logActivity(ctx, {
      entityType: "company",
      entityId: company._id,
      activityType: "company.updated",
      actor: args.actor,
      at: now,
      summary: `Updated company "${updated.name}": ${Object.keys(diff).join(", ")}`,
      diff,
    });
    return { changed: true, company: presentCompany(updated) };
  },
});
