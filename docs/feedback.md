# Feedback and ideas for the web app

The owner's notes on using Skippy OS at `www.skippyos.app`: what is wrong or awkward, and what it could do next. This is the inbox. The spec (`skippy-os-spec-alt.html`) stays the record of what is decided and built.

## How to use it

- Add a line under **Feedback** or **Ideas**, newest at the bottom. Rough wording is fine. Say which page it is about if it is not obvious.
- Or tell Claude in any session: "add to feedback: ...".
- When an item is picked up it moves to **Done or decided**, with the date and either the commit that did it or the reason it was turned down. Anything decided also goes in the spec's decision log.
- This repo is public. Keep other people's names, addresses and anything private out of it.

A line looks like this:

```
- [ ] Agenda: the area filter resets when I change the week. (2026-11-22)
```

## Feedback

Things that are wrong, slow, confusing or awkward.

_Nothing waiting._

## Ideas

New things the app could do, or do differently. Things already set aside on purpose are listed in the spec under "After Phase 7", so they need not be repeated here.

- [ ] **Dictation in the composer.** (2026-11-22) A microphone button: tap to dictate, hold to dictate. Left for a later pass when the composer was built. Check first what speech-to-text the iPhone browser and the Home Screen app allow.

## Done or decided

- [x] **Lighter details windows, and no add-task form on Home.** Asked and built 2026-11-24. No "Chat" heading over the chat box. No separate "Add a file" button: a file sent in the record's chat is added to the record's files. Files are folded under "Files · N" and hidden when there are none. Today on Home no longer has the add-a-task form. The chat box takes only images and PDFs, so other kinds of file can no longer be added from a details window; asked the same day, the owner chose to keep it that way.
- [x] **Home: Ingested to Activity, no Projects or Recent activity.** Asked and built 2026-11-24. Ingested, with its undo, is on Activity under the inbox. Home ends with Chats, then Needs you when something needs you.
- [x] **Chat inside a details window, one per record.** Asked and built 2026-11-24. A task, event, repeating item or anything in Memory has one chat, shown in its window with the same composer as the chat page (images and PDFs, no Capture or Hold). Nothing opens in a new page. Records that already had several chats show the newest, with the others under "Earlier chats about this". Projects keep several chats on their page.
- [x] **Home order: Briefing, Today, Upcoming, Weekly review, Chats.** Asked and built 2026-11-24. Today lists tasks and events together in time order. Upcoming is new: the next seven days, a heading a day, in time order. The inbox moved to the Activity page, and "Since you last looked" left Home (Activity's "Claude and other agents" view has the same lines). Needs you, Ingested, Projects and Recent activity stay on Home, below Chats.
- [x] **The chat box and the docked box work like Claude's composer.** Asked 2026-11-22, built 2026-11-23 in `ec62e4e`. One rounded box that grows with the words, add-file on the left, send on the right; files by button, paste or drag, shown as chips. A chat takes up to ten images and PDFs and its session on the mini reads them. The docked box has a Chat / Capture / Hold switch that starts on Chat and goes back to it after each send; it is on every page, not only Home. A capture still keeps one file. Not copied from Claude: the model picker and tools menu. Dictation is left open under Ideas.
- [x] **A details window opens for reading.** Asked 2026-11-22, built 2026-11-23 in `ec62e4e`. Tasks and everything in Memory and on the Agenda open laid out to read, with an Edit button. Saving or cancelling goes back to the reading view.
- [x] **The chat composer is pinned to the bottom of the screen.** Asked 2026-11-22, built 2026-11-23 in `ec62e4e`. Not yet tried on an iPhone with the keyboard open.
- [x] **A chat can open and read web pages.** Asked and built 2026-11-23, after a chat about flights said it could not see fares. Chat sessions on the mini have a separate, signed-out browser for reading pages and working search forms. It is not your Chrome, so it cannot see anything behind a sign-in, and seat maps may be out of reach. How to turn it off is in `docs/chat-runner.md`.
