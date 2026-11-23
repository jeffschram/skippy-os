# The chat runner

A chat in the dashboard is a Claude Code session on the mini. When you send a message, Skippy OS saves it and queues a turn. The chat runner on the mini picks the turn up, runs the session, and writes the reply back as it comes.

If the runner is not going, nothing is lost: your message waits, the page says "Waiting for the Mac mini", and it is answered when the runner is back.

## The parts

| Part | Where | What it does |
| --- | --- | --- |
| The runner | `tools/chat-runner/runner.mjs` | One loop: say "alive" every half minute, claim the oldest waiting turn, run it, finish it. |
| Its secret | `~/.skippy-os/runner.env` | The address of the Convex deployment and the runner's token. Only your user can read it. The server holds the token's SHA-256, never the token. |
| The sessions | `~/.skippy-os/chat-workspace` | Where chat sessions run. A chat about a code project runs in that project's folder instead. |

## What a chat session may do

- Use the Skippy OS connector on your claude.ai account, to read and change your records.
- Search the web.
- Open and read web pages in a browser of its own, for what a search does not answer: fares, prices, timetables. It is a hidden Chrome with an empty profile, signed in nowhere, that remembers nothing between replies. It is not your Chrome. The session can work a search form, but it is told not to sign in, buy, book or send your details anywhere, and it cannot run script on a page or put a file into one.
- In a chat about a code project, read that project's files.
- Read the images and PDFs the owner attaches to a message. The runner copies them into `~/.skippy-os/chat-workspace/files/<chat>/` and tells the session where they are. That folder is inside the one idea chats run in, which is the only place such a session can read; a code project's session could already read files. The copies are removed after fourteen days; the originals stay in Skippy OS.

It may not edit files or run commands. Code changes happen in a real Claude Code session.

When something in a chat should become a record, the session offers a card under its reply. You change what you like and press Create, or Not now. Nothing is created until you do. Accepting a project card turns the chat into that project's chat, and tasks you accept after it join the project.

## Carrying a chat on in the Claude app

"Continue in Claude" on a chat has the session write a brief for a Claude session that has not seen the chat. Skippy OS keeps it in the project's notes, or as a note in Memory when the chat is not about a project, and the chat gives you a button to copy it.

## The browser

The browser comes from Microsoft's Playwright MCP server, which is installed with the repo's other packages (`pnpm install`) and needs Google Chrome on the mini. The runner's first line in the log ends "with a browser for chats" when it is on.

A chat session can read your records, and a browser can send anything anywhere, so a page written to mislead the session could try to get your records sent out. The session is told to treat what a page says as information and not instructions, but that is an instruction, not a wall. To take the browser away, add this line to `~/.skippy-os/runner.env` and restart the runner:

```
CHAT_BROWSER=off
```

```bash
launchctl kickstart -k gui/$(id -u)/app.skippyos.chat-runner
```

## Install it

```bash
tools/chat-runner/install.sh
```

This installs one per-user background job, `app.skippyos.chat-runner`, which starts the runner now and at each login and restarts it if it stops. It prints the runner's last word; "chat runner 1 on … talking to …" means it is up. The log is `~/.skippy-os/chat-runner.log`.

To run it by hand instead, for a look:

```bash
node tools/chat-runner/runner.mjs
```

## Remove it

```bash
tools/chat-runner/install.sh --remove
```

## If it goes wrong

- **"Waiting for the Mac mini" never clears.** The runner is not going. Look at the log, then install it again.
- **A reply stops half-way.** If the runner or its session dies, the turn is marked failed within about two minutes and says so. Send the message again.
- **A chat says a site refused the browser.** Some sites turn a hidden browser away. Ask it to try another site, or look yourself.
- **"bad_runner_token" in the log.** The token in `runner.env` no longer matches the server. Make a new pair: delete `runner.env` and ask Claude to set up the runner's secret again.
