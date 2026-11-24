import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildStepEnv,
  extractStepSummary,
  extractWarnings,
  formatDuration,
  formatFailureOutput,
  isCompactMode,
  isVerboseMode,
  runCompactStep,
  stripAnsi,
} from "./check-step-runner.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "check-step-runner-"));
  tempDirs.push(dir);
  return dir;
}

function createFakeStream() {
  let content = "";
  return {
    get text() {
      return content;
    },
    write(chunk) {
      content += String(chunk);
      return true;
    },
  };
}

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { force: true, recursive: true });
  }
  vi.useRealTimers();
});

describe("check-step-runner mode detection and env", () => {
  it("defaults to compact in gate runners unless --verbose or CHECK_VERBOSE is set", () => {
    expect(isVerboseMode({ argv: ["node", "check-ci.mjs"], env: {} })).toBe(false);
    expect(isVerboseMode({ argv: ["node", "check-ci.mjs", "--verbose"], env: {} })).toBe(true);
    expect(isVerboseMode({ argv: ["node", "check-ci.mjs"], env: { CHECK_VERBOSE: "1" } })).toBe(
      true,
    );
    expect(isVerboseMode({ argv: ["node", "check-ci.mjs"], env: { CHECK_VERBOSE: "true" } })).toBe(
      true,
    );
  });

  it("enables compact mode for non-TTY or CHECK_COMPACT=1 unless verbose overrides it", () => {
    expect(isCompactMode({ argv: [], env: {}, isTTY: false })).toBe(true);
    expect(isCompactMode({ argv: [], env: {}, isTTY: true })).toBe(false);
    expect(isCompactMode({ argv: [], env: { CHECK_COMPACT: "1" }, isTTY: true })).toBe(true);
    expect(
      isCompactMode({ argv: [], env: { CHECK_COMPACT: "1", CHECK_VERBOSE: "1" }, isTTY: false }),
    ).toBe(false);
    expect(isCompactMode({ argv: ["--verbose"], env: {}, isTTY: false })).toBe(false);
  });

  it("builds child env cleanly without touching release qualification variables", () => {
    const compactNpm = buildStepEnv(
      { CHECK_VERBOSE: "1", PATH: "/usr/bin" },
      {
        command: "npm",
        verbose: false,
      },
    );
    expect(compactNpm.CHECK_COMPACT).toBe("1");
    expect(compactNpm.CHECK_VERBOSE).toBeUndefined();
    expect(compactNpm.npm_config_loglevel).toBe("silent");

    const verboseNpm = buildStepEnv({ CHECK_COMPACT: "1" }, { command: "npm", verbose: true });
    expect(verboseNpm.CHECK_VERBOSE).toBe("1");
    expect(verboseNpm.CHECK_COMPACT).toBeUndefined();
    expect(verboseNpm.npm_config_loglevel).toBeUndefined();
  });
});

describe("check-step-runner formatting and parsing", () => {
  it("formats durations across ms, seconds, and minutes", () => {
    expect(formatDuration(240)).toBe("240ms");
    expect(formatDuration(4320)).toBe("4.3s");
    expect(formatDuration(135_000)).toBe("2m 15s");
  });

  it("strips ANSI escape codes cleanly", () => {
    expect(stripAnsi("\u001b[32mPASS\u001b[0m ok")).toBe("PASS ok");
  });

  it("extracts combined Vitest and Playwright test summaries", () => {
    const vitestCombined = [
      " Test Files  282 passed (282)",
      "      Tests  1450 passed (1450)",
      " Test Files  160 passed (160)",
      "      Tests  680 passed | 4 skipped (684)",
    ].join("\n");
    expect(extractStepSummary(vitestCombined)).toBe("442 files, 2130 passed, 4 skipped");

    const playwright = "\n..........\n  154 passed, 2 skipped (1.2m)\n";
    expect(extractStepSummary(playwright)).toBe("154 passed, 2 skipped");

    expect(extractStepSummary("plain script output")).toBeNull();
  });

  it("surfaces Vite, Wrangler, and ESLint warnings while ignoring normal output", () => {
    const buildOutput = [
      "vite v8.1.6 building for production...",
      "dist/assets/index.js  120.12 kB │ gzip: 35.12 kB",
      "(!) Some chunks are larger than 500 kB after minification.",
      "  - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.",
      "▲ [WARNING] Processing wrangler.jsonc configuration:",
      "  - Unexpected fields found in config.",
      "Total Upload: 1024 KiB",
    ].join("\n");

    const buildWarnings = extractWarnings(buildOutput, "build");
    expect(buildWarnings).toEqual([
      "(!) Some chunks are larger than 500 kB after minification.",
      "  - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.",
      "▲ [WARNING] Processing wrangler.jsonc configuration:",
      "  - Unexpected fields found in config.",
    ]);
    expect(extractWarnings("dist/assets/index.js  12 kB\n✓ built in 2.1s", "build")).toEqual([]);

    const eslintWarnings = extractWarnings(
      "/repo/src/App.tsx\n  12:4  warning  Fast refresh only works...  react-refresh/only-export-components\n\n✖ 1 problem (0 errors, 1 warning)\n",
      "eslint",
    );
    expect(eslintWarnings).toHaveLength(3);
    expect(extractWarnings("", "eslint")).toEqual([]);
  });

  it("preserves full small failures and truncates oversized dumps with a log pointer", () => {
    expect(formatFailureOutput("AssertionError: expected 1 to be 2\n")).toBe(
      "AssertionError: expected 1 to be 2",
    );

    const huge = `HEAD-MARKER\n${"x".repeat(20_000)}\nTAIL-MARKER`;
    const formatted = formatFailureOutput(huge, {
      logPath: ".cache/check-logs/07-lint.log",
      maxBytes: 4096,
    });
    expect(formatted).toContain("HEAD-MARKER");
    expect(formatted).toContain("TAIL-MARKER");
    expect(formatted).toContain("Full log saved to .cache/check-logs/07-lint.log");
  });
});

