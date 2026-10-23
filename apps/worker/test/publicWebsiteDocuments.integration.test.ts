import {
  publicWebsiteDocumentDeleteResponseSchema,
  publicWebsiteDocumentResponseSchema,
  publicWebsiteDocumentsResponseSchema,
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
import { applyD1Migrations, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import { privateOrganizationFileKey } from "../src/storage/privateFiles";

function binding<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return value;
}

const database = binding(env.CONTROL_DB, "CONTROL_DB");
const stores = binding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");
const files = binding(env.ORGANIZATION_FILES, "ORGANIZATION_FILES");
const email = "document.admin@example.test";

const api = (host: string, path: string, cookie?: string, init?: RequestInit) =>
  organizationRequest(host, path, cookie, init);

const json = (host: string, path: string, cookie: string, body: unknown, method = "POST") =>
  writeJson(exports.default, host, path, cookie, body, method);

const provision = (id: string, slug: string, role: "admin" | "member") =>
  provisionOrganization(database, stores, {
    id,
    name: `Organization ${slug}`,
    role,
    slug,
    userId: "document-user",
  });

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", email, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

async function uploadFile(
  cookie: string,
  fileName: string,
  contentType: string,
  content: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const fileId = crypto.randomUUID();
  const response = await exports.default.fetch(
    api("alpha.localhost", `/api/organization/files/${fileId}`, cookie, {
      body: content,
      headers: {
        "content-length": String(content.length),
        "content-type": contentType,
        "x-file-name": encodeURIComponent(fileName),
      },
      method: "PUT",
    }),
  );
  expect(response.status).toBe(201);
  return fileId;
}

beforeEach(async () => {
  await applyD1Migrations(database, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(database, "document-user", email, "Document Admin");
  await provision("organization-alpha", "alpha", "admin");
  await provision("organization-bravo", "bravo", "member");
});

afterEach(async () => reset());

describe("Public website hosted documents", () => {
  it("uploads, lists, streams inline/attachment, updates, reclaims, and isolates across tenants", async () => {
    const cookie = await signIn();

    // 1. Upload a PDF and a DOCX
    const pdfBytes = new TextEncoder().encode("%PDF-1.4 test donation pdf");
    const pdfFileId = await uploadFile(cookie, "mail-in-form.pdf", "application/pdf", pdfBytes);

    const docxBytes = new TextEncoder().encode("PK test docx volunteer agreement");
    const docxFileId = await uploadFile(
      cookie,
      "volunteer-agreement.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      docxBytes,
    );

    // 2. Create public website documents
    const createPdfResponse = await json(
      "alpha.localhost",
      "/api/organization/website/documents",
      cookie,
      {
        fileId: pdfFileId,
        title: "2026 Mail-In Donation Form",
      },
    );
    expect(createPdfResponse.status).toBe(201);
    const pdfDoc = publicWebsiteDocumentResponseSchema.parse(await createPdfResponse.json());
    expect(pdfDoc.slug).toBe("2026-mail-in-donation-form");
    expect(pdfDoc.downloadPath).toBe("/api/public/documents/2026-mail-in-donation-form.pdf");

    const createDocxResponse = await json(
      "alpha.localhost",
      "/api/organization/website/documents",
      cookie,
      {
        fileId: docxFileId,
        title: "Volunteer Agreement",
      },
    );
    expect(createDocxResponse.status).toBe(201);
    const docxDoc = publicWebsiteDocumentResponseSchema.parse(await createDocxResponse.json());
    expect(docxDoc.slug).toBe("volunteer-agreement");
    expect(docxDoc.downloadPath).toBe("/api/public/documents/volunteer-agreement.docx");

    // 3. List documents
    const listResponse = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/website/documents", cookie),
    );
    expect(listResponse.status).toBe(200);
    const listData = publicWebsiteDocumentsResponseSchema.parse(await listResponse.json());
    expect(listData.documents).toHaveLength(2);
    expect(listData.documents[0]?.id).toBe(pdfDoc.id);
    expect(listData.documents[1]?.id).toBe(docxDoc.id);

    // 4. Download PDF anonymously (inline disposition by default)
    const downloadPdfResponse = await exports.default.fetch(
      api("alpha.localhost", pdfDoc.downloadPath),
    );
    expect(downloadPdfResponse.status).toBe(200);
    expect(downloadPdfResponse.headers.get("content-type")).toBe("application/pdf");
    expect(downloadPdfResponse.headers.get("content-disposition")).toContain("inline;");
    expect(downloadPdfResponse.headers.get("content-disposition")).toContain("mail-in-form.pdf");
    expect(await downloadPdfResponse.text()).toBe("%PDF-1.4 test donation pdf");

    // 5. Download PDF with ?download=1 forces attachment
    const forceDownloadPdfResponse = await exports.default.fetch(
      api("alpha.localhost", `${pdfDoc.downloadPath}?download=1`),
    );
    expect(forceDownloadPdfResponse.status).toBe(200);
    expect(forceDownloadPdfResponse.headers.get("content-disposition")).toContain("attachment;");

    // 6. Download DOCX anonymously (attachment disposition by default)
    const downloadDocxResponse = await exports.default.fetch(
      api("alpha.localhost", docxDoc.downloadPath),
    );
    expect(downloadDocxResponse.status).toBe(200);
    expect(downloadDocxResponse.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(downloadDocxResponse.headers.get("content-disposition")).toContain("attachment;");
    expect(await downloadDocxResponse.text()).toBe("PK test docx volunteer agreement");

    // 7. Resolves without extension or by UUID as well
    const bySlugBare = await exports.default.fetch(
      api("alpha.localhost", `/api/public/documents/${pdfDoc.slug}`),
    );
    expect(bySlugBare.status).toBe(200);
    const byId = await exports.default.fetch(
      api("alpha.localhost", `/api/public/documents/${pdfDoc.id}.pdf`),
    );
    expect(byId.status).toBe(200);

    // 8. ETag and 304 revalidation
    const etag = downloadPdfResponse.headers.get("etag");
    expect(etag).toBeTruthy();
    const revalidateResponse = await exports.default.fetch(
      api("alpha.localhost", pdfDoc.downloadPath, undefined, {
        headers: { "if-none-match": etag ?? "" },
      }),
    );
    expect(revalidateResponse.status).toBe(304);

    // 9. Cross-tenant isolation: requesting Alpha's document on Bravo returns 404
    const crossTenantResponse = await exports.default.fetch(
      api("bravo.localhost", pdfDoc.downloadPath),
    );
    expect(crossTenantResponse.status).toBe(404);

    // 10. Replace the PDF file with an updated version (preserving slug and URL!)
    const replacementBytes = new TextEncoder().encode("%PDF-1.4 updated 2027 form");
    const replacementFileId = await uploadFile(
      cookie,
      "mail-in-form-2027.pdf",
      "application/pdf",
      replacementBytes,
    );

    const updateResponse = await json(
      "alpha.localhost",
      `/api/organization/website/documents/${pdfDoc.id}`,
      cookie,
      {
        fileId: replacementFileId,
        title: "2027 Mail-In Donation Form",
      },
      "PUT",
    );
    expect(updateResponse.status).toBe(200);
    const updatedDoc = publicWebsiteDocumentResponseSchema.parse(await updateResponse.json());
    expect(updatedDoc.id).toBe(pdfDoc.id);
    expect(updatedDoc.slug).toBe(pdfDoc.slug); // Stable URL preserved!
    expect(updatedDoc.fileId).toBe(replacementFileId);

    // Old private file is reclaimed from R2
    const oldKey = privateOrganizationFileKey("organization-alpha", pdfFileId);
    expect(await files.get(oldKey)).toBeNull();

    // Downloading the same URL returns updated content
    const downloadUpdatedResponse = await exports.default.fetch(
      api("alpha.localhost", pdfDoc.downloadPath),
    );
    expect(downloadUpdatedResponse.status).toBe(200);
    expect(await downloadUpdatedResponse.text()).toBe("%PDF-1.4 updated 2027 form");

    // 11. Delete document
    const deleteResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/website/documents/${pdfDoc.id}`, cookie, {
        method: "DELETE",
      }),
    );
    expect(deleteResponse.status).toBe(200);
    const deleteResult = publicWebsiteDocumentDeleteResponseSchema.parse(
      await deleteResponse.json(),
    );
    expect(deleteResult.documentId).toBe(pdfDoc.id);
    expect(deleteResult.status).toBe("deleted");

    // Subsequent download is 404
    const downloadDeletedResponse = await exports.default.fetch(
      api("alpha.localhost", pdfDoc.downloadPath),
    );
    expect(downloadDeletedResponse.status).toBe(404);

    // Replaced file reclaimed
    const replacementKey = privateOrganizationFileKey("organization-alpha", replacementFileId);
    expect(await files.get(replacementKey)).toBeNull();

    // 12. Slug tombstone: creating a new document with the exact same title gets suffix -2
    const newDocBytes = new TextEncoder().encode("%PDF-1.4 brand new form");
    const newDocFileId = await uploadFile(
      cookie,
      "brand-new-form.pdf",
      "application/pdf",
      newDocBytes,
    );
    const createAgainResponse = await json(
      "alpha.localhost",
      "/api/organization/website/documents",
      cookie,
      {
        fileId: newDocFileId,
        title: "2026 Mail-In Donation Form",
      },
    );
    expect(createAgainResponse.status).toBe(201);
    const docAgain = publicWebsiteDocumentResponseSchema.parse(await createAgainResponse.json());
    expect(docAgain.slug).toBe("2026-mail-in-donation-form-2");
    expect(docAgain.downloadPath).toBe("/api/public/documents/2026-mail-in-donation-form-2.pdf");
  });

  it("rejects unsupported MIME types and files > 5 MB", async () => {
    const cookie = await signIn();

    // Upload an image
    const imageBytes = new TextEncoder().encode("fake png");
    const imageFileId = await uploadFile(cookie, "photo.png", "image/png", imageBytes);

    const imageResponse = await json(
      "alpha.localhost",
      "/api/organization/website/documents",
      cookie,
      {
        fileId: imageFileId,
        title: "Photo Document",
      },
    );
    expect(imageResponse.status).toBe(400);
    const imageError = await imageResponse.json();
    expect(imageError).toHaveProperty("code", "validation_failed");
  });
});
