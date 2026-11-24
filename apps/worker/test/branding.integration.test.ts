import {
  organizationBrandingSchema,
  privateFileResponseSchema,
  publishedOrganizationProjectionSchema,
} from "@choir/contracts";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";
import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import { renderTestEmailPayload } from "../src/organization/organizationCommunications";
import type { OrganizationStore } from "../src/organization/OrganizationStore";

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

    // Commerce projection includes the configured organization logo
    const commerceProjection = await exports.default.fetch(
      api("alpha.localhost", "/api/public/commerce-projection"),
    );
    expect(commerceProjection.status).toBe(200);
    const commerceData = publishedOrganizationProjectionSchema.parse(
      await commerceProjection.json(),
    );
    expect(commerceData.payload.settings.logoFileId).toBe(LOGO_FILE_ID);

    // Tenant isolation: bravo does not have a logo and does not leak alpha's logo
    const bravoPublicLogo = await exports.default.fetch(api("bravo.localhost", "/api/public/logo"));
    expect(bravoPublicLogo.status).toBe(404);

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

  it("rejects HTML, SVG, mislabeled bytes, and unverified legacy logo references while serving verified raster images (SEC-08)", async () => {
    const cookie = await signIn();

    const uploadFile = async (
      fileId: string,
      fileName: string,
      contentType: string,
      bytes: Uint8Array<ArrayBuffer>,
    ) => {
      const response = await exports.default.fetch(
        api("alpha.localhost", `/api/organization/files/${fileId}`, cookie, {
          body: bytes,
          headers: {
            "content-length": String(bytes.byteLength),
            "content-type": contentType,
            "x-file-name": encodeURIComponent(fileName),
          },
          method: "PUT",
        }),
      );
      expect(response.status).toBe(201);
    };

    const toArrayBufferBytes = (text: string): Uint8Array<ArrayBuffer> => {
      const encoded = new TextEncoder().encode(text);
      const copy = new Uint8Array(new ArrayBuffer(encoded.byteLength));
      copy.set(encoded);
      return copy;
    };

    const htmlFileId = "88888888-8888-4888-8888-888888888801";
    const svgFileId = "88888888-8888-4888-8888-888888888802";
    const mislabeledHtmlFileId = "88888888-8888-4888-8888-888888888803";
    const mislabeledPngAsJpegId = "88888888-8888-4888-8888-888888888804";
    const webpFileId = "88888888-8888-4888-8888-888888888805";
    const jpegFileId = "88888888-8888-4888-8888-888888888806";

    await uploadFile(
      htmlFileId,
      "poc.html",
      "text/html",
      toArrayBufferBytes("<!doctype html><h1>Injected</h1>"),
    );
    await uploadFile(
      svgFileId,
      "logo.svg",
      "image/svg+xml",
      toArrayBufferBytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    );
    await uploadFile(
      mislabeledHtmlFileId,
      "fake.png",
      "image/png",
      toArrayBufferBytes("<html><body>not a png</body></html>"),
    );
    const pngBytes = new Uint8Array(new ArrayBuffer(8));
    pngBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await uploadFile(mislabeledPngAsJpegId, "wrong.jpg", "image/jpeg", pngBytes);

    // 1. PUT /api/organization/branding rejects HTML, SVG, and mislabeled bytes.
    for (const badFileId of [htmlFileId, svgFileId, mislabeledHtmlFileId, mislabeledPngAsJpegId]) {
      const rejected = await jsonWrite(
        "alpha.localhost",
        "/api/organization/branding",
        "PUT",
        { logoFileId: badFileId },
        cookie,
      );
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({ code: "invalid_logo_image" });
    }

    // 2. POST /api/setup/progress also rejects HTML/SVG/mislabeled logoFileId.
    const setupRejected = await jsonWrite(
      "alpha.localhost",
      "/api/setup/progress",
      "POST",
      { data: { logoFileId: htmlFileId }, step: "branding" },
      cookie,
    );
    expect(setupRejected.status).toBe(400);
    expect(await setupRejected.json()).toMatchObject({ code: "invalid_logo_image" });

    // 3. Unverified legacy references in organization_metadata are refused at read time (404).
    const alphaStub = stores.get(stores.idFromName("organization-alpha"));
    await runInDurableObject<OrganizationStore, null>(alphaStub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE organization_metadata SET logo_file_id = ?, logo_verified_content_type = NULL WHERE organization_id = 'organization-alpha'",
        htmlFileId,
      );
      return null;
    });
    const legacyHtmlRes = await exports.default.fetch(api("alpha.localhost", "/api/public/logo"));
    expect(legacyHtmlRes.status).toBe(404);

    // Even if a legacy row points to a valid PNG without logo_verified_content_type, refuse it.
    await uploadFile(LOGO_FILE_ID, "legacy.png", "image/png", pngBytes);
    await runInDurableObject<OrganizationStore, null>(alphaStub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE organization_metadata SET logo_file_id = ?, logo_verified_content_type = NULL WHERE organization_id = 'organization-alpha'",
        LOGO_FILE_ID,
      );
      return null;
    });
    const legacyUnverifiedPngRes = await exports.default.fetch(
      api("alpha.localhost", "/api/public/logo"),
    );
    expect(legacyUnverifiedPngRes.status).toBe(404);

    // Even if logo_verified_content_type were forged to image/png for mislabeled HTML bytes, read-time sniff refuses it.
    await runInDurableObject<OrganizationStore, null>(alphaStub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE organization_metadata SET logo_file_id = ?, logo_verified_content_type = 'image/png' WHERE organization_id = 'organization-alpha'",
        mislabeledHtmlFileId,
      );
      return null;
    });
    const forgedMislabeledRes = await exports.default.fetch(
      api("alpha.localhost", "/api/public/logo"),
    );
    expect(forgedMislabeledRes.status).toBe(404);

    // 4. Valid JPEG and WebP logos succeed and render across shell, public site, and email.
    const jpegBytes = new Uint8Array(new ArrayBuffer(6));
    jpegBytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    await uploadFile(jpegFileId, "logo.jpg", "image/jpeg", jpegBytes);
    const saveJpeg = await jsonWrite(
      "alpha.localhost",
      "/api/organization/branding",
      "PUT",
      { logoFileId: jpegFileId },
      cookie,
    );
    expect(saveJpeg.status).toBe(200);
    const publicJpeg = await exports.default.fetch(api("alpha.localhost", "/api/public/logo"));
    expect(publicJpeg.status).toBe(200);
    expect(publicJpeg.headers.get("content-type")).toBe("image/jpeg");
    expect(publicJpeg.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await publicJpeg.arrayBuffer())).toEqual(jpegBytes);

    const webpBytes = new Uint8Array(new ArrayBuffer(12));
    webpBytes.set([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    await uploadFile(webpFileId, "logo.webp", "image/webp", webpBytes);
    const saveWebp = await jsonWrite(
      "alpha.localhost",
      "/api/organization/branding",
      "PUT",
      { logoFileId: webpFileId },
      cookie,
    );
    expect(saveWebp.status).toBe(200);
    const publicWebp = await exports.default.fetch(api("alpha.localhost", "/api/public/logo"));
    expect(publicWebp.status).toBe(200);
    expect(publicWebp.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await publicWebp.arrayBuffer())).toEqual(webpBytes);

    // Authenticated shell branding, public site projection, and email rendering all resolve the verified logo.
    const shellBranding = organizationBrandingSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/organization/branding", cookie))
      ).json(),
    );
    expect(shellBranding.logoFileId).toBe(webpFileId);

    const commerceProjection = publishedOrganizationProjectionSchema.parse(
      await (
        await exports.default.fetch(api("alpha.localhost", "/api/public/commerce-projection"))
      ).json(),
    );
    expect(commerceProjection.payload.settings.logoFileId).toBe(webpFileId);

    const renderedEmail = renderTestEmailPayload({
      baseDomain: "alpha.localhost",
      branding: { logoFileId: shellBranding.logoFileId, organizationName: "Organization alpha" },
      contentMarkdown: "{organizationLogo}",
      event: null,
      fromName: "Organization alpha",
      subject: "Hello",
      timezone: "America/New_York",
    });
    expect(renderedEmail.templatedContent).toContain("https://alpha.localhost/api/public/logo");
  });
});
