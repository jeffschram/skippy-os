import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { buildPatch, cleanText, logActivity, refuse, requireText } from "./lib/common";
import { actor, decisionStatus, type PROJECT_PARTS } from "./schema";

/**
 * The parts a project can switch on beyond its tasks: Options (questions to
 * decide, each with options side by side) and Budget (lines planned against
 * spent, which double as the shopping list). The third part, Schedule, is
 * the project's events and needs no table of its own. Adding to a part
 * switches it on. Changes are logged against the project.
 */

type Part = (typeof PROJECT_PARTS)[number];
const nullable = <T extends Parameters<typeof v.optional>[0]>(validator: T) => v.optional(v.union(validator, v.null()));
const MAX_DETAILS = 4000;

/** An amount of money: not negative, kept to the cent. */
export function money(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw refuse("invalid_arguments", `${field} must be an amount of zero or more.`);
  return Math.round(value * 100) / 100;
}

function amount(value: number | null | undefined, field: string) {
  return value === undefined || value === null ? value : money(value, field);
}

function limited(value: string | null | undefined, field: string, max: number) {
  const text = cleanText(value);
  if (text && text.length > max) throw refuse("invalid_arguments", `${field} is limited to ${max} characters.`);
  return text;
}

function webAddress(value: string | null | undefined) {
  const text = limited(value, "url", 2000);
  if (text && !/^https?:\/\//i.test(text)) throw refuse("invalid_arguments", "url must start with http:// or https://.");
  return text;
}

async function projectNamed(ctx: QueryCtx, slug: string): Promise<Doc<"projects">> {
  const project = await ctx.db
    .query("projects")
    .withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase()))
    .unique();
  if (!project) throw refuse("not_found", `There is no project with the slug "${slug}". Use list_projects to see them.`);
  return project;
}

async function row<T extends "decisions" | "decisionOptions" | "budgetLines">(ctx: QueryCtx, table: T, id: string, what: string) {
  const key = ctx.db.normalizeId(table, id);
  const found = key ? await ctx.db.get(key) : null;
  if (!found) throw refuse("not_found", `There is no ${what} with the id "${id}". Use get_project to see them.`);
  return found as Doc<T>;
}

/** Switches a part on when something is first added to it. */
async function switchOn(ctx: MutationCtx, project: Doc<"projects">, part: Part, by: Doc<"projects">["updatedBy"], now: number) {
  if (project.parts?.includes(part)) return;
  await ctx.db.patch(project._id, { parts: [...(project.parts ?? []), part], updatedBy: by, updatedAt: now });
}

const log = (ctx: MutationCtx, project: Doc<"projects">, by: Doc<"projects">["updatedBy"], at: number, activityType: string, summary: string) =>
  logActivity(ctx, { entityType: "project", entityId: project._id, activityType, actor: by, at, summary });

/** The next place at the end of a list. */
const after = (rows: { order: number }[]) => rows.reduce((top, item) => Math.max(top, item.order), 0) + 1;

/** The project's decisions with their options, and its budget lines with the totals. */
export async function readParts(ctx: QueryCtx, project: Doc<"projects">) {
  const decisions = await ctx.db
    .query("decisions")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  const withOptions = [];
  for (const decision of decisions) {
    const options = await ctx.db
      .query("decisionOptions")
      .withIndex("by_decision", (q) => q.eq("decisionId", decision._id))
      .collect();
    withOptions.push({
      id: decision._id,
      question: decision.question,
      status: decision.status,
      criteria: decision.criteria,
      chosenOptionId: decision.chosenOptionId,
      why: decision.why,
      decidedAt: decision.decidedAt === undefined ? undefined : new Date(decision.decidedAt).toISOString(),
      options: options.map((option) => ({
        id: option._id,
        title: option.title,
        details: option.details,
        url: option.url,
        price: option.price,
      })),
    });
  }
  const lines = await ctx.db
    .query("budgetLines")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  const sum = (pick: (line: Doc<"budgetLines">) => number | undefined) =>
    Math.round(lines.reduce((total, line) => total + (pick(line) ?? 0), 0) * 100) / 100;
  return {
    /** The Options part: open questions first, in the order they were added. */
    decisions: withOptions,
    /** The Budget part. `total` is the amount to stay within, when one is set. */
    budget: {
      total: project.budget,
      planned: sum((line) => line.planned),
      spent: sum((line) => line.spent),
      lines: lines.map((line) => ({
        id: line._id,
        title: line.title,
        planned: line.planned,
        spent: line.spent,
        bought: line.bought,
        url: line.url,
        note: line.note,
      })),
    },
  };
}

