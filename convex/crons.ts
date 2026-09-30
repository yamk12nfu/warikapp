import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.cron(
  "post fixed costs for the current JST month",
  "5 15 * * *",
  internal.fixedCosts.postCurrentMonth,
  {},
);

crons.cron(
  "purge orphan uploads",
  "30 18 * * *",
  internal.uploads.purgeOrphans,
  {},
);

export default crons;
