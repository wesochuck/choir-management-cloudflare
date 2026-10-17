// Full release qualification: browser-free gate plus the Chromium browser suite.
//
// `npm run check:ci` remains the fast browser-free local gate. `npm run
// check:release` (this script) is the complete release qualification command:
// it runs check:ci, then the Playwright Chromium projects with
// RELEASE_QUALIFICATION=1 so focused tests fail and failure artifacts
// (screenshots, traces, HTML report) are retained.
//
// Phase 6 decision: Chromium stays the release-qualifying engine. The WebKit
// smoke set (`npm run test:e2e:webkit`) and the full matrix
// (`npm run test:e2e:all-browsers`) are opt-in/periodic checks, not
// release-blocking: the test plan explicitly does not require every browser
// engine on every run. Firefox is deferred (see apps/web/e2e/fixtures/README.md).
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { collectReleaseManifest } from "./release-artifact.mjs";
import {
  invalidateQualification,
  qualificationInputs,
  recordQualification,
} from "./release-qualification.mjs";

const steps = [
  {
    job: "release",
    label: "Run browser-free local gate (check:ci)",
    command: "npm",
    args: ["run", "check:ci"],
  },
  {
    job: "release",
    label: "Run Playwright Chromium browser suite",
    command: "npm",
    args: ["run", "test:e2e"],
    env: { RELEASE_QUALIFICATION: "1" },
  },
];

export async function checkRelease(options = {}) {
  const root = options.root ?? process.cwd();
  const runner = options.runner ?? execFileSync;
  const startedAt = Date.now();
  await invalidateQualification(root);
  let inputs;
  try {
    inputs = await qualificationInputs(root);
  } catch {
    console.log(
      "This checkout cannot produce reusable qualification evidence; the full gate will still run.",
    );
  }
  let manifest;
  function runStep(step) {
    process.stdout.write(`\n=== ${step.label} (release ${step.job} job)\n`);
    return runner(step.command, step.args, {
      stdio: "inherit",
      cwd: root,
      env: { ...process.env, RELEASE_QUALIFICATION: "1", ...(step.env ?? {}) },
    });
  }

  const results = [];
  for (const step of steps) {
    try {
      await runStep(step);
      if (inputs && step.args.includes("check:ci")) {
        manifest = await collectReleaseManifest(root, inputs.commitSha);
      }
      results.push({ ...step, ok: true });
    } catch (error) {
      results.push({ ...step, ok: false });
      console.error(`\n✗ ${step.label} failed with exit ${error.status ?? error.message}.`);
      if (step.label.includes("Playwright")) {
        console.error(
          "If the failure reports a missing browser executable, install Chromium with " +
            "`npx playwright install chromium` and re-run `npm run check:release`.",
        );
      }
      break;
    }
  }

  const failed = results.filter((result) => !result.ok);
  const ran = results.length;

  console.log("\nRelease qualification summary:");
  for (const result of results) {
    console.log(`  ${result.ok ? "✓" : "✗"} ${result.job.padEnd(14)} ${result.label}`);
  }
  if (failed.length > 0) {
    console.error(
      `\n${failed.length}/${ran} steps failed. Fix and re-run \`npm run check:release\` before promotion.`,
    );
    return false;
  } else {
    console.log(
      `\nAll ${ran} steps passed. Full release qualification (check:ci + Chromium E2E) is complete. ` +
        "WebKit smoke (`npm run test:e2e:webkit`) remains an opt-in periodic check, not a " +
        "release gate; see apps/web/e2e/fixtures/README.md.",
    );
  }

  if (inputs) {
    try {
      await recordQualification({ root, inputs, manifest, startedAt });
      console.log("Saved reusable qualification evidence (valid for four hours from gate start).");
    } catch (error) {
      console.error(`Cannot record release qualification: ${error.message}`);
      return false;
    }
  }
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    if (!(await checkRelease())) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
