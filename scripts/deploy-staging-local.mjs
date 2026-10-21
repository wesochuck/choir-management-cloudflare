#!/usr/bin/env node

import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createReleaseManifest, verifyReleaseManifest } from "./release-artifact.mjs";
import { invalidateQualification, readQualification } from "./release-qualification.mjs";
import {
  activeVersionId as sharedActiveVersionId,
  artifactDirForSha,
  assertReleaseCheckout as sharedAssertReleaseCheckout,
  createStagingReceipt,
  deployTriggers as sharedDeployTriggers,
  deployVersion as sharedDeployVersion,
  persistStagingArtifact,
  readManifestHashes,
  run as sharedRun,
  sanitizeExternalOutput as sharedSanitize,
  stagingReceiptPath,
  uploadedVersionId as sharedUploadedVersionId,
  verifyPersistedArtifact,
  WORKER_CONFIG,
  writeReceiptAtomic,
} from "./release-shared.mjs";

const workerConfig = WORKER_CONFIG;
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

export const sanitizeExternalOutput = sharedSanitize;
export const uploadedVersionId = sharedUploadedVersionId;

function run(command, args, options = {}) {
  return sharedRun(command, args, options);
}

function git(...args) {
  return run("git", args, { capture: true }).trim();
}

export function assertReleaseCheckout(state) {
  return sharedAssertReleaseCheckout(state, "staging");
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
  return sharedActiveVersionId(status, "staging");
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
  return sharedDeployVersion(versionId, message, { env: "staging", ...options });
}

export async function deployTriggers(envName, options = {}) {
  return sharedDeployTriggers(envName, options);
}

export async function qualifyDeployment(commitSha, options = {}) {
  const outerAttempts = options.outerMaxAttempts ?? 1;
  const attempts = options.attempts ?? 36;
  const retryDelayMs = options.retryDelayMs ?? 5000;
  const runner = options.runner ?? run;
  const sleeper = options.sleeper ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  // Deduplicate retries: if the outer orchestrator controls retry attempts,
  // inner qualification scripts must not loop internally (pass 1 attempt).
  const effectiveInnerAttempts = outerAttempts > 1 ? 1 : attempts;

  for (let attempt = 1; attempt <= outerAttempts; attempt += 1) {
    try {
      runner("npm", ["run", "qualify:staging"], {
        env: {
          ...process.env,
          STAGING_EXPECTED_VERSION: commitSha,
          STAGING_QUALIFY_ATTEMPTS: String(effectiveInnerAttempts),
          STAGING_QUALIFY_RETRY_MS: String(retryDelayMs),
          STAGING_WORKER_URL: options.stagingWorkerUrl ?? stagingWorkerUrl,
          ...(options.env ?? {}),
        },
      });
      runner("npm", ["run", "qualify:staging:evidence", "--", "--anonymous"], {
        env: {
          ...process.env,
          ...(options.env ?? {}),
        },
      });
      return;
    } catch (error) {
      if (attempt < outerAttempts) {
        await sleeper(retryDelayMs);
        continue;
      }
      throw error;
    }
  }
}

async function recordStagingProvenance({
  artifactDir,
  commitSha,
  deploymentId,
  previousWorkerVersionId,
  releasesDir,
  uploadedId,
}) {
  const artifactOptions = releasesDir ? { releasesDir } : {};
  const persistentDir = artifactDir ?? artifactDirForSha(commitSha, artifactOptions);
  const { lockfileSha256, manifestSha256 } = await readManifestHashes(persistentDir);
  await verifyPersistedArtifact(persistentDir, commitSha);
  const record = createStagingReceipt({
    artifactDir: persistentDir,
    artifactManifestSha256: manifestSha256,
    buildVersion: commitSha,
    commitSha,
    deploymentId: typeof deploymentId === "string" ? deploymentId : null,
    lockfileSha256,
    previousWorkerVersionId,
    qualifiedAt: new Date().toISOString(),
    releaseGate: "check:release",
    workerVersionId: uploadedId,
  });
  await writeReceiptAtomic(stagingReceiptPath(commitSha, artifactOptions), record);
  return { persistentDir, record };
}

