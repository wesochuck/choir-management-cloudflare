// Compact step execution and output-mode helpers for local CI, release
// qualification, and staging deployment scripts.
//
// Design goals:
// - Compact by default in gate runners (`check:ci`, `check:release`) so passing
//   runs stay ~25-40 lines instead of thousands of lines of passing test/build
//   chatter.
// - Explicit opt-out via `--verbose` or `CHECK_VERBOSE=1`.
// - Periodic elapsed heartbeats during long steps so non-interactive runners
//   and humans can tell a step is still making progress.
// - Full buffered stdout/stderr printed immediately on failure, plus persistent
//   per-step logs under `.cache/check-logs/` (gitignored) for on-demand review.
// - Actionable warnings (e.g. Vite chunk-size warnings, ESLint warnings) still
//   surfaced even when a step exits 0.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_HEARTBEAT_MS = 20_000;
export const DEFAULT_MAX_FAILURE_BYTES = 64 * 1024;
export const DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const MAX_WARNING_LINES = 30;

// Matches ANSI CSI/OSC escape sequences cleanly without control-char lint warnings.
const ANSI_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(0x1b)}(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\u0007\\u001b]*(?:\\u0007|${String.fromCharCode(0x1b)}\\\\))`,
  "gu",
);

function isTruthyFlag(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * Returns true when the caller explicitly requested verbose streaming output
 * via `--verbose` or `CHECK_VERBOSE=1`.
 */
export function isVerboseMode({ argv = process.argv, env = process.env } = {}) {
  return argv.includes("--verbose") || isTruthyFlag(env.CHECK_VERBOSE);
}

/**
 * Returns true when standalone tools (Vitest, Playwright, staging probes)
 * should use compact reporters/output. Explicit verbose mode always wins.
 */
export function isCompactMode({
  argv = process.argv,
  env = process.env,
  isTTY = Boolean(process.stdout?.isTTY),
} = {}) {
  if (isVerboseMode({ argv, env })) return false;
  if (argv.includes("--compact") || isTruthyFlag(env.CHECK_COMPACT)) return true;
  return !isTTY;
}

/**
 * Build child process environment variables reflecting the active verbosity
 * mode. Never sets `PLAYWRIGHT_*`, `NODE_*`, or `VITE_*` variables so local
 * release-qualification evidence hashes remain unaffected.
 */
export function buildStepEnv(baseEnv = process.env, { command = "", verbose = false } = {}) {
  const env = { ...baseEnv };
  if (verbose) {
    env.CHECK_VERBOSE = "1";
    delete env.CHECK_COMPACT;
    return env;
  }
  env.CHECK_COMPACT = "1";
  delete env.CHECK_VERBOSE;
  if (command === "npm" && env.npm_config_loglevel === undefined) {
    env.npm_config_loglevel = "silent";
  }
  return env;
}

export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI_ESCAPE_PATTERN, "");
}

export function formatDuration(milliseconds) {
  const ms = Math.max(0, Number(milliseconds) || 0);
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${String(minutes)}m ${String(remainder)}s`;
}

export function slugifyLabel(label) {
  return (
    String(label ?? "step")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 60) || "step"
  );
}

function extractVitestSummary(clean) {
  let filesPassed = 0;
  let testsPassed = 0;
  let testsSkipped = 0;
  let foundVitest = false;

  for (const match of clean.matchAll(/^\s*Test Files\s+(\d+)\s+passed\b/gmu)) {
    filesPassed += Number(match[1]);
    foundVitest = true;
  }
  for (const match of clean.matchAll(/^\s*Tests\s+(.+)$/gmu)) {
    const line = match[1];
    const passedMatch = /(\d+)\s+passed\b/u.exec(line);
    if (passedMatch) {
      testsPassed += Number(passedMatch[1]);
      foundVitest = true;
    }
    const skippedMatch = /(\d+)\s+skipped\b/u.exec(line);
    if (skippedMatch) {
      testsSkipped += Number(skippedMatch[1]);
    }
  }

  if (!foundVitest) return null;
  const parts = [];
  if (filesPassed > 0) parts.push(`${String(filesPassed)} files`);
  if (testsPassed > 0) parts.push(`${String(testsPassed)} passed`);
  if (testsSkipped > 0) parts.push(`${String(testsSkipped)} skipped`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function extractPlaywrightSummary(clean) {
  const lines = clean.split(/\r?\n/u);
  const summaryPattern =
    /^((?:\d+\s+(?:passed|skipped|flaky|did not run)(?:,\s*)?)+)\s*\([^)]+\)$/iu;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    const match = summaryPattern.exec(trimmed);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Extracts a short, stable pass summary (e.g. test counts) from known tool
 * outputs so the one-line pass banner still confirms what ran.
 */
export function extractStepSummary(output) {
  const clean = stripAnsi(output);
  return extractVitestSummary(clean) ?? extractPlaywrightSummary(clean);
}

const BUILD_WARNING_START =
  /^\s*(?:\(!\)|▲\s*\[WARNING\]|\[(?:vite|rollup|esbuild|wrangler)[^\]]*\]\s*warn(?:ing)?|warn(?:ing)?(?::|\s+-))/iu;

function extractBuildWarnings(clean) {
  const lines = clean.split(/\r?\n/u);
  const warnings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!BUILD_WARNING_START.test(line)) continue;
    warnings.push(line.trimEnd());
    let followUps = 0;
    while (i + 1 < lines.length && followUps < 5) {
      const next = lines[i + 1];
      if (!next.trim() || !/^\s+/u.test(next)) break;
      warnings.push(next.trimEnd());
      i += 1;
      followUps += 1;
    }
  }
  return warnings;
}

