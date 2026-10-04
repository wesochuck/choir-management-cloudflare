import { contactExportResponseSchema, contactImportErrorCsvResponseSchema } from "@choir/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { downloadContactImportErrorFile } from "../api/contactImports";
import { downloadContactsExport } from "./contactsCsv";
import { downloadCsv } from "./components/Reports/reportHelpers";

const revokeObjectURL = vi.fn<(url: string) => void>();

beforeEach(() => {
  revokeObjectURL.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T20:43:07Z"));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([
  [
    "contacts",
    () => {
      downloadContactsExport(
        contactExportResponseSchema.parse({
          csv: "Name\nSinger",
          downloadName: "contacts.csv",
          requestId: "99999999-9999-4999-8999-999999999999",
          rowCount: 1,
        }),
      );
    },
  ],
  [
    "contact-import-errors",
    () => {
      downloadContactImportErrorFile(
        contactImportErrorCsvResponseSchema.parse({
          csv: "Row,Error\n1,Invalid",
          downloadName: "contact-import-errors.csv",
          importId: "11111111-1111-4111-8111-111111111111",
          requestId: "99999999-9999-4999-8999-999999999999",
          rowCount: 1,
        }),
      );
    },
  ],
  [
    "attendance-report",
    () => {
      downloadCsv("attendance-report.csv", [
        ["Name", "Present"],
        ["Singer", 2],
      ]);
    },
  ],
] as const)("timestamps the actual %s download and revokes its URL", (base, download) => {
  let filename: string | null = null;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    filename = this.download;
    expect(this.href).toBe("blob:export");
  });
  download();
  expect(filename).toBe(`${base}_2026-Oct-03_08-43-07-PM-UTC.csv`);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
});
