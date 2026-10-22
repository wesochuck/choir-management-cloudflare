import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  AUDIT_POLICY,
  classifyAuditAttempt,
  countSeverities,
  runAuditAttempt,
  runDependencyAudit,
} from "./run-dependency-audit.mjs";

const HEALTHY_REPORT = {
  metadata: {
    dependencies: { dev: 10, optional: 0, peer: 0, prod: 50, total: 60 },
    vulnerabilities: { critical: 0, high: 0, info: 0, low: 2, moderate: 1, total: 3 },
  },
  vulnerabilities: {},
};

const VULNERABLE_REPORT = {
  metadata: {
    vulnerabilities: { critical: 1, high: 2, info: 0, low: 0, moderate: 0, total: 3 },
  },
};

function healthyAttempt() {
  return {
    exitCode: 0,
    signal: null,
    stderr: "",
    stdout: JSON.stringify(HEALTHY_REPORT),
    timedOut: false,
    truncated: false,
  };
}

describe("audit policy bounds", () => {
  it("stays inside a ~40s total budget with one wrapper-owned retry layer", () => {
    expect(AUDIT_POLICY.maxAttempts).toBe(2);
    expect(AUDIT_POLICY.fetchRetries).toBe(0);
    expect(AUDIT_POLICY.fetchTimeoutMs).toBe(15_000);
    expect(AUDIT_POLICY.attemptTimeoutMs).toBe(18_000);
    expect(AUDIT_POLICY.retryDelayMs).toBe(1_000);
    expect(AUDIT_POLICY.overallTimeoutMs).toBeLessThanOrEqual(45_000);
    // Worst case is attempt + delay + attempt, all inside the overall bound.
    expect(
      AUDIT_POLICY.attemptTimeoutMs * AUDIT_POLICY.maxAttempts + AUDIT_POLICY.retryDelayMs,
    ).toBeLessThanOrEqual(AUDIT_POLICY.overallTimeoutMs);
  });
});

describe("countSeverities", () => {
  it("prefers metadata counts", () => {
    expect(countSeverities(VULNERABLE_REPORT)).toEqual({ critical: 1, high: 2 });
  });

  it("aggregates per-entry severities when metadata is absent", () => {
    expect(
      countSeverities({
        vulnerabilities: {
          a: { severity: "high" },
          b: { severity: "critical" },
          c: { severity: "low" },
          d: {},
        },
      }),
    ).toEqual({ critical: 1, high: 1 });
  });

  it("returns null without trustworthy vulnerability data", () => {
    expect(countSeverities(null)).toBeNull();
    expect(countSeverities([])).toBeNull();
    expect(countSeverities({})).toBeNull();
    expect(countSeverities({ ok: true })).toBeNull();
    expect(countSeverities({ metadata: {} })).toBeNull();
    expect(countSeverities({ metadata: { vulnerabilities: { high: "many" } } })).toBeNull();
  });
});

