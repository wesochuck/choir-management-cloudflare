import type { OrganizationEvent } from "@choir/contracts";
import { formatEventDate } from "./utils";

export interface SeatingHeaderProps {
  readonly activeEvent: OrganizationEvent | undefined;
  readonly assignedCount: number;
  readonly eligibleCount: number;
  readonly enterFocus: () => void;
  readonly exitFocus: () => void;
  readonly focusMode: boolean;
  readonly isNarrow: boolean;
  readonly mobileEditing: boolean;
  readonly setMobileEditing: (value: boolean) => void;
  readonly totalSeats: number;
}

export function SeatingHeader({
  activeEvent,
  assignedCount,
  eligibleCount,
  enterFocus,
  exitFocus,
  focusMode,
  isNarrow,
  mobileEditing,
  setMobileEditing,
  totalSeats,
}: SeatingHeaderProps) {
  return (
    <div className="seating-page-heading no-print">
      <div>
        <p className="eyebrow">Seating</p>
        <h1>Performance seating</h1>
        <p>
          {activeEvent?.title ?? "Performance"} ·{" "}
          {activeEvent ? formatEventDate(activeEvent.startsAt) : ""} · {assignedCount}/{totalSeats}{" "}
          seats assigned
        </p>
        {eligibleCount > totalSeats ? (
          <p className="notice notice--warning" role="alert">
            {String(eligibleCount - totalSeats)} eligible Profile(s) exceed this chart&apos;s
            capacity. Auto-suggestions will fill available seats only.
          </p>
        ) : null}
      </div>
      <div className="seating-page-heading__actions">
        {isNarrow && !mobileEditing ? (
          <button
            className="button button--primary"
            onClick={() => {
              setMobileEditing(true);
            }}
            type="button"
          >
            Edit anyway
          </button>
        ) : null}
        <button
          className="button button--secondary"
          onClick={() => {
            if (focusMode) {
              exitFocus();
            } else {
              enterFocus();
            }
          }}
          type="button"
        >
          {focusMode ? "Exit full screen" : "Full Screen"}
        </button>
      </div>
    </div>
  );
}
