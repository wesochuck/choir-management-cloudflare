import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkRelease } from "./check-release.mjs";

describe("check:release strictness", () => {
  it("invokes strict check:ci without any dev flag", async () => {
    const calls = [];
    const root = mkdtempSync(join(tmpdir(), "check-release-test-"));
    const result = await checkRelease({
      root,
      runner: (command, args) => {
        calls.push([command, args]);
        if (command === "npm" && args[1] === "check:ci") {
          // Simulate a passing gate so the suite completes without builds.
          return undefined;
        }
        return undefined;
      },
    });
    expect(result).toBe(true);
    const ciCalls = calls.filter(([command, args]) => command === "npm" && args[1] === "check:ci");
    expect(ciCalls).toHaveLength(1);
    expect(ciCalls[0][1]).toEqual(["run", "check:ci"]);
  });

  it("returns false when the strict gate fails, before any qualification evidence", async () => {
    const calls = [];
    const root = mkdtempSync(join(tmpdir(), "check-release-test-"));
    const env = { ...process.env };
    const result = await checkRelease({
      root,
      runner: (command, args) => {
        calls.push([command, args]);
        if (command === "npm" && args[1] === "check:ci") {
          const error = new Error("gate failed");
          error.status = 1;
          throw error;
        }
        return undefined;
      },
    });
    expect(result).toBe(false);
    expect(calls).toEqual([["npm", ["run", "check:ci"]]]);
    expect(env.RELEASE_QUALIFICATION).toBeUndefined();
  });

  it("passes RELEASE_QUALIFICATION=1 into the Playwright suite", async () => {
    const seen = [];
    const root = mkdtempSync(join(tmpdir(), "check-release-test-"));
    const gateFailure = new Error("e2e failed");
    gateFailure.status = 1;
    const result = await checkRelease({
      root,
      runner: (command, args, options) => {
        seen.push({ args, command, env: options?.env });
        if (command === "npm" && args[1] === "check:ci") return undefined;
        throw gateFailure;
      },
    });
    expect(result).toBe(false);
    const e2eCall = seen.find((call) => call.args.includes("test:e2e"));
    expect(e2eCall).toBeDefined();
    expect(e2eCall.env.RELEASE_QUALIFICATION).toBe("1");
    const ciCall = seen.find((call) => call.args.includes("check:ci"));
    expect(ciCall.env.RELEASE_QUALIFICATION).toBe("1");
  });
});
