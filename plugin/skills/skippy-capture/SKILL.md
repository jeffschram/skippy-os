---
name: skippy-capture
description: Use when the owner asks to save, capture, remember, file or note something in Skippy or "my brain": a thought, a link, a fact, a decision, a person or a to-do. Also use when they ask what Skippy knows about something. Says which Skippy OS tool fits each kind of thing and how to avoid saving it twice.
---

# Filing things into Skippy OS

Skippy OS is the owner's long-term record: tasks, people, and the notes, links, facts and decisions worth keeping. This skill covers putting one thing into it from any chat, and reading it back.

## Which tools

Use the tools of the connector named **Skippy OS**. An older connector named just "Skippy" may also be connected, with similar tool names. It is a different, retired system. Never write to it.

Do not use the Skippy OS tool named `capture`. It is a test tool and what it saves is not kept with the rest.

If the Skippy OS tools are missing, tell the owner, and do not save the thing anywhere else instead.

## When to save

Save when the owner asks. Without being asked, you may offer once, in a few words, when something clearly worth keeping comes up: a decision with its reason, a lasting fact about the owner or the people around them, or a promise with a date. Do not save passing remarks, things already on file, or anything the owner said to keep out.

## What goes where

| The thing | Tool | How |
| --- | --- | --- |
| Something to do | `upsert_task` | Title starts with a verb. Add `dueAt` only for a real deadline, and `project` when it belongs to one. |
| A web page | `upsert_knowledge`, kind "link" | Give the `url`, a title, and one line on why it was saved. |
| A fact about the owner or their world | `upsert_knowledge`, kind "memory" | One fact per record, as a full sentence. |
| A decision | `upsert_knowledge`, kind "decision" | Fill `decision` with what was chosen and why, and what else was considered. |
| A rule the owner works by | `upsert_knowledge`, kind "principle" | |
| Something still open | `upsert_knowledge`, kind "question" | |
| A thought, or anything else | `upsert_knowledge`, kind "note" | |
| A person | `upsert_person` | Give an email or phone number when you have one; that is how people are matched. |

A to-do is always a task, never a note. A deadline belongs on a task only when it is the date the action must be done by.

## Before saving

Call `search` with the plainest words that would be in the record. If it is already there, update that record by its `id` instead of adding another. For a person known by name only, search first and update the one found.

## Tie it to what it concerns

- On knowledge, list the people, projects or other records it is about in `about`.
- For anything else, relate two records with `link_entities`.
- When it came from somewhere, fill `source`: "conversation" for this chat, or the system and a link back for an email, message or page. Keep any excerpt short. Never copy a whole email or message.

## Write for later

The owner, or another session, will read this months from now with no memory of this chat. Use full sentences, real names and absolute dates ("November 30, 2026", not "next Monday").

## After saving

Say what was saved in one line, with its title. If you changed an existing record instead of adding one, say that.

## Reading back

To answer "what does Skippy know about X": `search`, then `get_context_bundle` on the best results, which returns the record, what it is linked to and where it came from. Say so plainly when nothing is found, and do not fill the gap from memory.
