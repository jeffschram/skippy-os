import { internalMutation } from "./_generated/server";
import { indexCompany, indexKnowledge, indexPerson, indexProject, indexTask } from "./lib/searchIndex";

/**
 * Rebuilds the search rows for every record. Run it by hand after a change to
 * what search covers: `npx convex run maintenance:reindexSearch`.
 * It reads every record in one go, which is fine at one person's scale.
 */
export const reindexSearch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const counts = { project: 0, task: 0, person: 0, company: 0, knowledge: 0 };
    for (const doc of await ctx.db.query("projects").collect()) {
      await indexProject(ctx, doc);
      counts.project++;
    }
    for (const doc of await ctx.db.query("tasks").collect()) {
      await indexTask(ctx, doc);
      counts.task++;
    }
    for (const doc of await ctx.db.query("people").collect()) {
      await indexPerson(ctx, doc);
      counts.person++;
    }
    for (const doc of await ctx.db.query("companies").collect()) {
      await indexCompany(ctx, doc);
      counts.company++;
    }
    for (const doc of await ctx.db.query("knowledge").collect()) {
      await indexKnowledge(ctx, doc);
      counts.knowledge++;
    }
    return counts;
  },
});
