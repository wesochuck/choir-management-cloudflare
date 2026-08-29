import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localStagingEnv = join(repositoryRoot, ".env.staging.local");

export function loadStagingEnv() {
  if (existsSync(localStagingEnv)) {
    try {
      const lines = readFileSync(localStagingEnv, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/u);
        if (match) {
          const key = match[1];
          const value = match[2] ?? match[3] ?? match[4] ?? "";
          if (key && !process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }
}

export function getStagingConfig() {
  loadStagingEnv();
  const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
    /\/$/u,
    "",
  );
  const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
  const cookie = process.env.STAGING_SESSION_COOKIE ?? "";

  return {
    cookie,
    email,
    productUrl,
  };
}

export async function stagingFetch(path, options = {}) {
  const { cookie, productUrl } = getStagingConfig();
  const url = path.startsWith("http")
    ? path
    : `${productUrl}${path.startsWith("/") ? "" : "/"}${path}`;

  const headers = {
    accept: "application/json",
    ...(cookie ? { cookie } : {}),
    ...(options.headers ?? {}),
  };

  return fetch(url, {
    ...options,
    headers,
  });
}

export async function stagingFetchJson(path, options = {}) {
  const response = await stagingFetch(path, options);
  if (!response.ok) {
    throw new Error(`Staging fetch failed for ${path}: HTTP ${String(response.status)}`);
  }
  return response.json();
}
