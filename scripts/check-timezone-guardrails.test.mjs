import fs from "node:fs";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Timezone source code guardrails", () => {
  const workerFiles = globSync("apps/worker/src/**/*.ts", {
    cwd: process.cwd(),
    ignore: ["**/node_modules/**", "**/dist/**"],
  });

  it("requires every Intl.DateTimeFormat call in apps/worker/src to specify an explicit timeZone option", () => {
    const violations = [];

    for (const relPath of workerFiles) {
      const content = fs.readFileSync(relPath, "utf8");
      const regex = /new\s+Intl\.DateTimeFormat\s*\(([\s\S]*?)\)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const args = match[1] ?? "";
        if (!/\btimeZone\b/.test(args)) {
          const line = content.slice(0, match.index).split("\n").length;
          violations.push(`${relPath}:${String(line)}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("forbids hardcoded timeZone: 'UTC' in apps/worker/src DateTimeFormat calls", () => {
    const violations = [];

    for (const relPath of workerFiles) {
      const content = fs.readFileSync(relPath, "utf8");
      const regex = /new\s+Intl\.DateTimeFormat\s*\(([\s\S]*?)\)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const args = match[1] ?? "";
        if (/timeZone\s*:\s*["'`]UTC["'`]/.test(args)) {
          const line = content.slice(0, match.index).split("\n").length;
          violations.push(`${relPath}:${String(line)}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("forbids un-zoned toLocaleString / toLocaleDateString / toLocaleTimeString in apps/worker/src", () => {
    const violations = [];

    for (const relPath of workerFiles) {
      const content = fs.readFileSync(relPath, "utf8");
      const regex = /\.\s*toLocale(?:Date|Time)?String\s*\(([\s\S]*?)\)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const args = match[1] ?? "";
        if (!/\btimeZone\b/.test(args)) {
          const line = content.slice(0, match.index).split("\n").length;
          violations.push(`${relPath}:${String(line)}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("requires every queueTicketSaleAlert call site in apps/worker/src to pass timezone", () => {
    const violations = [];

    for (const relPath of workerFiles) {
      if (relPath.endsWith("ticketSaleAlerts.ts")) continue;
      const content = fs.readFileSync(relPath, "utf8");
      const regex = /queueTicketSaleAlert\s*\(\s*[^,]+,\s*\{([\s\S]*?)\}\s*\)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const payload = match[1] ?? "";
        if (!/\btimezone\b/.test(payload)) {
          const line = content.slice(0, match.index).split("\n").length;
          violations.push(`${relPath}:${String(line)}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