export async function runReleaseGate(options = {}) {
  const runner = options.runner ?? run;
  const readEvidence = options.readQualification ?? readQualification;
  const lookupOptions = options.root ? { root: options.root } : {};
  const cached = options.force
    ? { receipt: null, reason: "fresh checks requested" }
    : await readEvidence(lookupOptions);
  if (cached.receipt) {
    console.log("Reusing verified check:release evidence for this commit (within four hours).");
    return cached.receipt;
  }
  console.log(`Running the complete local release gate: ${cached.reason}.`);
  await (options.invalidateQualification ?? invalidateQualification)(options.root);
  await runner("npx", ["playwright", "install", "chromium"]);
  await runner("npm", ["run", "check:release"]);
  const fresh = await readEvidence(lookupOptions);
  if (!fresh.receipt)
    throw new Error(`Release gate produced no reusable evidence: ${fresh.reason}.`);
  return fresh.receipt;
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

export async function deployStaging(options = {}) {
  const argv = options.argv ?? process.argv;
  if (!argv.includes("--yes")) {
    throw new Error(
      "Staging deployment requires explicit confirmation: npm run deploy:staging -- --yes",
    );
  }

  // Issue 277: Enable practice loudness normalization in staging builds for operator qualification.
  process.env.VITE_PRACTICE_LOUDNESS_ENABLED ??=
    options.env?.VITE_PRACTICE_LOUDNESS_ENABLED ?? "true";

  console.log("Verifying clean, current main checkout...");
  const checkoutVerifier = options.verifyCheckout ?? verifyCheckout;
  const commitSha = checkoutVerifier();

  console.log("Checking local release qualification...");
  const releaseGateRunner = options.runReleaseGate ?? runReleaseGate;
  const qualification = await releaseGateRunner({
    runner: options.runner ?? run,
    force: argv.includes("--force-release-checks"),
  });
  if (checkoutVerifier() !== commitSha)
    throw new Error("The release commit changed during checks.");

  const releaseRoot = await mkdtemp(join(tmpdir(), "choir-staging-release-"));
  let previousVersionId;
  let uploadedId;
  let trafficShifted = false;
  try {
    console.log("Creating and verifying the immutable local release artifact...");
    const prepare = options.prepareArtifact ?? prepareArtifact;
    await prepare(releaseRoot, commitSha);
    // Bind the copied artifact to the bytes that actually passed the gate, including on reuse.
    if (qualification) {
      await verifyReleaseManifest(releaseRoot, commitSha, qualification.manifest);
    }

    const wranglerRunner = options.wrangler ?? wrangler;
    const statusRunner = options.stagingStatus ?? stagingStatus;
    const deployVersionRunner = options.deployVersion ?? deployVersion;
    const deployTriggersRunner = options.deployTriggers ?? deployTriggers;
    const qualifyRunner = options.qualifyDeployment ?? qualifyDeployment;
    const persistRunner = options.persistArtifact ?? persistStagingArtifact;
    const recordRunner = options.recordProvenance ?? recordStagingProvenance;

    wranglerRunner(["whoami"], { capture: true });
    const emailSendingList = wranglerRunner(["email", "sending", "list"], { capture: true });
    assertEmailSendingEnabled(emailSendingList, "mail.staging.musicsite.org");

    const subscriptions = JSON.parse(
      wranglerRunner(["queues", "subscription", "list", emailFeedbackQueue, "--json"], {
        capture: true,
      }),
    );
    assertEmailFeedbackSubscription(subscriptions);
    previousVersionId = activeVersionId(statusRunner());

    console.log("Applying forward-only staging migrations and version-external triggers...");
    wranglerRunner([
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
    await deployTriggersRunner("staging");

    console.log("Uploading the verified artifact as an inactive Worker version...");
    const uploadOutputPath = join(releaseRoot, "version-upload.json");
    wranglerRunner(
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
    await deployVersionRunner(uploadedId, `Staging release ${commitSha}`);
    trafficShifted = true;

    console.log("Qualifying the exact deployed build...");
    await qualifyRunner(commitSha);

    const finalStatus = statusRunner();
    if (activeVersionId(finalStatus) !== uploadedId) {
      throw new Error("The uploaded Worker version does not serve 100% of staging traffic.");
    }
    const deploymentId =
      typeof finalStatus.id === "string" ? finalStatus.id : finalStatus.deployment_id;

    console.log("Persisting the qualified artifact for promotion...");
    const releasesDirOption = options.releasesDir ? { releasesDir: options.releasesDir } : {};
    const persistentDir =
      options.persistedArtifactDir ??
      (await persistRunner(releaseRoot, commitSha, releasesDirOption));
    const { record } = await recordRunner({
      artifactDir: persistentDir,
      commitSha,
      deploymentId,
      previousWorkerVersionId: previousVersionId,
      releasesDir: options.releasesDir,
      uploadedId,
    });
    console.log(`Staging release complete: ${commitSha} → ${uploadedId}.`);
    console.log(`Qualified artifact retained at ${persistentDir}.`);
    console.log(`Staging receipt: ${stagingReceiptPath(commitSha, releasesDirOption)}.`);
    console.log(
      `Promote later without rebuilding: npm run release:promote -- --sha ${commitSha} --yes (artifact manifest ${record.artifactManifestSha256.slice(0, 12)}).`,
    );
  } catch (error) {
    if (trafficShifted && previousVersionId) {
      console.error(
        "Staging qualification failed; restoring the captured previous Worker version...",
      );
      try {
        const deployVersionRunner = options.deployVersion ?? deployVersion;
        await deployVersionRunner(previousVersionId, `Automatic local rollback from ${commitSha}`);
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
    console.error(sharedSanitize(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
