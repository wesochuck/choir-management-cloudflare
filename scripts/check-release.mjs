// Full release qualification: browser-free gate plus the Chromium browser suite.
//
// `npm run check:ci` remains the fast browser-free local gate. `npm run
// check:release` (this script) is the complete release qualification command:
// it runs check:ci, then the Playwright Chromium projects with
// RELEASE_QUALIFICATION=1 so focused tests fail and failure artifacts
// (screenshots, traces, HTML report) are retained.
//
// Compact output is enabled by default; pass `--verbose` or set
// `CHECK_VERBOSE=1` to stream full step logs live.
//
// Phase 6 decision: Chromium stays the release-qualifying engine. The WebKit
// smoke set (`npm run test:e2e:webkit`) and the full matrix
// (`npm run test:e2e:all-browsers`) are opt-in/periodic checks, not
// release-blocking: the test plan explicitly does not require every browser
// engine on every run. Firefox is deferred (see apps/web/e2e/fixtures/README.md).
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  buildStepEnv,
  formatDuration,
  isVerboseMode,
  runCompactStep,
} from "./check-step-runner.mjs";
import { collectReleaseManifest } from "./release-artifact.mjs";
import { applyReleaseBuildDefaults } from "./release-environment.mjs";
import {
  invalidateQualification,
  qualificationInputs,
  recordQualification,
} from "./release-qualification.mjs";

const logDir = ".cache/check-logs/check-release";

const steps = [
  {
    job: "release",
    label: "Run browser-free local gate (check:ci)",
    command: "npm",
    args: ["run", "check:ci"],
    streamNested: true,
  },
  {
    job: "release",
    label: "Run Playwright Chromium browser suite",
    command: "npm",
    args: ["run", "test:e2e"],
    env: { RELEASE_QUALIFICATION: "1" },
  },
];

function spawnInherited(command, args, { cwd, env, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    const forwardSignal = (signal) => {
      child.kill(signal);
    };
    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);
    const cleanup = () => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code, signal) => {
      cleanup();
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(
        signal
          ? `${label} terminated by signal ${String(signal)}`
          : `${label} failed with exit ${String(code ?? 1)}`,
      );
      error.status = typeof code === "number" ? code : 1;
      reject(error);
    });
  });
}

export async function checkRelease(options = {}) {
  applyReleaseBuildDefaults();
  const root = options.root ?? process.cwd();
  const baseEnv = options.env ?? process.env;
  const verbose =
    options.verbose ?? isVerboseMode({ argv: options.argv ?? process.argv, env: baseEnv });
  const startedAt = Date.now();
  await invalidateQualification(root);
  let inputs;
  try {
    inputs = await qualificationInputs(root);
  } catch (error) {
    console.log(
      `Cannot save reusable qualification evidence: ${error.message}. ` +
        "The full gate will still run. Commit changes first, then qualify the clean commit " +
        "before pushing to let staging reuse the result.",
    );
  }

  if (!verbose && !options.runner) {
    console.log(
      "Running check:release in compact mode (pass --verbose or CHECK_VERBOSE=1 for full logs; logs saved in .cache/check-logs).",
    );
  }

  let manifest;
  async function runStep(step, index) {
    const mergedEnv = buildStepEnv(
      { ...baseEnv, RELEASE_QUALIFICATION: "1", ...(step.env ?? {}) },
      { command: step.command, verbose },
    );
    if (options.runner) {
      process.stdout.write(`\n=== ${step.label} (release ${step.job} job)\n`);
      return options.runner(step.command, step.args, {
        stdio: "inherit",
        cwd: root,
        env: mergedEnv,
      });
    }

    if (step.streamNested) {
      const stepStart = Date.now();
      if (verbose) {
        process.stdout.write(`\n=== ${step.label} (release ${step.job} job)\n`);
      } else {
        process.stdout.write(`[${String(index)}/${String(steps.length)}] ${step.label}\n`);
      }
      await spawnInherited(step.command, step.args, {
        cwd: root,
        env: { ...mergedEnv, CHECK_NESTED: verbose ? "0" : "1" },
        label: step.label,
      });
      if (!verbose) {
        process.stdout.write(
          `✓ [${String(index)}/${String(steps.length)}] ${step.label} (${formatDuration(Date.now() - stepStart)})\n`,
        );
      }
      return;
    }

    await runCompactStep({
      args: step.args,
      command: step.command,
      cwd: root,
      env: mergedEnv,
      index,
      job: `release ${step.job} job`,
      label: step.label,
      logDir: verbose ? null : logDir,
      total: steps.length,
      verbose,
    });
  }

  const results = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    try {
      await runStep(step, i + 1);
      if (inputs && step.args.includes("check:ci")) {
        manifest = await collectReleaseManifest(root, inputs.commitSha);
      }
      results.push({ ...step, ok: true });
    } catch (error) {
      results.push({ ...step, ok: false });
      if (!error?.alreadyPrinted) {
        console.error(`\n✗ ${step.label} failed with exit ${error.status ?? error.message}.`);
      }
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
