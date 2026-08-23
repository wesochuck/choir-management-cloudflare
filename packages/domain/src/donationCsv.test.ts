import { describe, expect, it } from "vitest";

import { donationExportFilename, renderDonationCsv, type DonationExportRow } from "./donationCsv";

const baseNamed: DonationExportRow = {
  amountPaidCents: 25_00,
  anonymous: false,
  createdAt: "2026-01-15T12:34:56.000Z",
  donorEmail: "alice@example.test",
  donorName: "Alice Anderson",
  id: "don-1",
  status: "paid",
  tributeName: "",
  tributeType: "none",
};

const baseAnonymous: DonationExportRow = {
  amountPaidCents: 10_00,
  anonymous: true,
  createdAt: "2026-01-16T12:34:56.000Z",
  donorEmail: "",
  donorName: "Anonymous",
  id: "don-2",
  status: "paid",
  tributeName: "",
  tributeType: "none",
};

describe("renderDonationCsv", () => {
  it("produces a header-only CSV when there are no rows", () => {
    const csv = renderDonationCsv([]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      '"ID","Donor Name","Donor Email","Amount","Payment Method","Reference","Tribute","Tribute Name","Anonymous","Status","Thank You Status","Thank You Sent At","Date"',
    );
    expect(lines[1]).toBe("");
  });

  it("renders a single named donation with correct columns and amount formatting", () => {
    const csv = renderDonationCsv([baseNamed]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain('"ID"');
    expect(lines[1]).toBe(
      '"don-1","Alice Anderson","alice@example.test","25.00","stripe","","none","","No","paid","Pending","","2026-01-15T12:34:56.000Z"',
    );
  });

  it("renders manual donation with payment method, reference, and thank you sent status", () => {
    const manualRow: DonationExportRow = {
      amountPaidCents: 150_00,
      anonymous: false,
      createdAt: "2026-01-18T10:00:00.000Z",
      donorEmail: "bob@example.test",
      donorName: "Bob Builder",
      id: "don-manual",
      paymentMethod: "check",
      paymentReference: "Check #1042",
      status: "paid",
      thankYouSentAt: "2026-01-19T14:30:00.000Z",
      tributeName: "",
      tributeType: "none",
    };
    const csv = renderDonationCsv([manualRow]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe(
      '"don-manual","Bob Builder","bob@example.test","150.00","check","Check #1042","none","","No","paid","Sent","2026-01-19T14:30:00.000Z","2026-01-18T10:00:00.000Z"',
    );
  });

  it("sorts by createdAt descending then donor last-name ascending", () => {
    const older: DonationExportRow = {
      ...baseNamed,
      createdAt: "2026-01-10T00:00:00.000Z",
      donorName: "Zoe Zulu",
      id: "don-old",
    };
    const newer: DonationExportRow = {
      ...baseNamed,
      createdAt: "2026-01-20T00:00:00.000Z",
      donorName: "Bob Brown",
      id: "don-new",
    };
    const csv = renderDonationCsv([older, baseNamed, newer]);
    const dataLines = csv.split("\r\n").slice(1, -1); // drop header + trailing empty
    expect(dataLines[0]).toContain('"don-new"');
    expect(dataLines[1]).toContain('"don-1"');
    expect(dataLines[2]).toContain('"don-old"');
  });

  it("separates anonymous donations behind an ANONYMOUS DONORS row", () => {
    const csv = renderDonationCsv([baseNamed, baseAnonymous]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain('"don-1"');
    expect(lines[2]).toBe('"","ANONYMOUS DONORS","","","","","","","","","","",""');
    expect(lines[3]).toContain('"don-2"');
    expect(lines[4]).toBe(""); // trailing
  });

  it("does not add the ANONYMOUS separator when there are no anonymous rows", () => {
    const csv = renderDonationCsv([baseNamed]);
    const lines = csv.split("\r\n");
    expect(lines.join("\r\n")).not.toContain("ANONYMOUS DONORS");
  });

  it("escapes embedded commas and quotes in donor name", () => {
    const row: DonationExportRow = {
      ...baseNamed,
      donorName: 'Alice "Alice" Anderson, Jr.',
    };
    const csv = renderDonationCsv([row]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain('"Alice ""Alice"" Anderson, Jr."');
  });

  it("neutralizes spreadsheet-formula injection attempts in donor name and email", () => {
    const row: DonationExportRow = {
      ...baseNamed,
      donorName: '=HYPERLINK("evil")',
      donorEmail: "+1234",
    };
    const csv = renderDonationCsv([row]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("'=HYPERLINK");
    expect(lines[1]).toContain("'+1234");
  });

  it("renders tribute type and tribute name", () => {
    const row: DonationExportRow = {
      ...baseNamed,
      tributeName: "Jane Doe",
      tributeType: "memory",
    };
    const csv = renderDonationCsv([row]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain('"memory"');
    expect(lines[1]).toContain('"Jane Doe"');
  });
});

describe("donationExportFilename", () => {
  it("uses UTC date from the provided Date", () => {
    const date = new Date(Date.UTC(2026, 6, 22));
    expect(donationExportFilename(date)).toBe("donations_export_2026-07-22.csv");
  });
});
