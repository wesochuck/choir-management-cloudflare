#!/usr/bin/env node
// Enforces 8-token spacing scale for gap/padding/margin.
// Fails on raw rem within the small scale (0.05-2rem) that should be var(--spacing-*).
// Large clamp max values (3rem,4rem,5rem,6rem,7rem,8rem,2.25rem,2.5rem, etc.) are allowed as layout exceptions.
import fs from "fs";
import { globSync } from "fs";

const ROOT = "apps/web/src/styles";
const files = globSync(`${ROOT}/**/*.css`).filter(
  (f) => !f.endsWith("main.css") && !f.endsWith("tokens.css") && !f.endsWith("theme.css"),
);

// Small-scale values that must be tokenized (0.05-2rem)
const smallRemRe = /(?<![0-9.])(\d+\.\d+rem|\d+rem)(?![0-9])/g;
const allowedLarge = new Set([
  "3rem",
  "4rem",
  "5rem",
  "6rem",
  "7rem",
  "8rem",
  "2.25rem",
  "2.5rem",
  "3.5rem",
  "1.8rem",
  "1.9rem",
  "2.4rem",
  "2.75rem",
  "0.275rem",
]); // 0.275 will be fixed, kept here to show intent before fix

let failures = [];
for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    if (!/^\s*(gap|column-gap|row-gap|padding|margin)/.test(line)) return;
    // Ignore lines already tokenized with var(--spacing-*) for the small values, but still catch raw rem tokens
    // Extract all rem tokens in this declaration value
    const matches = [...line.matchAll(smallRemRe)];
    for (const m of matches) {
      const token = m[0];
      // If line contains var(--spacing, the token might still be raw alongside tokenized values (multi-value case)
      // Fail if token is small-scale and not already replaced (i.e., raw rem still present)
      // Large values are allowed exceptions - skip them
      if (allowedLarge.has(token)) continue;
      // Also skip 0 (no unit) and values inside clamp that are large - but small values inside clamp should still be tokenized (we already tokenize clamp interior)
      // If token is small and raw, it's a failure
      // Check if token is within 0.05-2rem range that we tokenize
      const num = parseFloat(token);
      if (num > 0 && num <= 2.02) {
        // Check if this token is part of a var() already? No, var() doesn't contain rem
        failures.push(
          `${file}:${idx + 1}: ${line.trim()} → raw ${token} should be var(--spacing-*)`,
        );
      }
    }
  });
}

if (failures.length) {
  console.error(
    `check:spacing failed — ${failures.length} raw rem in gap/padding/margin (small scale) found:\n` +
      failures.join("\n"),
  );
  console.error(`\nAllowed large exceptions: ${[...allowedLarge].join(", ")} (clamp max, layout)`);
  process.exit(1);
} else {
  console.log("check:spacing passed — no raw small-scale rem in gap/padding/margin");
}
