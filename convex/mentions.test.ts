/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { nameIn } from "./lib/mentions";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

const OWNER = "user_owner";
const NOW = new Date("2026-11-25T17:00:00Z").getTime();

beforeEach(() => {
  process.env.SKIPPY_OWNER_CLERK_USER_ID = OWNER;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

const start = () => convexTest(schema, modules);

describe("people named in other records", () => {
  it("finds a name as whole words, any case, and a number however it is written", () => {
    const person = { name: "Sam Rivera", aliases: ["Sammy"], phoneNumbers: ["+15555550123"] };
    expect(nameIn("Lunch with sam rivera on Friday", person)).toBe("Sam Rivera");
    expect(nameIn("Sammy's birthday", person)).toBe("Sammy");
    expect(nameIn("Texted (555) 555-0123 about it", person)).toBe("+15555550123");
    expect(nameIn("Sam Riverastone and Sammyville", person)).toBeUndefined();
    expect(nameIn("Order 2026-11-25 for Sam", person)).toBeUndefined();
  });

  it("links records to the people they name, and lists the ones that use a first name only", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    const sam = (await owner.mutation(api.viewerMemory.savePerson, { name: "Sam Rivera", phoneNumbers: ["555-555-0123"] })).id;

    await owner.mutation(api.viewerMemory.saveKnowledge, { kind: "memory", title: "Sam Rivera is coming for dinner" });
    await owner.mutation(api.viewer.saveTask, { title: "Call back about the boat", description: "From 555 555 0123." });
    const first = (await owner.mutation(api.viewerMemory.saveKnowledge, { kind: "memory", title: "Sam's birthday is March 3" })).id;
    await owner.mutation(api.viewerMemory.saveKnowledge, { kind: "note", title: "Samuel Beckett quotes" });

    const linked = async () =>
      (await owner.query(api.viewerMemory.item, { type: "person", id: sam, now: NOW }))!.links.map((link) => [link.relation, link.record.title]);
    expect((await linked()).sort()).toEqual([
      ["mentions", "Call back about the boat"],
      ["mentions", "Sam Rivera is coming for dinner"],
    ]);

    // The first name alone could be someone else, so it waits for the owner.
    const mentions = (await owner.query(api.viewerMemory.mentionsOf, { id: sam }))!;
    expect(mentions.firstName).toBe("Sam");
    expect(mentions.items.map((item) => [item.title, item.named])).toEqual([["Sam's birthday is March 3", "Sam"]]);

    await owner.mutation(api.viewerMemory.linkMentions, { person: sam, records: [{ type: "knowledge", id: first }] });
    expect((await owner.query(api.viewerMemory.mentionsOf, { id: sam }))!.items).toEqual([]);
    expect(await linked()).toContainEqual(["mentions", "Sam's birthday is March 3"]);
  });

  it("links what is already on file when a person gains another name", async () => {
    const t = start();
    const owner = t.withIdentity({ subject: OWNER });
    await owner.mutation(api.viewerMemory.saveKnowledge, { kind: "memory", title: "Cate is bringing pie" });
    const kate = (await owner.mutation(api.viewerMemory.savePerson, { name: "Kate Doe" })).id;
    expect((await owner.query(api.viewerMemory.item, { type: "person", id: kate, now: NOW }))!.links).toEqual([]);

    await owner.mutation(api.viewerMemory.savePerson, { id: kate, aliases: [" Cate ", "cate", "Kate Doe"] });
    const bundle = (await owner.query(api.viewerMemory.item, { type: "person", id: kate, now: NOW }))!;
    expect((bundle.record as { aliases: string[] }).aliases).toEqual(["Cate"]);
    expect(bundle.links.map((link) => [link.relation, link.record.title, link.reason])).toEqual([
      ["mentions", "Cate is bringing pie", "Names Cate"],
    ]);
  });
});
