import type { DonationRecord, OrganizationEvent, OrganizationTicketOrder } from "@choir/contracts";
import type { ReactNode } from "react";

import { eventLabel } from "./reportHelpers";

export type ReportTab =
  "attendance" | "rsvp" | "repertoire" | "roster" | "donations-tickets" | "music-folders";
export type LoadState = "loading" | "ready" | "error";
export type CommerceFilter = "all" | "donations" | "tickets";

export type CommerceRow =
  | { readonly kind: "donation"; readonly record: DonationRecord }
  | { readonly kind: "ticket"; readonly record: OrganizationTicketOrder };

export interface SingerAttendance {
  readonly absences: number;
  readonly name: string;
  readonly present: number;
  readonly profileId: string;
  readonly total: number;
  readonly voicePart: string;
}

export function Status({
  state,
  empty = "No records are available.",
}: {
  readonly state: LoadState;
  readonly empty?: string;
}): ReactNode {
  if (state === "loading") return <p className="empty-state">Loading report…</p>;
  if (state === "error") {
    return <p className="notice notice--error">This report could not be loaded. Try again.</p>;
  }
  return <p className="empty-state">{empty}</p>;
}

export function EventPicker({
  events,
  selectedId,
  onChange,
}: {
  readonly events: readonly OrganizationEvent[];
  readonly onChange: (id: string) => void;
  readonly selectedId: string;
}): ReactNode {
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
