import type { OrganizationProfile, OrganizationSeatingChartRequest } from "@choir/contracts";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useMemo } from "react";
import { getLastName } from "../../nameFormatting";

import { UnassignedProfileChip } from "./shared";

import type { SeatTileProps } from "./types";

export function SeatTile({
  assigned,
  label,
  mismatch,
  onActivate,
  onDrop,
  onRemove,
  seatKey,
  suggestion,
}: SeatTileProps) {
  const draggable = useDraggable({ id: `seat:${seatKey}`, disabled: !assigned });
  const droppable = useDroppable({ id: `seat:${seatKey}` });
  return (
    <div
      aria-label={`${label}${assigned ? `, assigned to ${assigned.displayName}` : ", empty"}`}
      className={`seating-seat seating-seat--canvas${assigned ? " seating-seat--assigned" : " seating-seat--empty"}${mismatch ? " seating-seat--mismatch" : ""}${draggable.isDragging ? " seating-seat--dragging" : ""}${droppable.isOver ? " seating-seat--drop-target" : ""}`}
      draggable={Boolean(assigned)}
      ref={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      style={{ opacity: draggable.isDragging ? 0.45 : undefined }}
      {...draggable.attributes}
      {...draggable.listeners}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", `seat:${seatKey}`);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(event.dataTransfer.getData("text/plain"));
      }}
      onClick={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest("button")) return;
        onActivate();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onActivate();
      }}
      tabIndex={0}
    >
      <span className="seating-seat__number">{label}</span>
      <span className="seating-seat__suggestion">{suggestion ?? "Open"}</span>
      <strong>{assigned?.displayName ?? "Empty"}</strong>
      {assigned ? <span className="seating-seat__voice">{assigned.voicePart}</span> : null}
      {mismatch ? <span className="seating-seat__warning">Voice part mismatch</span> : null}
      <button
        aria-label={
          assigned ? `Remove ${assigned.displayName} from ${label}` : `Delete empty ${label}`
        }
        className="seating-seat__remove"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
        title="Delete seat"
        type="button"
      >
        ×
      </button>
    </div>
  );
}

export function UnassignedTray({
  profiles,
  onAdd,
  onLookup,
  onRemoveRsvp,
  onDrop,
  query,
  setQuery,
}: {
  readonly onAdd: () => void;
  readonly onLookup: () => void;
  readonly onRemoveRsvp: (profile: OrganizationProfile) => void;
  readonly onDrop: (token: string) => void;
  readonly profiles: readonly OrganizationProfile[];
  readonly query: string;
  readonly setQuery: (value: string) => void;
}) {
  const { isOver: trayIsOver, setNodeRef: setTrayNodeRef } = useDroppable({ id: "tray" });
  const attachTrayNode = (node: HTMLElement | null) => {
    setTrayNodeRef(node);
  };
  const groups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = normalized
      ? profiles.filter(({ displayName, voicePart }) =>
          `${displayName} ${voicePart}`.toLocaleLowerCase().includes(normalized),
        )
      : profiles;
    const grouped = new Map<string, OrganizationProfile[]>();
    filtered.forEach((profile) => {
      const key = profile.voicePart || "Other";
      const list = grouped.get(key) ?? [];
      list.push(profile);
      grouped.set(key, list);
    });
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [profiles, query]);
  return (
    <section
      className={`seating-tray${trayIsOver ? " seating-tray--drop-target" : ""}`}
      aria-labelledby="unassigned-title"
      ref={attachTrayNode}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(event.dataTransfer.getData("text/plain"));
      }}
    >
      <div className="seating-tray__header">
        <div>
          <h2 id="unassigned-title">Unassigned Profiles</h2>
          <p>Drag a Profile to a seat, or drop a seat here to clear it.</p>
        </div>
        <span className="status-pill">{profiles.length}</span>
      </div>
      <div className="seating-tray__actions">
        <input
          aria-label="Search unassigned Profiles"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search Profiles"
          type="search"
          value={query}
        />
        <button className="button button--secondary button--small" onClick={onLookup} type="button">
          Lookup
        </button>
        <button className="button button--secondary button--small" onClick={onAdd} type="button">
          Add Profile
        </button>
      </div>
      <div className="seating-tray__groups">
        {groups.map(([group, groupProfiles]) => (
          <div className="seating-tray__group" key={group}>
            <h3>
              {group} <span>{groupProfiles.length}</span>
            </h3>
            <div className="seating-tray__profiles">
              {groupProfiles.map((profile) => (
                <UnassignedProfileChip key={profile.id} onRemove={onRemoveRsvp} profile={profile} />
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 ? (
          <p className="empty-state">All eligible Profiles are assigned.</p>
        ) : null}
      </div>
    </section>
  );
}

export function ChartList({
  chart,
  profilesById,
  displayNames,
  showSeatNumbers,
  showVoiceParts,
}: {
  readonly chart: OrganizationSeatingChartRequest;
  readonly profilesById: ReadonlyMap<string, OrganizationProfile>;
  readonly displayNames: ReadonlyMap<string, string>;
  readonly showSeatNumbers: boolean;
  readonly showVoiceParts: boolean;
}) {
  return (
    <div className="seating-list-view" aria-label="Text seating list">
      {[...chart.rowCounts.keys()].reverse().map((rowIndex) => {
        const rowLabel =
          rowIndex === chart.rowCounts.length - 1 ? " (Back)" : rowIndex === 0 ? " (Front)" : "";
        const rowSeats = Array.from({ length: chart.rowCounts[rowIndex] ?? 0 }, (_, seatIndex) => {
          const profile = profilesById.get(
            chart.assignments[`${String(rowIndex)}-${String(seatIndex)}`] ?? "",
          );
          return profile ? { profile, seatIndex } : null;
        }).filter(
          (entry): entry is { profile: OrganizationProfile; seatIndex: number } => entry !== null,
        );
        return (
          <section className="seating-list-row" key={rowIndex}>
            <h3>
              Row {rowIndex + 1}
              {rowLabel}{" "}
              <span>
                {rowSeats.length}/{chart.rowCounts[rowIndex] ?? 0}
              </span>
            </h3>
            <ol>
              {rowSeats.map(({ profile, seatIndex }) => (
                <li key={`${String(rowIndex)}-${String(seatIndex)}`}>
                  {showSeatNumbers ? (
                    <span className="seating-list-seat-number">{seatIndex + 1}</span>
                  ) : null}
                  <strong>
                    {(displayNames.get(profile.id) ?? getLastName(profile.displayName)).replace(
                      ", ",
                      " ",
                    )}
                  </strong>
                  {showVoiceParts && profile.voicePart ? (
                    <em className="seating-list-voice-part">({profile.voicePart})</em>
                  ) : null}
                </li>
              ))}
              {rowSeats.length === 0 ? <li>No Profiles assigned</li> : null}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
