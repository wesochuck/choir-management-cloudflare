import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

import { AUDIT_STEP_LABEL, runCheckCi } from "./check-ci-runner.mjs";
import {
  DEFAULT_HEARTBEAT_MS,
  formatDuration,
  isVerboseMode,
  runCompactStep,
  writeStepLog,
} from "./check-step-runner.mjs";

const manifestName = "release-manifest.json";
const logDir = ".cache/check-logs/check-ci";

// Enforces the local release qualification checks before promotion.
// The browser E2E job is not run here because it needs Playwright browsers installed; see the note below.
// Usage: `npm run check:ci` (strict, compact by default) or `npm run check:ci:dev` (explicit
// development mode: same checks, but a recognized transient audit outage with all other checks
// passing exits 0 and is clearly labeled DEGRADED instead of qualified).
// Pass `--verbose` or set `CHECK_VERBOSE=1` to stream full step output live.
const steps = [
  {
    job: "static",
    label: "Verify lockfile matches manifests",
    command: "node",
    args: ["scripts/check-lockfile.mjs"],
  },
  {
    job: "static",
    label: "Check Durable Object RPC boundaries",
    command: "node",
    args: ["scripts/check-durable-object-boundaries.mjs"],
  },
  {
    job: "static",
    label: "Check DO runtime boundaries",
    command: "npm",
    args: ["run", "check:do-runtime"],
  },
  { job: "static", label: "Check formatting", command: "npm", args: ["run", "format:check"] },
  {
    job: "static",
    label: "Check Content Security Policy headers",
    command: "node",
    args: ["scripts/check-csp.mjs"],
  },
  {
    job: "static",
    label: "Check no eyebrows in design system",
    command: "node",
    args: ["scripts/check-no-eyebrows.mjs"],
  },
  {
    job: "static",
    label: "Lint",
    command: "npm",
    args: ["run", "lint"],
    warningMode: "eslint",
  },
  {
    job: "static",
    label: "Check unused dependencies and exports (Knip)",
    command: "npm",
    args: ["run", "knip"],
  },
  { job: "static", label: "Check spacing tokens", command: "npm", args: ["run", "check:spacing"] },
  {
    job: "static",
    label: "Check control-row vertical alignment",
    command: "npm",
    args: ["run", "check:control-alignment"],
  },
  { job: "contracts", label: "Typecheck", command: "npm", args: ["run", "typecheck"] },
  {
    job: "contracts",
    label: "Check exported contracts",
    command: "npm",
    args: ["run", "check:contracts:exports"],
  },
  {
    job: "contracts",
    label: "Check Worker route registrations",
    command: "npm",
    args: ["run", "check:routes"],
  },
  { job: "unit", label: "Run unit tests", command: "npm", args: ["test"] },
  {
    job: "build-release",
    label: "Build deployable artifact",
    command: "npm",
    args: ["run", "build"],
    warningMode: "build",
  },
  {
    job: "build-release",
    label: "Record release identity and file hashes",
    command: "node",
    args: ["scripts/release-artifact.mjs", "create", "--sha"],
  },
  {
    job: "build-release",
    label: "Verify release artifact",
    command: "node",
    args: ["scripts/release-artifact.mjs", "verify", "--sha"],
  },
  {
    job: "integration",
    label: "Run Workerd integration tests",
    command: "npm",
    args: ["run", "test:integration:prepared"],
  },
];

function headSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

// The release manifest is a tracked build artifact; restore its pre-run bytes
// so a local check does not dirty the working tree.
const previousManifest = existsSync(manifestName) ? readFileSync(manifestName) : null;

function restoreManifest() {
  if (previousManifest === null) {
    if (existsSync(manifestName)) unlinkSync(manifestName);
  } else {
    writeFileSync(manifestName, previousManifest);
  }
}

const commitSha = headSha();
const dev = process.argv.includes("--dev");
const verbose = isVerboseMode();
const nested = process.env.CHECK_NESTED === "1";
const indent = nested ? "  " : "";

function runStep(step, meta) {
  const args = step.args.flatMap((argument) =>
    argument === "--sha" ? ["--sha", commitSha] : [argument],
  );
  return runCompactStep({
    args,
    command: step.command,
    cwd: process.cwd(),
    index: meta?.index ?? null,
    indent,
    job: `CI ${step.job} job`,
    label: step.label,
    logDir: verbose ? null : logDir,
    total: meta?.total ?? null,
    verbose,
    warningMode: step.warningMode ?? false,
  });
}

