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

- [ ] **The chat box and the Home box should work like Claude's composer.** (2026-11-22) Today the chat box is a plain text field that takes no files, and Home has a text field with three buttons (Capture, Hold for 7 days, Chat) and an "Attach a file" link.
  - **Shape, both pages:** one rounded box that grows as the text does, with a row of buttons inside it: add a file on the left, send on the right. Enter sends, Shift+Enter starts a new line.
  - **Files:** add with the button, by pasting an image, or by dragging one in. Each shows as a small chip that can be removed before sending. Several at once.
  - **Claude reads what is attached.** Decided 2026-11-22: images and PDFs to begin with, kept in Convex file storage like every other file. This means a chat message can carry files, and the chat runner on the mini has to hand them to the session. It is the larger part of the work.
  - **Home, one switch instead of three buttons.** Decided 2026-11-22: a three-way switch, Chat / Capture / Hold, with one send button. Chat is where it starts and where it goes back to after each send, so a switch left on Hold cannot quietly send things to the seven-day pile. This changes what Enter does on Home: today it captures. With files allowed in a chat, attaching one no longer rules Chat out, and the `/chat` shortcut is no longer needed.
  - **Not copied from Claude:** the model picker and the tools menu. The mini decides those.
  - **Later pass:** a microphone button, tap to dictate and hold to dictate. Check first what speech-to-text the iPhone browser and the Home Screen app allow.
- [ ] **A details window should open for reading, not as a form.** (2026-11-22) Opening a task, or any other record, shows its edit form straight away. Wanted: the window opens showing the record laid out to be read, with an Edit button that switches it to the form. This covers both details windows: the one for tasks and the one for everything else (events, recurrences, people, notes and the rest).
- [ ] **Chat: keep the composer pinned to the bottom of the screen.** (2026-11-22) The box is already set to stick to the bottom, but that only holds once the chat is longer than the screen; in a short chat it sits just under the last message. Wanted: always at the bottom of the screen, as in Claude, with the messages scrolling above it. Check it on the phone with the keyboard open. Do it together with the composer item above.

## Ideas

New things the app could do, or do differently. Things already set aside on purpose are listed in the spec under "After Phase 7", so they need not be repeated here.

_Nothing yet._

## Done or decided

_Nothing yet._
