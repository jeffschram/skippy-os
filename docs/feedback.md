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

- [x] **A roomier composer.** Asked and built 2026-11-25. The box starts two lines tall, with a little more padding, and sits higher off the bottom of the screen: 24 pixels in a browser, the phone's home bar plus 12 when Skippy OS is on the home screen. Pages and chats leave more room at the end so nothing hides behind it.
- [x] **Google Maps links for places.** Asked and built 2026-11-25. An event's or a task's place opens Google Maps, in its row and in its window, where one place also gets a Directions link from wherever you are. A trip written "Home → Westchester County Airport (HPN)" opens as directions, starting from the home address in Settings (or from where you are, until one is saved there). Tasks gained a Where field, and calls, meeting links and "TBD" stay plain words.
- [x] **Coming up and Tasks first on a project page.** Asked and built 2026-11-25. Right under the project's heading and settings, above Status.
- [x] **Flights not under their trip's project.** Asked 2026-11-25. The flights are copies from Google Calendar, which Skippy could not change at all, so they could not be given a project. Now a calendar copy's window has an edit button with only a Project field; its title, time and details still change in the calendar. Skippy's own events get a Project field too, and a project's page has a Coming up panel listing its events still to come.
- [x] **A Skippy desktop app.** Suggested and built 2026-11-25, after Claude's "Install as app" beta came out: https://claude.ai/artifact/GJCX8X2Hp4cXUMgfRV6hh9, source in `tools/desktop-app/skippy.html`. A capture box (or Hold for another device) and today's events and tasks in time order, with tasks you can tick off. Installed from the artifact's Share menu, it gets its own window and icon, a Dock badge with the count of open tasks, a menu bar item showing the next event, and Option+Shift+S to capture from anywhere. It talks to Skippy OS through your connector, so it needs no server changes. Not yet tried as an installed app.
- [x] **Bold headings and roomier bullets in the briefing.** Asked and built 2026-11-24. Headings such as "Since yesterday", and "Still ahead today:" in older briefings, show in bold at the same size, sitting close to their list. Bullets have more space between them, and sections more again. The weekly review looks the same way.
- [x] **Larger text on phones.** Asked and built 2026-11-24. On screens narrower than 640 pixels every text size steps up about two pixels: body text and list titles from 16 to 18, smaller lines from 14 to 16. Buttons, and the Chat / Capture / Hold switch, stay the size they were.
- [x] **Details / Chat switch on a phone.** Asked and built 2026-11-24, after the chat was too squeezed to read on the phone. On a phone, or a screen 720 pixels tall or less, a details window has a Details / Chat switch; Chat gives the chat the whole height. Larger screens show both together, as before.
- [x] **A shorter briefing that does not repeat Today, and a calmer Today list.** Asked and built 2026-11-24. The briefing is now up to three short sections, each a bold label with bullet points, about 120 words at most: **Since yesterday** (what moved since yesterday's first briefing: tasks done, project updates, replies that came in), **Worth knowing** (news that made no record) and **Heads-up** (only what the lists below cannot show, such as a clash or something to do now for tomorrow). It no longer lists today's or tomorrow's events and tasks. Home shows the bold labels and bullets. On Today and Upcoming, a day's all-day events sit on one "All day:" line at the top, and each opens in its window, which now has a Done box. Every tick is the same grey, whether you ticked it or the clock did. A row's second line stays on one line. Turned down the same day: moving finished items to the bottom, because a list that keeps its order is easier to take in.
- [x] **Chats support Markdown, with links you can click.** Asked and built 2026-11-24. Replies show lists, bold and links, and links open in a new tab. Bare site names such as celebrationcinema.com become links too, so older replies work. Chat sessions are now told to link the exact page they read.
- [x] **A skill for delegated tasks.** Suggested and built 2026-11-24: `skippy-delegate`, in `plugin/skills/`. A delegated task's session loads it first. It says how to work the task, what is off limits, how to report as it goes, to add a dated "From Skippy" summary to the task, and to set the task to done, to do or waiting when it stops. Edit the skill to change how delegation behaves.
- [x] **Events show as done on Home.** Asked and built 2026-11-24. An event is crossed out and greyed, like a finished task, once it is over: at its end time, an hour after it starts when it has no end, or at midnight when it is all day. Before then its box ticks it off early, and ticking again takes that back. This works for Google Calendar copies too; the tick stays in Skippy and Google Calendar never sees it. Done events stay in the list rather than leaving it. The same rows are on the Agenda.
- [x] **Done box and "Delegate to Skippy" in a task's window.** Asked and built 2026-11-24. The Done box ticks the task off. "Delegate to Skippy", in the task's chat box, has the mini work on the task and post what it finds in the chat as it goes. It can research, read your records, draft, update that task and mark it done, but it never buys, books, signs in or sends anything: it gets those ready and leaves them to you. Not yet tried on the live site.
- [x] **Icon buttons in details windows.** Asked and built 2026-11-24. Edit is a pencil and Close is an X, each in a rounded square button at the top right. The pencil is hidden while editing, and for calendar events that are changed in Google Calendar.
- [x] **Details windows fit the screen; chat bubbles.** Asked and built 2026-11-24. The window is never taller than the screen: the record's text has a maximum height, and the chat fills what is left and scrolls inside. Links, source and history fold under one line named for what is in it ("Source and history"). In every chat your messages are on the right in a shaded box, at most 80% wide, and the "You / Skippy · time" lines are gone. On a short screen (about 770 pixels or less) with a long record, the window still scrolls a little.
- [x] **Lighter details windows, and no add-task form on Home.** Asked and built 2026-11-24. No "Chat" heading over the chat box. No separate "Add a file" button: a file sent in the record's chat is added to the record's files. Files are folded under "Files · N" and hidden when there are none. Today on Home no longer has the add-a-task form. The chat box takes only images and PDFs, so other kinds of file can no longer be added from a details window; asked the same day, the owner chose to keep it that way.
- [x] **Home: Ingested to Activity, no Projects or Recent activity.** Asked and built 2026-11-24. Ingested, with its undo, is on Activity under the inbox. Home ends with Chats, then Needs you when something needs you.
- [x] **Chat inside a details window, one per record.** Asked and built 2026-11-24. A task, event, repeating item or anything in Memory has one chat, shown in its window with the same composer as the chat page (images and PDFs, no Capture or Hold). Nothing opens in a new page. Records that already had several chats show the newest, with the others under "Earlier chats about this". Projects keep several chats on their page.
- [x] **Home order: Briefing, Today, Upcoming, Weekly review, Chats.** Asked and built 2026-11-24. Today lists tasks and events together in time order. Upcoming is new: the next seven days, a heading a day, in time order. The inbox moved to the Activity page, and "Since you last looked" left Home (Activity's "Claude and other agents" view has the same lines). Needs you, Ingested, Projects and Recent activity stay on Home, below Chats.
- [x] **The chat box and the docked box work like Claude's composer.** Asked 2026-11-22, built 2026-11-23 in `ec62e4e`. One rounded box that grows with the words, add-file on the left, send on the right; files by button, paste or drag, shown as chips. A chat takes up to ten images and PDFs and its session on the mini reads them. The docked box has a Chat / Capture / Hold switch that starts on Chat and goes back to it after each send; it is on every page, not only Home. A capture still keeps one file. Not copied from Claude: the model picker and tools menu. Dictation is left open under Ideas.
- [x] **A details window opens for reading.** Asked 2026-11-22, built 2026-11-23 in `ec62e4e`. Tasks and everything in Memory and on the Agenda open laid out to read, with an Edit button. Saving or cancelling goes back to the reading view.
- [x] **The chat composer is pinned to the bottom of the screen.** Asked 2026-11-22, built 2026-11-23 in `ec62e4e`. Not yet tried on an iPhone with the keyboard open.
- [x] **A chat can open and read web pages.** Asked and built 2026-11-23, after a chat about flights said it could not see fares. Chat sessions on the mini have a separate, signed-out browser for reading pages and working search forms. It is not your Chrome, so it cannot see anything behind a sign-in, and seat maps may be out of reach. How to turn it off is in `docs/chat-runner.md`.