describe("classifyAuditAttempt", () => {
  it("passes a valid clean report", () => {
    const result = classifyAuditAttempt({ ...healthyAttempt() });
    expect(result.outcome).toBe("passed");
    expect(result.transient).toBe(false);
  });

  it("passes low/moderate-only reports without claiming an all-severity clean bill", () => {
    const result = classifyAuditAttempt({
      exitCode: 1,
      stderr: "",
      stdout: JSON.stringify(HEALTHY_REPORT),
      timedOut: false,
    });
    // npm exits nonzero at the high threshold even for lower findings;
    // the report itself shows zero high/critical.
    expect(result.outcome).toBe("passed");
  });

  it("flags high/critical findings as vulnerable even with warnings present", () => {
    const result = classifyAuditAttempt({
      exitCode: 1,
      stderr: "npm warn old lockfile\n",
      stdout: JSON.stringify(VULNERABLE_REPORT),
      timedOut: false,
    });
    expect(result.outcome).toBe("vulnerable");
    expect(result.reason).toContain("2 high");
    expect(result.reason).toContain("1 critical");
    expect(result.transient).toBe(false);
  });

  it("classifies the observed registry timeout as unverified_network", () => {
    const result = classifyAuditAttempt({
      exitCode: 1,
      stderr:
        "npm warn audit network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk\n" +
        "npm error audit endpoint returned an error\n",
      stdout: JSON.stringify({
        error: { detail: "", summary: "" },
        message: "network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
      }),
      timedOut: false,
    });
    expect(result.outcome).toBe("unverified_network");
    expect(result.transient).toBe(true);
  });

  it.each([
    ["ETIMEDOUT", "npm error code ETIMEDOUT\nnpm error network timeout"],
    ["EAI_AGAIN", "npm error code EAI_AGAIN\nnpm error getaddrinfo EAI_AGAIN registry.npmjs.org"],
    ["ECONNRESET", "npm error code ECONNRESET\nnpm error socket hang up"],
    ["HTTP 429", "npm error code E429\nnpm error 429 Too Many Requests"],
    ["HTTP 503", "npm error 503 Service Unavailable"],
  ])("treats %s as a transient registry failure", (_name, stderr) => {
    const result = classifyAuditAttempt({ exitCode: 1, stderr, stdout: "", timedOut: false });
    expect(result.outcome).toBe("unverified_network");
    expect(result.transient).toBe(true);
  });

  it("treats a bare audit endpoint error without transient signal as unknown", () => {
    const result = classifyAuditAttempt({
      exitCode: 1,
      stderr: "npm error audit endpoint returned an error\n",
      stdout: JSON.stringify({ error: { detail: "", summary: "" }, message: "oops" }),
      timedOut: false,
    });
    expect(result.outcome).toBe("failed_unknown");
    expect(result.transient).toBe(false);
  });

  it.each([
    ["auth failure", "npm error code E401\nnpm error Incorrect or missing password"],
    ["certificate failure", "npm error UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
    ["TLS failure", "npm error code EPROTO\nnpm error write EPROTO"],
  ])("fails closed on %s (never transient, never clean)", (_name, stderr) => {
    const result = classifyAuditAttempt({ exitCode: 1, stderr, stdout: "", timedOut: false });
    expect(result.outcome).toBe("failed_unknown");
    expect(result.transient).toBe(false);
  });

  it("treats malformed or truncated exited output as unknown", () => {
    expect(
      classifyAuditAttempt({ exitCode: 1, stderr: "", stdout: "{not json", timedOut: false })
        .outcome,
    ).toBe("failed_unknown");
    expect(
      classifyAuditAttempt({ exitCode: 0, stderr: "", stdout: "", timedOut: false }).outcome,
    ).toBe("failed_unknown");
    expect(
      classifyAuditAttempt({ exitCode: 0, stderr: "", stdout: "{}", timedOut: false }).outcome,
    ).toBe("failed_unknown");
  });

  it("treats a timeout-killed attempt as transient even with garbage output", () => {
    const result = classifyAuditAttempt({
      exitCode: null,
      stderr: "npm warn audit network timeout at: https://registry.npmjs.org/\n",
      stdout: '{"vulnerabilities": {"left-pad": {"severi',
      timedOut: true,
    });
    expect(result.outcome).toBe("unverified_network");
    expect(result.transient).toBe(true);
  });
});

describe("runDependencyAudit orchestration", () => {
  it("succeeds on the first attempt without retrying", async () => {
    const runAttempt = vi.fn(async () => healthyAttempt());
    const result = await runDependencyAudit({ runAttempt, sleepFn: vi.fn() });
    expect(result.outcome).toBe("passed");
    expect(result.attempts).toBe(1);
    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty("stdout");
    expect(result).not.toHaveProperty("stderr");
  });

  it("retries once on a transient failure, then succeeds", async () => {
    const sleeps = [];
    const runAttempt = vi
      .fn()
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        stderr: "npm error code ECONNRESET",
        stdout: "",
        timedOut: false,
        truncated: false,
      })
      .mockResolvedValueOnce(healthyAttempt());
    const result = await runDependencyAudit({
      runAttempt,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result.outcome).toBe("passed");
    expect(result.attempts).toBe(2);
    expect(sleeps).toEqual([AUDIT_POLICY.retryDelayMs]);
  });

  it("never retries a confirmed vulnerability report", async () => {
    const runAttempt = vi.fn(async () => ({
      exitCode: 1,
      signal: null,
      stderr: "",
      stdout: JSON.stringify(VULNERABLE_REPORT),
      timedOut: false,
      truncated: false,
    }));
    const result = await runDependencyAudit({ runAttempt, sleepFn: vi.fn() });
    expect(result.outcome).toBe("vulnerable");
    expect(result.attempts).toBe(1);
    expect(result.high).toBe(2);
    expect(result.critical).toBe(1);
  });

  it("never retries an unknown failure", async () => {
    const runAttempt = vi.fn(async () => ({
      exitCode: 1,
      signal: null,
      stderr: "npm error code E401",
      stdout: "",
      timedOut: false,
      truncated: false,
    }));
    const result = await runDependencyAudit({ runAttempt, sleepFn: vi.fn() });
    expect(result.outcome).toBe("failed_unknown");
    expect(result.attempts).toBe(1);
  });

  it("reports unverified_network after exhausting bounded attempts", async () => {
    const runAttempt = vi.fn(async () => ({
      exitCode: 1,
      signal: null,
      stderr: "npm error code EAI_AGAIN",
      stdout: "",
      timedOut: false,
      truncated: false,
    }));
    const result = await runDependencyAudit({ runAttempt, sleepFn: async () => undefined });
    expect(result.outcome).toBe("unverified_network");
    expect(result.attempts).toBe(2);
    expect(runAttempt).toHaveBeenCalledTimes(2);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.command).toContain("npm audit");
  });

  it("stops without attempts when the overall budget is already spent", async () => {
    const runAttempt = vi.fn(async () => healthyAttempt());
    let now = 1000;
    const result = await runDependencyAudit({
      now: () => now,
      policy: { ...AUDIT_POLICY, overallTimeoutMs: 0 },
      runAttempt,
      sleepFn: vi.fn(),
    });
    expect(result.attempts).toBe(0);
    expect(result.outcome).toBe("unverified_network");
    expect(runAttempt).not.toHaveBeenCalled();
    expect(now).toBe(1000);
  });
});

