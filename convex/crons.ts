import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Held captures lapse after seven days. 09:10 UTC is the small hours in New York.
crons.daily("remove lapsed held captures", { hourUTC: 9, minuteUTC: 10 }, internal.captures.expireHolds);

export default crons;
