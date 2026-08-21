#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HELP = `Usage:
  npm run bootstrap:staging-platform-admin -- --email <email> --name <display name>

Creates or reuses one Better Auth identity in the staging D1 database and grants it the initial
Platform Administrator role. This command is permanently scoped to the staging Wrangler environment
and never configures a password, session, one-time code, MFA secret, or production resource.`;

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

export function parseBootstrapArguments(argv) {
  let email;
  let name;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--email":
        email = requireValue(argv, index, argument);
        index += 1;
        break;
      case "--help":
      case "-h":
        return { help: true };
      case "--name":
        name = requireValue(argv, index, argument);
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${argument ?? ""}`);
    }
  }
  if (!email || !name) {
    throw new Error("Both --email and --name are required.");
  }
  return { email, help: false, name };
}

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

export function normalizeBootstrapEmail(value) {
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    containsControlCharacter(email)
  ) {
    throw new Error("A valid Platform Administrator email address is required.");
  }
  return email;
}

export function normalizeBootstrapName(value) {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 120 || containsControlCharacter(name)) {
    throw new Error("A display name between 1 and 120 characters is required.");
  }
  return name;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildBootstrapSql({ email, name, now = new Date() }) {
  const normalizedEmail = normalizeBootstrapEmail(email);
  const normalizedName = normalizeBootstrapName(name);
  const nowIso = now.toISOString();
  const nowMilliseconds = now.getTime();
  const userId = randomUUID();
  const auditId = randomUUID();
  const requestId = randomUUID();

  return `PRAGMA foreign_keys = ON;
INSERT INTO user
  (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
SELECT
  ${sqlString(userId)}, ${sqlString(normalizedName)}, ${sqlString(normalizedEmail)},
  1, ${nowMilliseconds}, ${nowMilliseconds}, 0
WHERE NOT EXISTS (SELECT 1 FROM user WHERE email = ${sqlString(normalizedEmail)});

INSERT OR IGNORE INTO platform_administrators
  (user_id, granted_by, granted_at)
SELECT id, 'system:wrangler-bootstrap', ${sqlString(nowIso)}
FROM user
WHERE email = ${sqlString(normalizedEmail)};

INSERT INTO platform_audit_events
  (id, actor_user_id, organization_id, action, target_type, target_id,
   request_id, change_summary, occurred_at)
SELECT
  ${sqlString(auditId)}, 'system:wrangler-bootstrap', NULL,
  'platform.administrator.bootstrap_granted', 'platform_administrator', id,
  ${sqlString(requestId)}, '{"method":"wrangler_d1"}', ${sqlString(nowIso)}
FROM user
WHERE email = ${sqlString(normalizedEmail)} AND changes() = 1;`;
}

function runBootstrap(argv) {
  const options = parseBootstrapArguments(argv);
  if (options.help) {
    console.log(HELP);
    return;
  }

  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const sql = buildBootstrapSql(options);
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    npxCommand,
    [
      "wrangler",
      "d1",
      "execute",
      "CONTROL_DB",
      "--config",
      "apps/worker/wrangler.jsonc",
      "--env",
      "staging",
      "--remote",
      "--command",
      sql,
    ],
    {
      cwd: repositoryRoot,
      env: { ...process.env, WRANGLER_LOG_PATH: join(repositoryRoot, ".wrangler", "logs") },
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Wrangler exited with status ${String(result.status)}.`);
  }
  console.log("Platform Administrator bootstrap was applied to staging.");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    runBootstrap(process.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Platform Administrator bootstrap failed.",
    );
    process.exitCode = 1;
  }
}