describe("runAuditAttempt subprocess bounds", () => {
  function fakeSpawn({ behavior }) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    // A real kill delivers SIGTERM/SIGKILL and the process exits, which
    // surfaces as a close event. The fake reproduces that contract so the
    // wrapper's cleanup path is genuinely exercised.
    child.kill = vi.fn((signal) => {
      queueMicrotask(() => child.emit("close", null, signal ?? null));
      return true;
    });
    child.__behavior = behavior;
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => behavior(child));
      return child;
    });
    return { child, spawnFn };
  }

  it("passes npm fetch flags that constrain the invocation regardless of user config", async () => {
    const { spawnFn } = fakeSpawn({
      behavior: (child) => {
        child.stdout.emit("data", JSON.stringify(HEALTHY_REPORT));
        child.emit("close", 0, null);
      },
    });
    const result = await runAuditAttempt({ spawnFn });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [command, args] = spawnFn.mock.calls[0];
    expect(command).toBe("npm");
    expect(args).toEqual(
      expect.arrayContaining([
        "audit",
        "--audit-level=high",
        "--json",
        "--fetch-retries=0",
        "--fetch-timeout=15000",
      ]),
    );
    expect(result.timedOut).toBe(false);
  });

  it("kills a hung child at the hard attempt timeout and marks it transient", async () => {
    const { child, spawnFn } = fakeSpawn({ behavior: () => undefined });
    const promise = runAuditAttempt({
      policy: { ...AUDIT_POLICY, attemptTimeoutMs: 20, killGraceMs: 5 },
      spawnFn,
    });
    const result = await promise;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result.timedOut).toBe(true);
    const classification = classifyAuditAttempt({ ...result, timedOut: result.timedOut });
    expect(classification.outcome).toBe("unverified_network");
  });

  it("caps captured output for runaway registries", async () => {
    const { spawnFn } = fakeSpawn({
      behavior: (child) => {
        child.stdout.emit("data", `{"metadata": ${"x".repeat(200)}}`);
        child.emit("close", 1, null);
      },
    });
    const result = await runAuditAttempt({
      policy: { ...AUDIT_POLICY, maxOutputBytes: 20 },
      spawnFn,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(20);
  });
});
