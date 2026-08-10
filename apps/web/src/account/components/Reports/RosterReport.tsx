import { type OrganizationProfile } from "@choir/contracts";
import { useState } from "react";
import { DataTable } from "@choir/ui";
import { Status } from "./shared";
import { downloadCsv } from "./reportHelpers";
export function RosterReport({
  profiles,
  performerLabel,
}: {
  readonly performerLabel: string;
  readonly profiles: readonly OrganizationProfile[];
}) {
  const [query, setQuery] = useState("");
  const filtered = profiles.filter((profile) =>
    `${profile.displayName} ${profile.voicePart} ${profile.globalStatus}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <div className="reports-toolbar">
        <div>
          <h2>Roster export</h2>
          <p>Review the current roster and profile status.</p>
        </div>
        <button
          className="button button--secondary"
          disabled={!filtered.length}
          onClick={() => {
            downloadCsv("roster-report.csv", [
              ["Name", performerLabel, "Status", "Phone", "Directory"],
              ...filtered.map((profile) => [
                profile.displayName,
                profile.voicePart,
                profile.globalStatus,
                profile.phone,
                profile.showInDirectory ? "Shown" : "Hidden",
              ]),
            ]);
          }}
          type="button"
        >
          Export CSV
        </button>
      </div>
      <label className="field reports-search">
        <span>Search roster</span>
        <input
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Name, part, or status"
          value={query}
        />
      </label>
      {filtered.length === 0 ? (
        <Status
          state="ready"
          empty={
            profiles.length ? "No profiles match this search." : "No roster profiles are available."
          }
        />
      ) : (
        <DataTable
          columns={[
            {
              header: "Name",
              id: "name",
              render: (profile) => <strong>{profile.displayName}</strong>,
              sortValue: (profile) => profile.displayName,
            },
            {
              header: performerLabel,
              id: "voicePart",
              render: (profile) => profile.voicePart || "—",
              sortValue: (profile) => profile.voicePart,
            },
            {
              header: "Status",
              id: "status",
              render: (profile) => profile.globalStatus,
              sortValue: (profile) => profile.globalStatus,
            },
            {
              header: "Phone",
              id: "phone",
              render: (profile) => profile.phone || "—",
              sortValue: (profile) => profile.phone,
            },
            {
              header: "Directory",
              id: "directory",
              render: (profile) => (profile.showInDirectory ? "Shown" : "Hidden"),
              sortValue: (profile) => profile.showInDirectory,
            },
          ]}
          initialSort={{ columnId: "name", direction: "asc" }}
          keySelector={(profile) => profile.id}
          rows={filtered}
        />
      )}
    </>
  );
}
