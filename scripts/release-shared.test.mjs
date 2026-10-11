import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createReleaseManifest } from "./release-artifact.mjs";
import {
  activeVersionId,
  artifactDirForSha,
  assertCommitSha,
  assertPromotableStagingReceipt,
  assertPromoteCheckout,
  assertReleaseCheckout,
  assertStagingFreshness,
  createProductionReceipt,
  createStagingReceipt,
  deployTriggers,
  deployVersion,
  formatPromotionSummary,
  legacyReceiptPath,
  listStagingReceipts,
  parsePromoteArgs,
  persistStagingArtifact,
  productionReceiptPath,
  readManifestHashes,
  readStagingReceipt,
  selectStagingReceipt,
  stagingReceiptPath,
  uploadedVersionId,
  verifyArtifactMatchesReceipt,
  verifyPersistedArtifact,
  writeReceiptAtomic,
} from "./release-shared.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const temporaryRoots = [];
const temporaryReleases = [];

async function trackRoot(prefix = "release-shared-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function trackReleases() {
  const dir = await mkdtemp(join(tmpdir(), "releases-"));
  temporaryReleases.push(dir);
  return dir;
}

async function buildSourceRoot(sha = SHA_A) {
  const root = await trackRoot();
  await mkdir(join(root, "apps/worker/dist"), { recursive: true });
  await mkdir(join(root, "apps/web/dist"), { recursive: true });
  await writeFile(join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
  await writeFile(join(root, "apps/worker/dist/index.js"), "export default {};\n");
  await writeFile(join(root, "apps/web/dist/index.html"), "<main>release</main>\n");
  await createReleaseManifest(root, sha);
  return root;
}

async function persistedArtifact(releasesDir, sha = SHA_A) {
  const source = await buildSourceRoot(sha);
  return persistStagingArtifact(source, sha, { releasesDir });
}

async function stagingReceiptFor(releasesDir, sha, overrides = {}) {
  const artifactDir = await persistedArtifact(releasesDir, sha);
  const { lockfileSha256, manifestSha256 } = await readManifestHashes(artifactDir);
  const receipt = createStagingReceipt({
    artifactDir,
    artifactManifestSha256: manifestSha256,
    buildVersion: sha,
    commitSha: sha,
    deploymentId: "deploy-1",
    lockfileSha256,
    previousWorkerVersionId: "prev-1",
    qualifiedAt: new Date().toISOString(),
    workerVersionId: "worker-1",
    ...overrides,
  });
  await writeReceiptAtomic(stagingReceiptPath(sha, { releasesDir }), receipt);
  return { artifactDir, receipt };
}

afterEach(async () => {
  await Promise.all([
    ...temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    ...temporaryReleases.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  ]);
});

describe("release-shared checkout and version helpers", () => {
  it("validates commit SHAs", () => {
    expect(() => assertCommitSha(SHA_A)).not.toThrow();
    expect(() => assertCommitSha("short")).toThrow(/full-length Git commit SHA/u);
    expect(() => assertCommitSha("A".repeat(40))).toThrow(/full-length Git commit SHA/u);
  });

  it("requires a clean main checkout synchronized with origin", () => {
    const valid = { branch: "main", head: SHA_A, originMain: SHA_A, status: "" };
    expect(() => assertReleaseCheckout(valid, "staging")).not.toThrow();
    expect(() => assertReleaseCheckout(valid, "production")).not.toThrow();
    expect(() => assertReleaseCheckout({ ...valid, branch: "feature" }, "staging")).toThrow(
      /main branch/u,
    );
    expect(() => assertReleaseCheckout({ ...valid, status: " M x" }, "production")).toThrow(
      /clean working tree/u,
    );
    expect(() => assertReleaseCheckout({ ...valid, originMain: SHA_B }, "staging")).toThrow(
      /origin\/main/u,
    );
  });

  it("requires a clean main checkout for promotion without origin sync", () => {
    expect(() => assertPromoteCheckout({ branch: "main", status: "" })).not.toThrow();
    expect(() => assertPromoteCheckout({ branch: "feature", status: "" })).toThrow(/main branch/u);
    expect(() => assertPromoteCheckout({ branch: "main", status: " M x" })).toThrow(
      /clean working tree/u,
    );
  });

  it("extracts active and uploaded Worker version IDs", () => {
    expect(activeVersionId({ versions: [{ percentage: 100, version_id: "v1" }] })).toBe("v1");
    expect(
      activeVersionId({ versions: [{ percentage: 100, version_id: "v1" }] }, "production"),
    ).toBe("v1");
    expect(() => activeVersionId({ versions: [] })).toThrow(/100%/u);
    expect(uploadedVersionId('{"version_id":"new"}\n')).toBe("new");
    expect(() => uploadedVersionId("not json")).toThrow(/version ID/u);
  });

  it("retries version promotion on propagation delay and deploys to the requested env", async () => {
    const seenEnvs = [];
    let calls = 0;
    const runner = vi.fn((args) => {
      seenEnvs.push(args[args.indexOf("--env") + 1]);
      calls += 1;
      if (calls < 3) throw new Error("could not be found [code: 100146]");
      return "";
    });
    await deployVersion("v1", "msg", {
      attempts: 4,
      env: "production",
      retryDelayMs: 1,
      runner,
      sleeper: async () => {
        await Promise.resolve();
      },
    });
    expect(runner).toHaveBeenCalledTimes(3);
    expect(seenEnvs).toEqual(["production", "production", "production"]);
  });

  it("fails version promotion immediately on non-propagation errors", async () => {
    const runner = vi.fn(() => {
      throw new Error("auth [code: 10000]");
    });
    await expect(
      deployVersion("v1", "msg", {
        attempts: 3,
        runner,
        sleeper: async () => {
          await Promise.resolve();
        },
      }),
    ).rejects.toThrow(/10000/u);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("retries trigger deployment on transient errors", async () => {
    let calls = 0;
    const runner = vi.fn(() => {
      calls += 1;
      if (calls < 2) throw new Error("only partially updated [code: 10013]");
      return "";
    });
    await deployTriggers("staging", {
      attempts: 3,
      retryDelayMs: 1,
      runner,
      sleeper: async () => {
        await Promise.resolve();
      },
    });
    expect(runner).toHaveBeenCalledTimes(2);
  });
});

describe("release-shared receipts and artifacts", () => {
  it("builds per-environment receipt paths without colliding", () => {
    const releasesDir = "/tmp/releases-test";
    expect(stagingReceiptPath(SHA_A, { releasesDir })).toBe(
      join(releasesDir, `staging-${SHA_A}.json`),
    );
    expect(productionReceiptPath(SHA_A, { releasesDir })).toBe(
      join(releasesDir, `production-${SHA_A}.json`),
    );
    expect(legacyReceiptPath(SHA_A, { releasesDir })).toBe(join(releasesDir, `${SHA_A}.json`));
    expect(artifactDirForSha(SHA_A, { releasesDir })).toBe(join(releasesDir, "artifacts", SHA_A));
  });

  it("persists and verifies the exact staging bytes, including reruns", async () => {
    const releasesDir = await trackReleases();
    const source = await buildSourceRoot(SHA_A);
    const target = await persistStagingArtifact(source, SHA_A, { releasesDir });
    await expect(verifyPersistedArtifact(target, SHA_A)).resolves.toMatchObject({
      commitSha: SHA_A,
    });

    // A second successful staging run for the same SHA replaces the persistent
    // artifact with newly qualified bytes rather than misleadingly reusing stale
    // files. Failed runs never reach persist, so no receipt can form.
    await writeFile(join(source, "apps/web/dist/index.html"), "<main>rerun</main>\n");
    const { createReleaseManifest: recreate } = await import("./release-artifact.mjs");
    await recreate(source, SHA_A);
    const rerunTarget = await persistStagingArtifact(source, SHA_A, { releasesDir });
    expect(rerunTarget).toBe(target);
    await expect(verifyPersistedArtifact(rerunTarget, SHA_A)).resolves.toMatchObject({
      commitSha: SHA_A,
    });
    expect(await readFile(join(rerunTarget, "apps/web/dist/index.html"), "utf8")).toBe(
      "<main>rerun</main>\n",
    );
  });

  it("rejects corrupted or missing artifacts", async () => {
    const releasesDir = await trackReleases();
    const artifactDir = await persistedArtifact(releasesDir, SHA_A);
    await writeFile(join(artifactDir, "apps/web/dist/index.html"), "<main>tampered</main>\n");
    await expect(verifyPersistedArtifact(artifactDir, SHA_A)).rejects.toThrow(
      /verification failed/u,
    );
    await expect(
      verifyPersistedArtifact(join(releasesDir, "artifacts", SHA_B), SHA_B),
    ).rejects.toThrow();
  });

  it("creates promotable staging receipts and rejects incomplete ones", async () => {
    const releasesDir = await trackReleases();
    const { receipt } = await stagingReceiptFor(releasesDir, SHA_A);
    expect(() => assertPromotableStagingReceipt(receipt)).not.toThrow();

    expect(() => assertPromotableStagingReceipt(null)).toThrow(/missing/u);
    expect(() => assertPromotableStagingReceipt({ ...receipt, environment: "production" })).toThrow(
      /wrong environment/u,
    );
    expect(() => assertPromotableStagingReceipt({ ...receipt, qualification: "fail" })).toThrow(
      /passing run/u,
    );
    expect(() => assertPromotableStagingReceipt({ ...receipt, schemaVersion: 1 })).toThrow(
      /legacy receipt/u,
    );
    expect(() => assertPromotableStagingReceipt({ ...receipt, workerVersionId: "" })).toThrow(
      /incomplete/u,
    );
    expect(() => assertPromotableStagingReceipt({ ...receipt, buildVersion: SHA_B })).toThrow(
      /BUILD_VERSION/u,
    );
  });

  it("verifies the artifact matches the receipt hashes", async () => {
    const releasesDir = await trackReleases();
    const { artifactDir, receipt } = await stagingReceiptFor(releasesDir, SHA_A);
    await expect(verifyArtifactMatchesReceipt(artifactDir, receipt)).resolves.toMatchObject({
      commitSha: SHA_A,
    });

    await writeFile(join(artifactDir, "apps/web/dist/index.html"), "<main>changed</main>\n");
    await expect(verifyArtifactMatchesReceipt(artifactDir, receipt)).rejects.toThrow(
      /changed since qualification or is corrupted/u,
    );
  });

  it("detects lockfile drift even when file sets still verify", async () => {
    const releasesDir = await trackReleases();
    const { artifactDir, receipt } = await stagingReceiptFor(releasesDir, SHA_A);
    // Rewrite the lockfile and manifest so the file set is self-consistent but
    // no longer matches the qualified receipt hashes.
    await writeFile(join(artifactDir, "package-lock.json"), '{"lockfileVersion":2}\n');
    await createReleaseManifest(artifactDir, SHA_A);
    await expect(verifyArtifactMatchesReceipt(artifactDir, receipt)).rejects.toThrow(
      /lockfile hash mismatch|manifest hash mismatch/u,
    );
  });

  it("reads, lists, and selects staging receipts without guessing", async () => {
    const releasesDir = await trackReleases();
    await expect(readStagingReceipt(SHA_A, { releasesDir })).resolves.toBeNull();
    await expect(selectStagingReceipt({ releasesDir })).rejects.toThrow(/missing/u);

    const first = await stagingReceiptFor(releasesDir, SHA_A);
    expect(await readStagingReceipt(SHA_A, { releasesDir })).toMatchObject({
      commitSha: SHA_A,
    });
    expect(await listStagingReceipts({ releasesDir })).toHaveLength(1);
    await expect(selectStagingReceipt({ releasesDir })).resolves.toMatchObject({
      receipt: { commitSha: SHA_A },
    });

    await stagingReceiptFor(releasesDir, SHA_B);
    await expect(selectStagingReceipt({ releasesDir })).rejects.toThrow(/Multiple qualified/u);
    await expect(selectStagingReceipt({ releasesDir, sha: SHA_A })).resolves.toMatchObject({
      receipt: { commitSha: first.receipt.commitSha },
    });
    await expect(selectStagingReceipt({ releasesDir, sha: "c".repeat(40) })).rejects.toThrow(
      /missing for/u,
    );
  });

  it("prefers namespaced staging receipts and ignores production files", async () => {
    const releasesDir = await trackReleases();
    const { receipt } = await stagingReceiptFor(releasesDir, SHA_A);
    // A production-namespaced receipt for the same SHA must not satisfy staging.
    await writeFile(
      join(releasesDir, `production-${SHA_A}.json`),
      JSON.stringify(
        createProductionReceipt({
          artifactDir: receipt.artifactDir,
          artifactManifestSha256: receipt.artifactManifestSha256,
          buildVersion: SHA_A,
          commitSha: SHA_A,
          lockfileSha256: receipt.lockfileSha256,
          workerVersionId: "prod-1",
        }),
        null,
        2,
      ),
    );
    const listed = await listStagingReceipts({ releasesDir });
    expect(listed).toHaveLength(1);
    expect(listed[0].receipt.environment).toBe("staging");
  });

  it("falls back to legacy staging receipts but marks them incomplete", async () => {
    const releasesDir = await trackReleases();
    await writeFile(
      join(releasesDir, `${SHA_A}.json`),
      JSON.stringify({
        commitSha: SHA_A,
        deploymentId: "d1",
        environment: "staging",
        previousWorkerVersionId: "prev",
        qualifiedAt: new Date().toISOString(),
        schemaVersion: 1,
        workerVersionId: "worker-legacy",
      }),
    );
    const receipt = await readStagingReceipt(SHA_A, { releasesDir });
    expect(receipt?.workerVersionId).toBe("worker-legacy");
    expect(() => assertPromotableStagingReceipt(receipt)).toThrow(/legacy receipt/u);
  });

  it("checks that staging still serves the qualified version", () => {
    const receipt = {
      buildVersion: SHA_A,
      commitSha: SHA_A,
      qualifiedAt: new Date().toISOString(),
      workerVersionId: "worker-1",
    };
    expect(() =>
      assertStagingFreshness({
        healthVersion: SHA_A,
        receipt,
        stagingStatus: { versions: [{ percentage: 100, version_id: "worker-1" }] },
      }),
    ).not.toThrow();
    expect(() =>
      assertStagingFreshness({
        healthVersion: SHA_A,
        receipt,
        stagingStatus: { versions: [{ percentage: 100, version_id: "worker-2" }] },
      }),
    ).toThrow(/different Worker version/u);
    expect(() =>
      assertStagingFreshness({
        healthVersion: SHA_B,
        receipt,
        stagingStatus: { versions: [{ percentage: 100, version_id: "worker-1" }] },
      }),
    ).toThrow(/different SHA\/version/u);
  });

  it("parses promotion args and formats the approval summary", () => {
    expect(parsePromoteArgs(["node", "x", "--yes"])).toEqual({ hasYes: true, sha: null });
    expect(parsePromoteArgs(["node", "x", "--yes", "--sha", SHA_A])).toEqual({
      hasYes: true,
      sha: SHA_A,
    });
    expect(() => parsePromoteArgs(["node", "x", "--yes", "--sha"])).toThrow(/requires a value/u);
    expect(() => parsePromoteArgs(["node", "x", "--yes", "--sha", "short"])).toThrow(
      /full-length/u,
    );
    const summary = formatPromotionSummary({
      artifactDir: "/tmp/art",
      receipt: {
        artifactManifestSha256: "m".repeat(64),
        commitSha: SHA_A,
        lockfileSha256: "l".repeat(64),
        qualifiedAt: "2026-01-01T00:00:00.000Z",
        workerVersionId: "w1",
      },
    });
    expect(summary).toMatch(/Production target/u);
    expect(summary).toMatch(new RegExp(SHA_A.slice(0, 8), "u"));
  });

  it("writes receipts atomically without leaving partial files", async () => {
    const releasesDir = await trackReleases();
    const target = stagingReceiptPath(SHA_A, { releasesDir });
    await writeReceiptAtomic(target, { commitSha: SHA_A, environment: "staging" });
    expect(JSON.parse(await readFile(target, "utf8")).commitSha).toBe(SHA_A);
  });
});
