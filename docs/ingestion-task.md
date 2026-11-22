# The scheduled ingestion passes

Six times a day (9am, 11am, 1pm, 3pm, 5pm and 7pm) a pass reads your calendar, your mail and your messages and records what matters in Skippy OS. The day's first pass also writes the morning briefing.

## How a pass runs

A per-user background job, `app.skippyos.ingest`, starts `tools/ingest/pass.mjs`. That starts one Claude Code session from the command line with the prompt in `tools/ingest/prompt.txt` and exactly the tools a pass needs:

- read the calendar (list calendars, list events)
- read mail (search threads, read a thread)
- read the one transcript file of messages
- Skippy OS's ingestion tools, and its search and agenda to check what is already on file

The program refuses every other tool, whatever the session reads. It cannot send, reply, change a calendar, run a command or read any other file.

If a pass ends without closing its run in Skippy OS, the job reports that to Skippy OS, so it shows as a failed pass on Home with the reason. A pass that runs longer than 25 minutes is stopped.

The whole of the last pass is kept at `~/.skippy-os/ingest/last-pass.jsonl`, and one line per pass in `~/.skippy-os/ingest/passes.log`.

## Install it

```bash
tools/ingest/install.sh
```

To run a pass now, by hand:

```bash
node tools/ingest/pass.mjs
```

## Remove it

```bash
tools/ingest/install.sh --remove
```

## What it needs

- The mini on, and the command-line Claude signed in to your claude.ai account, with the Skippy OS, Google Calendar and Gmail connectors on that account.
- For messages, the exporter described in `docs/imessage.md`.
- `~/.skippy-os/runner.env`, which the chat runner also uses, to report a pass that failed.

It does not need the Claude desktop app to be open.

## Why not a scheduled task in the Claude desktop app

That was the first plan, and the task still exists there, switched off. Its one run stopped after 28 seconds: a session started by the desktop app is given a list of Skippy OS's tools that the app holds from earlier, and it had none of the ingestion tools, which were added later. A session started from the command line asks Skippy OS for its tools each time, so it always has the current ones. The desktop task also only asked the session to keep to its tools; the command line enforces it.
