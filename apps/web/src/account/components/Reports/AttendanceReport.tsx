import { type OrganizationEvent } from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";
import { DataTable } from "@choir/ui";
import { listOrganizationEventAttendance } from "../../../auth/api";
import { EventPicker, Status, type LoadState, type SingerAttendance } from "./shared";
import { aggregateAttendance, downloadCsv, reportEvents } from "./reportHelpers";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";
export function AttendanceReport({
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
  const [rows, setRows] = useState<readonly SingerAttendance[]>([]);
  const performances = useMemo(() => reportEvents(events), [events]);
  const selected = events.find((event) => event.id === selectedId);
  const rehearsals = useMemo(
    () =>
      events
        .filter(
          (event) =>
            event.type === "Rehearsal" &&
            event.parentPerformanceId === selectedId &&
            !event.isCanceled,
        )
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [events, selectedId],
  );

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
    Promise.all(
      rehearsals.map((event) => listOrganizationEventAttendance(event.id, controller.signal)),
    )
      .then((attendance) => {
        if (!controller.signal.aborted) {
          setRows(aggregateAttendance(attendance));
          setState("ready");
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setState("error");
      });
    return () => {
      controller.abort();
    };
  }, [rehearsals, selectedId]);

  const average = rows.length
    ? rows.reduce((sum, row) => sum + (row.total ? (row.present / row.total) * 100 : 0), 0) /
      rows.length
    : 0;
  return (
    <>
      <div className="reports-toolbar">
        <div>
          <h2>Attendance report</h2>
          <p>Review rehearsal attendance leading up to a performance.</p>
        </div>
        <button
          className="button button--secondary"
          disabled={!selected || rows.length === 0}
          onClick={() => {
            downloadCsv("attendance-report.csv", [
              [
                "Name",
                performerLabel,
                "Absences",
                "Present",
                "Total rehearsals",
                "Attendance rate",
              ],
              ...rows.map((row) => [
                row.name,
                row.voicePart,
                row.absences,
                row.present,
                row.total,
                `${row.total ? ((row.present / row.total) * 100).toFixed(1) : "0.0"}%`,
              ]),
            ]);
          }}
          type="button"
        >
          Export CSV
        </button>
      </div>
      <EventPicker events={performances} onChange={onChange} selectedId={selectedId} />
      {!selected ? <Status state="ready" empty="Choose a performance to view attendance." /> : null}
      {selected ? (
        <>
          <div className="reports-kpi-grid" aria-label="Attendance summary">
            <div className="reports-kpi">
              <strong>{rehearsals.length}</strong>
              <span>Rehearsals</span>
            </div>
            <div className="reports-kpi">
              <strong>{average.toFixed(1)}%</strong>
              <span>Average attendance</span>
            </div>
            <div className="reports-kpi">
              <strong>{rows.length}</strong>
              <span>Profiles tracked</span>
            </div>
            <div className="reports-kpi">
              <strong>{rows.filter((row) => row.absences >= 2).length}</strong>
              <span>2+ absences</span>
            </div>
          </div>
          {rehearsals.length === 0 ? (
            <Status state="ready" empty="No rehearsals are linked to this performance." />
          ) : state !== "ready" ? (
            <Status state={state} />
          ) : rows.length === 0 ? (
            <Status state="ready" empty="No attendance has been recorded for these rehearsals." />
          ) : (
            <DataTable
              columns={[
                {
                  header: "Name",
                  id: "name",
                  render: (row) => <strong>{row.name}</strong>,
                  sortValue: (row) => row.name,
                },
                {
                  header: partLabel,
                  id: "voicePart",
                  render: (row) => row.voicePart || "—",
                  sortValue: (row) => row.voicePart,
                },
                {
                  header: "Absences",
                  id: "absences",
                  render: (row) => row.absences,
                  sortValue: (row) => row.absences,
                },
                {
                  header: "Present",
                  id: "present",
                  render: (row) => `${String(row.present)} / ${String(row.total)}`,
                  sortValue: (row) => row.present,
                },
                {
                  header: "Attendance rate",
                  id: "attendanceRate",
                  render: (row) =>
                    row.total ? `${((row.present / row.total) * 100).toFixed(1)}%` : "—",
                  sortValue: (row) => (row.total ? row.present / row.total : null),
                },
              ]}
              initialSort={{ columnId: "absences", direction: "desc" }}
              keySelector={(row) => row.profileId}
              rows={rows}
            />
          )}
        </>
      ) : null}
    </>
  );
}