function extractEslintWarnings(clean) {
  if (!/\b\d+\s+warnings?\b/iu.test(clean) && !/^\s*\d+:\d+\s+warning\b/imu.test(clean)) {
    return [];
  }
  return clean
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

/**
 * Surfaces actionable warnings from a passing step without dumping routine
 * build/lint chatter.
 *
 * @param {string} output
 * @param {"build" | "eslint" | false | undefined} mode
 */
export function extractWarnings(output, mode) {
  if (!mode) return [];
  const clean = stripAnsi(output);
  if (mode === "build") return extractBuildWarnings(clean);
  if (mode === "eslint") return extractEslintWarnings(clean);
  return [];
}

/**
 * Formats buffered failure output, bounding pathological huge dumps while
 * preserving both the start (root cause) and end (final assertion/summary).
 */
export function formatFailureOutput(
  output,
  { maxBytes = DEFAULT_MAX_FAILURE_BYTES, logPath = null } = {},
) {
  const trimmed = String(output ?? "").trim();
  if (!trimmed) return "";
  const byteLength = Buffer.byteLength(trimmed, "utf8");
  if (byteLength <= maxBytes) return trimmed;

  const headBudget = Math.max(1024, Math.floor(maxBytes * 0.2));
  const tailBudget = Math.max(2048, maxBytes - headBudget);
  const buffer = Buffer.from(trimmed, "utf8");
  const head = buffer.subarray(0, headBudget).toString("utf8");
  const tail = buffer.subarray(Math.max(headBudget, buffer.length - tailBudget)).toString("utf8");
  const omitted = byteLength - headBudget - tailBudget;
  const pointer = logPath ? ` Full log saved to ${logPath}.` : "";
  return `${head}\n\n... [omitted ${String(Math.max(0, omitted))} bytes of output.${pointer}] ...\n\n${tail}`;
}

export function writeStepLog({
  logDir,
  index,
  label,
  command,
  args = [],
  output,
  exitCode,
  durationMs,
}) {
  if (!logDir) return null;
  try {
    mkdirSync(logDir, { recursive: true });
    const prefix = index ? `${String(index).padStart(2, "0")}-` : "";
    const filePath = join(logDir, `${prefix}${slugifyLabel(label)}.log`);
    const header = [
      `Step: ${label}`,
      `Command: ${command} ${args.join(" ")}`.trim(),
      `Exit: ${String(exitCode)}`,
      `Duration: ${formatDuration(durationMs)}`,
      "---",
      "",
    ].join("\n");
    writeFileSync(filePath, `${header}${stripAnsi(output)}\n`, "utf8");
    return filePath;
  } catch {
    return null;
  }
}

function appendCapped(chunks, chunk, state, maxBytes) {
  const bytes = Buffer.byteLength(chunk, "utf8");
  state.totalBytes += bytes;
  if (state.keptBytes + bytes <= maxBytes) {
    chunks.push(chunk);
    state.keptBytes += bytes;
    return;
  }
  // Keep a sliding tail when a pathological step exceeds the memory cap.
  chunks.push(chunk);
  state.keptBytes += bytes;
  while (chunks.length > 1 && state.keptBytes > maxBytes) {
    const dropped = chunks.shift();
    state.keptBytes -= Buffer.byteLength(dropped, "utf8");
    state.truncatedInMemory = true;
  }
}

function formatStepPrefix(index, total, indent = "") {
  return index && total ? `${indent}[${String(index)}/${String(total)}] ` : `${indent}• `;
}

function writeWarningsBlock(warnings, { stream, indent = "", logPath = null }) {
  if (warnings.length === 0) return;
  const shown = warnings.slice(0, MAX_WARNING_LINES);
  for (const line of shown) {
    stream.write(`${indent}  ⚠ ${line}\n`);
  }
  if (warnings.length > shown.length) {
    const extra = warnings.length - shown.length;
    const pointer = logPath ? ` (see ${logPath})` : "";
    stream.write(`${indent}  ⚠ ... and ${String(extra)} more warning line(s)${pointer}\n`);
  }
}

function createStepFailureError(label, code, signal) {
  const error = new Error(
    signal
      ? `${label} terminated by signal ${String(signal)}`
      : `${label} failed with exit ${String(code ?? 1)}`,
  );
  error.status = typeof code === "number" ? code : 1;
  if (signal) error.signal = signal;
  error.alreadyPrinted = true;
  return error;
}

/**
 * Executes a single check step in either compact (buffered + heartbeat) or
 * verbose (`stdio: "inherit"`) mode.
 */
export async function runCompactStep({
  command,
  args = [],
  label,
  job = "",
  index = null,
  total = null,
  indent = "",
  cwd = process.cwd(),
  env = process.env,
  verbose = false,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  maxFailureBytes = DEFAULT_MAX_FAILURE_BYTES,
  maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
  warningMode = false,
  logDir = null,
  stream = process.stdout,
  errorStream = process.stderr,
  spawnImpl = spawn,
  now = Date.now,
}) {
  const stepEnv = buildStepEnv(env, { command, verbose });
  const startedAt = now();

  if (verbose) {
    const jobSuffix = job ? ` (${job})` : "";
    stream.write(`\n=== ${label}${jobSuffix}\n`);
    return new Promise((resolve, reject) => {
      const child = spawnImpl(command, args, { cwd, env: stepEnv, stdio: "inherit" });
      const forwardSignal = (signal) => {
        child.kill(signal);
      };
      process.once("SIGINT", forwardSignal);
      process.once("SIGTERM", forwardSignal);
      const cleanup = () => {
        process.off("SIGINT", forwardSignal);
        process.off("SIGTERM", forwardSignal);
      };
      child.once("error", (error) => {
        cleanup();
        reject(error);
      });
      child.once("close", (code, signal) => {
        cleanup();
        if (code === 0) {
          resolve({ durationMs: now() - startedAt, exitCode: 0, output: "" });
          return;
        }
        reject(createStepFailureError(label, code, signal));
      });
    });
  }

  const prefix = formatStepPrefix(index, total, indent);
  stream.write(`${prefix}${label} ... `);

  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd,
      env: stepEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    const bufferState = { keptBytes: 0, totalBytes: 0, truncatedInMemory: false };
    let heartbeats = 0;

    const timer =
      heartbeatMs > 0
        ? setInterval(() => {
            const elapsedSeconds = Math.max(1, Math.round((now() - startedAt) / 1000));
            const lead = heartbeats === 0 ? "\n" : "";
            heartbeats += 1;
            stream.write(`${lead}${indent}  … still running (${String(elapsedSeconds)}s)\n`);
          }, heartbeatMs)
        : null;
    if (timer && typeof timer.unref === "function") timer.unref();

    const forwardSignal = (signal) => {
      child.kill(signal);
    };
    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);

    const cleanup = () => {
      if (timer) clearInterval(timer);
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
    };

    const onData = (data) => {
      appendCapped(
        chunks,
        typeof data === "string" ? data : data.toString("utf8"),
        bufferState,
        maxBufferBytes,
      );
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.once("error", (error) => {
      cleanup();
      const elapsed = formatDuration(now() - startedAt);
      if (heartbeats > 0) {
        stream.write(`${indent}✗ ${prefix.trimStart()}${label} (${elapsed}, spawn error)\n`);
      } else {
        stream.write(`✗ (${elapsed}, spawn error)\n`);
      }
      errorStream.write(`${error.message}\n`);
      reject(error);
    });

    child.once("close", (code, signal) => {
      cleanup();
      const durationMs = now() - startedAt;
      const elapsed = formatDuration(durationMs);
      const combined = chunks.join("");
      const logPath = writeStepLog({
        args,
        command,
        durationMs,
        exitCode: code ?? signal ?? 1,
        index,
        label,
        logDir,
        output: combined,
      });

      if (code === 0) {
        const summary = extractStepSummary(combined);
        const summarySuffix = summary ? ` — ${summary}` : "";
        if (heartbeats > 0) {
          stream.write(`${indent}✓ ${prefix.trimStart()}${label} (${elapsed})${summarySuffix}\n`);
        } else {
          stream.write(`✓ (${elapsed})${summarySuffix}\n`);
        }
        const warnings = extractWarnings(combined, warningMode);
        writeWarningsBlock(warnings, { indent, logPath, stream });
        resolve({ durationMs, exitCode: 0, logPath, output: combined, summary, warnings });
        return;
      }

      const exitTag = signal ? `signal ${String(signal)}` : `exit ${String(code ?? 1)}`;
      if (heartbeats > 0) {
        stream.write(`${indent}✗ ${prefix.trimStart()}${label} failed (${elapsed}, ${exitTag})\n`);
      } else {
        stream.write(`✗ (${elapsed}, ${exitTag})\n`);
      }
      const failureText = formatFailureOutput(combined, { logPath, maxBytes: maxFailureBytes });
      if (failureText) {
        errorStream.write(`${failureText}\n`);
      }
      if (logPath) {
        errorStream.write(`${indent}Full step log: ${logPath}\n`);
      }
      reject(createStepFailureError(label, code, signal));
    });
  });
}
