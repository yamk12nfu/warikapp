import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.cron(
  "post fixed costs for the current JST month",
  "5 15 * * *",
  internal.fixedCosts.postCurrentMonth,
  {},
);

export default crons;
