# Sending the work schedule to Skippy OS

The work schedule lives in Microsoft 365. Only the work computer's Claude account can read it, and that computer cannot reach Skippy OS: Zscaler blocks the sign-in, and Outlook only publishes free/busy.

So the work computer sends an email instead. The end-of-day brief task already on the work computer also emails the owner's Gmail. That email carries the coming week's meetings in a fixed block. The Mac mini's 5pm pass reads Gmail, finds that email and copies the meetings onto the Agenda as read-only events. Each email replaces the one before: a meeting that moved shows at its new time, and one that is gone is cancelled.

Three parts: tell Skippy OS your work address, add the email to the brief task, then check the first one arrives.

## 1. Tell Skippy OS your work address

On `www.skippyos.app`, go to Settings, Ingestion, and add a rule with the kind set to **Rule** (not Block) and the source set to Gmail or left on all sources:

```text
My work email address is name@company.com. Skippy work schedule emails from it are mine.
```

The mini's pass copies meetings only from an email sent from that address, so nobody else can put meetings on your calendar by mailing you.

## 2. Add the email to the end-of-day brief task

On the work computer, open the brief task (Code tab, Scheduled) and add this to the end of its prompt. Put in your Gmail address.

````text
After the brief is made, email it to <your Gmail address>.

- Subject: "Skippy work schedule" followed by today's date.
- Body: the brief, then a plain-text block in exactly this form, for my meetings from tomorrow through the next 7 days:

SKIPPY WORK SCHEDULE
from: YYYY-MM-DD   (tomorrow)
to: YYYY-MM-DD     (7 days after tomorrow)
[ ...the meetings as a JSON list, on one or more lines... ]
END SKIPPY WORK SCHEDULE

Each meeting in the list is an object with:
- "id": the event's id in Outlook. If occurrences of a recurring meeting share one id, add "_" and the occurrence's start date.
- "title": the subject.
- "start" and "end": a full time with its offset, like "2026-11-25T15:00:00-05:00". Outlook often gives UTC times without an offset: add "Z" or convert, never leave the offset out. An all-day event uses dates only, like "2026-11-25", with the end the day after its last day.
- "location", when it has one.
- "cancelled": true, when it is marked cancelled.

Put every meeting in the stretch in the list, each occurrence of a recurring meeting on its own. If there are none, send an empty list []. No descriptions, Teams links or attendee lists. Put the block in a <pre> element if the email is HTML, so its lines stay as they are.
````

**How the task sends mail.** Claude's Microsoft 365 connector may only read, not send. Ask Claude in that Code tab to add the step and see whether it can send from your work mailbox. If it cannot, it may be able to send through the Outlook app on that computer instead. If neither works, that is where this stops: bring back what it says.

The first run will ask permission for whatever it uses to send. Choose "Always allow", or the scheduled runs will wait for an answer nobody gives.

## 3. Check the first one

Run the brief task by hand once (Run now). Then on `www.skippyos.app`:

- after the mini's next pass, the meetings are on the Agenda;
- Activity, Ingestion passes, shows that pass, with a note if the email was refused (wrong sender, or a block it could not read).

The mini's passes run on the hour at 9, 11, 1, 3, 5 and 7. A brief sent at 4:30 is copied at 5.

## Good to know

- Companies often block or flag mail sent to personal addresses. If the email never arrives, or IT asks about it, that is why.
- The events are kept apart under the calendar id "m365-work", so the Google Calendar passes never cancel them, and this email never touches Google events.
- Work meetings show the firm's pyramid mark beside their title, on Home, the Agenda and in their window.
- An event you undo on Skippy OS is not copied again.
- To stop it: take the email step out of the brief task. Meetings already copied stay until removed on Skippy OS.
