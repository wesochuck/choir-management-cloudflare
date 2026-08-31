import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const manifestName = "release-manifest.json";

// Enforces the local release qualification checks before promotion.
// The browser E2E job is not run here because it needs Playwright browsers installed; see the note below.
const steps = [
  {
    job: "static",
    label: "Audit high-severity dependencies",
    command: "npm",
    args: ["run", "audit"],
  },
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
  { job: "static", label: "Check formatting", command: "npm", args: ["run", "format:check"] },
  { job: "static", label: "Lint", command: "npm", args: ["run", "lint"] },
  {
    job: "static",
    label: "Check unused dependencies and exports (Knip)",
    command: "npm",
    args: ["run", "knip"],
  },
  { job: "static", label: "Check spacing tokens", command: "npm", args: ["run", "check:spacing"] },
  { job: "contracts", label: "Typecheck", command: "npm", args: ["run", "typecheck"] },
  {
    job: "contracts",
    label: "Check exported contracts",
    command: "npm",
    args: ["run", "check:contracts:exports"],
  },
  {
    job: "contracts",
    label: "Validate parity ledger",
    command: "npm",
    args: ["run", "check:parity"],
  },
  {
    job: "contracts",
    label: "Audit parity implementation",
    command: "npm",
    args: ["run", "check:parity:implementation"],
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

const results = [];
try {
  for (const step of steps) {
    try {
      runStep(step);
      results.push({ ...step, ok: true });
    } catch (error) {
      results.push({ ...step, ok: false });
      console.error(`\n✗ ${step.label} failed with exit ${error.status ?? error.message}.`);
      break;
    }
  }
} finally {
  restoreManifest();
}

const failed = results.filter((result) => !result.ok);
const ran = results.length;
const jobs = [...new Set(results.map((result) => result.job))];

console.log("\nLocal CI mirror summary:");
for (const result of results) {
  console.log(`  ${result.ok ? "✓" : "✗"} ${result.job.padEnd(14)} ${result.label}`);
}
if (failed.length > 0) {
  const failedJob = new Set(failed.map((result) => result.job));
  console.error(
    `\n${failed.length}/${ran} steps failed (CI ${[...failedJob].join(", ")} job(s) would fail). ` +
      "Fix and re-run `npm run check:ci` before pushing.",
  );
  process.exitCode = 1;
} else {
  console.log(
    `\nAll ${ran} steps passed (CI ${jobs.join(", ")} jobs). ` +
      "The browser E2E job is not covered here: run `npx playwright install chromium && npm run test:e2e` " +
      "to cover it locally before pushing.",
  );
}