describe("runCompactStep", () => {
  it("collapses passing noisy output to one line, surfaces build warnings, and writes step logs", async () => {
    const logDir = makeTempDir();
    const out = createFakeStream();
    const err = createFakeStream();
    let tick = 1000;

    const spawnImpl = vi.fn(() => {
      const child = createFakeChild();
      queueMicrotask(() => {
        child.stdout.write("dist/assets/chunk-1.js  12 kB\n");
        child.stdout.write("dist/assets/chunk-2.js  18 kB\n");
        child.stdout.write("(!) Some chunks are larger than 500 kB after minification.\n");
        tick = 3400;
        child.emit("close", 0, null);
      });
      return child;
    });

    const result = await runCompactStep({
      args: ["run", "build"],
      command: "npm",
      errorStream: err,
      heartbeatMs: 0,
      index: 15,
      label: "Build deployable artifact",
      logDir,
      now: () => tick,
      spawnImpl,
      stream: out,
      total: 19,
      warningMode: "build",
    });

    expect(result.exitCode).toBe(0);
    expect(out.text).toBe(
      "[15/19] Build deployable artifact ... ✓ (2.4s)\n" +
        "  ⚠ (!) Some chunks are larger than 500 kB after minification.\n",
    );
    expect(err.text).toBe("");
    expect(result.logPath).toBe(join(logDir, "15-build-deployable-artifact.log"));
    expect(readFileSync(result.logPath, "utf8")).toContain("dist/assets/chunk-1.js");
  });

  it("emits periodic heartbeats during slow steps and finishes cleanly", async () => {
    vi.useFakeTimers();
    const out = createFakeStream();
    const err = createFakeStream();
    let fakeNow = 0;

    let activeChild;
    const spawnImpl = vi.fn(() => {
      activeChild = createFakeChild();
      return activeChild;
    });

    const promise = runCompactStep({
      args: ["test"],
      command: "npm",
      errorStream: err,
      heartbeatMs: 20_000,
      index: 14,
      label: "Run unit tests",
      now: () => fakeNow,
      spawnImpl,
      stream: out,
      total: 19,
    });

    fakeNow = 20_000;
    vi.advanceTimersByTime(20_000);
    fakeNow = 40_000;
    vi.advanceTimersByTime(20_000);

    activeChild.stdout.write(" Test Files  10 passed (10)\n      Tests  42 passed (42)\n");
    fakeNow = 45_200;
    activeChild.emit("close", 0, null);

    await promise;
    expect(out.text).toBe(
      "[14/19] Run unit tests ... \n" +
        "  … still running (20s)\n" +
        "  … still running (40s)\n" +
        "✓ [14/19] Run unit tests (45.2s) — 10 files, 42 passed\n",
    );
    expect(err.text).toBe("");
  });

  it("dumps full buffered error output and log pointer when a step fails", async () => {
    const logDir = makeTempDir();
    const out = createFakeStream();
    const err = createFakeStream();
    let tick = 1000;

    const spawnImpl = vi.fn(() => {
      const child = createFakeChild();
      queueMicrotask(() => {
        child.stdout.write("FAIL src/example.test.ts\n");
        child.stderr.write("AssertionError: expected 1 to equal 2\n");
        tick = 2200;
        child.emit("close", 1, null);
      });
      return child;
    });

    await expect(
      runCompactStep({
        args: ["test"],
        command: "npm",
        errorStream: err,
        heartbeatMs: 0,
        index: 14,
        label: "Run unit tests",
        logDir,
        now: () => tick,
        spawnImpl,
        stream: out,
        total: 19,
      }),
    ).rejects.toMatchObject({ alreadyPrinted: true, status: 1 });

    expect(out.text).toBe("[14/19] Run unit tests ... ✗ (1.2s, exit 1)\n");
    expect(err.text).toContain("FAIL src/example.test.ts");
    expect(err.text).toContain("AssertionError: expected 1 to equal 2");
    expect(err.text).toContain("Full step log:");
  });

  it("inherits stdio and sets CHECK_VERBOSE=1 in verbose mode", async () => {
    const out = createFakeStream();
    const seenOptions = [];
    const spawnImpl = vi.fn((_cmd, _args, options) => {
      seenOptions.push(options);
      const child = createFakeChild();
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    });

    await runCompactStep({
      args: ["run", "lint"],
      command: "npm",
      job: "CI static job",
      label: "Lint",
      spawnImpl,
      stream: out,
      verbose: true,
    });

    expect(out.text).toBe("\n=== Lint (CI static job)\n");
    expect(seenOptions[0].stdio).toBe("inherit");
    expect(seenOptions[0].env.CHECK_VERBOSE).toBe("1");
    expect(seenOptions[0].env.CHECK_COMPACT).toBeUndefined();
  });
});
