import { addRow, addSeat, isSeatingSectionMismatch } from "@choir/domain";
import type {
  OrganizationProfile,
  OrganizationRosterConfiguration,
  OrganizationSeatingChartRequest,
  SeatingFormation,
} from "@choir/contracts";
import type { CSSProperties } from "react";
import { SeatName, SeatTile } from "./chartParts";

export interface SeatingGridCanvasProps {
  readonly chart: OrganizationSeatingChartRequest;
  readonly currentFormation: SeatingFormation | null;
  readonly handleNativeDrop: (token: string, seatKey?: string) => void;
  readonly isEditing: boolean;
  readonly profilesById: Map<string, OrganizationProfile>;
  readonly requestRemoveRow: (rowIndex: number) => void;
  readonly requestRemoveSeat: (rowIndex: number, seatIndex: number) => void;
  readonly roster: OrganizationRosterConfiguration;
  readonly rows: readonly number[];
  readonly setSelectedSeat: (seatKey: string | null) => void;
  readonly updateLayout: (layout: ReturnType<typeof addRow>) => void;
}

export function SeatingGridCanvas({
  chart,
  currentFormation,
  handleNativeDrop,
  isEditing,
  profilesById,
  requestRemoveRow,
  requestRemoveSeat,
  roster,
  rows,
  setSelectedSeat,
  updateLayout,
}: SeatingGridCanvasProps) {
  const profileForSeat = (seatKey: string) => profilesById.get(chart.assignments[seatKey] ?? "");

  return (
    <div
      aria-label="Seating chart assignments"
      className={`seating-editor-canvas${isEditing ? " seating-editor-canvas--editing" : " seating-editor-canvas--readonly"}`}
    >
      {isEditing ? (
        <button
          className="button button--secondary button--small no-print"
          onClick={() => {
            updateLayout(addRow({ ...chart }, "back"));
          }}
          type="button"
        >
          + Add row to back
        </button>
      ) : null}
      <div className="seating-grid seating-grid--canvas">
        {rows.map((rowIndex) => {
          const count = chart.rowCounts[rowIndex] ?? 0;
          const occupied = Array.from(
            { length: count },
            (_, seatIndex) => chart.assignments[`${String(rowIndex)}-${String(seatIndex)}`],
          ).filter(Boolean).length;
          return (
            <div
              className="seating-row seating-row--canvas"
              key={rowIndex}
              style={{ "--seating-seat-count": String(count) } as CSSProperties}
            >
              <div className="seating-row-label seating-row-label--canvas">
                <strong>Row {rowIndex + 1}</strong>
                <span>
                  {occupied}/{count}
                </span>
              </div>
              {isEditing ? (
                <button
                  aria-label={`Delete row ${String(rowIndex + 1)}`}
                  className="seating-row-action-btn seating-row-action-btn--delete no-print"
                  disabled={chart.rowCounts.length <= 1}
                  onClick={() => {
                    requestRemoveRow(rowIndex);
                  }}
                  type="button"
                >
                  ×
                </button>
              ) : null}
              {Array.from({ length: count }, (_, seatIndex) => {
                const seatKey = `${String(rowIndex)}-${String(seatIndex)}`;
                const profile = profileForSeat(seatKey);
                const suggestion = chart.sectionSuggestions[seatKey];
                const mismatch = currentFormation?.isVoicePartLayout
                  ? Boolean(
                      profile &&
                      suggestion &&
                      profile.voicePart.toUpperCase() !== suggestion.toUpperCase(),
                    )
                  : isSeatingSectionMismatch(profile?.voicePart, suggestion, roster.voiceParts);
                return isEditing ? (
                  <SeatTile
                    assigned={profile}
                    key={seatKey}
                    label={`Seat ${String(seatIndex + 1)}`}
                    mismatch={mismatch}
                    onActivate={() => {
                      setSelectedSeat(seatKey);
                    }}
                    onDrop={(token) => {
                      handleNativeDrop(token, seatKey);
                    }}
                    onRemove={() => {
                      requestRemoveSeat(rowIndex, seatIndex);
                    }}
                    seatKey={seatKey}
                    suggestion={suggestion}
                  />
                ) : (
                  <div
                    aria-label={`Seat ${String(seatIndex + 1)}${profile ? `, assigned to ${profile.displayName}` : ", empty"}`}
                    className={`seating-seat seating-seat--canvas seating-seat--readonly${profile ? " seating-seat--assigned" : " seating-seat--empty"}${mismatch ? " seating-seat--mismatch" : ""}`}
                    key={seatKey}
                    title={profile?.displayName}
                  >
                    <span className="seating-seat__number">Seat {seatIndex + 1}</span>
                    <span className="seating-seat__suggestion">{suggestion ?? "Open"}</span>
                    <SeatName displayName={profile?.displayName} />
                    {profile ? (
                      <span className="seating-seat__voice">{profile.voicePart}</span>
                    ) : null}
                  </div>
                );
              })}
              {isEditing ? (
                <button
                  aria-label={`Add seat to row ${String(rowIndex + 1)}`}
                  className="seating-row-action-btn seating-row-action-btn--add no-print"
                  onClick={() => {
                    updateLayout(addSeat({ ...chart }, rowIndex));
                  }}
                  type="button"
                >
                  +
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {isEditing ? (
        <button
          className="button button--secondary button--small no-print"
          onClick={() => {
            updateLayout(addRow({ ...chart }, "front"));
          }}
          type="button"
        >
          + Add row to front
        </button>
      ) : null}
      <div className="seating-stage-marker">Director</div>
    </div>
  );
}
