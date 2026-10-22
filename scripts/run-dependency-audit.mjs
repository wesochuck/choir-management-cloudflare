// Bounded, network-aware dependency audit wrapper (issue #286).
//
// `npm audit` uses one nonzero exit code for both real vulnerabilities and
// request errors, and its defaults allow several minutes of waiting per
// request (fetch-timeout=300000, fetch-retries=2). This wrapper owns the
// only retry layer: two total attempts with npm's own retries disabled,
// an 18s hard kill per attempt, ~1s between attempts, and a 40s overall
// wall-clock bound even if the child hangs.
//
// Outcomes:
//   passed             valid report, zero high/critical findings
//   vulnerable         valid report with >=1 high/critical finding (fail fast)
//   unverified_network recognized transient registry/network failure, no report
//   failed_unknown     malformed report, auth/TLS failure, or anything else
//
// An unavailable registry is NEVER reported as clean. `npm run audit`
// stays strict: only `passed` exits 0.
import { spawn } from "node:child_process";

export const AUDIT_POLICY = {
  maxAttempts: 2,
  fetchRetries: 0,
  fetchTimeoutMs: 15_000,
  attemptTimeoutMs: 18_000,
  retryDelayMs: 1_000,
  overallTimeoutMs: 40_000,
  maxOutputBytes: 1_000_000,
  killGraceMs: 1_000,
};

export const AUDIT_OUTCOMES = ["passed", "vulnerable", "unverified_network", "failed_unknown"];

// Transient signals: temporary network/registry failures worth one retry.
// Deliberately narrow: auth, TLS/certificate, and unrecognized errors are
// NOT transient, so a persistent misconfiguration can never degrade into a
// quiet retry loop.
const TRANSIENT_PATTERNS = [
  /\bETIMEDOUT\b/i,
  /\bECONNRESET\b/i,
  /\bEAI_AGAIN\b/i,
  /\bENOTFOUND\b/i,
  /\bEPIPE\b/i,
  /socket hang up/i,
  /network timeout/i,
  /getaddrinfo/i,
  /fetch failed/i,
  /audit request failed/i,
  /temporar\w* (unavailable|failure|error)/i,
  /HTTP (429|502|503|504)\b/,
  /\b(429|502|503|504) (Too Many|Bad Gateway|Service Unavailable|Gateway Timeout)/i,
];

// Security-sensitive failures: never transient, never retried, never clean.
// Checked BEFORE the transient allowlist so a mixed diagnostic fails closed.
const FATAL_PATTERNS = [
  /\bE401\b/,
  /\bE403\b/,
  /\bENEEDAUTH\b/,
  /\bEOTP\b/,
  /unauthori[sz]ed/i,
  /authentication/i,
  /\bCERT\b/i,
  /certificate/i,
  /UNABLE_TO_VERIFY/i,
  /TLS|SSL handshake|EPROTO|ERR_TLS/i,
];

const NETWORK_TIMEOUT_MESSAGE = /network timeout at:/i;
const AUDIT_ENDPOINT_ERROR = /audit endpoint returned an error/i;

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function toCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

/**
 * Count high/critical findings in a parsed `npm audit --json` report.
 * Accepts the arborist shape (`metadata.vulnerabilities` counts, preferred)
 * or a per-entry `vulnerabilities` object aggregated by severity. Returns
 * null when the report carries no trustworthy vulnerability data.
 */
export function countSeverities(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return null;
  const metadata = report.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const counts = metadata.vulnerabilities;
    if (counts && typeof counts === "object" && !Array.isArray(counts)) {
      const high = toCount(counts.high);
      const critical = toCount(counts.critical);
      if (high !== null && critical !== null) return { critical, high };
    }
  }
  const entries = report.vulnerabilities;
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    let high = 0;
    let critical = 0;
    for (const entry of Object.values(entries)) {
      const severity =
        entry && typeof entry === "object" ? String(entry.severity ?? "").toLowerCase() : "";
      if (severity === "high") high += 1;
      else if (severity === "critical") critical += 1;
    }
    return { critical, high };
  }
  return null;
}

/**
 * Classify one finished audit attempt. A timeout-killed attempt is always
 * transient (a hang proves nothing about the tree); an exited attempt is
 * judged by its report and diagnostics.
 */
