import { describe, expect, it, vi } from "vitest";

import { buildProbes, evaluateAttempt, probe, runQualification } from "./qualify-staging.mjs";

describe("qualify-staging helper logic", () => {
  it("builds custom-domain and worker probes correctly", () => {
    const withWorker = buildProbes({
      organizationSlugs: ["lcc", "lmc"],
      productUrl: "https://staging.musicsite.org",
      workerUrl: "https://staging.workers.dev",
    });
    expect(withWorker.probes.map((p) => p.label)).toEqual([
      "deployed Worker health",
      "deployed Worker readiness",
      "product health",
      "product readiness",
      "lcc Organization health",
      "lmc Organization health",
    ]);
    expect(withWorker.workerProbes.length).toBe(2);
    expect(withWorker.customDomainProbes.length).toBe(4);

    const withoutWorker = buildProbes({
      organizationSlugs: ["lcc"],
      productUrl: "https://musicsite.org",
      workerUrl: "",
    });
    expect(withoutWorker.workerProbes.length).toBe(0);
    expect(withoutWorker.probes.map((p) => p.label)).toEqual([
      "product health",
      "product readiness",
      "lcc Organization health",
    ]);
  });

  describe("probe function", () => {
    it("fulfills when health check matches expected version and environment", async () => {
      const fetcher = vi.fn(async () => ({
        json: async () => ({
          environment: "staging",
          status: "ok",
          version: "target-sha",
        }),
        status: 200,
      }));

      await expect(
        probe(
          { expected: "health", label: "product health", url: "https://example.com/api/health" },
          {
            expectedEnvironment: "staging",
            expectedVersion: "target-sha",
            fetcher,
          },
        ),
      ).resolves.toBeUndefined();
    });

    it("fulfills for readiness check when status is ready", async () => {
      const fetcher = vi.fn(async () => ({
        json: async () => ({ status: "ready" }),
        status: 200,
      }));

      await expect(
        probe(
          { expected: "ready", label: "product readiness", url: "https://example.com/api/ready" },
          { fetcher },
        ),
      ).resolves.toBeUndefined();
    });

    it("throws version mismatch when health check serves previous version", async () => {
      const fetcher = vi.fn(async () => ({
        json: async () => ({
          environment: "staging",
          status: "ok",
          version: "previous-sha",
        }),
        status: 200,
      }));

      await expect(
        probe(
          { expected: "health", label: "product health", url: "https://example.com/api/health" },
          {
            expectedEnvironment: "staging",
            expectedVersion: "target-sha",
            fetcher,
          },
        ),
      ).rejects.toThrow("product health serves previous-sha instead of target-sha.");
    });

    it("throws on non-200 HTTP responses", async () => {
      const fetcher = vi.fn(async () => ({
        json: async () => ({ error: "internal error" }),
        status: 500,
      }));

      await expect(
        probe(
          { expected: "health", label: "product health", url: "https://example.com/api/health" },
          { fetcher },
        ),
      ).rejects.toThrow("product health returned HTTP 500.");
    });

    it("returns edgeBlocked for HTTP 403 on custom-domain probes", async () => {
      const fetcher = vi.fn(async () => ({
        json: async () => ({}),
        status: 403,
      }));
      const entry = {
        expected: "health",
        label: "product health",
        url: "https://staging.musicsite.org/api/health",
      };

      const result = await probe(entry, {
        customDomainProbes: [entry],
        fetcher,
      });

      expect(result).toEqual({ edgeBlocked: true });
    });

    it("throws HTTP 403 on deployed Worker probes instead of returning edgeBlocked", async () => {
      const fetcher = vi.fn(async () => ({
        json: async () => ({}),
        status: 403,
      }));
      const entry = {
        expected: "health",
        label: "deployed Worker health",
        url: "https://worker.dev/api/health",
      };

      await expect(
        probe(entry, {
          customDomainProbes: [
            {
              expected: "health",
              label: "product health",
              url: "https://staging.musicsite.org/api/health",
            },
          ],
          fetcher,
        }),
      ).rejects.toThrow("deployed Worker health returned HTTP 403.");
    });
  });

  describe("evaluateAttempt", () => {
    const workerProbes = [
      { expected: "health", label: "deployed Worker health", url: "https://worker/api/health" },
      { expected: "ready", label: "deployed Worker readiness", url: "https://worker/api/ready" },
    ];
    const customDomainProbes = [
      { expected: "health", label: "product health", url: "https://domain/api/health" },
      { expected: "ready", label: "product readiness", url: "https://domain/api/ready" },
      { expected: "health", label: "lcc Organization health", url: "https://lcc/api/health" },
    ];
    const allProbes = [...workerProbes, ...customDomainProbes];

    it("recognizes propagation delay when direct Worker passed and custom domains are stale", () => {
      const results = [
        { status: "fulfilled" }, // deployed Worker health
        { status: "fulfilled" }, // deployed Worker readiness
        {
          reason: new Error("product health serves old-sha instead of new-sha."),
          status: "rejected",
        },
        { status: "fulfilled" }, // product readiness
        {
          reason: new Error("lcc Organization health serves old-sha instead of new-sha."),
          status: "rejected",
        },
      ];

      const evaluation = evaluateAttempt(results, allProbes, customDomainProbes, workerProbes);

      expect(evaluation.directWorkerPassed).toBe(true);
      expect(evaluation.propagationDelay).toBe(true);
      expect(evaluation.qualified).toBe(false);
      expect(evaluation.failures.length).toBe(2);
    });

    it("recognizes propagation delay when all probes including Worker are stale", () => {
      const results = [
        {
          reason: new Error("deployed Worker health serves old-sha instead of new-sha."),
          status: "rejected",
        },
        { status: "fulfilled" },
        {
          reason: new Error("product health serves old-sha instead of new-sha."),
          status: "rejected",
        },
        { status: "fulfilled" },
        {
          reason: new Error("lcc Organization health serves old-sha instead of new-sha."),
          status: "rejected",
        },
      ];

      const evaluation = evaluateAttempt(results, allProbes, customDomainProbes, workerProbes);

      expect(evaluation.directWorkerPassed).toBe(false);
      expect(evaluation.propagationDelay).toBe(true);
      expect(evaluation.qualified).toBe(false);
    });

    it("rejects propagation delay when direct Worker probe has a real error (HTTP 500)", () => {
      const results = [
        {
          reason: new Error("deployed Worker health returned HTTP 500."),
          status: "rejected",
        },
        { status: "fulfilled" },
        {
          reason: new Error("product health serves old-sha instead of new-sha."),
          status: "rejected",
        },
        { status: "fulfilled" },
        {
          reason: new Error("lcc Organization health serves old-sha instead of new-sha."),
          status: "rejected",
        },
      ];

      const evaluation = evaluateAttempt(results, allProbes, customDomainProbes, workerProbes);

      expect(evaluation.directWorkerPassed).toBe(false);
      expect(evaluation.propagationDelay).toBe(false);
      expect(evaluation.qualified).toBe(false);
    });

    it("rejects propagation delay when custom domain has a real error (readiness failed)", () => {
      const results = [
        { status: "fulfilled" },
        { status: "fulfilled" },
        {
          reason: new Error("product health serves old-sha instead of new-sha."),
          status: "rejected",
        },
        {
          reason: new Error("product readiness did not report ready."),
          status: "rejected",
        },
        {
          reason: new Error("lcc Organization health serves old-sha instead of new-sha."),
          status: "rejected",
        },
      ];

      const evaluation = evaluateAttempt(results, allProbes, customDomainProbes, workerProbes);

      expect(evaluation.directWorkerPassed).toBe(true);
      expect(evaluation.propagationDelay).toBe(false);
      expect(evaluation.qualified).toBe(false);
    });

    it("qualifies when all probes succeed", () => {
      const results = allProbes.map(() => ({ status: "fulfilled" }));

      const evaluation = evaluateAttempt(results, allProbes, customDomainProbes, workerProbes);

      expect(evaluation.qualified).toBe(true);
      expect(evaluation.failures.length).toBe(0);
      expect(evaluation.propagationDelay).toBe(false);
    });

    it("qualifies with degraded status when all custom domains are edge blocked and Worker passed", () => {
      const results = [
        { status: "fulfilled" },
        { status: "fulfilled" },
        { status: "fulfilled", value: { edgeBlocked: true } },
        { status: "fulfilled", value: { edgeBlocked: true } },
        { status: "fulfilled", value: { edgeBlocked: true } },
      ];

      const evaluation = evaluateAttempt(results, allProbes, customDomainProbes, workerProbes);

      expect(evaluation.qualified).toBe(true);
      expect(evaluation.allEdgeBlocked).toBe(true);
      expect(evaluation.failures.length).toBe(0);
    });
  });

  describe("runQualification end-to-end simulation", () => {
    it("handles edge propagation delay without triggering qualification failure or rollback", async () => {
      const logger = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };
      const fetcher = vi.fn(async (url) => {
        if (url.includes("workers.dev")) {
          if (url.includes("/api/ready")) {
            return { json: async () => ({ status: "ready" }), status: 200 };
          }
          return {
            json: async () => ({ environment: "staging", status: "ok", version: "target-sha" }),
            status: 200,
          };
        }
        // Custom domain endpoints still serve previous version
        if (url.includes("/api/ready")) {
          return { json: async () => ({ status: "ready" }), status: 200 };
        }
        return {
          json: async () => ({ environment: "staging", status: "ok", version: "old-sha" }),
          status: 200,
        };
      });

      const outcome = await runQualification({
        attempts: 2,
        expectedVersion: "target-sha",
        fetcher,
        logger,
        organizationSlugs: ["lcc"],
        productUrl: "https://staging.musicsite.org",
        retryDelayMs: 0,
        workerUrl: "https://choir.staging.workers.dev",
      });

      expect(outcome.success).toBe(true);
      expect(outcome.exitCode).toBe(0);
      expect(outcome.propagationDelay).toBe(true);
      expect(outcome.qualified).toBe(false);
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "Qualified Worker version target-sha directly on deployed Worker probes",
        ),
      );
    });

    it("reports hard failure and returns exitCode 1 when a real Worker failure occurs", async () => {
      const logger = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };
      const fetcher = vi.fn(async (url) => {
        if (url.includes("workers.dev")) {
          return { json: async () => ({}), status: 500 };
        }
        return {
          json: async () => ({ environment: "staging", status: "ok", version: "old-sha" }),
          status: 200,
        };
      });

      const outcome = await runQualification({
        attempts: 2,
        expectedVersion: "target-sha",
        fetcher,
        logger,
        organizationSlugs: ["lcc"],
        productUrl: "https://staging.musicsite.org",
        retryDelayMs: 0,
        workerUrl: "https://choir.staging.workers.dev",
      });

      expect(outcome.success).toBe(false);
      expect(outcome.exitCode).toBe(1);
      expect(outcome.propagationDelay).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Release qualification failed"),
      );
    });

    it("reports hard failure when custom domain returns HTTP 500", async () => {
      const logger = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };
      const fetcher = vi.fn(async (url) => {
        if (url.includes("workers.dev")) {
          if (url.includes("/api/ready")) {
            return { json: async () => ({ status: "ready" }), status: 200 };
          }
          return {
            json: async () => ({ environment: "staging", status: "ok", version: "target-sha" }),
            status: 200,
          };
        }
        return { json: async () => ({}), status: 500 };
      });

      const outcome = await runQualification({
        attempts: 1,
        expectedVersion: "target-sha",
        fetcher,
        logger,
        organizationSlugs: ["lcc"],
        productUrl: "https://staging.musicsite.org",
        retryDelayMs: 0,
        workerUrl: "https://choir.staging.workers.dev",
      });

      expect(outcome.success).toBe(false);
      expect(outcome.exitCode).toBe(1);
      expect(outcome.propagationDelay).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Release qualification failed"),
      );
    });

    it("succeeds immediately when all probes match expected version", async () => {
      const logger = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };
      const fetcher = vi.fn(async (url) => {
        if (url.includes("/api/ready")) {
          return { json: async () => ({ status: "ready" }), status: 200 };
        }
        return {
          json: async () => ({ environment: "staging", status: "ok", version: "target-sha" }),
          status: 200,
        };
      });

      const outcome = await runQualification({
        attempts: 3,
        expectedVersion: "target-sha",
        fetcher,
        logger,
        organizationSlugs: ["lcc"],
        productUrl: "https://staging.musicsite.org",
        retryDelayMs: 0,
        workerUrl: "https://choir.staging.workers.dev",
      });

      expect(outcome.success).toBe(true);
      expect(outcome.exitCode).toBe(0);
      expect(outcome.qualified).toBe(true);
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining("Qualified Worker version target-sha with 5 API probes."),
      );
    });

    it("throws when expected version is missing", async () => {
      await expect(
        runQualification({
          env: {},
          expectedVersion: undefined,
        }),
      ).rejects.toThrow("The expected release version is required for qualification.");
    });
  });
});
