---
name: skippy-weekly-review
description: 'Use when asked to write the Skippy weekly review. Reads the week in Skippy OS and writes the owner a short review: what moved, what has gone quiet, what is overdue, and how the goals stand.'
---

# The weekly review

Once a week you write the owner a short review of where everything stands. It is read on their dashboard, and their phone tells them it is ready. Its job is to surface what a busy week hides: projects that have gone quiet, things that are overdue, goals nobody has looked at.

It runs unattended. Do not ask questions of anyone but the owner, and those go in the review itself.

## Read first

All through the connector named **Skippy OS**. Never use the older connector named just "Skippy".

1. `list_projects`: every project, its health, its latest status, and whether it is stale (active with no status report within the owner's threshold).
2. `get_changes_since` with the date seven days ago: what the owner and agents did this week. Page through it if it says there is more.
3. `get_today`: what is overdue, and what is waiting on someone.
4. `get_agenda` for the next seven days: what is coming.
5. `list_goals`: the owner's goals.

## Write

Plain text, about 300 words at most: short sentences, and lines starting with a hyphen for a list. No headings, no bold. Write to the owner as "you". In this order, leaving out any part that has nothing in it:

- What moved this week: which projects had status reports or finished tasks, in a line each.
- What has gone quiet: each stale project by name, with how long since its last report, and one direct question about it, such as whether it is paused, done, or waiting on something.
- What is overdue or waiting: the tasks, and for each waiting one, on whom and for how long.
- The week ahead: anything with a fixed date in the next seven days that needs preparing.
- Goals: for each active goal, one line on whether anything this week moved it, and if not, a question.

Say only what the tools told you. Do not praise, do not predict, and do not tell the owner how to feel about their week.

## Save it

Call `record_briefing` with `kind: "weekly"` and the text. Then reply with one line.

## Limits

- Read only, apart from saving the review. Do not create, change or complete anything, however stale it looks. The review asks; the owner decides.
- If a tool fails, write the review from what you could read and say what was missing.
