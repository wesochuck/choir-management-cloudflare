import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
const suppliedSessionCookie = process.env.STAGING_SESSION_COOKIE?.trim() ?? "";
const runExport = process.env.STAGING_FOLLOW_UP_EXPORT !== "0";
const runTicketReminder = process.env.STAGING_FOLLOW_UP_TICKET_REMINDER !== "0";
const planOnly = process.argv.includes("--plan-only");

export function followUpQualificationPlan() {
  return [
    "authenticate once in the user's own terminal without printing the session cookie",
    "verify the guarded Organization-export path, creating an artifact only with STAGING_EXPORT_CREATE=1",
    "reuse the same session for the ticket-reminder and refund-boundary qualification",
    "leave provider-backed payment actions disabled unless the existing ticket qualifier explicitly requests them",
  ];
}

export function reusableStagingSessionCookie(value) {
  const cookie = value.trim();
  if (!cookie) return null;
  if (!cookie.includes("choir-management.session_token=")) {
    throw new Error("STAGING_SESSION_COOKIE is not a staging session cookie.");
  }
  return cookie;
}

export function followUpPhases(options = {}) {
  const phases = [];
  if (options.runExport !== false) phases.push("export");
  if (options.runTicketReminder !== false) phases.push("ticket-reminder");
  return phases;
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

async function request(path, body) {
  const response = await fetch(`${productUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Sign-in request failed with HTTP ${String(response.status)}.`);
  }
  return response;
}

async function authenticate(readline) {
  const reusableCookie = reusableStagingSessionCookie(suppliedSessionCookie);
  if (reusableCookie) return reusableCookie;

  await request("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
  console.log(`A sign-in code was requested for ${email}.`);
  const code = (
    await readline.question("Enter the six-digit sign-in code (not recorded): ")
  ).trim();
  if (!/^\d{6}$/.test(code)) throw new Error("The sign-in code must contain exactly six digits.");

  const response = await request("/api/auth/sign-in/email-otp", { email, otp: code });
  const cookie = sessionCookieFrom(response);
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
  if (planOnly) {
    for (const [index, step] of followUpQualificationPlan().entries()) {
      console.log(`${String(index + 1)}. ${step}`);
    }
    return;
  }

  const phases = followUpPhases({ runExport, runTicketReminder });
  if (phases.length === 0)
    throw new Error("At least one follow-up qualification phase is required.");

  const readline = createInterface({ input, output });
  const cookie = await authenticate(readline).finally(() => readline.close());
  const environment = {
    ...process.env,
    STAGING_AUTH_EMAIL: email,
    STAGING_SESSION_COOKIE: cookie,
  };

  if (runExport) {
    const exportStatus = runPhase("scripts/qualify-staging-export.mjs", environment);
    if (exportStatus !== 0) {
      throw new Error(
        `Organization-export qualification failed with exit status ${String(exportStatus)}.`,
      );
    }
  }

  if (runTicketReminder) {
    const ticketStatus = runPhase("scripts/qualify-staging-ticket-reminder.mjs", environment);
    if (ticketStatus !== 0) {
      throw new Error(
        `Ticket-reminder qualification failed with exit status ${String(ticketStatus)}.`,
      );
    }
  }

  console.log(JSON.stringify({ completed: true, phases }));
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
