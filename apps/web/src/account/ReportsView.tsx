import {
  type DonationRecord,
  type OrganizationEvent,
  type OrganizationMusicPiece,
  type OrganizationProfile,
  type OrganizationTicketOrder,
} from "@choir/contracts";
import { useEffect, useState } from "react";

import { useConfirmation } from "@choir/ui";

import {
  getOrganizationRosterConfiguration,
  listOrganizationDonations,
  listOrganizationEvents,
  listOrganizationMusic,
  listOrganizationProfiles,
  listOrganizationTicketOrders,
} from "../auth/api";
import { CommerceReport } from "./components/Reports/CommerceReport";
import { AttendanceReport } from "./components/Reports/AttendanceReport";
import { RepertoireReport } from "./components/Reports/RepertoireReport";
import { RosterReport } from "./components/Reports/RosterReport";
import { RsvpReport } from "./components/Reports/RsvpReport";
import { type LoadState, type ReportTab } from "./components/Reports/shared";
import { reportEvents, TAB_LABELS } from "./components/Reports/reportHelpers";
import { MusicFolderReport } from "./components/MusicFolderReport/view";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";

export function ReportsView({ enabled }: { readonly enabled: boolean }) {
  const [tab, setTab] = useState<ReportTab>("attendance");
  const [state, setState] = useState<LoadState>(enabled ? "loading" : "ready");
  const [events, setEvents] = useState<readonly OrganizationEvent[]>([]);
  const [profiles, setProfiles] = useState<readonly OrganizationProfile[]>([]);
  const [pieces, setPieces] = useState<readonly OrganizationMusicPiece[]>([]);
  const [performerLabel, setPerformerLabel] = useState("Performer");
  const [selectedPerformanceId, setSelectedPerformanceId] = useState("");
  const [donations, setDonations] = useState<readonly DonationRecord[]>([]);
  const [ticketOrders, setTicketOrders] = useState<readonly OrganizationTicketOrder[]>([]);
  const [commerceState, setCommerceState] = useState<LoadState>("ready");
  const [musicFolderUnsaved, setMusicFolderUnsaved] = useState(false);
  const { confirm, confirmationDialog } = useConfirmation();

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
    if (!enabled || tab !== "donations-tickets") return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCommerceState("loading");
    Promise.all([
      listOrganizationDonations(controller.signal),
      listOrganizationTicketOrders(controller.signal),
    ])
      .then(([nextDonations, nextTicketOrders]) => {
        if (controller.signal.aborted) return;
        setDonations(nextDonations);
        setTicketOrders(nextTicketOrders);
        setCommerceState("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setCommerceState("error");
      });
    return () => {
      controller.abort();
    };
  }, [enabled, tab]);

  if (!enabled) {
    return <OrganizationMfaPrompt message="Verify Organization MFA to view reports." />;
  }
  if (state === "loading") return <p className="empty-state">Loading reports…</p>;
  if (state === "error")
    return <p className="notice notice--error">Reports could not be loaded. Try again.</p>;
  function selectReportTab(nextTab: ReportTab): void {
    if (tab === "music-folders" && musicFolderUnsaved) {
      void confirm({
        confirmLabel: "Change report",
        description: "Your unsaved Folder Number changes will be discarded.",
        destructive: true,
        title: "Discard Folder Number changes?",
      }).then((shouldChange) => {
        if (shouldChange) setTab(nextTab);
      });
      return;
    }
    setTab(nextTab);
  }
  return (
    <section className="reports-view" aria-label="Reports and insights">
      <nav className="ticketing-tabs reports-tabs" aria-label="Report types" role="tablist">
        {TAB_LABELS.map((item) => (
          <button
            aria-controls={`report-${item.id}-panel`}
            aria-selected={tab === item.id}
            className={tab === item.id ? "is-active" : undefined}
            id={`report-${item.id}-tab`}
            key={item.id}
            onClick={() => {
              selectReportTab(item.id);
            }}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>
      <section
        aria-labelledby={`report-${tab}-tab`}
        className="panel reports-panel"
        id={`report-${tab}-panel`}
        role="tabpanel"
      >
        {tab === "attendance" ? (
          <AttendanceReport
            events={events}
            onChange={setSelectedPerformanceId}
            performerLabel={performerLabel}
            selectedId={selectedPerformanceId}
          />
        ) : null}
        {tab === "rsvp" ? (
          <RsvpReport
            events={events}
            onChange={setSelectedPerformanceId}
            performerLabel={performerLabel}
            selectedId={selectedPerformanceId}
          />
        ) : null}
        {tab === "repertoire" ? <RepertoireReport pieces={pieces} /> : null}
        {tab === "roster" ? (
          <RosterReport performerLabel={performerLabel} profiles={profiles} />
        ) : null}
        {tab === "donations-tickets" ? (
          <CommerceReport donations={donations} state={commerceState} ticketOrders={ticketOrders} />
        ) : null}
        {tab === "music-folders" ? (
          <MusicFolderReport enabled={enabled} onUnsavedChange={setMusicFolderUnsaved} />
        ) : null}
      </section>
      {confirmationDialog}
    </section>
  );
}
