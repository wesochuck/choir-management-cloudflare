import {
  donationRecordsResponseSchema,
  type DonationRecord,
  type OrganizationAttendanceRow,
  type OrganizationEvent,
  type OrganizationMusicPiece,
  type OrganizationProfile,
} from "@choir/contracts";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  getOrganizationRosterConfiguration,
  listOrganizationEventAttendance,
  listOrganizationEvents,
  listOrganizationMusic,
  listOrganizationProfiles,
} from "../auth/api";

type ReportTab = "attendance" | "rsvp" | "repertoire" | "roster" | "donations";
type LoadState = "loading" | "ready" | "error";

interface SingerAttendance {
  readonly absences: number;
  readonly name: string;
  readonly present: number;
  readonly profileId: string;
  readonly total: number;
  readonly voicePart: string;
}

const TAB_LABELS: readonly { id: ReportTab; label: string }[] = [
  { id: "attendance", label: "Attendance" },
  { id: "rsvp", label: "RSVP" },
  { id: "repertoire", label: "Repertoire" },
  { id: "roster", label: "Roster" },
  { id: "donations", label: "Donations" },
];

function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(date);
}

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, rows: readonly (readonly (string | number)[])[]): void {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

function reportEvents(events: readonly OrganizationEvent[]): readonly OrganizationEvent[] {
  return events
    .filter((event) => event.type === "Performance" && !event.isCanceled)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

function eventLabel(event: OrganizationEvent): string {
  return `${event.title} · ${formatDate(event.startsAt, true)}`;
}

function aggregateAttendance(
  rowsByRehearsal: readonly (readonly OrganizationAttendanceRow[])[],
): readonly SingerAttendance[] {
  const aggregate = new Map<string, SingerAttendance>();
  for (const rows of rowsByRehearsal) {
    for (const row of rows) {
      const previous = aggregate.get(row.profileId);
      const next: SingerAttendance = previous ?? {
        absences: 0,
        name: row.displayName,
        present: 0,
        profileId: row.profileId,
        total: 0,
        voicePart: row.voicePart,
      };
      aggregate.set(row.profileId, {
        ...next,
        absences: next.absences + (row.attendance === "Absent" ? 1 : 0),
        present: next.present + (row.attendance === "Present" ? 1 : 0),
        total: next.total + 1,
      });
    }
  }
  return [...aggregate.values()].sort(
    (a, b) => b.absences - a.absences || a.name.localeCompare(b.name),
  );
}

function Status({
  state,
  empty = "No records are available.",
}: {
  state: LoadState;
  empty?: string;
}) {
  if (state === "loading") return <p className="empty-state">Loading report…</p>;
  if (state === "error") {
    return <p className="notice notice--error">This report could not be loaded. Try again.</p>;
  }
  return <p className="empty-state">{empty}</p>;
}

function EventPicker({
  events,
  selectedId,
  onChange,
}: {
  readonly events: readonly OrganizationEvent[];
  readonly onChange: (id: string) => void;
  readonly selectedId: string;
}) {
  return (
    <label className="field reports-controls__event">
      <span>Performance</span>
      <select
        onChange={(event) => {
          onChange(event.target.value);
        }}
        value={selectedId}
      >
        <option value="">Choose a performance…</option>
        {events.map((event) => (
          <option key={event.id} value={event.id}>
            {eventLabel(event)}
          </option>
        ))}
      </select>
    </label>
  );
}

function AttendanceReport({
  events,
  selectedId,
}: {
  readonly events: readonly OrganizationEvent[];
  readonly selectedId: string;
}) {
  const [state, setState] = useState<LoadState>("ready");
  const [rows, setRows] = useState<readonly SingerAttendance[]>([]);
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
              ["Name", "Voice part", "Absences", "Present", "Total rehearsals", "Attendance rate"],
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
            <ReportTable headers={["Name", "Voice part", "Absences", "Present", "Attendance rate"]}>
              {rows.map((row) => (
                <tr key={row.profileId}>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td>{row.voicePart || "—"}</td>
                  <td>{row.absences}</td>
                  <td>
                    {row.present} / {row.total}
                  </td>
                  <td>{row.total ? `${((row.present / row.total) * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
            </ReportTable>
          )}
        </>
      ) : null}
    </>
  );
}

function RsvpReport({
  events,
  selectedId,
}: {
  readonly events: readonly OrganizationEvent[];
  readonly selectedId: string;
}) {
  const [state, setState] = useState<LoadState>("ready");
  const [rows, setRows] = useState<readonly OrganizationAttendanceRow[]>([]);
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
              ["Name", "Voice part", "RSVP", "Attendance"],
              ...rows.map((row) => [row.displayName, row.voicePart, row.rsvp, row.attendance]),
            ]);
          }}
          type="button"
        >
          Export CSV
        </button>
      </div>
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
            <ReportTable headers={["Name", "Voice part", "RSVP", "Attendance"]}>
              {rows.map((row) => (
                <tr key={row.profileId}>
                  <td>
                    <strong>{row.displayName}</strong>
                  </td>
                  <td>{row.voicePart || "—"}</td>
                  <td>
                    <span className={`status-pill status-pill--${row.rsvp.toLowerCase()}`}>
                      {row.rsvp}
                    </span>
                  </td>
                  <td>{row.attendance}</td>
                </tr>
              ))}
            </ReportTable>
          )}
        </>
      ) : null}
    </>
  );
}

function RepertoireReport({ pieces }: { readonly pieces: readonly OrganizationMusicPiece[] }) {
  const [query, setQuery] = useState("");
  const filtered = pieces.filter((piece) =>
    `${piece.title} ${piece.composer} ${piece.arranger}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <div className="reports-toolbar">
        <div>
          <h2>Repertoire history</h2>
          <p>See how often each library piece has been performed.</p>
        </div>
        <button
          className="button button--secondary"
          disabled={!filtered.length}
          onClick={() => {
            downloadCsv("repertoire-report.csv", [
              ["Title", "Composer", "Arranger", "Performances", "Last performed"],
              ...filtered.map((piece) => [
                piece.title,
                piece.composer || "",
                piece.arranger || "",
                piece.performanceCount,
                formatDate(piece.lastPerformedAt),
              ]),
            ]);
          }}
          type="button"
        >
          Export CSV
        </button>
      </div>
      <label className="field reports-search">
        <span>Search repertoire</span>
        <input
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Title, composer, or arranger"
          value={query}
        />
      </label>
      {filtered.length === 0 ? (
        <Status
          state="ready"
          empty={pieces.length ? "No pieces match this search." : "No music pieces are available."}
        />
      ) : (
        <ReportTable
          headers={["Title", "Composer / arranger", "Performances", "Last performed", "Duration"]}
        >
          {filtered.map((piece) => (
            <tr key={piece.id}>
              <td>
                <strong>{piece.title}</strong>
              </td>
              <td>{[piece.composer, piece.arranger].filter(Boolean).join(" / ") || "—"}</td>
              <td>{piece.performanceCount}</td>
              <td>{formatDate(piece.lastPerformedAt)}</td>
              <td>
                {piece.durationSeconds === null
                  ? "—"
                  : `${String(Math.floor(piece.durationSeconds / 60))}:${String(piece.durationSeconds % 60).padStart(2, "0")}`}
              </td>
            </tr>
          ))}
        </ReportTable>
      )}
    </>
  );
}

function RosterReport({
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
        <ReportTable headers={["Name", performerLabel, "Status", "Phone", "Directory"]}>
          {filtered.map((profile) => (
            <tr key={profile.id}>
              <td>
                <strong>{profile.displayName}</strong>
              </td>
              <td>{profile.voicePart || "—"}</td>
              <td>{profile.globalStatus}</td>
              <td>{profile.phone || "—"}</td>
              <td>{profile.showInDirectory ? "Shown" : "Hidden"}</td>
            </tr>
          ))}
        </ReportTable>
      )}
    </>
  );
}

function DonationsReport({
  donations,
  state,
}: {
  readonly donations: readonly DonationRecord[];
  readonly state: LoadState;
}) {
  const total = donations.reduce((sum, donation) => sum + donation.amountCents, 0);
  const fees = donations.reduce((sum, donation) => sum + donation.feeCents, 0);
  return (
    <>
      <div className="reports-toolbar">
        <div>
          <h2>Donation report</h2>
          <p>Review donation history, processing fees, and tribute details.</p>
        </div>
        <button
          className="button button--secondary"
          disabled={!donations.length}
          onClick={() => {
            downloadCsv("donation-report.csv", [
              ["Donor", "Email", "Amount", "Processing fee", "Status", "Date", "Tribute"],
              ...donations.map((donation) => [
                donation.anonymous ? "Anonymous" : donation.buyerName,
                donation.anonymous ? "" : donation.buyerEmail,
                money(donation.amountCents),
                money(donation.feeCents),
                donation.status,
                donation.createdAt,
                donation.tributeName || "",
              ]),
            ]);
          }}
          type="button"
        >
          Export CSV
        </button>
      </div>
      {state !== "ready" ? (
        <Status state={state} />
      ) : donations.length === 0 ? (
        <Status state="ready" empty="No donations have been recorded." />
      ) : (
        <>
          <div className="reports-kpi-grid reports-kpi-grid--compact">
            <div className="reports-kpi">
              <strong>{donations.length}</strong>
              <span>Donations</span>
            </div>
            <div className="reports-kpi">
              <strong>{money(total)}</strong>
              <span>Total received</span>
            </div>
            <div className="reports-kpi">
              <strong>{money(fees)}</strong>
              <span>Processing fees</span>
            </div>
          </div>
          <ReportTable headers={["Donor", "Amount", "Fee", "Status", "Date", "Tribute"]}>
            {donations.map((donation) => (
              <tr key={donation.id}>
                <td>
                  <strong>{donation.anonymous ? "Anonymous" : donation.buyerName}</strong>
                  <br />
                  <small>{donation.anonymous ? "" : donation.buyerEmail}</small>
                </td>
                <td>{money(donation.amountCents)}</td>
                <td>{donation.feeCents ? money(donation.feeCents) : "Covered"}</td>
                <td>{donation.status}</td>
                <td>{formatDate(donation.createdAt, true)}</td>
                <td>{donation.tributeName || "—"}</td>
              </tr>
            ))}
          </ReportTable>
        </>
      )}
    </>
  );
}

function ReportTable({
  children,
  headers,
}: {
  readonly children: ReactNode;
  readonly headers: readonly string[];
}) {
  return (
    <div className="table-scroll">
      <table className="data-table table--actions">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function ReportsView({ enabled }: { readonly enabled: boolean }) {
  const [tab, setTab] = useState<ReportTab>("attendance");
  const [state, setState] = useState<LoadState>(enabled ? "loading" : "ready");
  const [events, setEvents] = useState<readonly OrganizationEvent[]>([]);
  const [profiles, setProfiles] = useState<readonly OrganizationProfile[]>([]);
  const [pieces, setPieces] = useState<readonly OrganizationMusicPiece[]>([]);
  const [performerLabel, setPerformerLabel] = useState("Performer");
  const [selectedPerformanceId, setSelectedPerformanceId] = useState("");
  const [donations, setDonations] = useState<readonly DonationRecord[]>([]);
  const [donationState, setDonationState] = useState<LoadState>("ready");
  const performances = useMemo(() => reportEvents(events), [events]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationEvents(controller.signal),
      listOrganizationProfiles(controller.signal),
      listOrganizationMusic(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
    ])
      .then(([nextEvents, nextProfiles, nextPieces, configuration]) => {
        if (controller.signal.aborted) return;
        setEvents(nextEvents);
        setProfiles(nextProfiles);
        setPieces(nextPieces);
        setPerformerLabel(configuration.performerLabel);
        const nextPerformances = reportEvents(nextEvents);
        const now = Date.now();
        const nearest =
          nextPerformances.find((event) => new Date(event.startsAt).getTime() >= now) ??
          nextPerformances.at(-1);
        setSelectedPerformanceId(nearest?.id ?? "");
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setState("error");
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || tab !== "donations") return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDonationState("loading");
    fetch("/api/organization/donations", { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("donations_request_failed");
        const parsed = donationRecordsResponseSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setDonations(parsed.donations);
          setDonationState("ready");
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setDonationState("error");
      });
    return () => {
      controller.abort();
    };
  }, [enabled, tab]);

  if (!enabled)
    return <p className="notice notice--warning">Verify Organization MFA to view reports.</p>;
  if (state === "loading") return <p className="empty-state">Loading reports…</p>;
  if (state === "error")
    return <p className="notice notice--error">Reports could not be loaded. Try again.</p>;
  return (
    <section className="reports-view" aria-label="Reports and insights">
      <div className="reports-intro">
        <div>
          <p className="eyebrow">Insights & settings</p>
          <h2>Reports</h2>
          <p>Review attendance, RSVPs, repertoire, roster, and giving activity.</p>
        </div>
      </div>
      <nav className="ticketing-tabs reports-tabs" aria-label="Report types" role="tablist">
        {TAB_LABELS.map((item) => (
          <button
            aria-selected={tab === item.id}
            className={tab === item.id ? "is-active" : undefined}
            key={item.id}
            onClick={() => {
              setTab(item.id);
            }}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>
      <section className="panel reports-panel" role="tabpanel">
        {(tab === "attendance" || tab === "rsvp") && (
          <EventPicker
            events={performances}
            onChange={setSelectedPerformanceId}
            selectedId={selectedPerformanceId}
          />
        )}
        {tab === "attendance" ? (
          <AttendanceReport events={events} selectedId={selectedPerformanceId} />
        ) : null}
        {tab === "rsvp" ? <RsvpReport events={events} selectedId={selectedPerformanceId} /> : null}
        {tab === "repertoire" ? <RepertoireReport pieces={pieces} /> : null}
        {tab === "roster" ? (
          <RosterReport performerLabel={performerLabel} profiles={profiles} />
        ) : null}
        {tab === "donations" ? (
          <DonationsReport donations={donations} state={donationState} />
        ) : null}
      </section>
    </section>
  );
}