export function classifyAuditAttempt({ stdout, stderr, exitCode, timedOut }) {
  const diagnostics = `${stdout ?? ""}\n${stderr ?? ""}`;
  let report = null;
  let parsed = false;
  const trimmed = (stdout ?? "").trim();
  if (trimmed) {
    try {
      report = JSON.parse(trimmed);
      parsed = true;
    } catch {
      report = null;
    }
  }

  if (parsed) {
    const counts = countSeverities(report);
    if (counts !== null) {
      if (counts.high > 0 || counts.critical > 0) {
        return {
          counts,
          outcome: "vulnerable",
          reason: `audit reported ${counts.high} high and ${counts.critical} critical vulnerabilities`,
          transient: false,
        };
      }
      return {
        counts,
        outcome: "passed",
        reason: "audit reported zero high/critical vulnerabilities",
        transient: false,
      };
    }
  }

  if (timedOut) {
    return {
      counts: null,
      outcome: "unverified_network",
      reason: "audit attempt exceeded its hard timeout with no valid report",
      transient: true,
    };
  }

  // No valid report. Judge the diagnostics: fatal signals fail closed,
  // recognized transient signals (even with empty stdout) mean the
  // registry was unreachable, and anything else is unexplained.
  if (matchesAny(diagnostics, FATAL_PATTERNS)) {
    return {
      counts: null,
      outcome: "failed_unknown",
      reason: "audit failed with an authentication, TLS, or authorization error",
      transient: false,
    };
  }
  if (matchesAny(diagnostics, TRANSIENT_PATTERNS)) {
    return {
      counts: null,
      outcome: "unverified_network",
      reason: "npm registry temporarily unavailable after bounded retries",
      transient: true,
    };
  }

  if (!parsed) {
    return {
      counts: null,
      outcome: "failed_unknown",
      reason:
        exitCode === 0
          ? "npm exited cleanly but produced no parseable audit report"
          : "npm produced no parseable audit report",
      transient: false,
    };
  }

  // Parsed JSON but no vulnerability data: an npm error envelope or an
  // unexpected schema. The observed outage shape is
  // { message: "network timeout at: ...", error: {...} }.
  const message =
    typeof report.message === "string"
      ? report.message
      : `${report.error?.summary ?? ""} ${report.error?.detail ?? ""}`;
  const combined = `${message}\n${stderr ?? ""}`;
  if (matchesAny(combined, FATAL_PATTERNS)) {
    return {
      counts: null,
      outcome: "failed_unknown",
      reason: "audit failed with an authentication, TLS, or authorization error",
      transient: false,
    };
  }
  const timeoutSignal =
    NETWORK_TIMEOUT_MESSAGE.test(combined) || AUDIT_ENDPOINT_ERROR.test(combined);
  if (timeoutSignal && matchesAny(combined, TRANSIENT_PATTERNS)) {
    return {
      counts: null,
      outcome: "unverified_network",
      reason: "npm registry network timeout after bounded retries",
      transient: true,
    };
  }
  if (matchesAny(combined, TRANSIENT_PATTERNS)) {
    return {
      counts: null,
      outcome: "unverified_network",
      reason: "npm registry temporarily unavailable after bounded retries",
      transient: true,
    };
  }
  if (timeoutSignal) {
    // An endpoint error WITHOUT a recognized transient signal is not
    // silently ignorable: fail closed as unknown.
    return {
      counts: null,
      outcome: "failed_unknown",
      reason: "audit endpoint errored without a recognized transient signal",
      transient: false,
    };
  }
  if (message.trim()) {
    return {
      counts: null,
      outcome: "failed_unknown",
      reason: `audit returned an unrecognized error report: ${message.trim().slice(0, 200)}`,
      transient: false,
    };
  }
  return {
    counts: null,
    outcome: "failed_unknown",
    reason: "audit returned an unrecognized report shape with no vulnerability data",
    transient: false,
  };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function appendCapped(current, bytesUsed, chunk, maxBytes) {
  const size = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
  const text = String(chunk);
  if (bytesUsed >= maxBytes) return { bytes: bytesUsed, text: current, truncated: true };
  if (bytesUsed + size <= maxBytes) {
    return { bytes: bytesUsed + size, text: current + text, truncated: false };
  }
  // Approximate: slice by characters; the bound is a safety cap, not exact accounting.
  const remaining = Math.max(0, maxBytes - bytesUsed);
  return { bytes: maxBytes, text: current + text.slice(0, remaining), truncated: true };
}

/**
 * Spawn one bounded `npm audit` attempt. Resolves with captured output;
 * never rejects on audit failure (only on spawn errors, which the caller
 * treats as unknown). `spawnFn` and timers are injectable for offline tests.
 */
export function runAuditAttempt({
  spawnFn = spawn,
  policy = AUDIT_POLICY,
  now = Date.now,
  signal,
} = {}) {
  const startedAt = now();
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timedOut = false;
    let attemptTimer = null;
    let killTimer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (attemptTimer) clearTimeout(attemptTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ ...result, elapsedMs: now() - startedAt, timedOut });
    };

    let child;
    try {
      child = spawnFn(
        "npm",
        [
          "audit",
          "--audit-level=high",
          "--json",
          "--fetch-retries=0",
          `--fetch-timeout=${policy.fetchTimeoutMs}`,
        ],
        { stdio: ["ignore", "pipe", "pipe"], signal },
      );
    } catch (error) {
      finish({
        exitCode: null,
        signal: null,
        stderr: `failed to spawn npm audit: ${error.message}`,
        stdout: "",
        truncated: false,
      });
      return;
    }

    if (!child || !child.stdout || !child.stderr) {
      finish({
        exitCode: null,
        signal: null,
        stderr: "npm audit subprocess provided no output streams",
        stdout: "",
        truncated: false,
      });
      return;
    }

    attemptTimer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // Already exited; the close handler below settles the attempt.
      }
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already exited.
        }
      }, policy.killGraceMs);
      killTimer.unref?.();
    }, policy.attemptTimeoutMs);
    attemptTimer.unref?.();

    child.stdout.on("data", (chunk) => {
      const next = appendCapped(stdout, stdoutBytes, chunk, policy.maxOutputBytes);
      stdout = next.text;
      stdoutBytes = next.bytes;
      stdoutTruncated = stdoutTruncated || next.truncated;
    });
    child.stderr.on("data", (chunk) => {
      const next = appendCapped(stderr, stderrBytes, chunk, policy.maxOutputBytes);
      stderr = next.text;
      stderrBytes = next.bytes;
      stderrTruncated = stderrTruncated || next.truncated;
    });
    child.on("error", (error) => {
      finish({
        exitCode: null,
        signal: null,
        stderr: `${stderr}\nspawn error: ${error.message}`,
        stdout,
        truncated: stdoutTruncated || stderrTruncated,
      });
    });
    child.on("close", (code, signalName) => {
      finish({
        exitCode: code,
        signal: signalName ?? null,
        stderr,
        stdout,
        truncated: stdoutTruncated || stderrTruncated,
      });
    });
  });
}

