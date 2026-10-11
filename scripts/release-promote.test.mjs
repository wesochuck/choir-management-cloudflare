import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createReleaseManifest } from "./release-artifact.mjs";
import { promoteToProduction } from "./release-promote.mjs";
import {
  artifactDirForSha,
  createStagingReceipt,
  persistStagingArtifact,
  productionReceiptPath,
  readManifestHashes,
  stagingReceiptPath,
  writeReceiptAtomic,
} from "./release-shared.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const temporaryDirs = [];

async function trackTemp(prefix = "promote-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

async function buildSourceRoot(sha) {
  const root = await trackTemp("promote-src-");
  await mkdir(join(root, "apps/worker/dist"), { recursive: true });
  await mkdir(join(root, "apps/web/dist"), { recursive: true });
  await writeFile(join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
  await writeFile(join(root, "apps/worker/dist/index.js"), `// ${sha}\n`);
  await writeFile(join(root, "apps/web/dist/index.html"), `<main>${sha}</main>\n`);
  await createReleaseManifest(root, sha);
  return root;
}

async function qualifiedStaging(releasesDir, sha, overrides = {}) {
  const source = await buildSourceRoot(sha);
  const artifactDir = await persistStagingArtifact(source, sha, { releasesDir });
  const { lockfileSha256, manifestSha256 } = await readManifestHashes(artifactDir);
  const receipt = createStagingReceipt({
    artifactDir,
    artifactManifestSha256: manifestSha256,
    buildVersion: sha,
    commitSha: sha,
    deploymentId: `staging-deploy-${sha.slice(0, 8)}`,
    lockfileSha256,
    previousWorkerVersionId: "staging-prev",
    qualifiedAt: "2026-10-10T00:00:00.000Z",
    workerVersionId: `staging-worker-${sha.slice(0, 8)}`,
    ...overrides,
  });
  const receiptPath = stagingReceiptPath(sha, { releasesDir });
  await writeReceiptAtomic(receiptPath, receipt);
  return { artifactDir, receipt, receiptPath };
}

function prodEmailTable() {
  return [
    "┌───────────────┬────────────────────────────┬─────────┬──────────────────────────────────┐",
    "│ zone          │ name                       │ enabled │ tag                              │",
    "├───────────────┼────────────────────────────┼─────────┼──────────────────────────────────┤",
    "│ musicsite.org │ mail.musicsite.org         │ yes     │ ddf97609ef204c588f9d1c3e2802e37c │",
    "└───────────────┴────────────────────────────┴─────────┴──────────────────────────────────┘",
  ].join("\n");
}

function prodSubscriptions() {
  return JSON.stringify([
    {
      destination: { type: "queues.queue" },
      enabled: true,
      events: [
        "message.delivered",
        "message.deferred",
        "message.bounced",
        "message.failed",
        "message.rejected",
        "message.complained",
      ],
      source: { domain: "mail.musicsite.org", type: "email.sending" },
    },
  ]);
}

function baseMocks({ receipt, uploadedId = "prod-worker-new" }) {
  const stagingStatus = {
    id: "staging-deploy-1",
    versions: [{ percentage: 100, version_id: receipt.workerVersionId }],
  };
  const prodPrevious = {
    id: "prod-deploy-prev",
    versions: [{ percentage: 100, version_id: "prod-prev" }],
  };
  const prodFinal = {
    id: "prod-deploy-new",
    versions: [{ percentage: 100, version_id: uploadedId }],
  };
  const getProductionStatus = vi
    .fn()
    .mockResolvedValueOnce(prodPrevious)
    .mockResolvedValue(prodFinal);

  const wrangler = vi.fn((args) => {
    const joined = args.join(" ");
    if (joined.startsWith("whoami")) return "";
    if (joined.includes("email sending list")) return prodEmailTable();
    if (joined.includes("queues subscription list")) return prodSubscriptions();
    if (joined.includes("d1 migrations apply")) return "";
    throw new Error(`Unexpected wrangler call in test: ${joined}`);
  });

  return {
    deployTriggers: vi.fn(async () => {
      await Promise.resolve();
    }),
    deployVersion: vi.fn(async () => {
      await Promise.resolve();
    }),
    getCheckoutState: vi.fn(() => ({ branch: "main", head: receipt.commitSha, status: "" })),
    getProductionStatus,
    getStagingHealthVersion: vi.fn(async () => receipt.commitSha),
    getStagingStatus: vi.fn(async () => stagingStatus),
    prodFinal,
    prodPrevious,
    qualifyProduction: vi.fn(async () => {
      await Promise.resolve();
    }),
    runner: vi.fn(() => ""),
    uploadVersion: vi.fn(async () => uploadedId),
    verifyCommitExists: vi.fn(async () => {
      await Promise.resolve();
    }),
    wrangler,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe("release promotion safeguards", () => {
  it("requires explicit --yes approval and never bypasses checks", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    await qualifiedStaging(releasesDir, SHA_A);
    await expect(
      promoteToProduction({ argv: ["node", "release-promote.mjs"], releasesDir }),
    ).rejects.toThrow(/explicit confirmation/u);
  });

  it("refuses when no staging qualification exists", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    const wrangler = vi.fn(() => "");
    await expect(
      promoteToProduction({
        argv: ["node", "x", "--yes"],
        getCheckoutState: () => ({ branch: "main", head: SHA_A, status: "" }),
        releasesDir,
        verifyCommitExists: async () => {
          await Promise.resolve();
        },
        wrangler,
      }),
    ).rejects.toThrow(/Staging qualification is missing/u);
    expect(wrangler).not.toHaveBeenCalled();
  });

  it("requires an explicit SHA when multiple staging receipts exist", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    await qualifiedStaging(releasesDir, SHA_A);
    await qualifiedStaging(releasesDir, SHA_B);
    const mocks = baseMocks({ releasesDir, receipt: { commitSha: SHA_A } });
    await expect(
      promoteToProduction({ argv: ["node", "x", "--yes"], releasesDir, ...mocks }),
    ).rejects.toThrow(/Multiple qualified/u);
    expect(mocks.wrangler).not.toHaveBeenCalled();
  });

  it("promotes the exact staging bytes with no rebuild or full suite rerun", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    const { artifactDir, receipt } = await qualifiedStaging(releasesDir, SHA_A);
    const beforeManifest = await readFile(join(artifactDir, "release-manifest.json"), "utf8");
    const mocks = baseMocks({ releasesDir, receipt });

    const result = await promoteToProduction({
      argv: ["node", "x", "--yes", "--sha", SHA_A],
      releasesDir,
      ...mocks,
    });

    expect(result.commitSha).toBe(SHA_A);
    expect(result.uploadedId).toBe("prod-worker-new");
    expect(mocks.uploadVersion).toHaveBeenCalledTimes(1);
    const [uploadDir, uploadSha] = mocks.uploadVersion.mock.calls[0];
    expect(uploadDir).toBe(artifactDir);
    expect(uploadSha).toBe(SHA_A);
    // The exact retained bytes are still intact after promotion.
    expect(await readFile(join(artifactDir, "release-manifest.json"), "utf8")).toBe(beforeManifest);
    // No fresh build or full release gate is ever invoked by promotion.
    const runnerCalls = mocks.runner.mock.calls.flatMap(([, args]) => args ?? []);
    expect(runnerCalls).not.toContain("check:release");
    expect(runnerCalls).not.toContain("check:ci");
    expect(runnerCalls).not.toContain("test:e2e");
    expect(runnerCalls).not.toContain("build");

    const prodPath = productionReceiptPath(SHA_A, { releasesDir });
    const prodReceipt = JSON.parse(await readFile(prodPath, "utf8"));
    expect(prodReceipt.environment).toBe("production");
    expect(prodReceipt.commitSha).toBe(SHA_A);
    expect(prodReceipt.workerVersionId).toBe("prod-worker-new");
    expect(prodReceipt.sourceStagingWorkerVersionId).toBe(receipt.workerVersionId);
    expect(prodReceipt.artifactManifestSha256).toBe(receipt.artifactManifestSha256);
    expect(prodReceipt.lockfileSha256).toBe(receipt.lockfileSha256);
    // Staging and production receipts are independently preserved.
    expect(await readFile(stagingReceiptPath(SHA_A, { releasesDir }), "utf8")).toContain(
      receipt.workerVersionId,
    );
  });

  it("supports reruns of the same qualified SHA", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    const { receipt } = await qualifiedStaging(releasesDir, SHA_A);
    const firstMocks = baseMocks({ releasesDir, receipt });
    await promoteToProduction({
      argv: ["node", "x", "--yes", "--sha", SHA_A],
      releasesDir,
      ...firstMocks,
    });
    const secondMocks = baseMocks({ releasesDir, receipt, uploadedId: "prod-worker-second" });
    const second = await promoteToProduction({
      argv: ["node", "x", "--yes", "--sha", SHA_A],
      releasesDir,
      ...secondMocks,
    });
    expect(second.uploadedId).toBe("prod-worker-second");
  });

  it("refuses corrupted or missing artifacts", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    const { artifactDir, receipt } = await qualifiedStaging(releasesDir, SHA_A);
    await writeFile(join(artifactDir, "apps/web/dist/index.html"), "<main>tampered</main>\n");
    const mocks = baseMocks({ releasesDir, receipt });
    await expect(
      promoteToProduction({ argv: ["node", "x", "--yes", "--sha", SHA_A], releasesDir, ...mocks }),
    ).rejects.toThrow(/changed since qualification or is corrupted/u);
    expect(mocks.wrangler).not.toHaveBeenCalled();
  });

  it("refuses when the artifact directory is unavailable", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    const { receipt } = await qualifiedStaging(releasesDir, SHA_A);
    await rm(receipt.artifactDir, { force: true, recursive: true });
    const mocks = baseMocks({ releasesDir, receipt });
    await expect(
      promoteToProduction({ argv: ["node", "x", "--yes", "--sha", SHA_A], releasesDir, ...mocks }),
    ).rejects.toThrow(/changed since qualification|unavailable/u);
  });

  it("refuses stale staging Worker versions", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    const { receipt } = await qualifiedStaging(releasesDir, SHA_A);
    const mocks = baseMocks({ releasesDir, receipt });
    mocks.getStagingStatus.mockResolvedValueOnce({
      versions: [{ percentage: 100, version_id: "different-worker" }],
    });
    await expect(
      promoteToProduction({ argv: ["node", "x", "--yes", "--sha", SHA_A], releasesDir, ...mocks }),
    ).rejects.toThrow(/different Worker version/u);
    expect(mocks.wrangler).not.toHaveBeenCalled();
  });

  it("refuses stale BUILD_VERSION reports from staging", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    const { receipt } = await qualifiedStaging(releasesDir, SHA_A);
    const mocks = baseMocks({ releasesDir, receipt });
    mocks.getStagingHealthVersion.mockResolvedValueOnce(SHA_B);
    await expect(
      promoteToProduction({ argv: ["node", "x", "--yes", "--sha", SHA_A], releasesDir, ...mocks }),
    ).rejects.toThrow(/different SHA\/version/u);
  });

  it("refuses dirty or non-main checkouts and unknown commits", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    const { receipt } = await qualifiedStaging(releasesDir, SHA_A);
    const mocks = baseMocks({ releasesDir, receipt });
    mocks.getCheckoutState.mockReturnValueOnce({ branch: "feature", head: SHA_A, status: "" });
    await expect(
      promoteToProduction({ argv: ["node", "x", "--yes", "--sha", SHA_A], releasesDir, ...mocks }),
    ).rejects.toThrow(/main branch/u);

    const dirtyMocks = baseMocks({ releasesDir, receipt });
    dirtyMocks.getCheckoutState.mockReturnValueOnce({
      branch: "main",
      head: SHA_A,
      status: " M x",
    });
    await expect(
      promoteToProduction({
        argv: ["node", "x", "--yes", "--sha", SHA_A],
        releasesDir,
        ...dirtyMocks,
      }),
    ).rejects.toThrow(/clean working tree/u);

    const unknownMocks = baseMocks({ releasesDir, receipt });
    unknownMocks.verifyCommitExists.mockRejectedValueOnce(new Error("unknown commit"));
    await expect(
      promoteToProduction({
        argv: ["node", "x", "--yes", "--sha", SHA_A],
        releasesDir,
        ...unknownMocks,
      }),
    ).rejects.toThrow(/not available locally/u);
  });

  it("promotes the qualified SHA even when HEAD advanced past it", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    const { receipt } = await qualifiedStaging(releasesDir, SHA_A);
    const mocks = baseMocks({ releasesDir, receipt });
    mocks.getCheckoutState.mockReturnValueOnce({ branch: "main", head: SHA_C, status: "" });
    const result = await promoteToProduction({
      argv: ["node", "x", "--yes", "--sha", SHA_A],
      releasesDir,
      ...mocks,
    });
    expect(result.commitSha).toBe(SHA_A);
    expect(mocks.uploadVersion.mock.calls[0][1]).toBe(SHA_A);
  });

  it("refuses incomplete and wrong-environment receipts", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    // Legacy receipt without artifact hashes can never authorize production.
    await writeFile(
      join(releasesDir, `${SHA_A}.json`),
      JSON.stringify({
        commitSha: SHA_A,
        environment: "staging",
        qualifiedAt: new Date().toISOString(),
        schemaVersion: 1,
        workerVersionId: "legacy-worker",
      }),
    );
    await mkdir(artifactDirForSha(SHA_A, { releasesDir }), { recursive: true });
    const mocks = baseMocks({ releasesDir, receipt: { commitSha: SHA_A } });
    await expect(
      promoteToProduction({ argv: ["node", "x", "--yes", "--sha", SHA_A], releasesDir, ...mocks }),
    ).rejects.toThrow(/incomplete/u);
    expect(mocks.wrangler).not.toHaveBeenCalled();
  });

  it("refuses failed release gates recorded in the receipt", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    const { receipt } = await qualifiedStaging(releasesDir, SHA_A, { qualification: "fail" });
    const mocks = baseMocks({ releasesDir, receipt });
    await expect(
      promoteToProduction({ argv: ["node", "x", "--yes", "--sha", SHA_A], releasesDir, ...mocks }),
    ).rejects.toThrow(/passing run|missing/u);
    expect(mocks.wrangler).not.toHaveBeenCalled();
  });

  it("rolls back production Worker code when qualification fails", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    const { receipt } = await qualifiedStaging(releasesDir, SHA_A);
    const mocks = baseMocks({ releasesDir, receipt });
    mocks.qualifyProduction.mockRejectedValueOnce(new Error("prod smoke failed"));
    await expect(
      promoteToProduction({ argv: ["node", "x", "--yes", "--sha", SHA_A], releasesDir, ...mocks }),
    ).rejects.toThrow(/prod smoke failed/u);
    expect(mocks.deployVersion).toHaveBeenCalledTimes(2);
    expect(mocks.deployVersion.mock.calls[1][0]).toBe("prod-prev");
    // A failed promotion never writes a production receipt.
    await expect(readFile(productionReceiptPath(SHA_A, { releasesDir }), "utf8")).rejects.toThrow();
  });

  it("reports rollback failure without hiding the original error", async () => {
    const releasesDir = await trackTemp("promote-releases-");
    const { receipt } = await qualifiedStaging(releasesDir, SHA_A);
    const mocks = baseMocks({ releasesDir, receipt });
    mocks.qualifyProduction.mockRejectedValueOnce(new Error("prod smoke failed"));
    mocks.deployVersion
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("rollback down"));
    const error = await promoteToProduction({
      argv: ["node", "x", "--yes", "--sha", SHA_A],
      releasesDir,
      ...mocks,
    }).catch((e) => e);
    expect(String(error?.message ?? error)).toMatch(/automatic rollback failed/u);
  });
});