/**
 * Adds a question to decide, or changes one. Choosing an option decides it
 * and saves the decision to Memory, linked to the project; choosing none
 * opens it again and archives what was saved.
 */
export const upsertDecision = internalMutation({
  args: {
    actor,
    project: v.optional(v.string()),
    id: v.optional(v.string()),
    question: v.optional(v.string()),
    criteria: nullable(v.string()),
    status: v.optional(decisionStatus),
    chosen: nullable(v.string()),
    why: nullable(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const criteria = limited(args.criteria, "criteria", MAX_DETAILS);
    const why = limited(args.why, "why", MAX_DETAILS);

    if (args.id === undefined) {
      if (args.project === undefined) throw refuse("invalid_arguments", "A new decision needs a project.");
      if (args.chosen) throw refuse("invalid_arguments", "Add the options first, then choose one.");
      const project = await projectNamed(ctx, args.project);
      const question = requireText(args.question, "question");
      const existing = await ctx.db
        .query("decisions")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();
      const id = await ctx.db.insert("decisions", {
        projectId: project._id,
        question,
        status: "open",
        ...(criteria ? { criteria } : {}),
        order: after(existing),
        createdBy: args.actor,
        updatedBy: args.actor,
        updatedAt: now,
      });
      await switchOn(ctx, project, "options", args.actor, now);
      await log(ctx, project, args.actor, now, "project.decision_added", `To decide on "${project.title}": ${question}`);
      return { decision: { id, project: project.slug, question, status: "open" as const } };
    }

    const decision = await row(ctx, "decisions", args.id, "decision");
    const project = (await ctx.db.get(decision.projectId))!;
    let chosenOptionId: Id<"decisionOptions"> | null | undefined;
    let chosen: Doc<"decisionOptions"> | undefined;
    if (args.chosen) {
      chosen = await row(ctx, "decisionOptions", args.chosen, "option");
      if (chosen.decisionId !== decision._id) throw refuse("invalid_arguments", "That option belongs to another decision.");
      chosenOptionId = chosen._id;
    } else if (args.chosen === null) {
      chosenOptionId = null;
    }
    // Choosing decides it; clearing the choice opens it again.
    let status = args.status;
    if (chosenOptionId) status = "decided";
    else if (chosenOptionId === null && (status ?? decision.status) === "decided") status = "open";
    if (status === "decided" && !(chosenOptionId ?? (chosenOptionId === null ? undefined : decision.chosenOptionId))) {
      throw refuse("invalid_arguments", "Choose one of its options to decide it: pass chosen with the option's id.");
    }

    const fields = {
      question: args.question === undefined ? undefined : requireText(args.question, "question"),
      criteria,
      why,
      status,
      chosenOptionId,
      decidedAt: status === "decided" && decision.status !== "decided" ? now : status && status !== "decided" ? null : undefined,
    };
    const { patch, diff } = buildPatch(decision, fields);
    if (Object.keys(patch).length === 0) return { changed: false, decision: { id: decision._id, status: decision.status } };
    await ctx.db.patch(decision._id, { ...patch, updatedBy: args.actor, updatedAt: now });
    const updated = (await ctx.db.get(decision._id))!;

    // Keep Memory in step: a made decision is saved there, and one opened again is archived.
    if (updated.status === "decided" && updated.chosenOptionId) {
      const option = chosen ?? (await ctx.db.get(updated.chosenOptionId))!;
      const options = await ctx.db
        .query("decisionOptions")
        .withIndex("by_decision", (q) => q.eq("decisionId", decision._id))
        .collect();
      const saved = await ctx.runMutation(internal.knowledge.upsert, {
        actor: args.actor,
        ...(updated.knowledgeId ? { id: updated.knowledgeId } : { kind: "decision" as const }),
        title: `${updated.question} ${option.title}`.slice(0, 200),
        body: updated.why ?? null,
        lifecycle: "active",
        decision: {
          options: options.map((item) => item.title),
          chosen: option.title,
          ...(updated.why ? { rationale: updated.why } : {}),
        },
        about: [{ type: "project", id: project.slug }],
      });
      const knowledgeId = (saved as { knowledge?: { id?: string } }).knowledge?.id;
      const key = knowledgeId ? ctx.db.normalizeId("knowledge", knowledgeId) : null;
      if (key && key !== updated.knowledgeId) await ctx.db.patch(decision._id, { knowledgeId: key });
    } else if (decision.status === "decided" && updated.knowledgeId) {
      await ctx.runMutation(internal.knowledge.upsert, { actor: args.actor, id: updated.knowledgeId, lifecycle: "archived" });
    }

    const summary =
      updated.status === "decided" && decision.status !== "decided"
        ? `Decided on "${project.title}": ${updated.question} ${chosen?.title ?? ""}`.trim()
        : `Changed the decision "${updated.question}" on "${project.title}": ${Object.keys(diff).join(", ")}`;
    await log(ctx, project, args.actor, now, updated.status === "decided" && decision.status !== "decided" ? "project.decided" : "project.decision_updated", summary);
    return { changed: true, decision: { id: decision._id, status: updated.status } };
  },
});

/** Adds an option to a decision, or changes one. */
export const upsertOption = internalMutation({
  args: {
    actor,
    decision: v.optional(v.string()),
    id: v.optional(v.string()),
    title: v.optional(v.string()),
    details: nullable(v.string()),
    url: nullable(v.string()),
    price: nullable(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const fields = {
      title: args.title === undefined ? undefined : requireText(args.title, "title"),
      details: limited(args.details, "details", MAX_DETAILS),
      url: webAddress(args.url),
      price: amount(args.price, "price"),
    };
    if (args.id === undefined) {
      if (args.decision === undefined) throw refuse("invalid_arguments", "A new option needs the decision's id.");
      const decision = await row(ctx, "decisions", args.decision, "decision");
      const project = (await ctx.db.get(decision.projectId))!;
      const title = requireText(args.title, "title");
      const existing = await ctx.db
        .query("decisionOptions")
        .withIndex("by_decision", (q) => q.eq("decisionId", decision._id))
        .collect();
      const id = await ctx.db.insert("decisionOptions", {
        decisionId: decision._id,
        projectId: decision.projectId,
        title,
        ...(fields.details ? { details: fields.details } : {}),
        ...(fields.url ? { url: fields.url } : {}),
        ...(typeof fields.price === "number" ? { price: fields.price } : {}),
        order: after(existing),
        createdBy: args.actor,
        updatedBy: args.actor,
        updatedAt: now,
      });
      await log(ctx, project, args.actor, now, "project.option_added", `Option for "${decision.question}": ${title}`);
      return { option: { id, decision: decision._id, title } };
    }
    const option = await row(ctx, "decisionOptions", args.id, "option");
    const { patch, diff } = buildPatch(option, fields);
    if (Object.keys(patch).length === 0) return { changed: false, option: { id: option._id } };
    await ctx.db.patch(option._id, { ...patch, updatedBy: args.actor, updatedAt: now });
    const project = (await ctx.db.get(option.projectId))!;
    await log(ctx, project, args.actor, now, "project.option_updated", `Changed the option "${patch.title ?? option.title}": ${Object.keys(diff).join(", ")}`);
    return { changed: true, option: { id: option._id } };
  },
});

/** Takes an option off its decision for good. The chosen option cannot be: open the decision again first. */
export const removeOption = internalMutation({
  args: { actor, id: v.string() },
  handler: async (ctx, args) => {
    const option = await row(ctx, "decisionOptions", args.id, "option");
    const decision = (await ctx.db.get(option.decisionId))!;
    if (decision.chosenOptionId === option._id) throw refuse("invalid_arguments", "That is the chosen option. Open the decision again first.");
    await ctx.db.delete(option._id);
    const project = (await ctx.db.get(option.projectId))!;
    await log(ctx, project, args.actor, Date.now(), "project.option_removed", `Removed the option "${option.title}" from "${decision.question}"`);
    return { removed: true };
  },
});

/** Removes a decision and its options for good. What was saved to Memory stays there. */
export const removeDecision = internalMutation({
  args: { actor, id: v.string() },
  handler: async (ctx, args) => {
    const decision = await row(ctx, "decisions", args.id, "decision");
    const options = await ctx.db
      .query("decisionOptions")
      .withIndex("by_decision", (q) => q.eq("decisionId", decision._id))
      .collect();
    for (const option of options) await ctx.db.delete(option._id);
    await ctx.db.delete(decision._id);
    const project = (await ctx.db.get(decision.projectId))!;
    await log(ctx, project, args.actor, Date.now(), "project.decision_removed", `Removed the decision "${decision.question}"`);
    return { removed: true };
  },
});

/** Adds a budget line, or changes one. */
export const upsertBudgetLine = internalMutation({
  args: {
    actor,
    project: v.optional(v.string()),
    id: v.optional(v.string()),
    title: v.optional(v.string()),
    planned: nullable(v.number()),
    spent: nullable(v.number()),
    bought: v.optional(v.boolean()),
    url: nullable(v.string()),
    note: nullable(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const fields = {
      title: args.title === undefined ? undefined : requireText(args.title, "title"),
      planned: amount(args.planned, "planned"),
      spent: amount(args.spent, "spent"),
      bought: args.bought,
      url: webAddress(args.url),
      note: limited(args.note, "note", 1000),
    };
    if (args.id === undefined) {
      if (args.project === undefined) throw refuse("invalid_arguments", "A new budget line needs a project.");
      const project = await projectNamed(ctx, args.project);
      const title = requireText(args.title, "title");
      const existing = await ctx.db
        .query("budgetLines")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();
      const id = await ctx.db.insert("budgetLines", {
        projectId: project._id,
        title,
        bought: fields.bought ?? false,
        ...(typeof fields.planned === "number" ? { planned: fields.planned } : {}),
        ...(typeof fields.spent === "number" ? { spent: fields.spent } : {}),
        ...(fields.url ? { url: fields.url } : {}),
        ...(fields.note ? { note: fields.note } : {}),
        order: after(existing),
        createdBy: args.actor,
        updatedBy: args.actor,
        updatedAt: now,
      });
      await switchOn(ctx, project, "budget", args.actor, now);
      await log(ctx, project, args.actor, now, "project.budget_line_added", `Budget line on "${project.title}": ${title}`);
      return { line: { id, project: project.slug, title } };
    }
    const line = await row(ctx, "budgetLines", args.id, "budget line");
    const { patch, diff } = buildPatch(line, fields);
    if (Object.keys(patch).length === 0) return { changed: false, line: { id: line._id } };
    await ctx.db.patch(line._id, { ...patch, updatedBy: args.actor, updatedAt: now });
    const project = (await ctx.db.get(line.projectId))!;
    await log(ctx, project, args.actor, now, "project.budget_line_updated", `Changed the budget line "${patch.title ?? line.title}": ${Object.keys(diff).join(", ")}`);
    return { changed: true, line: { id: line._id } };
  },
});

/** Removes a budget line for good. */
export const removeBudgetLine = internalMutation({
  args: { actor, id: v.string() },
  handler: async (ctx, args) => {
    const line = await row(ctx, "budgetLines", args.id, "budget line");
    await ctx.db.delete(line._id);
    const project = (await ctx.db.get(line.projectId))!;
    await log(ctx, project, args.actor, Date.now(), "project.budget_line_removed", `Removed the budget line "${line.title}"`);
    return { removed: true };
  },
});
