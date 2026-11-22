---
name: skippy-capture
description: 'Use when the owner asks to save, capture, remember or note something in Skippy or its Memory, or asks what Skippy knows. Says which Skippy OS tool fits and how to avoid saving it twice.'
---

# Filing things into Skippy OS

Skippy OS is the owner's long-term record: tasks, people, and the notes, links, facts and decisions worth keeping. This skill covers putting one thing into it from any chat, and reading it back.

## Which tools

Use the tools of the connector named **Skippy OS**. An older connector named just "Skippy" may also be connected, with similar tool names. It is a different, retired system. Never write to it.

The tool named `capture` drops something into the owner's inbox to be filed later. Prefer filing it properly yourself, as below. Use `capture` only when the owner says to capture or hold something and you cannot tell what it is, or when they ask for a "hold" (`intent: "hold"`: a private seven-day hand-off between their devices that is never filed).

If the Skippy OS tools are missing, tell the owner, and do not save the thing anywhere else instead.

## When to save

Save when the owner asks. Without being asked, you may offer once, in a few words, when something clearly worth keeping comes up: a decision with its reason, a lasting fact about the owner or the people around them, or a promise with a date. Do not save passing remarks, things already on file, or anything the owner said to keep out.

## What goes where

| The thing | Tool | How |
| --- | --- | --- |
| Something to do | `upsert_task` | Title starts with a verb. Add `dueAt` only for a real deadline, and `project` when it belongs to one. |
| An appointment, a trip, anything with a time | `upsert_event` | Call `get_agenda` first, so it is not added twice and a clash is seen. A bare date makes it all day. |
| Something that comes round again | `upsert_recurrence` | A bill, a renewal, a regular check-in. Use this, not a task, when it has no end. Tick a round off with `complete_recurrence`, passing the `nextDue` day you read. |
| A web page | `upsert_knowledge`, kind "link" | Give the `url`, a title, and one line on why it was saved. |
| A fact about the owner or their world | `upsert_knowledge`, kind "memory" | One fact per record, as a full sentence. |
| A decision | `upsert_knowledge`, kind "decision" | Fill `decision` with what was chosen and why, and what else was considered. |
| A rule the owner works by | `upsert_knowledge`, kind "principle" | |
| Something still open | `upsert_knowledge`, kind "question" | |
| A thought, or anything else | `upsert_knowledge`, kind "note" | |
| A person | `upsert_person` | Give an email or phone number when you have one; that is how people are matched. |

A to-do is always a task, never a note. A deadline belongs on a task only when it is the date the action must be done by.

## Emptying the inbox

When the owner asks you to go through their captures, or the inbox: call `list_captures`. For each one, decide what it is from the table above, search for a record that already covers it, save or update the record, then call `resolve_capture` with `outcome: "processed"` and what it became in `results`. A capture that is a duplicate or not worth keeping is resolved with `outcome: "discarded"` and a few words of why in `note`. A capture that has `about` belongs under that record: give a task that project, and list the record in `about` on knowledge. A capture that holds a file cannot be discarded by you; leave it for the owner. Leave a capture alone when you cannot tell what the owner meant, and ask them. Never file a held capture.

## Before saving

Call `search` with the plainest words that would be in the record. If it is already there, update that record by its `id` instead of adding another. For a person known by name only, search first and update the one found.

## Tie it to what it concerns

- On knowledge, list the people, projects or other records it is about in `about`.
- For anything else, relate two records with `link_entities`.
- On a capture, pass `about` when it concerns a project or another record.
- When it came from somewhere, fill `source`: "conversation" for this chat, or the system and a link back for an email, message or page. Keep any excerpt short. Never copy a whole email or message.

## Write for later

The owner, or another session, will read this months from now with no memory of this chat. Use full sentences, real names and absolute dates ("November 30, 2026", not "next Monday").

## After saving

Say what was saved in one line, with its title. If you changed an existing record instead of adding one, say that.

## Reading back

To answer "what does Skippy know about X": `search`, then `get_context_bundle` on the best results, which returns the record, what it is linked to and where it came from. Say so plainly when nothing is found, and do not fill the gap from memory.
