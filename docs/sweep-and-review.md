# The nightly sweep and the weekly review

Two jobs that catch what a busy week hides. Both run a Claude Code session from the command line with an exact list of tools, like the ingestion passes.

## The nightly sweep

Sessions that work on a code project are meant to report their status to Skippy OS. When one does not, the dashboard goes quiet although work was done.

At 3:30 each morning `tools/schedule/sweep.mjs` looks at every active code project that has a code folder. It reads the commits in that folder, on any branch. If there are commits newer than the project's last status report, it has a session write the report that was missed, from the commit messages alone, and the report is marked "from the nightly sweep, written from commits" on the project's page.

A project is never reported twice for the same commits: once the report is written it is newer than they are, and each project keeps the time it was swept up to.

The sweep's session can read one project and record one status report. It cannot change tasks, set a project's health, or read files.

It covers code projects only. A general project has no commits to read, so it relies on the status skill and on the stale flag.

## The weekly review

At 6pm each Sunday `tools/schedule/review.mjs` has a session read the week in Skippy OS (projects, what changed, what is overdue or waiting, the next seven days, your goals) and write you about 300 words: what moved, what has gone quiet with a question about each, what is overdue or waiting, what is coming, and how each goal stands.

The review is kept for a week under the briefing on Home, and your phone is told when it is ready. Its session reads, and saves the review; it changes nothing else.

## Install them

```bash
tools/schedule/install.sh
```

To run either now:

```bash
node tools/schedule/sweep.mjs
```

```bash
node tools/schedule/review.mjs
```

## Remove them

```bash
tools/schedule/install.sh --remove
```

Logs are in `~/.skippy-os/sweep/sweep.log` and `~/.skippy-os/review/review.log`, with the last session of each beside them.
