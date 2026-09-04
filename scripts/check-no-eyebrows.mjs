#!/usr/bin/env node
// Bans eyebrow kickers from the design system (see apps/web/AGENTS.md).
// Fails on any case-insensitive "eyebrow" in web source or shared UI primitives.
// Scope is source only (apps/web/src, packages/ui/src). The global zero-count
// E2E assertion in apps/web/e2e/responsive.audit.spec.ts is the runtime
// counterpart and intentionally lives outside this scan, as do these docs.
import fs from "fs";
import { globSync } from "fs";

const ROOTS = ["apps/web/src", "packages/ui/src"];
const EXTENSIONS = ["ts", "tsx", "css"];
const bannedRe = /eyebrow/i;

const files = ROOTS.flatMap((root) =>
  globSync(EXTENSIONS.map((extension) => `${root}/**/*.${extension}`)),
);

/** @type {string[]} */
const failures = [];
for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    if (bannedRe.test(line)) {
      failures.push(`${file}:${idx + 1}: ${line.trim()}`);
    }
  });
}

if (failures.length > 0) {
  console.error(
    `check:no-eyebrows failed — ${failures.length} eyebrow reference(s) found:\n` +
      failures.join("\n"),
  );
  console.error(
    "\nEyebrows are removed from the design system. Use h1/h2 with page-heading__description or section-heading copy directly.",
  );
  process.exit(1);
} else {
  console.log("check:no-eyebrows passed — no eyebrow references in web source or UI primitives");
}
