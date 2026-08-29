import { organizationBrandingSchema, privateFileResponseSchema } from "@choir/contracts";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";
import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";

const USER_EMAIL = "branding.manager@example.test";
const LOGO_FILE_ID = "88888888-8888-4888-8888-888888888888";

function binding<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return value;
}

const database = binding(env.CONTROL_DB, "CONTROL_DB");
const stores = binding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const api = (host: string, path: string, cookie?: string, init?: RequestInit) =>
  organizationRequest(host, path, cookie, init);

const jsonWrite = (
  host: string,
  path: string,
  method: "POST" | "PUT",
  body: unknown,
  cookie: string,
) => writeJson(exports.default, host, path, cookie, body, method);

const provision = (id: string, slug: string, role: "admin" | "member") =>
  provisionOrganization(database, stores, {
    id,
    name: `Organization ${slug}`,
    role,
    slug,
    userId: "branding-manager",
  });

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

describe("Organization branding and public logo endpoint", () => {
  beforeEach(async () => {
    await applyD1Migrations(database, [...inject("controlMigrations")]);
    clearCapturedPlatformEmailsForTest();
    await seedAuthUser(database, "branding-manager", USER_EMAIL, "Branding Manager");
    await provision("organization-alpha", "alpha", "admin");
    await provision("organization-bravo", "bravo", "member");
  });

  afterEach(async () => {
    await reset();
  });

  it("reads, updates, and serves organization logo publicly", async () => {
    const cookie = await signIn();

    // Initial state: no logo
    const initialGet = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/branding", cookie),
    );
    expect(initialGet.status).toBe(200);
    const initialData = organizationBrandingSchema.parse(await initialGet.json());
    expect(initialData.logoFileId).toBeNull();
    expect(initialData.organizationName).toBe("Organization alpha");

    // Public logo returns 404 when not configured
    const initialPublic = await exports.default.fetch(api("alpha.localhost", "/api/public/logo"));
    expect(initialPublic.status).toBe(404);

    // Upload an image file
    const samplePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const upload = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/files/${LOGO_FILE_ID}`, cookie, {
        body: samplePng,
        headers: {
          "content-length": String(samplePng.byteLength),
          "content-type": "image/png",
          "x-file-name": "logo.png",
        },
        method: "PUT",
      }),
    );
    expect(upload.status).toBe(201);
    expect(privateFileResponseSchema.parse(await upload.json()).id).toBe(LOGO_FILE_ID);

    // Update branding with logoFileId
    const update = await jsonWrite(
      "alpha.localhost",
      "/api/organization/branding",
      "PUT",
      { logoFileId: LOGO_FILE_ID },
      cookie,
    );
    expect(update.status).toBe(200);
    const updatedData = organizationBrandingSchema.parse(await update.json());
    expect(updatedData.logoFileId).toBe(LOGO_FILE_ID);

    // Public logo endpoint serves the image
    const publicLogo = await exports.default.fetch(api("alpha.localhost", "/api/public/logo"));
    expect(publicLogo.status).toBe(200);
    expect(publicLogo.headers.get("content-type")).toBe("image/png");
    expect(publicLogo.headers.get("cache-control")).toContain("public");
    const body = new Uint8Array(await publicLogo.arrayBuffer());
    expect(body).toEqual(samplePng);

    // Member role cannot update branding (requires admin/owner)
    const forbiddenUpdate = await jsonWrite(
      "bravo.localhost",
      "/api/organization/branding",
      "PUT",
      { logoFileId: LOGO_FILE_ID },
      cookie,
    );
    expect(forbiddenUpdate.status).toBe(403);
  });
});
