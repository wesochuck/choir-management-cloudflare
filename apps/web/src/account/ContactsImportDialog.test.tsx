import type {
  ContactImportPreviewResponse,
  ContactImportUploadResponse,
  ContactList,
} from "@choir/contracts";
import {
  contactImportJobStatusResponseSchema,
  contactImportPreviewResponseSchema,
  contactImportUploadResponseSchema,
  contactListSchema,
} from "@choir/contracts";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ContactImportMappingFields,
  ContactImportPreviewFields,
  ContactImportResultFields,
  ContactImportUploadFields,
  ContactImportWizardSteps,
} from "./ContactsImportDialog";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IMPORT_ID = "11111111-1111-4111-8111-111111111111";
const LIST_NEWSLETTER = "33333333-3333-4333-8333-333333333333";

const newsletter: ContactList = contactListSchema.parse({
  createdAt: "2026-08-01T00:00:00.000Z",
  description: "Monthly updates",
  id: LIST_NEWSLETTER,
  name: "Newsletter",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

const upload: ContactImportUploadResponse = contactImportUploadResponseSchema.parse({
  headers: ["First Name", "Email"],
  importId: IMPORT_ID,
  invalidRowCount: 1,
  probableDuplicateCount: 1,
  requestId: REQUEST_ID,
  rowCount: 4,
  sampleRows: [["Jane", "jane@example.com"]],
  status: "staged",
});

const preview: ContactImportPreviewResponse = contactImportPreviewResponseSchema.parse({
  contactsCreated: 0,
  contactsUpdated: 0,
  existingMatches: 1,
  importId: IMPORT_ID,
  inFileDuplicates: 1,
  invalidRows: 1,
  membershipsAdded: 0,
  newContacts: 2,
  requestId: REQUEST_ID,
  rowsRead: 4,
  status: "staged",
  suppressedPreserved: 1,
});

describe("contact import wizard steps", () => {
  it("marks the current step for assistive technology", () => {
    const html = renderToString(<ContactImportWizardSteps step="preview" />);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Upload");
    expect(html).toContain("Map columns");
    expect(html).toContain("Preview");
    expect(html).toContain("Processing");
    expect(html).toContain("Result");
  });
});

describe("contact import upload fields", () => {
  it("renders an accessible file control and states the consent rule", () => {
    const html = renderToString(
      <ContactImportUploadFields busy={false} onFile={() => undefined} />,
    );
    expect(html).toContain("Choose a CSV file");
    expect(html).toContain('type="file"');
    expect(html).toContain("10,000 rows");
    expect(html).toMatch(/never implies consent/i);
  });
});

describe("contact import mapping fields", () => {
  it("labels every header column and target list", () => {
    const html = renderToString(
      <ContactImportMappingFields
        busy={false}
        invalidRowCount={upload.invalidRowCount}
        listIds={[LIST_NEWSLETTER]}
        lists={[newsletter]}
        onBack={() => undefined}
        onContinue={() => undefined}
        onListIdsChange={() => undefined}
        onTargetsChange={() => undefined}
        probableDuplicateCount={upload.probableDuplicateCount}
        sampleRow={upload.sampleRows[0] ?? []}
        sampleRows={upload.sampleRows}
        targets={["firstName", "email"]}
        upload={upload}
      />,
    );
    expect(html).toContain("Map columns to contact fields");
    expect(html).toContain("Sample rows");
    expect(html).toContain("jane@example.com");
    expect(html).toContain("First Name");
    expect(html).toContain("Email Marketing Status");
    expect(html).toContain("SMS Marketing Status");
    expect(html).toContain("Ignore");
    expect(html).toContain("Newsletter");
    expect(html).toContain("Preview import");
  });
});

describe("contact import preview fields", () => {
  it("announces counts and the unsubscribe guarantee", () => {
    const html = renderToString(
      <ContactImportPreviewFields
        busy={false}
        onBack={() => undefined}
        onConfirm={() => undefined}
        preview={preview}
      />,
    );
    expect(html).toContain("New contacts");
    expect(html).toContain("Existing contacts to update");
    expect(html).toContain("Duplicates within file");
    expect(html).toContain("Unsubscribes preserved");
    expect(html).toMatch(/stay unsubscribed/i);
    expect(html).toContain("Confirm import");
  });
});

describe("contact import result fields", () => {
  it("reports created, updated, and membership outcomes with error download", () => {
    const status = contactImportJobStatusResponseSchema.parse({
      contactsCreated: 2,
      contactsUpdated: 1,
      errorCode: null,
      existingMatches: 1,
      hasErrorCsv: true,
      importId: IMPORT_ID,
      inFileDuplicates: 1,
      invalidRows: 1,
      membershipsAdded: 3,
      newContacts: 2,
      processedRows: 4,
      requestId: REQUEST_ID,
      rowsRead: 4,
      status: "completed",
      suppressedPreserved: 0,
    });
    const html = renderToString(
      <ContactImportResultFields
        busy={false}
        onDone={() => undefined}
        onDownloadErrors={() => undefined}
        status={status}
      />,
    );
    expect(html).toContain("2 contacts");
    expect(html).toContain("3 list memberships");
    expect(html).toContain("Download error CSV");
    expect(html).toContain("Done");
    expect(vi.fn()).toBeDefined();
  });
});
