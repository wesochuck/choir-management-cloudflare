#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { getPlatformAdminSession } from "./staging-auth-helper.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localStagingEnv = join(repositoryRoot, ".env.staging.local");

// Load local staging env if present
if (existsSync(localStagingEnv)) {
  try {
    const lines = readFileSync(localStagingEnv, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/u);
      if (match) {
        const key = match[1];
        const value = match[2] ?? match[3] ?? match[4] ?? "";
        if (key && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  } catch {
    // Ignore read errors
  }
}

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/u,
  "",
);
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();

const PHASES = [
  {
    args: ["scripts/qualify-staging-auth.mjs"],
    label: "Anonymous & Authenticated Boundary Sweeps",
    name: "auth-boundaries",
  },
  {
    args: ["scripts/qualify-staging-evidence.mjs"],
    label: "Parity Probes & Safe Boundary Evidence",
    name: "parity-probes",
  },
  {
    args: ["scripts/qualify-staging-roster.mjs"],
    label: "Roster CRUD, Import/Export & Isolation",
    name: "roster",
  },
  {
    args: ["scripts/qualify-staging-rsvp-attendance.mjs"],
    label: "RSVP, Attendance Lifecycle & CSV Checksums",
    name: "rsvp-attendance",
  },
  {
    args: ["scripts/qualify-staging-export.mjs"],
    label: "Organization Export Manifest & Checksum Validation",
    name: "export",
  },
  {
    args: ["scripts/qualify-staging-ticket-reminder.mjs"],
    label: "Ticket Reminders & Refund Boundary",
    name: "ticket-reminder",
  },
  {
    args: ["scripts/qualify-staging-queue-dead-letter.mjs"],
    label: "Queue Dead-Letter Creation & Dismissal",
    name: "queue-dead-letter",
  },
  {
    args: ["scripts/qualify-staging-scheduler.mjs"],
    label: "Scheduler, Event Reminders & Attendance Reports",
    name: "scheduler",
  },
  {
    args: ["scripts/qualify-staging-stripe-commerce.mjs"],
    label: "Stripe Sandbox & Commercial Flow Qualification",
    name: "stripe-commerce",
  },
  {
    args: ["scripts/qualify-staging-setup-maintenance.mjs"],
    label: "Setup Wizard & Maintenance Tasks Qualification",
    name: "setup-maintenance",
  },
];

function runPhase(scriptArgs, environment) {
  const result = spawnSync("node", scriptArgs, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

async function main() {
  console.log("=======================================================");
  console.log(" 🚀 Staging Full-Product Automated Qualification Suite");
  console.log(` Target: ${productUrl}`);
  console.log(` User:   ${email}`);
  console.log("=======================================================\n");

  console.log("Step 0: Establishing Authenticated Staging Session...");
  const cookie = await getPlatformAdminSession({ email, productUrl });
  console.log("✅ Authenticated staging session active.\n");

  const environment = {
    ...process.env,
    STAGING_AUTH_EMAIL: email,
    STAGING_EXPORT_CREATE: process.env.STAGING_EXPORT_CREATE ?? "1",
    STAGING_PRODUCT_URL: productUrl,
    STAGING_RUN_MAINTENANCE: "1",
    STAGING_SESSION_COOKIE: cookie,
    STAGING_STATUS_AUTOMATION_ALLOW_FIXTURE: "1",
  };

  const onlyFilter = process.argv
    .slice(2)
    .find((arg) => !arg.startsWith("--plan"))
    ?.replace(/^--only=/, "")
    ?.trim()
    ?.toLowerCase();

  const phasesToRun = onlyFilter
    ? PHASES.filter(
        (phase, idx) =>
          phase.name.toLowerCase().includes(onlyFilter) || String(idx + 1) === onlyFilter,
      )
    : PHASES;

  if (phasesToRun.length === 0) {
    console.error(
      `Unknown phase filter "${onlyFilter}". Available phases: ${PHASES.map((p) => p.name).join(", ")}`,
    );
    process.exit(1);
  }

  const results = [];
  let failures = 0;

  for (const [index, phase] of phasesToRun.entries()) {
    console.log(`\n-------------------------------------------------------`);
    console.log(
      `[Phase ${String(index + 1)}/${String(phasesToRun.length)}] Running ${phase.label}...`,
    );
    console.log(`-------------------------------------------------------`);

    const startTime = Date.now();
    const status = runPhase(phase.args, environment);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    if (status === 0) {
      console.log(`\n✅ PASS ${phase.name} (${duration}s)`);
      results.push({ duration, name: phase.name, passed: true });
    } else {
      console.log(`\n❌ FAIL ${phase.name} (${duration}s, exit code: ${String(status)})`);
      results.push({ duration, name: phase.name, passed: false });
      failures += 1;
      // Continue through remaining phases to capture full report
    }
  }

  console.log("\n=======================================================");
  console.log(" 📊 Staging Qualification Summary");
  console.log("=======================================================");
  for (const res of results) {
    console.log(`${res.passed ? "✅ PASS" : "❌ FAIL"} ${res.name} (${res.duration}s)`);
  }
  console.log("=======================================================");
  console.log(
    `Total: ${String(results.length)} phases | Passed: ${String(results.length - failures)} | Failed: ${String(failures)}`,
  );
  console.log("=======================================================\n");

  if (failures > 0) {
    process.exitCode = 1;
  }
}

await main();
