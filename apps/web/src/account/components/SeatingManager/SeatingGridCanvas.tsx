import { addRow, addSeat, isSeatingSectionMismatch } from "@choir/domain";
import type {
  OrganizationProfile,
  OrganizationRosterConfiguration,
  OrganizationSeatingChartRequest,
  SeatingFormation,
} from "@choir/contracts";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useDndContext } from "@dnd-kit/core";
import { SeatName, SeatSuggestion, SeatTile } from "./chartParts";
import { useSeatingNamePresentation } from "./hooks/useSeatingNamePresentation";

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

function seatKeyForTarget(target: EventTarget | null): string | null {
  return target instanceof Element
    ? (target.closest<HTMLElement>("[data-seat-key]")?.dataset.seatKey ?? null)
    : null;
}

function isMagnifiedNeighbor(seatIndex: number, magnifiedIndex: number): boolean {
  return magnifiedIndex >= 0 && Math.abs(seatIndex - magnifiedIndex) === 1;
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
  const canvasRef = useRef<HTMLDivElement>(null);
  const [hoveredSeat, setHoveredSeat] = useState<string | null>(null);
  const [focusedSeat, setFocusedSeat] = useState<string | null>(null);
  const dismissedHover = useRef<string | null>(null);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      dismissedHover.current = hoveredSeat;
      setHoveredSeat(null);
      setFocusedSeat(null);
    };
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("keydown", dismiss);
    };
  }, [hoveredSeat]);
  const { active } = useDndContext();
  const magnifiedSeat = active ? null : (hoveredSeat ?? focusedSeat);
  useSeatingNamePresentation(canvasRef, chart);
  const profileForSeat = (seatKey: string) => profilesById.get(chart.assignments[seatKey] ?? "");

  return (
    <div
      aria-label="Seating chart assignments"
      className={`seating-editor-canvas${isEditing ? " seating-editor-canvas--editing" : " seating-editor-canvas--readonly"}`}
      onPointerOver={(event) => {
        if (event.pointerType === "touch" || event.buttons > 0) return;
        // Directly entering a control must not move it away from the pointer.
        if (event.target instanceof Element && event.target.closest("button")) return;
        const seatKey = seatKeyForTarget(event.target);
        if (seatKey === dismissedHover.current) return;
        dismissedHover.current = null;
        setHoveredSeat(seatKey);
      }}
      onPointerLeave={() => {
        dismissedHover.current = null;
        setHoveredSeat(null);
      }}
      onFocus={(event) => {
        if (event.target instanceof Element && event.target.matches(":focus-visible")) {
          setFocusedSeat(seatKeyForTarget(event.target));
        }
      }}
      onBlur={(event) => {
        if (seatKeyForTarget(event.target) === seatKeyForTarget(event.relatedTarget)) return;
        setFocusedSeat(null);
      }}
      onDragStart={() => {
        setHoveredSeat(null);
        setFocusedSeat(null);
      }}
      ref={canvasRef}
      tabIndex={-1}
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
          const magnifiedIndex = magnifiedSeat?.startsWith(`${String(rowIndex)}-`)
            ? Number(magnifiedSeat.split("-")[1])
            : -1;
          const initialPresentation = count >= 15 ? "initials" : "full";
          const occupied = Array.from(
            { length: count },
            (_, seatIndex) => chart.assignments[`${String(rowIndex)}-${String(seatIndex)}`],
          ).filter(Boolean).length;
          return (
            <div
              className="seating-row seating-row--canvas"
              data-name-presentation={initialPresentation}
              key={rowIndex}
              style={
                {
                  "--seating-seat-count": String(count),
                } as CSSProperties
              }
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
                const magnifiedNeighbor = isMagnifiedNeighbor(seatIndex, magnifiedIndex);
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
                    magnified={seatKey === magnifiedSeat}
                    magnifiedNeighbor={magnifiedNeighbor}
                    onActivate={() => {
                      setSelectedSeat(seatKey);
                    }}
                    onDrop={(token) => {
                      handleNativeDrop(token, seatKey);
                    }}
                    onRemove={() => {
                      requestRemoveSeat(rowIndex, seatIndex);
                    }}
                    presentation={initialPresentation}
                    seatKey={seatKey}
                    suggestion={suggestion}
                  />
                ) : (
                  <div
                    aria-label={`Seat ${String(seatIndex + 1)}${profile ? `, assigned to ${profile.displayName}` : ", empty"}`}
                    className={`seating-seat seating-seat--canvas seating-seat--readonly${profile ? " seating-seat--assigned" : " seating-seat--empty"}${mismatch ? " seating-seat--mismatch" : ""}`}
                    data-name-presentation={initialPresentation}
                    data-seat-key={seatKey}
                    data-magnified={seatKey === magnifiedSeat || undefined}
                    data-magnified-neighbor={magnifiedNeighbor ? true : undefined}
                    key={seatKey}
                    tabIndex={profile ? 0 : undefined}
                  >
                    <div className="seating-seat__surface">
                      <span className="seating-seat__number">Seat {seatIndex + 1}</span>
                      <SeatSuggestion occupied={Boolean(profile)} suggestion={suggestion} />
                      <SeatName displayName={profile?.displayName} />
                      {profile ? (
                        <span className="seating-seat__voice">{profile.voicePart}</span>
                      ) : null}
                    </div>
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
