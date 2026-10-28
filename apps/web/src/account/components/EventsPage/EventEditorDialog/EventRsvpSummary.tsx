import type {
  OrganizationAttendanceRow,
  OrganizationEventRequest,
  OrganizationProfile,
} from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";
import { isPerformer } from "@choir/domain";
import { RsvpNotificationAction } from "../../RsvpManager/RsvpNotificationAction";
import { listOrganizationEventAttendance, listOrganizationProfiles } from "../../../../api";

export interface EventRsvpSummaryProps {
  readonly editingId: string | null;
  readonly eventType: OrganizationEventRequest["type"];
  readonly onOpenRsvpDetails?: (() => void) | undefined;
  readonly onNavigate?: ((href: string) => void) | undefined;
  readonly staffingGoal?: number | null | undefined;
}

function ActiveEventRsvpSummary({
  editingId,
  eventType,
  onOpenRsvpDetails,
  staffingGoal,
  onNavigate,
}: EventRsvpSummaryProps & { readonly editingId: string }) {
  const [rows, setRows] = useState<readonly OrganizationAttendanceRow[]>([]);
  const [profiles, setProfiles] = useState<readonly OrganizationProfile[]>([]);
  const [state, setState] = useState<"error" | "loading" | "ready">("loading");

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset state when editingId changes
    setState("loading");

    Promise.all([
      listOrganizationEventAttendance(editingId, controller.signal),
      listOrganizationProfiles(controller.signal),
    ])
      .then(([data, loadedProfiles]) => {
        if (!controller.signal.aborted) {
          setRows(data);
          setProfiles(loadedProfiles);
          setState("ready");
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setState("error");
        }
      });

    return () => {
      controller.abort();
    };
  }, [editingId]);

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );
  const activeRows = useMemo(
    () =>
      rows.filter((row) => {
        const profile = profileById.get(row.profileId);
        return (
          profile?.globalStatus === "Active" &&
          (eventType !== "Performance" || isPerformer(profile))
        );
      }),
    [rows, profileById, eventType],
  );
  const excludedCounts = useMemo(() => {
    let onBreak = 0;
    let inactive = 0;
    for (const row of rows) {
      const status = profileById.get(row.profileId)?.globalStatus;
      if (status === "Idle") onBreak++;
      if (status === "Inactive") inactive++;
    }
    return { onBreak, inactive };
  }, [rows, profileById]);
  const counts = useMemo(() => {
    let yes = 0;
    let no = 0;
    let pending = 0;
    for (const row of activeRows) {
      if (row.rsvp === "Yes") {
        yes++;
      } else if (row.rsvp === "No") {
        no++;
      } else {
        pending++;
      }
    }
    return {
      no,
      pending,
      total: activeRows.length,
      yes,
    };
  }, [activeRows]);

  const targetUrl = `/admin/rsvp?eventId=${encodeURIComponent(editingId)}`;

  return (
    <fieldset className="event-rsvp-summary">
      <legend>RSVP responses</legend>
      <p className="field-help">
        {eventType === "Performance"
          ? "Responses from active Performers for this performance."
          : "Responses from active members and volunteering for this event."}
      </p>

      {state === "loading" ? (
        <p className="field-help" role="status">
          Loading RSVP responses…
        </p>
      ) : null}

      {state === "error" ? (
        <p className="notice notice--error" role="alert">
          Unable to load RSVP responses.
        </p>
      ) : null}

      {state === "ready" ? (
        <>
          <div
            aria-label="RSVP response summary"
            className="event-rsvp-summary__metrics"
            role="group"
          >
            <span className="rsvp-status-badge rsvp-status-badge--Yes">
              Attending: {String(counts.yes)}
            </span>
            <span className="rsvp-status-badge rsvp-status-badge--No">
              Declined: {String(counts.no)}
            </span>
            <span className="rsvp-status-badge rsvp-status-badge--Pending">
              No response: {String(counts.pending)}
            </span>
            <span className="status-pill">Total: {String(counts.total)}</span>
          </div>

          {excludedCounts.onBreak + excludedCounts.inactive > 0 ? (
            <p className="field-help">
              Excluded from response totals: On Break: {excludedCounts.onBreak}; Inactive:{" "}
              {excludedCounts.inactive}.
            </p>
          ) : null}
          {eventType === "Performance" ? (
            <RsvpNotificationAction
              activePendingCount={counts.pending}
              eventId={editingId}
              rows={rows}
              onNavigate={onNavigate}
            />
          ) : null}
          {staffingGoal && staffingGoal > 0 ? (
            <p className="event-rsvp-summary__staffing">
              Staffing goal: <strong>{String(counts.yes)}</strong> of{" "}
              <strong>{String(staffingGoal)}</strong> volunteers committed
              {counts.yes >= staffingGoal ? " (goal reached)" : ""}.
            </p>
          ) : null}

          <div className="button-row">
            <a
              className="button button--secondary button--small"
              href={targetUrl}
              onClick={(clickEvent) => {
                if (
                  !clickEvent.defaultPrevented &&
                  clickEvent.button === 0 &&
                  !clickEvent.metaKey &&
                  !clickEvent.ctrlKey &&
                  !clickEvent.shiftKey &&
                  !clickEvent.altKey
                ) {
                  clickEvent.preventDefault();
                  onOpenRsvpDetails?.();
                }
              }}
            >
              View full RSVP details →
            </a>
          </div>
        </>
      ) : null}
    </fieldset>
  );
}

export function EventRsvpSummary(props: EventRsvpSummaryProps) {
  if (!props.editingId) {
    return (
      <fieldset className="event-rsvp-summary">
        <legend>RSVP responses</legend>
        <p className="field-help" role="status">
          Save this event to view RSVP responses and manage attendance.
        </p>
      </fieldset>
    );
  }

  return <ActiveEventRsvpSummary {...props} editingId={props.editingId} />;
}
