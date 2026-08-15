import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { getStagingSession } from "./staging-auth-helper.mjs";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
const suppliedSessionCookie = process.env.STAGING_SESSION_COOKIE?.trim() ?? "";
const runKey = (process.env.STAGING_BATCH_RUN_KEY ?? randomUUID().slice(0, 8)).trim().toLowerCase();
const includeRosterAutomation = process.env.STAGING_INCLUDE_ROSTER_AUTOMATION === "1";

if (!/^[a-z0-9-]{4,40}$/.test(runKey)) {
  throw new Error(
    "STAGING_BATCH_RUN_KEY must contain 4-40 lowercase letters, numbers, or hyphens.",
  );
}

export function providerIndependentQualificationPlan(options = {}) {
  const plan = [
    "authenticate once in the user's own terminal without printing the session cookie",
    "run roster create/update/import/export/directory/isolation qualification",
    "reuse the same in-memory session for RSVP notes, attendance, finalization, export, and isolation",
    "stop on a failed batch phase and retain only bounded phase summaries",
  ];
  if (options.includeRosterAutomation === true) {
    plan.splice(
      3,
      0,
      "optionally reuse the same session for roster status automation and isolation",
    );
  }
  return plan;
}

function runPhase(script, environment) {
  const result = spawnSync("node", [script], {
    env: environment,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

async function main() {
  if (process.argv.includes("--plan-only")) {
    for (const [index, step] of providerIndependentQualificationPlan({
      includeRosterAutomation,
    }).entries()) {
      console.log(`${String(index + 1)}. ${step}`);
    }
    return;
  }

  const cookie = await getStagingSession({
    email,
    productUrl,
    sessionCookie: suppliedSessionCookie || undefined,
  });

  const environment = {
    ...process.env,
    STAGING_BATCH_RUN_KEY: runKey,
    STAGING_ROSTER_RUN_KEY: runKey,
    STAGING_RSVP_RUN_KEY: runKey,
    STAGING_RSVP_PROFILE_PREFIX: `Qualification Roster CRUD ${runKey}`,
    STAGING_SESSION_COOKIE: cookie,
  };
  const rosterStatus = runPhase("scripts/qualify-staging-roster.mjs", environment);
  if (rosterStatus !== 0) {
    throw new Error(`Roster qualification failed with exit status ${String(rosterStatus)}.`);
  }
  const rsvpStatus = runPhase("scripts/qualify-staging-rsvp-attendance.mjs", environment);
  if (rsvpStatus !== 0) {
    throw new Error(`RSVP/attendance qualification failed with exit status ${String(rsvpStatus)}.`);
  }
  const phases = ["roster", "rsvp-attendance"];
  if (includeRosterAutomation) {
    const automationStatus = runPhase("scripts/qualify-staging-roster-automation.mjs", environment);
    if (automationStatus !== 0) {
      throw new Error(
        `Roster automation qualification failed with exit status ${String(automationStatus)}.`,
      );
    }
    phases.push("roster-automation");
  }
  console.log(
    JSON.stringify({
      completed: true,
      phases,
      runKey,
    }),
  );
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
