import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

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

function sessionCookieFrom(response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""];
  return setCookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

async function prompt(readline, message) {
  return (await readline.question(message)).trim();
}

async function authenticate(readline) {
  if (suppliedSessionCookie) {
    if (!suppliedSessionCookie.includes("choir-management.session_token=")) {
      throw new Error("STAGING_SESSION_COOKIE is not a staging session cookie.");
    }
    return suppliedSessionCookie;
  }
  const otpResponse = await fetch(`${productUrl}/api/auth/email-otp/send-verification-otp`, {
    body: JSON.stringify({ email, type: "sign-in" }),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });
  if (!otpResponse.ok) {
    throw new Error(`Sign-in code request failed with HTTP ${String(otpResponse.status)}.`);
  }
  console.log(`A sign-in code was requested for ${email}.`);
  const code = await prompt(readline, "Enter the six-digit sign-in code (not recorded): ");
  if (!/^\d{6}$/.test(code)) throw new Error("The sign-in code must contain exactly six digits.");
  const signInResponse = await fetch(`${productUrl}/api/auth/sign-in/email-otp`, {
    body: JSON.stringify({ email, otp: code }),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });
  if (!signInResponse.ok) {
    throw new Error(`Sign-in request failed with HTTP ${String(signInResponse.status)}.`);
  }
  const cookie = sessionCookieFrom(signInResponse);
  if (!cookie.includes("choir-management.session_token=")) {
    throw new Error("The sign-in response did not return a staging session cookie.");
  }
  return cookie;
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

  const readline = createInterface({ input, output });
  const cookie = await authenticate(readline).finally(() => readline.close());

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
