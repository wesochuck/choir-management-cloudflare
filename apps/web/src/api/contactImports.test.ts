import {
  contactImportConfirmResponseSchema,
  contactImportErrorCsvResponseSchema,
  contactImportJobStatusResponseSchema,
  contactImportMappingResponseSchema,
  contactImportPreviewResponseSchema,
  contactImportUploadResponseSchema,
} from "@choir/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cancelContactImport,
  confirmContactImport,
  contactImportErrorMessage,
  downloadContactImportErrors,
  getContactImportStatus,
  previewContactImport,
  saveContactImportMapping,
  uploadContactImportCsv,
} from "./contactImports";
import { AuthApiError } from "./client";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IMPORT_ID = "11111111-1111-4111-8111-111111111111";
const LIST_ID = "33333333-3333-4333-8333-333333333333";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

function lastCall(): { readonly body: unknown; readonly method: string; readonly url: string } {
  const last = fetchMock.mock.calls.at(-1);
  if (!last) throw new Error("Expected fetch to have been called.");
  const [url, init] = last;
  if (typeof url !== "string") throw new Error("Expected fetch to use a string URL.");
  let body: unknown;
  try {
    body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : init?.body;
  } catch {
    body = init?.body;
  }
  return { body, method: init?.method ?? "GET", url };
}

const uploadFixture = contactImportUploadResponseSchema.parse({
  headers: ["First Name", "Email"],
  importId: IMPORT_ID,
  invalidRowCount: 0,
  probableDuplicateCount: 1,
  requestId: REQUEST_ID,
  rowCount: 3,
  sampleRows: [["Jane", "jane@example.com"]],
  status: "staged",
});

const counts = {
  contactsCreated: 0,
  contactsUpdated: 0,
  existingMatches: 1,
  inFileDuplicates: 1,
  invalidRows: 0,
  membershipsAdded: 0,
  newContacts: 2,
  rowsRead: 4,
  suppressedPreserved: 0,
};

describe("contact import browser client", () => {
  it("uploads CSV text through the organization-scoped route", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(uploadFixture, 201));
    const uploaded = await uploadContactImportCsv(
      "members.csv",
      "First Name,Email\nJane,jane@example.com\n",
    );
    expect(uploaded.importId).toBe(IMPORT_ID);
    const call = lastCall();
    expect(call.method).toBe("POST");
    expect(call.url).toBe("/api/organization/contact-imports?filename=members.csv");
    expect(call.body).toBe("First Name,Email\nJane,jane@example.com\n");
  });

  it("saves the column mapping with target lists", async () => {
    const mapping = contactImportMappingResponseSchema.parse({
      importId: IMPORT_ID,
      listIds: [LIST_ID],
      mapping: ["firstName", "email"],
      requestId: REQUEST_ID,
      status: "staged",
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(mapping));
    await saveContactImportMapping(IMPORT_ID, {
      listIds: [LIST_ID],
      mapping: ["firstName", "email"],
    });
    const call = lastCall();
    expect(call.method).toBe("PUT");
    expect(call.url).toBe(`/api/organization/contact-imports/${IMPORT_ID}/mapping`);
    expect(call.body).toMatchObject({ listIds: [LIST_ID], mapping: ["firstName", "email"] });
  });

  it("previews without mutating and confirms to start the job", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        contactImportPreviewResponseSchema.parse({
          ...counts,
          importId: IMPORT_ID,
          requestId: REQUEST_ID,
          status: "staged",
        }),
      ),
    );
    const previewed = await previewContactImport(IMPORT_ID);
    expect(previewed.newContacts).toBe(2);
    expect(lastCall().method).toBe("GET");

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        contactImportConfirmResponseSchema.parse({
          idempotencyKey: `contact-import:${IMPORT_ID}`,
          importId: IMPORT_ID,
          requestId: REQUEST_ID,
          status: "confirmed",
        }),
      ),
    );
    const confirmed = await confirmContactImport(IMPORT_ID);
    expect(confirmed.status).toBe("confirmed");
    expect(lastCall().url).toBe(`/api/organization/contact-imports/${IMPORT_ID}/confirm`);
  });

  it("polls import status and downloads the error CSV", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        contactImportJobStatusResponseSchema.parse({
          ...counts,
          contactsCreated: 2,
          contactsUpdated: 1,
          errorCode: null,
          hasErrorCsv: true,
          importId: IMPORT_ID,
          membershipsAdded: 3,
          processedRows: 4,
          requestId: REQUEST_ID,
          status: "completed",
        }),
      ),
    );
    const status = await getContactImportStatus(IMPORT_ID);
    expect(status.status).toBe("completed");
    expect(status.membershipsAdded).toBe(3);

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        contactImportErrorCsvResponseSchema.parse({
          csv: '"Row","Error"\n"2","Bad email"',
          importId: IMPORT_ID,
          requestId: REQUEST_ID,
          rowCount: 1,
        }),
      ),
    );
    const exported = await downloadContactImportErrors(IMPORT_ID);
    expect(exported.rowCount).toBe(1);
    expect(lastCall().url).toBe(`/api/organization/contact-imports/${IMPORT_ID}/errors`);
  });

  it("cancels a staged import before confirmation", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ importId: IMPORT_ID, requestId: REQUEST_ID, status: "cancelled" }),
    );
    await cancelContactImport(IMPORT_ID);
    const call = lastCall();
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`/api/organization/contact-imports/${IMPORT_ID}/cancel`);
  });

  it("maps import conflict errors to actionable messages", () => {
    expect(
      contactImportErrorMessage(
        new AuthApiError("Conflict", 409, "contact_import_conflict"),
        "Fallback.",
      ),
    ).toMatch(/not in a state/i);
    expect(
      contactImportErrorMessage(
        new AuthApiError("Duplicate", 409, "contact_duplicate_email"),
        "Fallback.",
      ),
    ).toMatch(/already exists/i);
  });
});