function defaultSleep(ms, signal) {
  return sleep(ms, signal);
}

/**
 * Run the bounded audit: up to two attempts, retrying only recognized
 * transient failures, inside an overall wall-clock bound. Returns a typed
 * outcome object; never throws for audit-level results.
 */
export async function runDependencyAudit({
  policy = AUDIT_POLICY,
  runAttempt = runAuditAttempt,
  sleepFn = defaultSleep,
  now = Date.now,
  signal,
} = {}) {
  const startedAt = now();
  const deadline = startedAt + policy.overallTimeoutMs;
  let attempts = 0;
  let lastClassification = null;

  while (attempts < policy.maxAttempts) {
    if (signal?.aborted || now() >= deadline) break;
    attempts += 1;
    if (attempts > 1) {
      const remaining = deadline - now();
      const delay = Math.min(policy.retryDelayMs, Math.max(0, remaining));
      if (delay > 0) {
        process.stderr.write(
          `Dependency audit: attempt ${attempts} of ${policy.maxAttempts} after a transient registry failure (waiting ${delay}ms)…\n`,
        );
        try {
          await sleepFn(delay, signal);
        } catch {
          break;
        }
      } else {
        process.stderr.write(
          `Dependency audit: overall ${policy.overallTimeoutMs}ms budget exhausted; not retrying.\n`,
        );
        break;
      }
    }
    const attempt = await runAttempt({ now, policy, signal });
    lastClassification = classifyAuditAttempt({
      exitCode: attempt.exitCode,
      stderr: attempt.stderr,
      stdout: attempt.stdout,
      timedOut: attempt.timedOut,
    });
    if (lastClassification.outcome !== "unverified_network") return finish(lastClassification);
    if (attempts >= policy.maxAttempts) return finish(lastClassification);
    // Otherwise loop for exactly one bounded retry of a transient failure.
  }

  return finish(
    lastClassification ?? {
      counts: null,
      outcome: "unverified_network",
      reason: "audit did not complete inside the overall wall-clock bound",
      transient: true,
    },
  );

  function finish(classification) {
    return {
      attempts,
      command: "npm audit --audit-level=high --json",
      critical: classification.counts?.critical ?? null,
      elapsedMs: now() - startedAt,
      high: classification.counts?.high ?? null,
      outcome: classification.outcome,
      reason: classification.reason,
    };
  }
}

function formatHuman(result) {
  const lines = [];
  if (result.outcome === "passed") {
    lines.push(
      `Dependency audit: PASSED — 0 high/critical vulnerabilities (${result.attempts} attempt${result.attempts === 1 ? "" : "s"}, ${(result.elapsedMs / 1000).toFixed(1)}s).`,
    );
  } else if (result.outcome === "vulnerable") {
    lines.push(
      `Dependency audit: FAILED — ${result.high ?? "?"} high / ${result.critical ?? "?"} critical vulnerabilities found.`,
    );
    lines.push("Fix or justify every high/critical finding before pushing or promoting.");
  } else if (result.outcome === "unverified_network") {
    lines.push(
      `Dependency audit: UNVERIFIED — npm registry unavailable after ${result.attempts} bounded attempt${result.attempts === 1 ? "" : "s"} (${result.reason}).`,
    );
    lines.push("NOT security-verified: this is not evidence the tree is clean.");
    lines.push("Next step: rerun the strict audit when registry connectivity returns.");
  } else {
    lines.push(`Dependency audit: FAILED — unexpected audit failure (${result.reason}).`);
    lines.push("Treat the tree as unverified until a valid audit report is produced.");
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const asJson = process.argv.includes("--format=json");
  try {
    const result = await runDependencyAudit();
    if (asJson) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.outcome !== "passed") {
        process.stderr.write(`${formatHuman(result)}\n`);
      }
    } else {
      process.stdout.write(`${formatHuman(result)}\n`);
    }
    process.exitCode = result.outcome === "passed" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Dependency audit: FAILED — ${error.message}\n`);
    process.exitCode = 1;
  }
}
