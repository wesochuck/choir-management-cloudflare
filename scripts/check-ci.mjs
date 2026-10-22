import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

import { runCheckCi } from "./check-ci-runner.mjs";

const manifestName = "release-manifest.json";

// Enforces the local release qualification checks before promotion.
// The browser E2E job is not run here because it needs Playwright browsers installed; see the note below.
// Usage: `npm run check:ci` (strict) or `npm run check:ci:dev` (explicit development mode:
// same checks, but a recognized transient audit outage with all other checks passing exits 0
// and is clearly labeled DEGRADED instead of qualified).
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
  { job: "static", label: "Lint", command: "npm", args: ["run", "lint"] },
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

function runStep(step) {
  const args = step.args.flatMap((argument) =>
    argument === "--sha" ? ["--sha", commitSha] : [argument],
  );
  process.stdout.write(`\n=== ${step.label} (CI ${step.job} job)\n`);
  execFileSync(step.command, args, { stdio: "inherit", cwd: process.cwd() });
}

// The strict audit wrapper prints its typed outcome as JSON to stdout and
// human diagnostics to stderr. Nonzero exits still carry a parseable
// outcome; anything else is an unknown audit failure.
function runAuditJson() {
  const args = ["scripts/run-dependency-audit.mjs", "--format=json"];
  process.stdout.write("\n=== Audit high-severity dependencies (CI static job)\n");
  try {
    const stdout = execFileSync("node", args, {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    return JSON.parse(stdout);
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : String(error?.stdout ?? "");
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
}

const dev = process.argv.includes("--dev");
if (dev) {
  console.log(
    "Development mode: same browser-free checks; a recognized transient audit outage " +
      "with all other checks passing exits 0 and is labeled DEGRADED (never release-qualified).",
  );
}

const { exitCode } = await runCheckCi({
  dev,
  restoreManifest,
  runAuditJson,
  runStep: async (step) => runStep(step),
  steps,
});
process.exitCode = exitCode;
