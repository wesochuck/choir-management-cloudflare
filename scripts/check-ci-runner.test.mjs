import { describe, expect, it, vi } from "vitest";

import { runCheckCi } from "./check-ci-runner.mjs";

const STEPS = [
  { args: ["a"], command: "node", job: "static", label: "First check" },
  { args: ["b"], command: "node", job: "unit", label: "Second check" },
];

function harness({ auditOutcome, failingLabels = [], dev = false } = {}) {
  const calls = [];
  const logs = [];
  const errors = [];
  const log = {
    error: (line) => errors.push(String(line)),
    log: (line) => logs.push(String(line)),
  };
  const runAuditJson = vi.fn(async () => ({ ...auditOutcome }));
  const runStep = vi.fn(async (step) => {
    calls.push(step.label);
    if (failingLabels.includes(step.label)) {
      const error = new Error(`step failed: ${step.label}`);
      error.status = 1;
      throw error;
    }
  });
  const restoreManifest = vi.fn();
  const run = () =>
    runCheckCi({
      dev,
      log,
      restoreManifest,
      runAuditJson,
      runStep,
      steps: STEPS,
    });
  return { calls, errors, log, logs, restoreManifest, run, runAuditJson, runStep };
}

const PASSED_AUDIT = { attempts: 1, elapsedMs: 1200, outcome: "passed", reason: "clean" };
const OUTAGE_AUDIT = {
  attempts: 2,
  elapsedMs: 21000,
  outcome: "unverified_network",
  reason: "registry unavailable",
};
const VULNERABLE_AUDIT = {
  attempts: 1,
  critical: 1,
  elapsedMs: 900,
  high: 2,
  outcome: "vulnerable",
  reason: "audit reported findings",
};

describe("check:ci runner", () => {
  it("runs every step in order and passes when the audit passes", async () => {
    const h = harness({ auditOutcome: PASSED_AUDIT });
    const result = await h.run();
    expect(result.exitCode).toBe(0);
    expect(h.calls).toEqual(["First check", "Second check"]);
    expect(h.restoreManifest).toHaveBeenCalledTimes(1);
    expect(h.logs.join("\n")).toContain("All 3 steps passed");
    expect(result.degraded).toBe(false);
  });

  it("restores the manifest even when a step throws", async () => {
    const h = harness({ auditOutcome: PASSED_AUDIT, failingLabels: ["First check"] });
    const result = await h.run();
    expect(result.exitCode).toBe(1);
    expect(h.restoreManifest).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual(["First check"]);
  });

  it("runs all remaining checks on a recognized outage but still fails strict", async () => {
    const h = harness({ auditOutcome: OUTAGE_AUDIT });
    const result = await h.run();
    expect(result.exitCode).toBe(1);
    expect(h.calls).toEqual(["First check", "Second check"]);
    expect(h.restoreManifest).toHaveBeenCalledTimes(1);
    const output = [...h.logs, ...h.errors].join("\n");
    expect(output).toContain("UNVERIFIED");
    expect(output).not.toContain("All 3 steps passed");
    expect(output).toContain("NOT release-qualified");
    expect(result.degraded).toBe(true);
  });

  it("marks dev runs DEGRADED with exit 0 only when every other check passes", async () => {
    const h = harness({ auditOutcome: OUTAGE_AUDIT, dev: true });
    const result = await h.run();
    expect(result.exitCode).toBe(0);
    expect(h.calls).toEqual(["First check", "Second check"]);
    const output = h.logs.join("\n");
    expect(output).toContain("Local checks: COMPLETE (DEGRADED)");
    expect(output).toContain("Dependency audit: UNVERIFIED");
    expect(output).toContain("Security gate: NOT PASSED / release qualification NOT VALID");
    expect(output).toContain("Remaining static/contract/unit/build/integration checks: PASSED");
    expect(output).toContain("rerun strict npm run check:release");
  });

  it("fails dev mode when another check fails during an outage", async () => {
    const h = harness({ auditOutcome: OUTAGE_AUDIT, dev: true, failingLabels: ["Second check"] });
    const result = await h.run();
    expect(result.exitCode).toBe(1);
    expect(h.calls).toEqual(["First check", "Second check"]);
    expect(h.logs.join("\n")).not.toContain("COMPLETE (DEGRADED)");
  });

  it("fails fast on a confirmed vulnerability without running other checks", async () => {
    for (const dev of [false, true]) {
      const h = harness({ auditOutcome: VULNERABLE_AUDIT, dev });
      const result = await h.run();
      expect(result.exitCode).toBe(1);
      expect(h.runStep).not.toHaveBeenCalled();
      expect(h.restoreManifest).toHaveBeenCalledTimes(1);
      expect([...h.logs, ...h.errors].join("\n")).toContain("vulnerabilities found");
    }
  });

  it("fails fast on unknown audit failures and malformed outcomes", async () => {
    for (const outcome of [
      { attempts: 1, outcome: "failed_unknown", reason: "weird envelope" },
      { attempts: 0, outcome: "mystery", reason: "not an outcome" },
      null,
    ]) {
      const h = harness({ auditOutcome: outcome });
      const result = await h.run();
      expect(result.exitCode).toBe(1);
      expect(h.runStep).not.toHaveBeenCalled();
      expect(h.restoreManifest).toHaveBeenCalledTimes(1);
    }
  });

  it("treats a crashing audit runner as an unknown failure", async () => {
    const calls = [];
    const restoreManifest = vi.fn();
    const result = await runCheckCi({
      dev: false,
      log: { error: () => undefined, log: () => undefined },
      restoreManifest,
      runAuditJson: async () => {
        throw new Error("spawn ENOENT");
      },
      runStep: async (step) => {
        calls.push(step.label);
      },
      steps: STEPS,
    });
    expect(result.exitCode).toBe(1);
    expect(calls).toEqual([]);
    expect(restoreManifest).toHaveBeenCalledTimes(1);
  });
});
