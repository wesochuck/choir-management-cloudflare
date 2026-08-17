import { type OrganizationAttendanceRow, type OrganizationEvent } from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";
import { DataTable } from "@choir/ui";
import { listOrganizationEventAttendance } from "../../../auth/api";
import { EventPicker, Status, type LoadState } from "./shared";
import { downloadCsv, reportEvents } from "./reportHelpers";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";
export function RsvpReport({
  events,
  onChange,
  performerLabel,
  selectedId,
}: {
  readonly events: readonly OrganizationEvent[];
  readonly onChange: (id: string) => void;
  readonly performerLabel: string;
  readonly selectedId: string;
}) {
  const { partLabel } = useOrganizationTerminology();
  const [state, setState] = useState<LoadState>("ready");
  const [rows, setRows] = useState<readonly OrganizationAttendanceRow[]>([]);
  const performances = useMemo(() => reportEvents(events), [events]);
  const selected = events.find((event) => event.id === selectedId);
  useEffect(() => {
    if (!selectedId) {
      // Reset the async report when the picker is cleared.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows([]);
      setState("ready");
      return;
    }
    const controller = new AbortController();
    setState("loading");
    listOrganizationEventAttendance(selectedId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setRows(next);
          setState("ready");
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setState("error");
      });
    return () => {
      controller.abort();
    };
  }, [selectedId]);
  const counts = {
    No: rows.filter((row) => row.rsvp === "No").length,
    Pending: rows.filter((row) => row.rsvp === "Pending").length,
    Yes: rows.filter((row) => row.rsvp === "Yes").length,
  };
  return (
    <>
      <div className="reports-toolbar">
        <div>
          <h2>RSVP report</h2>
          <p>See responses and attendance status for a performance.</p>
        </div>
        <button
          className="button button--secondary"
          disabled={!selected || rows.length === 0}
          onClick={() => {
            downloadCsv("rsvp-report.csv", [
              ["Name", performerLabel, "RSVP", "Attendance"],
              ...rows.map((row) => [row.displayName, row.voicePart, row.rsvp, row.attendance]),
            ]);
          }}
          type="button"
        >
          Export CSV
        </button>
      </div>
      <EventPicker events={performances} onChange={onChange} selectedId={selectedId} />
      {!selected ? (
        <Status state="ready" empty="Choose a performance to view RSVP responses." />
      ) : null}
      {selected && state !== "ready" ? <Status state={state} /> : null}
      {selected && state === "ready" ? (
        <>
          <div className="reports-kpi-grid reports-kpi-grid--compact">
            <div className="reports-kpi">
              <strong>{rows.length}</strong>
              <span>Total responses</span>
            </div>
            <div className="reports-kpi">
              <strong>{counts.Yes}</strong>
              <span>Yes</span>
            </div>
            <div className="reports-kpi">
              <strong>{counts.No}</strong>
              <span>No</span>
            </div>
            <div className="reports-kpi">
              <strong>{counts.Pending}</strong>
              <span>Pending</span>
            </div>
          </div>
          {rows.length === 0 ? (
            <Status state="ready" empty="No roster profiles are available for this event." />
          ) : (
            <DataTable
              columns={[
                {
                  header: "Name",
                  id: "name",
                  render: (row) => <strong>{row.displayName}</strong>,
                  sortValue: (row) => row.displayName,
                },
                {
                  header: partLabel,
                  id: "voicePart",
                  render: (row) => row.voicePart || "—",
                  sortValue: (row) => row.voicePart,
                },
                {
                  header: "RSVP",
                  id: "rsvp",
                  render: (row) => (
                    <span className={`status-pill status-pill--${row.rsvp.toLowerCase()}`}>
                      {row.rsvp}
                    </span>
                  ),
                  sortValue: (row) => row.rsvp,
                },
                {
                  header: "Attendance",
                  id: "attendance",
                  render: (row) => row.attendance,
                  sortValue: (row) => row.attendance,
                },
              ]}
              initialSort={{ columnId: "name", direction: "asc" }}
              keySelector={(row) => row.profileId}
              rows={rows}
            />
          )}
        </>
      ) : null}
    </>
  );
}
