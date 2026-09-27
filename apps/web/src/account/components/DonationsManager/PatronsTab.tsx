import type { PatronRecord } from "@choir/contracts";
import { DataTable, type DataTableColumn } from "@choir/ui";

import { money, type PatronState } from "./types";

const PATRON_COLUMNS: readonly DataTableColumn<PatronRecord>[] = [
  {
    header: "Name",
    id: "name",
    mobileLabel: "Name",
    render: (patron) => patron.name,
    sortValue: (patron) => patron.name,
  },
  {
    header: "Email",
    id: "email",
    mobileLabel: "Email",
    render: (patron) => patron.email,
    sortValue: (patron) => patron.email,
  },
  {
    align: "right",
    header: "Total donated",
    id: "totalDonated",
    mobileLabel: "Total donated",
    render: (patron) => money(patron.totalDonatedCents),
    sortValue: (patron) => patron.totalDonatedCents,
  },
  {
    align: "right",
    header: "Donations",
    id: "donations",
    mobileLabel: "Donations",
    render: (patron) => patron.donationCount,
    sortValue: (patron) => patron.donationCount,
  },
  {
    header: "First",
    id: "first",
    mobileLabel: "First gift",
    render: (patron) => new Date(patron.firstDonatedAt).toLocaleDateString(),
    sortValue: (patron) => patron.firstDonatedAt,
  },
  {
    header: "Latest",
    id: "latest",
    mobileLabel: "Latest gift",
    render: (patron) => new Date(patron.lastDonatedAt).toLocaleDateString(),
    sortValue: (patron) => patron.lastDonatedAt,
  },
];

export function PatronsTab({ patronState }: { readonly patronState: PatronState }) {
  if (patronState.status === "loading") return <p>Loading patrons…</p>;
  if (patronState.status === "error")
    return <p className="notice notice--error">Patrons could not be loaded.</p>;

  return (
    <DataTable
      columns={PATRON_COLUMNS}
      emptyMessage="No patrons recorded yet."
      initialSort={{ columnId: "latest", direction: "desc" }}
      keySelector={(patron) => patron.id}
      rows={patronState.patrons}
    />
  );
}
