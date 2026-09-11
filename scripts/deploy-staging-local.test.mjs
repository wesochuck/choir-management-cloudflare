import { describe, expect, it, vi } from "vitest";

import {
  activeVersionId,
  assertEmailFeedbackSubscription,
  assertEmailSendingEnabled,
  assertReleaseCheckout,
  deployStaging,
  deployTriggers,
  deployVersion,
  qualifyDeployment,
  runReleaseGate,
  sanitizeExternalOutput,
  uploadedVersionId,
} from "./deploy-staging-local.mjs";

describe("local staging deployment safeguards", () => {
  it("requires a clean main checkout synchronized with origin", () => {
    const valid = {
      branch: "main",
      status: "",
      head: "a".repeat(40),
      originMain: "a".repeat(40),
    };
    expect(() => assertReleaseCheckout(valid)).not.toThrow();
    expect(() => assertReleaseCheckout({ ...valid, branch: "feature" })).toThrow(/main branch/u);
    expect(() => assertReleaseCheckout({ ...valid, status: " M package.json" })).toThrow(
      /clean working tree/u,
    );
    expect(() => assertReleaseCheckout({ ...valid, originMain: "b".repeat(40) })).toThrow(
      /origin\/main/u,
    );
  });

  it("accepts only the complete staging email feedback subscription", () => {
    const subscription = {
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
    };
    expect(() => assertEmailFeedbackSubscription([subscription])).not.toThrow();
    expect(() =>
      assertEmailFeedbackSubscription([{ ...subscription, events: ["message.delivered"] }]),
    ).toThrow(/missing or incomplete/u);
  });

  it("extracts active and uploaded Worker version IDs", () => {
    expect(activeVersionId({ versions: [{ version_id: "active-version", percentage: 100 }] })).toBe(
      "active-version",
    );
    expect(uploadedVersionId('{"type":"version-upload","version_id":"new-version"}\n')).toBe(
      "new-version",
    );
    expect(() => activeVersionId({ versions: [] })).toThrow(/100%/u);
    expect(() => uploadedVersionId("not json")).toThrow(/version ID/u);
  });

  it("accepts only verified and enabled email sending domains", () => {
    const tableOutput = `
┌───────────────┬────────────────────────────┬─────────┬──────────────────────────────────┐
│ zone          │ name                       │ enabled │ tag                              │
├───────────────┼────────────────────────────┼─────────┼──────────────────────────────────┤
│ musicsite.org │ mail.staging.musicsite.org │ yes     │ 672a6796460e4004886dd48c96715849 │
├───────────────┼────────────────────────────┼─────────┼──────────────────────────────────┤
│ musicsite.org │ mail.musicsite.org         │ yes     │ ddf97609ef204c588f9d1c3e2802e37c │
└───────────────┴────────────────────────────┴─────────┴──────────────────────────────────┘
`;
    expect(() =>
      assertEmailSendingEnabled(tableOutput, "mail.staging.musicsite.org"),
    ).not.toThrow();
    expect(() => assertEmailSendingEnabled(tableOutput, "mail.musicsite.org")).not.toThrow();
    expect(() => assertEmailSendingEnabled(tableOutput, "unverified.musicsite.org")).toThrow(
      /Email Sending is not enabled/u,
    );
  });

  it("redacts email addresses and secret-like values from captured failures", () => {
    expect(sanitizeExternalOutput("user@example.com token=abc123")).toBe(
      "[redacted-email] token=[redacted]",
    );
  });

  it("retries deployVersion when encountering version propagation delay (error 100146)", async () => {
    let callCount = 0;
    const runner = vi.fn(() => {
      callCount += 1;
      if (callCount < 3) {
        throw new Error(
          "The requested Worker version could not be found, please check the ID being passed and try again. [code: 100146]",
        );
      }
      return "";
    });
    const sleeper = vi.fn(async () => Promise.resolve());

    await deployVersion("version-123", "deploy message", {
      attempts: 4,
      retryDelayMs: 50,
      runner,
      sleeper,
    });

    expect(runner).toHaveBeenCalledTimes(3);
    expect(sleeper).toHaveBeenCalledTimes(2);
    expect(sleeper).toHaveBeenCalledWith(50);
  });

  it("throws when deployVersion retries are exhausted", async () => {
    const runner = vi.fn(() => {
      throw new Error(
        "The requested Worker version could not be found, please check the ID being passed and try again. [code: 100146]",
      );
    });
    const sleeper = vi.fn(async () => Promise.resolve());

    await expect(
      deployVersion("version-123", "deploy message", {
        attempts: 3,
        retryDelayMs: 10,
        runner,
        sleeper,
      }),
    ).rejects.toThrow(/100146/u);

    expect(runner).toHaveBeenCalledTimes(3);
    expect(sleeper).toHaveBeenCalledTimes(2);
  });

  it("fails immediately on non-propagation errors without retrying", async () => {
    const runner = vi.fn(() => {
      throw new Error("Authentication error [code: 10000]");
    });
    const sleeper = vi.fn(async () => Promise.resolve());

    await expect(
      deployVersion("version-123", "deploy message", {
        attempts: 3,
        retryDelayMs: 10,
        runner,
        sleeper,
      }),
    ).rejects.toThrow(/10000/u);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(sleeper).not.toHaveBeenCalled();
  });

  it("retries deployTriggers when encountering transient Cloudflare trigger errors (code 10013)", async () => {
    let callCount = 0;
    const runner = vi.fn(() => {
      callCount += 1;
      if (callCount < 3) {
        throw new Error(
          "Trigger configuration for 'choir-management-cloudflare-staging' was only partially updated: Queue consumers: A request to the Cloudflare API failed. [code: 10013]",
        );
      }
      return "Deployed triggers";
    });
    const sleeper = vi.fn(async () => Promise.resolve());

    await deployTriggers("staging", {
      attempts: 4,
      retryDelayMs: 50,
      runner,
      sleeper,
    });

    expect(runner).toHaveBeenCalledTimes(3);
    expect(sleeper).toHaveBeenCalledTimes(2);
    expect(sleeper).toHaveBeenCalledWith(50);
  });

  it("throws when deployTriggers retries are exhausted", async () => {
    const runner = vi.fn(() => {
      throw new Error("A request to the Cloudflare API failed. [code: 10013]");
    });
    const sleeper = vi.fn(async () => Promise.resolve());

    await expect(
      deployTriggers("staging", {
        attempts: 3,
        retryDelayMs: 10,
        runner,
        sleeper,
      }),
    ).rejects.toThrow(/10013/u);

    expect(runner).toHaveBeenCalledTimes(3);
    expect(sleeper).toHaveBeenCalledTimes(2);
  });

  describe("qualifyDeployment retry deduplication", () => {
    it("runs qualification with inner attempts when no outer retries are specified", async () => {
      const recordedRuns = [];
      const runner = vi.fn((cmd, args, options) => {
        recordedRuns.push({ args, cmd, env: options?.env });
      });

      await qualifyDeployment("commit-abc", {
        attempts: 20,
        retryDelayMs: 1000,
        runner,
      });

      expect(runner).toHaveBeenCalledTimes(2);
      expect(recordedRuns[0].args).toEqual(["run", "qualify:staging"]);
      expect(recordedRuns[0].env?.STAGING_QUALIFY_ATTEMPTS).toBe("20");
      expect(recordedRuns[1].args).toEqual([
        "run",
        "qualify:staging:evidence",
        "--",
        "--anonymous",
      ]);
    });

    it("deduplicates retries by setting inner attempts to 1 when outerMaxAttempts is active", async () => {
      const recordedRuns = [];
      const runner = vi.fn((cmd, args, options) => {
        recordedRuns.push({ args, cmd, env: options?.env });
        if (args[1] === "qualify:staging") {
          throw new Error("Staging qualification endpoint timeout");
        }
      });
      const sleeper = vi.fn(async () => Promise.resolve());

      await expect(
        qualifyDeployment("commit-abc", {
          attempts: 36,
          outerMaxAttempts: 3,
          retryDelayMs: 25,
          runner,
          sleeper,
        }),
      ).rejects.toThrow(/timeout/u);

      // Total attempts on failure must exactly equal outerMaxAttempts, NOT outerMaxAttempts * 36
      expect(runner).toHaveBeenCalledTimes(3);
      expect(sleeper).toHaveBeenCalledTimes(2);
      for (const runCall of recordedRuns) {
        expect(runCall.env?.STAGING_QUALIFY_ATTEMPTS).toBe("1");
      }
    });

    it("succeeds on intermediate outer retry without continuing remaining attempts", async () => {
      let callCount = 0;
      const runner = vi.fn((_cmd, args) => {
        if (args[1] === "qualify:staging") {
          callCount += 1;
          if (callCount === 1) {
            throw new Error("Transient network failure");
          }
        }
      });
      const sleeper = vi.fn(async () => Promise.resolve());

      await qualifyDeployment("commit-abc", {
        outerMaxAttempts: 4,
        retryDelayMs: 20,
        runner,
        sleeper,
      });

      // Failed once, succeeded on 2nd attempt; ran qualify:staging:evidence once on success
      expect(callCount).toBe(2);
      expect(sleeper).toHaveBeenCalledTimes(1);
    });
  });

  describe("canonical release gate invocation", () => {
    it("installs Chromium and invokes npm run check:release", () => {
      const calls = [];
      const runner = vi.fn((command, args) => {
        calls.push({ args, command });
        return "";
      });

      runReleaseGate({ runner });

      expect(runner).toHaveBeenCalledTimes(2);
      expect(calls[0]).toEqual({
        command: "npx",
        args: ["playwright", "install", "chromium"],
      });
      expect(calls[1]).toEqual({
        command: "npm",
        args: ["run", "check:release"],
      });
    });

    it("does not independently invoke check:ci or test:e2e", () => {
      const calls = [];
      const runner = vi.fn((command, args) => {
        calls.push({ args, command });
        return "";
      });

      runReleaseGate({ runner });

      const invokedArgs = calls.flatMap((c) => c.args);
      expect(invokedArgs).not.toContain("check:ci");
      expect(invokedArgs).not.toContain("test:e2e");
    });

    it("deployStaging invokes the canonical release gate", async () => {
      const releaseGateSpy = vi.fn();
      let callCount = 0;
      const verifyCheckoutSpy = vi.fn(() => {
        callCount += 1;
        // Return a different commit SHA on the second verification call so deployStaging
        // exits immediately after the release gate without building a release artifact.
        return callCount === 1 ? "c".repeat(40) : "d".repeat(40);
      });

      await expect(
        deployStaging({
          argv: ["--yes"],
          verifyCheckout: verifyCheckoutSpy,
          runReleaseGate: releaseGateSpy,
        }),
      ).rejects.toThrow(/release commit changed during checks/u);

      expect(verifyCheckoutSpy).toHaveBeenCalledTimes(2);
      expect(releaseGateSpy).toHaveBeenCalledTimes(1);
    });
  });
});