function parseAuditPayload(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return {
      attempts: 0,
      outcome: "failed_unknown",
      reason: "audit wrapper produced no parseable outcome",
    };
  }
}

// The strict audit wrapper prints its typed outcome as JSON to stdout and
// human diagnostics to stderr. Nonzero exits still carry a parseable
// outcome; anything else is an unknown audit failure.
function runAuditJson(meta) {
  const args = ["scripts/run-dependency-audit.mjs", "--format=json"];
  const startedAt = Date.now();
  const index = meta?.index ?? 1;
  const total = meta?.total ?? steps.length + 1;

  if (verbose) {
    process.stdout.write(`\n=== ${AUDIT_STEP_LABEL} (CI static job)\n`);
  } else {
    process.stdout.write(`${indent}[${String(index)}/${String(total)}] ${AUDIT_STEP_LABEL} ... `);
  }

  return new Promise((resolve) => {
    const child = spawn("node", args, {
      cwd: process.cwd(),
      stdio: verbose ? ["ignore", "pipe", "inherit"] : ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let heartbeats = 0;

    const timer =
      !verbose && DEFAULT_HEARTBEAT_MS > 0
        ? setInterval(() => {
            const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
            const lead = heartbeats === 0 ? "\n" : "";
            heartbeats += 1;
            process.stdout.write(
              `${lead}${indent}  … still running (${String(elapsedSeconds)}s)\n`,
            );
          }, DEFAULT_HEARTBEAT_MS)
        : null;
    if (timer && typeof timer.unref === "function") timer.unref();

    const forwardSignal = (signal) => {
      child.kill(signal);
    };
    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);

    const cleanup = () => {
      if (timer) clearInterval(timer);
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
    };

    child.stdout?.on("data", (chunk) => stdoutChunks.push(chunk.toString("utf8")));
    child.stderr?.on("data", (chunk) => stderrChunks.push(chunk.toString("utf8")));

    child.once("error", (error) => {
      cleanup();
      if (!verbose) {
        const elapsed = formatDuration(Date.now() - startedAt);
        process.stdout.write(
          heartbeats > 0
            ? `${indent}✗ [${String(index)}/${String(total)}] ${AUDIT_STEP_LABEL} (${elapsed})\n`
            : `✗ (${elapsed})\n`,
        );
      }
      resolve({
        attempts: 0,
        outcome: "failed_unknown",
        reason: `audit wrapper crashed: ${error.message}`,
      });
    });

    child.once("close", (code) => {
      cleanup();
      const durationMs = Date.now() - startedAt;
      const elapsed = formatDuration(durationMs);
      const stdout = stdoutChunks.join("");
      const stderr = stderrChunks.join("");
      const parsed = parseAuditPayload(stdout);

      if (!verbose) {
        writeStepLog({
          args,
          command: "node",
          durationMs,
          exitCode: code ?? (parsed.outcome === "passed" ? 0 : 1),
          index,
          label: AUDIT_STEP_LABEL,
          logDir,
          output: [stdout, stderr].filter(Boolean).join("\n"),
        });

        if (parsed.outcome === "passed") {
          process.stdout.write(
            heartbeats > 0
              ? `${indent}✓ [${String(index)}/${String(total)}] ${AUDIT_STEP_LABEL} (${elapsed})\n`
              : `✓ (${elapsed})\n`,
          );
        } else {
          process.stdout.write(
            heartbeats > 0
              ? `${indent}✗ [${String(index)}/${String(total)}] ${AUDIT_STEP_LABEL} (${elapsed}, ${parsed.outcome})\n`
              : `✗ (${elapsed}, ${parsed.outcome})\n`,
          );
          if (stderr.trim()) {
            process.stderr.write(`${stderr.trimEnd()}\n`);
          }
        }
      }

      resolve(parsed);
    });
  });
}

if (dev) {
  console.log(
    "Development mode: same browser-free checks; a recognized transient audit outage " +
      "with all other checks passing exits 0 and is labeled DEGRADED (never release-qualified).",
  );
} else if (!verbose && !nested) {
  console.log(
    "Running check:ci in compact mode (pass --verbose or CHECK_VERBOSE=1 for full logs; per-step logs saved in .cache/check-logs/check-ci).",
  );
}

const { exitCode } = await runCheckCi({
  compact: !verbose,
  dev,
  restoreManifest,
  runAuditJson,
  runStep: async (step, meta) => runStep(step, meta),
  steps,
});
process.exitCode = exitCode;
