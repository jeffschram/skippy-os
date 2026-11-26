---
name: skippy-plan-project
description: 'Use when the owner asks to plan a project in Skippy, or to turn a brief or an idea into phases and tasks. Says how to write the plan into Skippy OS without overplanning or doubling up.'
---

# Planning a project in Skippy OS

Skippy OS holds each project's plan: a few phases in order, and tasks inside them. This skill covers turning a brief, an idea or a conversation into that plan. Day-to-day reporting afterwards is the `skippy-status` skill's job.

## Which tools

Use the tools of the connector named **Skippy OS**: `get_project`, `list_projects`, `search`, `upsert_project`, `create_phase`, `update_phase`, `upsert_task`, `record_project_status`.

An older connector named just "Skippy" may also be connected, with similar tool names. It is a different, retired system. Never write to it.

If the Skippy OS tools are missing, tell the owner and stop. Do not write the plan anywhere else and call it saved.

## Read before writing

1. Find the project. If the instructions or `CLAUDE.md` have a `Skippy project:` line, that slug is the project: call `get_project`. Otherwise call `list_projects` and `search` for it by name. Only when nothing fits is this a new project.
2. Read what is already there: the notes, the phases, the open tasks. A brief left by "Continue in Claude" sits at the end of the notes. The owner may have added tasks by hand. Build on all of it; never write a second copy of a phase or a task that exists.
3. Ask the owner only what the plan cannot be written without: what done looks like, any fixed date, and anything they have already ruled out. Two or three questions at most, and none whose answer is in the notes.

## Show the plan first

Write the plan in the chat and get a yes before saving anything, unless the owner has already said to go ahead and save it. Show the phases in order, the tasks under the first one or two, and the dates you would set. This is the moment the owner can change its shape cheaply.

## The shape of a good plan

- **Phases:** two to five, each a stage with a clear end, named for what is true when it is finished ("Flights and car booked", not "Travel"). A small project needs no phases at all: tasks alone are a plan.
- **Tasks:** each one something a person can sit down and finish, with a title that starts with a verb. Write out the tasks of the phase that is starting, and of the next where they are already known. Leave later phases as a title and a sentence; their tasks are written when they start.
- **Dates:** set `dueAt` only where there is a real deadline, a booking that sells out or a date someone else set. Set the project's `targetDate` when the owner gave one. Never spread made-up dates across the tasks to make the plan look scheduled.
- **Waiting:** a task that depends on someone else gets status "waiting" and `waitingOn` with who or what.
- **Size:** ten tasks is a lot. If the first phase needs more, it is two phases.
- **How it ends:** code is a type of its own (`kind` "code"). Any other project is `kind` "general" with a `finish`:
  - "date" for something built around a fixed date, such as a trip, a holiday gathering or a birthday weekend. Its `targetDate` is the day (the last day, for several); until there is one, put the rough time in `roughDate` ("early spring"). It needs no phases and no status reports: its tasks are what is left to book or decide, and it is set once they are all done. Its bookings, with their times and places, go in as events filed under it (`upsert_event` with `project`), which make its schedule, shown as the itinerary. A single dinner or appointment is just an event, not a project.
  - "tasks" (the default) for work that is done when its tasks are, such as a remodel. A `targetDate` here is an aim, not a fixed day.
  - "ongoing" for a part of life that never finishes, such as the house, the car or health. It has no end date and never goes stale; its tasks and repeating chores are its upkeep.
- **Parts:** a project can switch on parts, each a panel on its page (`parts` on `upsert_project`). Use them only where they help:
  - "options" when there are choices to weigh, such as where to stay or which contractor. Add each question with `upsert_decision` (with `criteria`: what matters in choosing) and its options with `upsert_option` (title, price, link, and in `details` how it measures up). Leave the choosing to the owner unless they said to decide; a decision is made with `chosen` and `why`, and then saved to Memory by itself.
  - "budget" when money matters, such as a remodel or a trip. Set the project's `budget` when the owner gave a total, and add a line per thing to pay for or buy with `upsert_budget_line` (`planned`, later `spent` and `bought`). The lines are also the shopping list.
  - "schedule" for its events by day. A project that ends on a date has it from the start.
  Adding a decision or a budget line switches its part on.

## Saving it

In this order, so that nothing points at something that does not exist yet:

1. The project: `upsert_project`. For a new one give `title`, a `summary` of one or two sentences, `kind` ("code" for software, otherwise "general"), and for a general one its `finish`, `targetDate` or `roughDate`, and any `parts`. For an existing one pass its `slug` and only what changes. Do not replace `notesPad` unless the owner asked; it holds their notes and any brief.
2. The phases, first to last: `create_phase` for each new one, with a `description` of one sentence. Mark the phase that is starting "active" with `update_phase`. Each call returns the phase's id.
3. The tasks: `upsert_task` with `project` and the `phaseId` of their phase.
4. Any decisions with their options, and budget lines, if the plan calls for them.
5. One status report, except for a project that ends on a date: `record_project_status`, saying in a sentence or two that the plan was written and what comes first, with `milestone` set to "Plan written".

If a call is refused, read the refusal: it says what was wrong. Fix that one thing; do not start again from the top, or the phases will be doubled.

## After saving

Tell the owner in a few lines what was saved: how many phases and tasks, and the first thing to do. For a new project, give them the line that ties a Claude Project or a code folder to it, with the slug `upsert_project` returned:

```
Skippy project: the-slug. Follow the skippy-status skill. If you don't have that skill, get it with get_skill from the Skippy OS connector.
```

## Changing a plan later

Plans change. To reshape one, read it again with `get_project` and change what is there: retitle or close phases with `update_phase`, move a task by setting its `phaseId`, cancel a task that is no longer wanted by setting its status to "cancelled". Do not delete and rebuild, and do not leave the old tasks open beside the new ones.
