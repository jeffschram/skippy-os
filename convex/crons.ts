import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Held captures lapse after seven days. 09:10 UTC is the small hours in New York.
crons.daily("remove lapsed held captures", { hourUTC: 9, minuteUTC: 10 }, internal.captures.expireHolds);

// A chat turn whose runner stopped holding it is failed, so the chat is never left looking busy.
crons.interval("fail chat turns the runner dropped", { minutes: 1 }, internal.chats.reapStalled);

// Reminders before events and tasks with a time of day.
crons.interval("send reminders", { minutes: 1 }, internal.reminders.sendDue);

export default crons;
