import { clearSeatAssignment, moveAssignment } from "@choir/domain";
import { Dialog } from "@choir/ui";
import type {
  OrganizationEvent,
  OrganizationProfile,
  OrganizationProfileRequest,
  OrganizationRosterConfiguration,
  OrganizationSeatingChart,
  OrganizationSeatingChartRequest,
} from "@choir/contracts";
import type { Dispatch, SetStateAction } from "react";
import { setOrganizationEventRsvp } from "../../../auth/api";
import { ConfirmDialog } from "./shared";
import type { ConfirmState } from "./types";
import { groupSeatAssignmentProfiles, seatingRowSummary, statusLabel } from "./utils";

interface ChartDialogProps {
  readonly changeNewChartRowCount: (value: number) => void;
  readonly changeNewChartSingerCount: (value: number) => void;
  readonly chartDialog: "create" | "rename" | null;
  readonly chartName: string;
  readonly createChart: () => void;
  readonly newChartRowCount: number;
  readonly newChartSingerCount: number;
  readonly renameChart: () => void;
  readonly rsvpYesCount: number;
  readonly setChartDialog: (dialog: "create" | "rename" | null) => void;
  readonly setChartName: (name: string) => void;
}

function ChartDialog({
  changeNewChartRowCount,
  changeNewChartSingerCount,
  chartDialog,
  chartName,
  createChart,
  newChartRowCount,
  newChartSingerCount,
  renameChart,
  rsvpYesCount,
  setChartDialog,
  setChartName,
}: ChartDialogProps) {
  const createLayoutIsValid =
    newChartSingerCount > 0 && newChartRowCount > 0 && newChartRowCount <= newChartSingerCount;
  const maxNewChartRows = Math.max(1, Math.min(50, newChartSingerCount));

  return (
    <Dialog
      description={
        chartDialog === "rename"
          ? "Use a short name that identifies this seating arrangement."
          : "Name the chart and set the singers and rows for its initial layout."
      }
      onClose={() => {
        setChartDialog(null);
      }}
      open={chartDialog !== null}
      title={chartDialog === "rename" ? "Rename seating chart" : "New seating chart"}
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (chartDialog === "rename") {
            renameChart();
          } else {
            createChart();
          }
        }}
      >
        <label className="field">
          Chart name
          <input
            autoFocus
            maxLength={200}
            onChange={(event) => {
              setChartName(event.target.value);
            }}
            required
            value={chartName}
          />
        </label>
        {chartDialog === "create" ? (
          <>
            <div className="form-grid seating-chart-create-fields">
              <label className="field">
                Singers to place
                <input
                  aria-describedby="seating-chart-rsvp-help"
                  max={4_000}
                  min={0}
                  onChange={(event) => {
                    changeNewChartSingerCount(event.target.valueAsNumber);
                  }}
                  type="number"
                  value={newChartSingerCount}
                />
              </label>
              <label className="field">
                Rows
                <input
                  max={maxNewChartRows}
                  min={1}
                  onChange={(event) => {
                    changeNewChartRowCount(event.target.valueAsNumber);
                  }}
                  type="number"
                  value={newChartRowCount}
                />
              </label>
            </div>
            <p className="field-help" id="seating-chart-rsvp-help">
              {rsvpYesCount === 0
                ? "No singers have RSVP’d Yes yet. You can still set the number to place."
                : `${String(rsvpYesCount)} singer${rsvpYesCount === 1 ? " has" : "s have"} RSVP’d Yes for this Performance; this is the default.`}
            </p>
            <p aria-live="polite" className="seating-chart-layout-preview" role="status">
              {seatingRowSummary(newChartSingerCount, newChartRowCount)}
            </p>
          </>
        ) : null}
        <div className="form-actions">
          <button
            className="button button--secondary"
            onClick={() => {
              setChartDialog(null);
            }}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={chartDialog === "create" && !createLayoutIsValid}
            type="submit"
          >
            {chartDialog === "rename" ? "Save name" : "Create chart"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface CopyChartDialogProps {
  readonly copyBusy: boolean;
  readonly copyChartId: string;
  readonly copyCharts: readonly OrganizationSeatingChart[];
  readonly copyOpen: boolean;
  readonly copyPerformanceId: string;
  readonly copySelectedChart: () => void;
  readonly eventId: string;
  readonly events: readonly OrganizationEvent[];
  readonly loadCopyCharts: (performanceId: string) => void;
  readonly setCopyChartId: (id: string) => void;
  readonly setCopyOpen: (open: boolean) => void;
}

function CopyChartDialog({
  copyBusy,
  copyChartId,
  copyCharts,
  copyOpen,
  copyPerformanceId,
  copySelectedChart,
  eventId,
  events,
  loadCopyCharts,
  setCopyChartId,
  setCopyOpen,
}: CopyChartDialogProps) {
  return (
    <Dialog
      description="Copy layout and eligible assignments from another Performance using the same Venue."
      onClose={() => {
        setCopyOpen(false);
      }}
      open={copyOpen}
      title="Copy seating chart"
    >
      <div className="form-stack">
        <label className="field">
          Source Performance
          <select
            onChange={(event) => {
              loadCopyCharts(event.target.value);
            }}
            value={copyPerformanceId}
          >
            <option value="">Choose a Performance</option>
            {events
              .filter(({ id }) => id !== eventId)
              .map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Source chart
          <select
            disabled={copyBusy || !copyPerformanceId}
            onChange={(event) => {
              setCopyChartId(event.target.value);
            }}
            value={copyChartId}
          >
            <option value="">Choose a chart</option>
            {copyCharts.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        {copyBusy ? <p role="status">Loading source charts…</p> : null}
        {!copyBusy && copyPerformanceId && copyCharts.length === 0 ? (
          <p className="empty-state">No charts use this Venue.</p>
        ) : null}
        <div className="form-actions">
          <button
            className="button button--secondary"
            onClick={() => {
              setCopyOpen(false);
            }}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={!copyChartId}
            onClick={copySelectedChart}
            type="button"
          >
            Copy chart
          </button>
        </div>
      </div>
    </Dialog>
  );
}

interface AddProfileDialogProps {
  readonly partLabel: string;
  readonly profileBusy: boolean;
  readonly profileDialog: "add" | "lookup" | null;
  readonly profileForm: OrganizationProfileRequest;
  readonly profileMessage: string | null;
  readonly roster: OrganizationRosterConfiguration;
  readonly saveProfile: () => void;
  readonly setProfileDialog: (dialog: "add" | "lookup" | null) => void;
  readonly setProfileForm: Dispatch<SetStateAction<OrganizationProfileRequest>>;
}

function AddProfileDialog({
  partLabel,
  profileBusy,
  profileDialog,
  profileForm,
  profileMessage,
  roster,
  saveProfile,
  setProfileDialog,
  setProfileForm,
}: AddProfileDialogProps) {
  return (
    <Dialog
      description="Add an eligible Profile to this Performance."
      onClose={() => {
        setProfileDialog(null);
      }}
      open={profileDialog === "add"}
      title="Add Profile"
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          saveProfile();
        }}
      >
        {profileMessage ? (
          <p className="notice notice--error" role="alert">
            {profileMessage}
          </p>
        ) : null}
        <label className="field">
          Display name
          <input
            autoFocus
            maxLength={200}
            onChange={(event) => {
              setProfileForm((current) => ({ ...current, displayName: event.target.value }));
            }}
            required
            value={profileForm.displayName}
          />
        </label>
        <label className="field">
          {partLabel}
          <select
            onChange={(event) => {
              setProfileForm((current) => ({ ...current, voicePart: event.target.value }));
            }}
            required
            value={profileForm.voicePart}
          >
            <option value="">Choose {partLabel.toLowerCase()}</option>
            {roster.voiceParts.map(({ fullName, label }) => (
              <option key={label} value={label}>
                {fullName} ({label})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Status
          <select
            onChange={(event) => {
              setProfileForm((current) => ({
                ...current,
                globalStatus:
                  event.target.value === "Idle" || event.target.value === "Inactive"
                    ? event.target.value
                    : "Active",
              }));
            }}
            value={profileForm.globalStatus}
          >
            <option value="Active">Active</option>
            <option value="Idle">On Break</option>
            <option value="Inactive">Inactive</option>
          </select>
        </label>
        <div className="form-actions">
          <button
            className="button button--secondary"
            onClick={() => {
              setProfileDialog(null);
            }}
            type="button"
          >
            Cancel
          </button>
          <button className="button button--primary" disabled={profileBusy} type="submit">
            {profileBusy ? "Adding…" : "Add and mark attending"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface ProfileLookupDialogProps {
  readonly eventId: string;
  readonly lookupProfiles: readonly OrganizationProfile[];
  readonly lookupQuery: string;
  readonly partLabel: string;
  readonly profileDialog: "add" | "lookup" | null;
  readonly setAttendance: Dispatch<
    SetStateAction<
      readonly { readonly profileId: string; readonly rsvp: "No" | "Pending" | "Yes" }[]
    >
  >;
  readonly setLookupQuery: (query: string) => void;
  readonly setProfileDialog: (dialog: "add" | "lookup" | null) => void;
}

function ProfileLookupDialog({
  eventId,
  lookupProfiles,
  lookupQuery,
  partLabel,
  profileDialog,
  setAttendance,
  setLookupQuery,
  setProfileDialog,
}: ProfileLookupDialogProps) {
  return (
    <Dialog
      description="Choose an existing Organization Profile to mark attending for this Performance."
      onClose={() => {
        setProfileDialog(null);
      }}
      open={profileDialog === "lookup"}
      title="Profile lookup"
    >
      <div className="form-stack">
        <label className="field">
          Search Profiles
          <input
            autoFocus
            onChange={(event) => {
              setLookupQuery(event.target.value);
            }}
            placeholder={`Name or ${partLabel.toLowerCase()}`}
            type="search"
            value={lookupQuery}
          />
        </label>
        <div className="seating-lookup-list">
          {lookupProfiles
            .filter((profile) => {
              const normalized = lookupQuery.trim().toLocaleLowerCase();
              return (
                !normalized ||
                `${profile.displayName} ${profile.voicePart}`
                  .toLocaleLowerCase()
                  .includes(normalized)
              );
            })
            .map((profile) => (
              <button
                className="seating-lookup-row"
                key={profile.id}
                onClick={() => {
                  void setOrganizationEventRsvp(eventId, profile.id, "Yes").then(() => {
                    setAttendance((current) => [
                      ...current.filter(({ profileId }) => profileId !== profile.id),
                      { profileId: profile.id, rsvp: "Yes" },
                    ]);
                    setProfileDialog(null);
                  });
                }}
                type="button"
              >
                <strong>{profile.displayName}</strong>
                <span>{profile.voicePart || `No ${partLabel.toLowerCase()}`}</span>
                <em>{statusLabel(profile.globalStatus)}</em>
              </button>
            ))}
        </div>
      </div>
    </Dialog>
  );
}

interface SeatDetailDialogProps {
  readonly applyChart: (chart: OrganizationSeatingChartRequest) => void;
  readonly chart: OrganizationSeatingChartRequest;
  readonly eligibleProfiles: readonly OrganizationProfile[];
  readonly isVoicePartLayout: boolean;
  readonly partLabel: string;
  readonly profilesById: Map<string, OrganizationProfile>;
  readonly requestRemoveSeat: (rowIndex: number, seatIndex: number) => void;
  readonly roster: OrganizationRosterConfiguration;
  readonly selectedSeat: string | null;
  readonly setSelectedSeat: (seatKey: string | null) => void;
}

function SeatDetailDialog({
  applyChart,
  chart,
  eligibleProfiles,
  isVoicePartLayout,
  partLabel,
  profilesById,
  requestRemoveSeat,
  roster,
  selectedSeat,
  setSelectedSeat,
}: SeatDetailDialogProps) {
  if (!selectedSeat) return null;
  const [rowText, seatText] = selectedSeat.split("-");
  const rowIndex = Number(rowText);
  const seatIndex = Number(seatText);
  const assignedProfileId = chart.assignments[selectedSeat];
  const canDeleteSeat = !assignedProfileId && (chart.rowCounts[rowIndex] ?? 0) > 1;
  const suggestion = chart.sectionSuggestions[selectedSeat];
  const groups = groupSeatAssignmentProfiles(
    eligibleProfiles,
    suggestion,
    isVoicePartLayout,
    roster,
  );

  return (
    <Dialog
      description="Assign an eligible Profile, unassign the current Profile, or delete an empty seat."
      onClose={() => {
        setSelectedSeat(null);
      }}
      open
      title={`Seat ${String(seatIndex + 1)}`}
    >
      <div className="form-stack">
        <p>
          {assignedProfileId
            ? `Assigned to ${profilesById.get(assignedProfileId)?.displayName ?? "Profile"}.`
            : "This seat is empty."}
        </p>
        {suggestion ? (
          <p className="seating-assignment-picker__hint">
            Candidates matching {suggestion} are shown first, followed by the other sections in
            roster order. Names are sorted by surname.
          </p>
        ) : null}
        <div className="seating-assignment-picker">
          {groups.map((group) => (
            <section className="seating-assignment-group" key={group.key}>
              <h3 className="seating-assignment-group__heading">{group.label}</h3>
              {group.profiles.map((profile) => (
                <button
                  className="seating-lookup-row"
                  key={profile.id}
                  onClick={() => {
                    applyChart({
                      ...chart,
                      assignments: moveAssignment(chart.assignments, "", selectedSeat, profile.id),
                    });
                    setSelectedSeat(null);
                  }}
                  type="button"
                >
                  <strong>{profile.displayName}</strong>
                  <span>{profile.voicePart || `No ${partLabel.toLowerCase()}`}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
        <div className="form-actions">
          <button
            className="button button--secondary"
            onClick={() => {
              setSelectedSeat(null);
            }}
            type="button"
          >
            Cancel
          </button>
          {assignedProfileId ? (
            <button
              className="button button--secondary"
              onClick={() => {
                const nextLayout = clearSeatAssignment(
                  {
                    assignments: chart.assignments,
                    rowCounts: chart.rowCounts,
                    sectionSuggestions: chart.sectionSuggestions,
                  },
                  rowIndex,
                  seatIndex,
                );
                applyChart({ ...chart, assignments: nextLayout.assignments });
                setSelectedSeat(null);
              }}
              type="button"
            >
              Unassign
            </button>
          ) : null}
          {canDeleteSeat ? (
            <button
              className="button button--danger"
              onClick={() => {
                setSelectedSeat(null);
                requestRemoveSeat(rowIndex, seatIndex);
              }}
              type="button"
            >
              Delete seat
            </button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

export interface SeatingDialogsProps {
  readonly applyChart: (chart: OrganizationSeatingChartRequest) => void;
  readonly changeNewChartRowCount: (value: number) => void;
  readonly changeNewChartSingerCount: (value: number) => void;
  readonly chart: OrganizationSeatingChartRequest;
  readonly chartDialog: "create" | "rename" | null;
  readonly chartName: string;
  readonly confirmState: ConfirmState | null;
  readonly copyBusy: boolean;
  readonly copyChartId: string;
  readonly copyCharts: readonly OrganizationSeatingChart[];
  readonly copyOpen: boolean;
  readonly copyPerformanceId: string;
  readonly copySelectedChart: () => void;
  readonly createChart: () => void;
  readonly eligibleProfiles: readonly OrganizationProfile[];
  readonly eventId: string;
  readonly events: readonly OrganizationEvent[];
  readonly isVoicePartLayout: boolean;
  readonly loadCopyCharts: (performanceId: string) => void;
  readonly lookupProfiles: readonly OrganizationProfile[];
  readonly lookupQuery: string;
  readonly newChartRowCount: number;
  readonly newChartSingerCount: number;
  readonly partLabel: string;
  readonly profileBusy: boolean;
  readonly profileDialog: "add" | "lookup" | null;
  readonly profileForm: OrganizationProfileRequest;
  readonly profileMessage: string | null;
  readonly profilesById: Map<string, OrganizationProfile>;
  readonly renameChart: () => void;
  readonly requestRemoveSeat: (rowIndex: number, seatIndex: number) => void;
  readonly roster: OrganizationRosterConfiguration;
  readonly rsvpYesCount: number;
  readonly saveProfile: () => void;
  readonly selectedSeat: string | null;
  readonly setAttendance: Dispatch<
    SetStateAction<
      readonly { readonly profileId: string; readonly rsvp: "No" | "Pending" | "Yes" }[]
    >
  >;
  readonly setChartDialog: (dialog: "create" | "rename" | null) => void;
  readonly setChartName: (name: string) => void;
  readonly setConfirmState: (state: ConfirmState | null) => void;
  readonly setCopyChartId: (id: string) => void;
  readonly setCopyOpen: (open: boolean) => void;
  readonly setLookupQuery: (query: string) => void;
  readonly setProfileDialog: (dialog: "add" | "lookup" | null) => void;
  readonly setProfileForm: Dispatch<SetStateAction<OrganizationProfileRequest>>;
  readonly setSelectedSeat: (seatKey: string | null) => void;
}

export function SeatingDialogs({
  applyChart,
  changeNewChartRowCount,
  changeNewChartSingerCount,
  chart,
  chartDialog,
  chartName,
  confirmState,
  copyBusy,
  copyChartId,
  copyCharts,
  copyOpen,
  copyPerformanceId,
  copySelectedChart,
  createChart,
  eligibleProfiles,
  eventId,
  events,
  isVoicePartLayout,
  loadCopyCharts,
  lookupProfiles,
  lookupQuery,
  newChartRowCount,
  newChartSingerCount,
  partLabel,
  profileBusy,
  profileDialog,
  profileForm,
  profileMessage,
  profilesById,
  renameChart,
  requestRemoveSeat,
  roster,
  rsvpYesCount,
  saveProfile,
  selectedSeat,
  setAttendance,
  setChartDialog,
  setChartName,
  setConfirmState,
  setCopyChartId,
  setCopyOpen,
  setLookupQuery,
  setProfileDialog,
  setProfileForm,
  setSelectedSeat,
}: SeatingDialogsProps) {
  return (
    <>
      <ConfirmDialog
        onClose={() => {
          setConfirmState(null);
        }}
        state={confirmState}
      />

      <ChartDialog
        changeNewChartRowCount={changeNewChartRowCount}
        changeNewChartSingerCount={changeNewChartSingerCount}
        chartDialog={chartDialog}
        chartName={chartName}
        createChart={createChart}
        newChartRowCount={newChartRowCount}
        newChartSingerCount={newChartSingerCount}
        renameChart={renameChart}
        rsvpYesCount={rsvpYesCount}
        setChartDialog={setChartDialog}
        setChartName={setChartName}
      />

      <CopyChartDialog
        copyBusy={copyBusy}
        copyChartId={copyChartId}
        copyCharts={copyCharts}
        copyOpen={copyOpen}
        copyPerformanceId={copyPerformanceId}
        copySelectedChart={copySelectedChart}
        eventId={eventId}
        events={events}
        loadCopyCharts={loadCopyCharts}
        setCopyChartId={setCopyChartId}
        setCopyOpen={setCopyOpen}
      />

      <AddProfileDialog
        partLabel={partLabel}
        profileBusy={profileBusy}
        profileDialog={profileDialog}
        profileForm={profileForm}
        profileMessage={profileMessage}
        roster={roster}
        saveProfile={saveProfile}
        setProfileDialog={setProfileDialog}
        setProfileForm={setProfileForm}
      />

      <ProfileLookupDialog
        eventId={eventId}
        lookupProfiles={lookupProfiles}
        lookupQuery={lookupQuery}
        partLabel={partLabel}
        profileDialog={profileDialog}
        setAttendance={setAttendance}
        setLookupQuery={setLookupQuery}
        setProfileDialog={setProfileDialog}
      />

      <SeatDetailDialog
        applyChart={applyChart}
        chart={chart}
        eligibleProfiles={eligibleProfiles}
        isVoicePartLayout={isVoicePartLayout}
        partLabel={partLabel}
        profilesById={profilesById}
        requestRemoveSeat={requestRemoveSeat}
        roster={roster}
        selectedSeat={selectedSeat}
        setSelectedSeat={setSelectedSeat}
      />
    </>
  );
}
