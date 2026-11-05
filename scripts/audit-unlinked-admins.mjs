#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HELP = `Usage:
  node scripts/audit-unlinked-admins.mjs [--remote] [--env staging]

Queries the control database for Owner and Administrator Memberships that do not have
a linked Organization Profile. Outputs a read-only audit report grouped by Organization.`;

export const AUDIT_QUERY = `
SELECT
  m.organizationId,
  o.name AS organizationName,
  m.id AS membershipId,
  m.role,
  u.email,
  u.name AS userName
FROM member m
JOIN organizations o ON o.id = m.organizationId
JOIN user u ON u.id = m.userId
WHERE m.role IN ('owner', 'admin')
  AND m.profileId IS NULL
ORDER BY m.organizationId, m.role, u.email;
`;

export function runAudit(argv = process.argv.slice(2)) {
  const isRemote = argv.includes("--remote") || argv.includes("-r");
  const envIndex = argv.indexOf("--env");
  const environment = envIndex !== -1 && argv[envIndex + 1] ? argv[envIndex + 1] : "staging";

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const wranglerArgs = [
    "wrangler",
    "d1",
    "execute",
    "CONTROL_DB",
    "--config",
    "apps/worker/wrangler.jsonc",
    "--command",
    AUDIT_QUERY,
  ];

  if (environment) {
    wranglerArgs.push("--env", environment);
  }
  if (isRemote) {
    wranglerArgs.push("--remote");
  }

  const result = spawnSync(npxCommand, wranglerArgs, {
    cwd: repositoryRoot,
    env: { ...process.env, WRANGLER_LOG_PATH: join(repositoryRoot, ".wrangler", "logs") },
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Wrangler audit exited with status ${String(result.status)}.`);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    runAudit();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Audit script failed.");
    process.exitCode = 1;
  }
}
