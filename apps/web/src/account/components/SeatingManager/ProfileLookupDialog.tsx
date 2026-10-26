import { AttendanceWarningBadge } from "./AttendanceWarningBadge";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Dialog } from "@choir/ui";
import type { OrganizationProfile } from "@choir/contracts";
import { setOrganizationEventRsvp } from "../../../auth/api";
import { statusLabel } from "./utils";

export function ProfileLookupDialog({
  assignedIds,
  attendingIds,
  eventId,
  lookupProfiles,
  lookupQuery,
  partLabel,
  setAttendance,
  setLookupQuery,
  setProfileDialog,
}: {
  readonly assignedIds: ReadonlySet<string>;
  readonly attendingIds: ReadonlySet<string>;
  readonly eventId: string;
  readonly lookupProfiles: readonly OrganizationProfile[];
  readonly lookupQuery: string;
  readonly partLabel: string;
  readonly setAttendance: Dispatch<
    SetStateAction<
      readonly {
        readonly profileId: string;
        readonly rsvp: "No" | "Pending" | "Yes";
      }[]
    >
  >;
  readonly setLookupQuery: (query: string) => void;
  readonly setProfileDialog: (dialog: "add" | "lookup" | null) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const normalized = lookupQuery.trim().toLocaleLowerCase();
  const matches = lookupProfiles.filter(
    (profile) =>
      !normalized ||
      `${profile.displayName} ${profile.voicePart}`.toLocaleLowerCase().includes(normalized),
  );

  async function markAttending(profileId: string): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setBusyId(profileId);
    setError(null);
    try {
      await setOrganizationEventRsvp(eventId, profileId, "Yes");
      if (!active.current) return;
      setAttendance((current) => [
        ...current.filter((row) => row.profileId !== profileId),
        { profileId, rsvp: "Yes" },
      ]);
      setProfileDialog(null);
    } catch (caught: unknown) {
      if (active.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not mark this singer Attending. Try again.",
        );
    } finally {
      pending.current = false;
      if (active.current) setBusyId(null);
    }
  }

  return (
    <Dialog
      description="Search the entire Organization roster. Mark an eligible singer Attending, then assign them through the seating chart."
      onClose={() => {
        if (!pending.current) setProfileDialog(null);
      }}
      open
      title="Profile lookup"
    >
      <div className="form-stack">
        <label className="field">
          Search Profiles
          <input
            onChange={(event) => {
              setLookupQuery(event.target.value);
            }}
            placeholder={`Name or ${partLabel.toLowerCase()}`}
            type="search"
            value={lookupQuery}
          />
        </label>
        {error ? (
          <p role="alert" className="notice notice--error">
            {error}
          </p>
        ) : null}
        <div className="seating-lookup-list" aria-busy={busyId !== null}>
          {matches.length === 0 ? (
            <p role="status">No Organization Profiles match your search.</p>
          ) : null}
          {matches.map((profile) => {
            const attending = attendingIds.has(profile.id);
            const seated = assignedIds.has(profile.id);
            const reasons = [
              profile.globalStatus !== "Active"
                ? `Profile is ${statusLabel(profile.globalStatus)}`
                : "",
              !profile.voicePart.trim() ? `No ${partLabel.toLowerCase()}` : "",
            ].filter(Boolean);
            const canMarkAttending = !attending && !seated && reasons.length === 0;
            return (
              <div className="seating-lookup-row seating-roster-result" key={profile.id}>
                <strong className="seating-person-name">
                  {profile.displayName}
                  <AttendanceWarningBadge profileId={profile.id} />
                </strong>
                <span>{profile.voicePart || `No ${partLabel.toLowerCase()}`}</span>
                <p>
                  {attending ? "Attending" : "Not RSVP'd Attending"}
                  {seated ? " · Already seated. Use the chart to move or swap seats." : ""}
                  {reasons.length
                    ? ` · Ineligible: ${reasons.join("; ")}.`
                    : attending && !seated
                      ? " · Eligible but unassigned"
                      : ""}
                </p>
                {canMarkAttending ? (
                  <button
                    className="button button--secondary button--small"
                    disabled={busyId !== null}
                    onClick={() => {
                      void markAttending(profile.id);
                    }}
                    type="button"
                    aria-label={`Mark ${profile.displayName} Attending`}
                  >
                    {busyId === profile.id ? "Marking Attending…" : "Mark Attending"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}
