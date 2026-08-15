#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const geminiConfigDir = join(homedir(), ".gemini", "config");
const mcpConfigFile = join(geminiConfigDir, "mcp_config.json");
const stagingEnvFile = join(repositoryRoot, ".env.staging.local");

async function prompt(readline, query, hidden = false) {
  if (!hidden) {
    return (await readline.question(query)).trim();
  }
  // For sensitive inputs like API tokens and passwords
  const answer = (await readline.question(query)).trim();
  return answer;
}

async function verifyCloudflareToken(token) {
  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data?.success && data?.result?.status === "active") {
      return { valid: true };
    }
    const message = data?.errors?.[0]?.message || `HTTP ${response.status}`;
    return { error: message, valid: false };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Network error", valid: false };
  }
}

async function configureMcp(readline) {
  console.log("\n=======================================================");
  console.log(" 1. Configure Cloudflare Live Account Management MCP");
  console.log("=======================================================");
  console.log("This will configure ~/.gemini/config/mcp_config.json so");
  console.log("Antigravity can manage and inspect your Cloudflare account.");

  const configureMcpChoice = (
    await prompt(readline, "\nDo you want to configure the Cloudflare MCP server now? [Y/n]: ")
  ).toLowerCase();
  if (configureMcpChoice === "n" || configureMcpChoice === "no") {
    console.log("Skipping Cloudflare MCP configuration.");
    return;
  }

  console.log("\nPlease enter your Cloudflare API Token (input is not logged/stored in git):");
  const token = await prompt(readline, "Cloudflare API Token: ", true);
  if (!token) {
    console.log("No token entered. Skipping Cloudflare MCP setup.");
    return;
  }

  console.log("Verifying token with Cloudflare API...");
  const verification = await verifyCloudflareToken(token);
  if (!verification.valid) {
    console.error(`\n⚠️  Token verification failed: ${verification.error}`);
    const proceedAnyway = (
      await prompt(readline, "Do you want to save this configuration anyway? [y/N]: ")
    ).toLowerCase();
    if (proceedAnyway !== "y" && proceedAnyway !== "yes") {
      console.log("Aborting Cloudflare MCP configuration.");
      return;
    }
  } else {
    console.log("✅ Cloudflare API Token verified successfully (Status: Active).");
  }

  let mcpConfig = { mcpServers: {} };
  if (existsSync(mcpConfigFile)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpConfigFile, "utf-8"));
    } catch {
      mcpConfig = { mcpServers: {} };
    }
  }
  if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};

  mcpConfig.mcpServers["cloudflare-docs"] = {
    serverUrl: "https://docs.mcp.cloudflare.com/mcp",
  };

  mcpConfig.mcpServers["cloudflare-api"] = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    serverUrl: "https://mcp.cloudflare.com/mcp",
  };

  if (!existsSync(geminiConfigDir)) {
    mkdirSync(geminiConfigDir, { recursive: true });
  }

  writeFileSync(mcpConfigFile, JSON.stringify(mcpConfig, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  console.log(`✅ Saved secure MCP configuration to ${mcpConfigFile} (permissions: 0600).`);
}

async function configureStagingCredentials(readline) {
  console.log("\n=======================================================");
  console.log(" 2. Configure Zero-Prompt Staging Qualification Auth");
  console.log("=======================================================");
  console.log("This will configure .env.staging.local (git-ignored) so");
  console.log("you can run all staging qualification tests without OTPs.");

  const configureStagingChoice = (
    await prompt(readline, "\nDo you want to configure staging test credentials now? [Y/n]: ")
  ).toLowerCase();
  if (configureStagingChoice === "n" || configureStagingChoice === "no") {
    console.log("Skipping staging test credentials configuration.");
    return;
  }

  const email =
    (await prompt(readline, "Staging Test Email [cwosborn@gmail.com]: ")) || "cwosborn@gmail.com";
  const password = await prompt(readline, "Staging Account Password: ", true);
  const totpSecret = await prompt(
    readline,
    "Platform Admin TOTP Secret or otpauth:// URI (optional): ",
    true,
  );

  const envLines = [
    "# Staging Qualification & Automation Local Environment",
    "# This file is strictly git-ignored and never committed.",
    `STAGING_AUTH_EMAIL="${email}"`,
  ];
  if (password) {
    envLines.push(`STAGING_AUTH_PASSWORD="${password}"`);
  }
  if (totpSecret) {
    envLines.push(`STAGING_PLATFORM_TOTP_SECRET="${totpSecret}"`);
  }

  writeFileSync(stagingEnvFile, envLines.join("\n") + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
  console.log(`✅ Saved staging credentials to ${stagingEnvFile} (permissions: 0600).`);
}

async function main() {
  console.log("=======================================================");
  console.log(" Choir Management — Developer Environment Setup");
  console.log("=======================================================");

  const readline = createInterface({ input, output });
  try {
    await configureMcp(readline);
    await configureStagingCredentials(readline);

    console.log("\n=======================================================");
    console.log(" 🎉 Setup Complete!");
    console.log("=======================================================");
    console.log("1. Cloudflare MCP is configured in ~/.gemini/config/mcp_config.json");
    console.log("   (Restart Antigravity or start a new turn to load live tools)");
    console.log("2. Staging credentials saved to .env.staging.local");
    console.log("   Run all staging tests automatically without OTP:");
    console.log("   $ node scripts/qualify-staging-all.mjs");
    console.log("=======================================================\n");
  } finally {
    readline.close();
  }
}

await main();
