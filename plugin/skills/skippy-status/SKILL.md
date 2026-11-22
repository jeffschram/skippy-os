---
name: skippy-status
description: 'Use when project instructions or CLAUDE.md contain a "Skippy project:" line. Says when and how to report project status and tasks to Skippy OS. Load it before the first substantial step.'
---

# Reporting to Skippy OS

Skippy OS is the owner's record of their projects and tasks. The owner reads it on a dashboard instead of reading your chats. A project there is only as current as what you report, so report without being asked.

This applies when the project's instructions or `CLAUDE.md` have a line like:

```
Skippy project: kitchen-remodel. Follow the skippy-status skill.
```

The word after the colon is the project's **slug**. Tools that act on a project take it in a field named `project`. With no such line, do not report anything, and do not guess a slug.

## Which tools

Use the tools of the connector named **Skippy OS**: `get_project`, `record_project_status`, `upsert_task`, `complete_task`, `update_phase`, `upsert_project`, `get_changes_since`.

An older connector named just "Skippy" may also be connected, with similar tool names. It is a different, retired system. Never write to it.

If the Skippy OS tools are missing, or a call fails for a reason you cannot fix, tell the owner in one line and carry on with the work. Do not retry in a loop, and do not write status anywhere else instead.

## At the start: read

Before the first substantial step, call `get_project` with `project` set to the slug. It returns the project's details and notes, phases, open tasks, recently closed tasks and the last five status reports.

The owner edits Skippy OS directly, so what you read can differ from what an earlier session left. Treat it as the truth: a task they closed is closed, a task they added is wanted, a changed deadline is the deadline. If you need to see exactly what changed, call `get_changes_since` with the time of the last status report.

If `get_project` says the project does not exist, the line in the instructions is the owner's say-so that it should. Create it with `upsert_project`: that slug, a plain title, `kind` "code" for a software folder and "general" otherwise, and `claudeHome` set to this Claude Project's name or this folder's path.

## While working: tasks

- When work that will outlast this session comes up, add it with `upsert_task` and the project's slug. Start the title with a verb.
- When you finish something that is a task in Skippy OS, call `complete_task`.
- When a task now depends on someone else, set its status to "waiting" and say who in `waitingOn`.
- Check the open tasks from `get_project` before adding one, so the same task is not added twice.
- Do not add a task for a step you will finish in this session.
- When the project has phases, put a new task in the phase it belongs to with `phaseId`. When work on a phase starts, set the phase to "active" with `update_phase`, and to "done" when everything in it is finished.

## When to report

Call `record_project_status` when any of these happens:

- A milestone is reached: something shipped, was sent, booked, decided or finished.
- A decision is made that changes the plan.
- The work gets blocked, or stops being blocked.
- A working session ends: you have finished what the owner asked for and are about to give your closing answer.

One report per stopping point is enough. Do not report after a quick question, or when nothing has changed since the last report.

## What a report says

`note` is one short paragraph, written for the owner, who has not read this chat:

- What happened in this session, in outcomes and not steps.
- Where the project stands now.
- What comes next, and anything waiting on the owner.

Use plain words and whole sentences. Name things the way the owner does. Leave out file names, commands and tool names unless the owner needs them.

Other fields:

- `health`: set it only when it has changed. "on_track" means going as planned, "at_risk" means it may slip, "blocked" means it cannot move until something outside the work changes.
- `milestone`: a few words, only when one was reached.
- `surface`: "claude_code" in Claude Code, "claude_project" in a Claude Project chat, "scheduled" in a scheduled task.

A good note:

> Booked the Thursday flights and the rental car, and sent Dad the arrival times. The grocery order is drafted but not placed; it needs your card. Next: place the order by Friday so it arrives before we do.

A poor note: "Worked on travel. Made progress on several items."

## Keep it truthful

Report what is true, including what failed or was left undone. Never mark a task done that was not finished, and never report a milestone that was not reached.

Mention the report to the owner in a few words at most, such as "Status recorded in Skippy." Do not paste the report into the chat.
