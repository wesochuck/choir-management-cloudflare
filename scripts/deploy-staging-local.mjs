#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createReleaseManifest, verifyReleaseManifest } from "./release-artifact.mjs";

const workerConfig = "apps/worker/wrangler.jsonc";
const stagingWorkerUrl =
  "https://choir-management-cloudflare-staging.wes-osborn-account.workers.dev";
const emailFeedbackQueue = "choir-management-email-events-staging";
const expectedEmailEvents = new Set([
  "message.delivered",
  "message.deferred",
  "message.bounced",
  "message.failed",
  "message.rejected",
  "message.complained",
]);

export function sanitizeExternalOutput(value) {
  return String(value)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "[redacted-email]")
    .replace(/(bearer|token|secret)(\s*[:=]\s*)\S+/giu, "$1$2[redacted]");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = options.capture
      ? sanitizeExternalOutput(`${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim())
      : "See the command output above.";
    throw new Error(`${command} ${args.join(" ")} failed. ${output}`);
  }
  return options.capture ? String(result.stdout ?? "") : "";
}

function git(...args) {
  return run("git", args, { capture: true }).trim();
}

export function assertReleaseCheckout({ branch, status, head, originMain }) {
  if (branch !== "main") throw new Error("Staging releases must run from the main branch.");
  if (status !== "") throw new Error("Staging releases require a clean working tree.");
  if (head !== originMain) {
    throw new Error("Local main must exactly match origin/main before staging deployment.");
  }
  if (!/^[0-9a-f]{40}$/u.test(head)) throw new Error("The release commit SHA is invalid.");
}

function verifyCheckout() {
  run("git", ["fetch", "origin", "main", "--quiet"]);
  const state = {
    branch: git("branch", "--show-current"),
    status: git("status", "--porcelain"),
    head: git("rev-parse", "HEAD"),
    originMain: git("rev-parse", "origin/main"),
  };
  assertReleaseCheckout(state);
  return state.head;
}

export function assertEmailSendingEnabled(output, domain) {
  const normalizedDomain = domain.trim().toLowerCase();
  const lines = String(output).split(/\r?\n/u);
  const isEnabled = lines.some((line) => {
    const parts = line.split("│").map((part) => part.trim().toLowerCase());
    return parts.length >= 4 && parts[2] === normalizedDomain && parts[3] === "yes";
  });
  if (!isEnabled) {
    throw new Error(
      `Email Sending is not enabled for '${domain}'. Run 'npx wrangler email sending enable ${domain}'.`,
    );
  }
}

export function assertEmailFeedbackSubscription(subscriptions) {
  if (!Array.isArray(subscriptions)) throw new Error("Unexpected queue subscription response.");
  const valid = subscriptions.some(
    (candidate) =>
      candidate?.name === "staging-email-feedback" &&
      candidate?.enabled === true &&
      candidate?.source?.type === "email.sending" &&
      candidate?.source?.domain === "mail.staging.musicsite.org" &&
      candidate?.destination?.type === "queues.queue" &&
      Array.isArray(candidate.events) &&
      candidate.events.length === expectedEmailEvents.size &&
      candidate.events.every((event) => expectedEmailEvents.has(event)),
  );
  if (!valid) throw new Error("The staging Email Sending subscription is missing or incomplete.");
}

export function activeVersionId(status) {
  const version = status?.versions?.find((candidate) => candidate.percentage === 100);
  if (typeof version?.version_id !== "string" || version.version_id === "") {
    throw new Error("No Worker version currently serves 100% of staging traffic.");
  }
  return version.version_id;
}

export function uploadedVersionId(output) {
  const records = String(output)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const result = records.find(
    (record) => record && typeof record === "object" && typeof record.version_id === "string",
  );
  if (!result) throw new Error("Wrangler did not report an uploaded Worker version ID.");
  return result.version_id;
}

function wrangler(args, options = {}) {
  return run("npx", ["--no-install", "wrangler", ...args], options);
}

async function prepareArtifact(releaseRoot, commitSha) {
  await mkdir(join(releaseRoot, "apps", "worker"), { recursive: true });
  await mkdir(join(releaseRoot, "apps", "web"), { recursive: true });
  await cp("package-lock.json", join(releaseRoot, "package-lock.json"));
  await cp("apps/worker/dist", join(releaseRoot, "apps", "worker", "dist"), {
    recursive: true,
  });
  await cp("apps/web/dist", join(releaseRoot, "apps", "web", "dist"), { recursive: true });
  await createReleaseManifest(releaseRoot, commitSha);
  await verifyReleaseManifest(releaseRoot, commitSha);
}

function stagingStatus() {
  return JSON.parse(
    wrangler(["deployments", "status", "--json", "--config", workerConfig, "--env", "staging"], {
      capture: true,
    }),
  );
}

export async function deployVersion(versionId, message, options = {}) {
  const attempts = options.attempts ?? 6;
  const retryDelayMs = options.retryDelayMs ?? 2000;
  const runner = options.runner ?? wrangler;
  const sleeper = options.sleeper ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const output = runner(
        [
          "versions",
          "deploy",
          `${versionId}@100%`,
          "--yes",
          "--config",
          workerConfig,
          "--env",
          "staging",
          "--message",
          message,
        ],
        { capture: true },
      );
      if (output && typeof output === "string" && output.trim().length > 0) {
        console.log(output.trim());
      }
      return;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const isVersionNotFound =
        messageText.includes("100146") || messageText.includes("could not be found");
      if (isVersionNotFound && attempt < attempts) {
        console.warn(
          `Worker version ${versionId} is not yet visible on Cloudflare (attempt ${attempt}/${attempts}); retrying in ${retryDelayMs}ms...`,
        );
        await sleeper(retryDelayMs);
        continue;
      }
      throw error;
    }
  }
}

async function recordProvenance(record) {
  const directory = resolve(".wrangler", "releases");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${record.commitSha}.json`),
    `${JSON.stringify(record, undefined, 2)}\n`,
    "utf8",
  );
}

