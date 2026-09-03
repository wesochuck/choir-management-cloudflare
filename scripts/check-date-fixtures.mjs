#!/usr/bin/env node

import fs from "node:fs";
import { globSync } from "node:fs";

export function findExpiringDateFixtures(options = {}) {
  const root = options.root ?? process.cwd();
  const now = options.now ? new Date(options.now) : new Date();
  const horizonDays = options.horizonDays ?? 180;
  const horizonMs = horizonDays * 86_400_000;
  const maxThresholdTime = now.getTime() + horizonMs;

  const patterns = options.patterns ?? [
    "apps/web/src/account/RsvpManagerPage.test.tsx",
    "apps/web/e2e/ticketing.spec.ts",
  ];

  const files = globSync(patterns, { cwd: root, ignore: ["**/node_modules/**", "**/dist/**"] });
  const violations = [];

  const dateRegex = /\b(20\d{2})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/g;

  for (const relPath of files) {
    const fullPath = `${root}/${relPath}`;
    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("// historic-fixture") || line.includes("// historic-date")) continue;
      if (/createdAt|updatedAt|generatedAt|publishedAt|archivedAt|issuedAt/i.test(line)) continue;
      if (!/endsAt|startsAt|rsvpDeadline|expiresAt|deadline|saleEnd|starts_at|ends_at/i.test(line))
        continue;

      let match;
      dateRegex.lastIndex = 0;
      while ((match = dateRegex.exec(line)) !== null) {
        const dateStr = match[0];
        const dateObj = new Date(dateStr);
        if (Number.isNaN(dateObj.getTime())) continue;

        if (dateObj.getTime() < maxThresholdTime) {
          violations.push({
            date: dateStr,
            file: relPath,
            line: i + 1,
            lineContent: line.trim(),
          });
        }
      }
    }
  }

  return violations;
}

if (process.argv[1]?.endsWith("check-date-fixtures.mjs")) {
  const violations = findExpiringDateFixtures();
  if (violations.length > 0) {
    console.error(`Found ${String(violations.length)} hardcoded expiring test dates:`);
    for (const v of violations) {
      console.error(`  ${v.file}:${String(v.line)}: ${v.date} -> ${v.lineContent}`);
    }
    console.error(
      "\nUse relative date helpers from @choir/testkit (e.g. futureIsoDate({ days })) or mark with // historic-fixture",
    );
    process.exit(1);
  } else {
    console.log("All date fixtures are relative or within valid forward bounds.");
  }
}
