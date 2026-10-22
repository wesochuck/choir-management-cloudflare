// Local CI orchestration shared by `npm run check:ci` (strict) and
// `npm run check:ci:dev` (explicit development mode). Pure orchestration:
// all side effects (spawning, logging, manifest restore) arrive as injected
// callbacks so the matrix below is unit-testable without touching the tree.
//
// Rules (issue #286):
// - A valid audit report with high/critical findings, or an unexplained
//   audit failure, fails fast exactly like today.
// - A recognized transient registry outage (unverified_network) runs every
//   remaining check for diagnostics, then still fails strict check:ci.
// - check:ci:dev exits 0 on an unverified audit ONLY when every other check
//   passes, and labels the result DEGRADED. Release qualification never
//   consumes a degraded result (check:release always uses strict mode).
export const AUDIT_STEP_LABEL = "Audit high-severity dependencies";

/**
 * @param {object} options
 * @param {Array} options.steps non-audit check steps, in gate order
 * @param {() => Promise<object>} options.runAuditJson resolves the typed audit outcome
 * @param {(step: object) => Promise<void>} options.runStep rejects on step failure
 * @param {() => void} options.restoreManifest always runs, success or failure
 * @param {boolean} [options.dev] explicit development mode
 * @param {{ log: Function, error: Function }} [options.log]
 */
export async function runCheckCi({
  steps,
  runAuditJson,
  runStep,
  restoreManifest,
  dev = false,
  log = console,
}) {
  const results = [];
  let auditOutcome;
  try {
    try {
      auditOutcome = await runAuditJson();
      if (!auditOutcome || typeof auditOutcome.outcome !== "string") {
        auditOutcome = {
          attempts: 0,
          outcome: "failed_unknown",
          reason: "audit wrapper produced no parseable outcome",
        };
      }
    } catch (error) {
      auditOutcome = {
        attempts: 0,
        outcome: "failed_unknown",
        reason: `audit wrapper crashed: ${error?.message ?? error}`,
      };
    }

    if (auditOutcome.outcome === "passed") {
      log.log("Dependency audit: PASSED — verified clean at the high threshold.");
      results.push({ job: "static", label: AUDIT_STEP_LABEL, ok: true });
    } else if (auditOutcome.outcome === "unverified_network") {
      log.error(
        `\n✗ ${AUDIT_STEP_LABEL}: UNVERIFIED — npm registry unavailable ` +
          `after ${auditOutcome.attempts ?? "?"} bounded attempt(s) (${auditOutcome.reason ?? "no reason given"}). ` +
          "NOT security-verified; continuing with remaining checks for diagnostics.",
      );
      results.push({
        auditOutcome: "unverified_network",
        job: "static",
        label: AUDIT_STEP_LABEL,
        ok: false,
      });
    } else {
      const detail =
        auditOutcome.outcome === "vulnerable"
          ? `vulnerabilities found (${auditOutcome.reason ?? "see audit output"})`
          : `unexpected audit failure (${auditOutcome.reason ?? "no reason given"})`;
      log.error(`\n✗ ${AUDIT_STEP_LABEL} failed: ${detail}.`);
      results.push({
        auditOutcome: auditOutcome.outcome,
        job: "static",
        label: AUDIT_STEP_LABEL,
        ok: false,
      });
      return finish({ auditOutcome, dev, log, results });
    }

    for (const step of steps) {
      try {
        await runStep(step);
        results.push({ ...step, ok: true });
      } catch (error) {
        results.push({ ...step, ok: false });
        log.error(
          `\n✗ ${step.label} failed with exit ${error?.status ?? error?.message ?? error}.`,
        );
        if (auditOutcome.outcome === "passed") break;
      }
    }
    return finish({ auditOutcome, dev, log, results });
  } finally {
    restoreManifest();
  }
}

function finish({ auditOutcome, dev, log, results }) {
  const failed = results.filter((result) => !result.ok);
  const nonAuditFailed = failed.filter((result) => result.label !== AUDIT_STEP_LABEL);
  const degraded = auditOutcome.outcome === "unverified_network";
  const ran = results.length;
  const jobs = [...new Set(results.map((result) => result.job))];

  log.log("\nLocal CI mirror summary:");
  for (const result of results) {
    const marker = result.ok ? "✓" : "✗";
    const extra =
      !result.ok &&
      result.label === AUDIT_STEP_LABEL &&
      result.auditOutcome === "unverified_network"
        ? " (UNVERIFIED — registry unavailable)"
        : "";
    log.log(`  ${marker} ${(result.job ?? "").padEnd(14)} ${result.label}${extra}`);
  }

  if (failed.length === 0) {
    log.log(
      `\nAll ${ran} steps passed (CI ${jobs.join(", ")} jobs). ` +
        "The browser E2E job is not covered here: run `npx playwright install chromium && npm run test:e2e` " +
        "to cover it locally before pushing.",
    );
    return { auditOutcome, degraded: false, exitCode: 0, results };
  }

  if (dev && degraded && nonAuditFailed.length === 0) {
    log.log("\nLocal checks: COMPLETE (DEGRADED)");
    log.log(
      `Dependency audit: UNVERIFIED — npm registry unavailable after ${auditOutcome.attempts ?? "?"} bounded attempts`,
    );
    log.log("Security gate: NOT PASSED / release qualification NOT VALID");
    log.log("Remaining static/contract/unit/build/integration checks: PASSED");
    log.log("Next step: rerun strict npm run check:release when registry connectivity returns.");
    return { auditOutcome, degraded: true, exitCode: 0, results };
  }

  if (degraded && nonAuditFailed.length === 0) {
    log.error(
      `\nAudit high-severity dependencies could not be verified (registry unavailable); ` +
        `the remaining ${ran - 1} check(s) passed. ` +
        "This is NOT release-qualified: rerun strict `npm run check:ci` when registry connectivity returns.",
    );
  } else {
    const failedJob = [...new Set(failed.map((result) => result.job))];
    log.error(
      `\n${failed.length}/${ran} steps failed (CI ${failedJob.join(", ")} job(s) would fail). ` +
        "Fix and re-run `npm run check:ci` before pushing.",
    );
  }
  return { auditOutcome, degraded, exitCode: 1, results };
}
