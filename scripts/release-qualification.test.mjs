import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectReleaseManifest, createReleaseManifest } from "./release-artifact.mjs";
import { checkRelease } from "./check-release.mjs";
import { deployStaging, runReleaseGate } from "./deploy-staging-local.mjs";
import {
  QUALIFICATION_MAX_AGE_MS,
  qualificationInputs,
  readQualification,
  recordQualification,
} from "./release-qualification.mjs";

const roots = [];
const receiptPath = (root) => join(root, ".wrangler/releases/qualification.json");
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "release-qualification-"));
  roots.push(root);
  for (const path of ["apps/web/dist", "apps/worker/dist", "node_modules"]) {
    await mkdir(join(root, path), { recursive: true });
  }
  await writeFile(
    join(root, ".gitignore"),
    ".wrangler/\nnode_modules/\ndist/\n.env*\n.dev.vars*\n",
  );
  await writeFile(join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
  await writeFile(join(root, "source.js"), "export const value = 1;\n");
  await writeFile(join(root, "node_modules/.package-lock.json"), '{"lockfileVersion":3}\n');
  await writeFile(join(root, "apps/web/dist/index.html"), "<main>qualified</main>");
  await writeFile(join(root, "apps/worker/dist/index.js"), "export default {};");
  git(root, "init", "--quiet");
  git(root, "add", ".");
  git(
    root,
    "-c",
    "user.name=Release Test",
    "-c",
    "user.email=release@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  return root;
}

async function qualify(root, now = Date.now()) {
  const inputs = await qualificationInputs(root);
  const manifest = await collectReleaseManifest(root, inputs.commitSha);
  return recordQualification({ root, inputs, manifest, startedAt: now - 1000, now });
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("reusable local release qualification", () => {
  it("records clean inputs and rehashes the exact qualified artifacts", async () => {
    const root = await fixture();
    const receipt = await qualify(root);
    expect((await readQualification({ root })).receipt).toEqual(receipt);
    // The record contains hashes, never local configuration values.
    await writeFile(join(root, "apps/worker/.dev.vars"), "SECRET=do-not-record-this");
    await qualify(root);
    expect(await readFile(receiptPath(root), "utf8")).not.toContain("do-not-record-this");
  });

  it.each([
    ["modified Worker bundle", "apps/worker/dist/index.js"],
    ["unexpected web asset", "apps/web/dist/unexpected.js"],
    ["dependency reinstall", "node_modules/.package-lock.json"],
    ["local secrets/configuration", "apps/worker/.dev.vars"],
    ["tracked source edits", "source.js"],
    ["untracked source files", "new-file.js"],
    ["lockfile edits", "package-lock.json"],
  ])("rejects %s", async (_label, path) => {
    const root = await fixture();
    await qualify(root);
    await writeFile(join(root, path), "changed");
    expect((await readQualification({ root })).receipt).toBeNull();
  });

  it("rejects changed commits even when the tracked file bytes are unchanged", async () => {
    const root = await fixture();
    await qualify(root);
    git(
      root,
      "-c",
      "user.name=Release Test",
      "-c",
      "user.email=release@example.invalid",
      "commit",
      "--allow-empty",
      "--quiet",
      "-m",
      "new commit",
    );
    expect((await readQualification({ root })).receipt).toBeNull();
  });

  it("rejects expired, future-dated, corrupt, incomplete, or missing evidence", async () => {
    const root = await fixture();
    const now = Date.now();
    const receipt = await qualify(root, now);
    expect(
      (await readQualification({ root, now: now + QUALIFICATION_MAX_AGE_MS })).receipt,
    ).toBeNull();
    expect((await readQualification({ root, now: now - 1 })).receipt).toBeNull();
    for (const content of [
      "invalid json",
      JSON.stringify({ ...receipt, manifest: null }),
      JSON.stringify({ ...receipt, schemaVersion: 99 }),
    ]) {
      await writeFile(receiptPath(root), content);
      expect((await readQualification({ root })).receipt).toBeNull();
    }
    await rm(receiptPath(root));
    expect((await readQualification({ root })).receipt).toBeNull();
  });

  it("rejects missing artifacts and a changed build/test environment", async () => {
    const root = await fixture();
    await qualify(root);
    vi.stubEnv("VITE_RELEASE_TEST", "different build input");
    expect((await readQualification({ root })).receipt).toBeNull();
    vi.unstubAllEnvs();
    await rm(join(root, "apps/worker/dist/index.js"));
    expect((await readQualification({ root })).receipt).toBeNull();
  });

  it("invalidates previous success before a failed rerun", async () => {
    const root = await fixture();
    await qualify(root);
    vi.spyOn(console, "log").mockImplementation(vi.fn());
    vi.spyOn(console, "error").mockImplementation(vi.fn());
    expect(
      await checkRelease({
        root,
        runner: () => {
          throw new Error("gate failed");
        },
      }),
    ).toBe(false);
    expect((await readQualification({ root })).receipt).toBeNull();
  });

  it("revokes reusable evidence when a forced browser installation fails", async () => {
    const root = await fixture();
    await qualify(root);
    await expect(
      runReleaseGate({
        root,
        force: true,
        runner: () => {
          throw new Error("browser install failed");
        },
      }),
    ).rejects.toThrow("browser install failed");
    expect((await readQualification({ root })).receipt).toBeNull();
  });

  it("only records success after both complete gate phases, with focused tests forbidden", async () => {
    const root = await fixture();
    vi.spyOn(console, "log").mockImplementation(vi.fn());
    const runner = vi.fn();
    expect(await checkRelease({ root, runner })).toBe(true);
    expect(runner.mock.calls.map((call) => call[1])).toEqual([
      ["run", "check:ci"],
      ["run", "test:e2e"],
    ]);
    for (const call of runner.mock.calls) expect(call[2].env.RELEASE_QUALIFICATION).toBe("1");
    expect((await readQualification({ root })).receipt?.gate).toBe("check:release");
  });

  it.each(["source.js", "apps/worker/dist/index.js"])(
    "refuses changes during the gate: %s",
    async (path) => {
      const root = await fixture();
      vi.spyOn(console, "log").mockImplementation(vi.fn());
      vi.spyOn(console, "error").mockImplementation(vi.fn());
      const runner = async (_command, args) => {
        if (args.includes("test:e2e")) await writeFile(join(root, path), "changed during testing");
      };
      expect(await checkRelease({ root, runner })).toBe(false);
      expect((await readQualification({ root })).receipt).toBeNull();
    },
  );

  it("permits dirty development qualification without publishing reusable evidence", async () => {
    const root = await fixture();
    await writeFile(join(root, "source.js"), "uncommitted work");
    vi.spyOn(console, "log").mockImplementation(vi.fn());
    expect(await checkRelease({ root, runner: vi.fn() })).toBe(true);
    expect((await readQualification({ root })).receipt).toBeNull();
  });

  it("rejects artifact drift during deployment before touching hosted resources", async () => {
    const root = await fixture();
    const receipt = await qualify(root);
    const wrangler = vi.fn();
    await expect(
      deployStaging({
        argv: ["--yes"],
        verifyCheckout: () => receipt.inputs.commitSha,
        runReleaseGate: async () => receipt,
        prepareArtifact: async (target, sha) => {
          await mkdir(join(target, "apps/worker/dist"), { recursive: true });
          await mkdir(join(target, "apps/web/dist"), { recursive: true });
          await writeFile(join(target, "package-lock.json"), '{"lockfileVersion":3}\n');
          await writeFile(join(target, "apps/worker/dist/index.js"), "changed after qualification");
          await writeFile(join(target, "apps/web/dist/index.html"), "<main>qualified</main>");
          await createReleaseManifest(target, sha);
        },
        wrangler,
      }),
    ).rejects.toThrow(/artifact verification failed/u);
    expect(wrangler).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "cached qualification preserves hosted checks and rollback (failure=%s)",
    async (failure) => {
      const root = await fixture();
      const receipt = await qualify(root);
      const gateRunner = vi.fn(() => {
        throw new Error("cached gate must not rerun");
      });
      const deployVersion = vi.fn();
      const deployTriggers = vi.fn();
      const qualifyDeployment = vi.fn(() => {
        if (failure) throw new Error("hosted qualification failed");
      });
      const wrangler = vi.fn((args, options) => {
        if (args[0] === "email") return "│ zone │ mail.staging.musicsite.org │ yes │ tag │";
        if (args[0] === "queues")
          return JSON.stringify([
            {
              name: "staging-email-feedback",
              enabled: true,
              source: { type: "email.sending", domain: "mail.staging.musicsite.org" },
              destination: { type: "queues.queue" },
              events: [
                "message.delivered",
                "message.deferred",
                "message.bounced",
                "message.failed",
                "message.rejected",
                "message.complained",
              ],
            },
          ]);
        if (args[0] === "versions")
          writeFileSync(
            options.env.WRANGLER_OUTPUT_FILE_PATH,
            JSON.stringify({ version_id: "new-version" }),
          );
        return "";
      });
      const persistArtifact = vi.fn(async () => root);
      const recordProvenance = vi.fn(async () => ({
        record: { artifactManifestSha256: "a".repeat(64) },
      }));
      let statusCalls = 0;
      const deployment = deployStaging({
        argv: ["--yes"],
        verifyCheckout: () => receipt.inputs.commitSha,
        runReleaseGate: () => runReleaseGate({ root, runner: gateRunner }),
        prepareArtifact: async (target, sha) => {
          for (const path of ["apps/web/dist", "apps/worker/dist"]) {
            await cp(join(root, path), join(target, path), { recursive: true });
          }
          await cp(join(root, "package-lock.json"), join(target, "package-lock.json"));
          await createReleaseManifest(target, sha);
        },
        stagingStatus: () => ({
          versions: [
            {
              version_id: statusCalls++ === 0 ? "previous-version" : "new-version",
              percentage: 100,
            },
          ],
        }),
        wrangler,
        deployVersion,
        deployTriggers,
        qualifyDeployment,
        persistArtifact,
        recordProvenance,
      });
      if (failure) await expect(deployment).rejects.toThrow("hosted qualification failed");
      else await deployment;
      expect(gateRunner).not.toHaveBeenCalled();
      for (const command of ["whoami", "email", "queues", "d1", "versions"]) {
        expect(wrangler.mock.calls.some(([args]) => args[0] === command)).toBe(true);
      }
      expect(deployTriggers).toHaveBeenCalledWith("staging");
      expect(qualifyDeployment).toHaveBeenCalledWith(receipt.inputs.commitSha);
      expect(deployVersion.mock.calls.map(([version]) => version)).toEqual(
        failure ? ["new-version", "previous-version"] : ["new-version"],
      );
      expect(persistArtifact).toHaveBeenCalledTimes(failure ? 0 : 1);
      expect(recordProvenance).toHaveBeenCalledTimes(failure ? 0 : 1);
    },
  );
});