export async function deployStaging() {
  if (!process.argv.includes("--yes")) {
    throw new Error(
      "Staging deployment requires explicit confirmation: npm run deploy:staging -- --yes",
    );
  }

  console.log("Verifying clean, current main checkout...");
  const commitSha = verifyCheckout();

  console.log("Running the complete local release gate...");
  run("npm", ["run", "check:ci"]);
  run("npx", ["playwright", "install", "chromium"]);
  run("npm", ["run", "test:e2e"]);
  if (verifyCheckout() !== commitSha) throw new Error("The release commit changed during checks.");

  const releaseRoot = await mkdtemp(join(tmpdir(), "choir-staging-release-"));
  let previousVersionId;
  let uploadedId;
  let trafficShifted = false;
  try {
    console.log("Creating and verifying the immutable local release artifact...");
    await prepareArtifact(releaseRoot, commitSha);

    wrangler(["whoami"], { capture: true });
    const emailSendingList = wrangler(["email", "sending", "list"], { capture: true });
    assertEmailSendingEnabled(emailSendingList, "mail.staging.musicsite.org");

    const subscriptions = JSON.parse(
      wrangler(["queues", "subscription", "list", emailFeedbackQueue, "--json"], {
        capture: true,
      }),
    );
    assertEmailFeedbackSubscription(subscriptions);
    previousVersionId = activeVersionId(stagingStatus());

    console.log("Applying forward-only staging migrations and version-external triggers...");
    wrangler([
      "d1",
      "migrations",
      "apply",
      "CONTROL_DB",
      "--config",
      workerConfig,
      "--env",
      "staging",
      "--remote",
    ]);
    wrangler(["triggers", "deploy", "--config", workerConfig, "--env", "staging"]);

    console.log("Uploading the verified artifact as an inactive Worker version...");
    const uploadOutputPath = join(releaseRoot, "version-upload.json");
    wrangler(
      [
        "versions",
        "upload",
        join(releaseRoot, "apps", "worker", "dist", "index.js"),
        "--no-bundle",
        "--assets",
        join(releaseRoot, "apps", "web", "dist"),
        "--config",
        workerConfig,
        "--env",
        "staging",
        "--var",
        `BUILD_VERSION:${commitSha}`,
        "--tag",
        `local-${commitSha.slice(0, 12)}`,
        "--message",
        `Local staging release ${commitSha}`,
      ],
      { capture: true, env: { WRANGLER_OUTPUT_FILE_PATH: uploadOutputPath } },
    );
    uploadedId = uploadedVersionId(await readFile(uploadOutputPath, "utf8"));

    console.log(`Promoting Worker version ${uploadedId} to 100% of staging traffic...`);
    await deployVersion(uploadedId, `Staging release ${commitSha}`);
    trafficShifted = true;

    console.log("Qualifying the exact deployed build...");
    run("npm", ["run", "qualify:staging"], {
      env: {
        STAGING_EXPECTED_VERSION: commitSha,
        STAGING_QUALIFY_ATTEMPTS: "36",
        STAGING_QUALIFY_RETRY_MS: "5000",
        STAGING_WORKER_URL: stagingWorkerUrl,
      },
    });
    run("npm", ["run", "qualify:staging:evidence", "--", "--anonymous"]);

    const finalStatus = stagingStatus();
    if (activeVersionId(finalStatus) !== uploadedId) {
      throw new Error("The uploaded Worker version does not serve 100% of staging traffic.");
    }
    const deploymentId =
      typeof finalStatus.id === "string" ? finalStatus.id : finalStatus.deployment_id;
    await recordProvenance({
      schemaVersion: 1,
      environment: "staging",
      commitSha,
      workerVersionId: uploadedId,
      previousWorkerVersionId: previousVersionId,
      deploymentId: typeof deploymentId === "string" ? deploymentId : null,
      qualifiedAt: new Date().toISOString(),
    });
    console.log(`Staging release complete: ${commitSha} → ${uploadedId}.`);
  } catch (error) {
    if (trafficShifted && previousVersionId) {
      console.error(
        "Staging qualification failed; restoring the captured previous Worker version...",
      );
      try {
        await deployVersion(previousVersionId, `Automatic local rollback from ${commitSha}`);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Release failed and automatic rollback failed.",
          { cause: rollbackError },
        );
      }
    }
    throw error;
  } finally {
    await rm(releaseRoot, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  deployStaging().catch((error) => {
    console.error(sanitizeExternalOutput(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
