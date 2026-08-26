import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { moveAssignment, swapAssignments } from "@choir/domain";
import { useRef, useState } from "react";
import type { OrganizationProfile, OrganizationSeatingChartRequest } from "@choir/contracts";

interface Args {
  readonly chart: OrganizationSeatingChartRequest;
  readonly profilesById: ReadonlyMap<string, OrganizationProfile>;
  readonly applyChart: (next: OrganizationSeatingChartRequest) => void;
}

export function useSeatingDragDrop({ applyChart, chart, profilesById }: Args) {
  const nativeDropHandledRef = useRef(false);
  const [draggingToken, setDraggingToken] = useState<string | null>(null);
  const [dragMessage, setDragMessage] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function handleDropToken(token: string, targetSeatKey?: string): void {
    if (!token) return;
    if (!targetSeatKey) {
      if (!token.startsWith("seat:")) return;
      const seatKey = token.slice("seat:".length);
      applyChart({
        ...chart,
        assignments: Object.fromEntries(
          Object.entries(chart.assignments).filter(([key]) => key !== seatKey),
        ),
      });
      return;
    }
    if (token.startsWith("seat:")) {
      const sourceSeatKey = token.slice("seat:".length);
      const targetOccupied = Boolean(chart.assignments[targetSeatKey]);
      applyChart({
        ...chart,
        assignments: targetOccupied
          ? swapAssignments(chart.assignments, sourceSeatKey, targetSeatKey)
          : moveAssignment(chart.assignments, sourceSeatKey, targetSeatKey),
      });
    } else if (token.startsWith("profile:")) {
      const profileId = token.slice("profile:".length);
      applyChart({
        ...chart,
        assignments: moveAssignment(chart.assignments, "", targetSeatKey, profileId),
      });
    }
  }
  function handleDragStart(event: DragStartEvent): void {
    nativeDropHandledRef.current = false;
    const token = String(event.active.id);
    setDraggingToken(token);
    const profileId = token.startsWith("profile:")
      ? token.slice("profile:".length)
      : token.startsWith("seat:")
        ? chart.assignments[token.slice("seat:".length)]
        : undefined;
    const profileName = profileId ? profilesById.get(profileId)?.displayName : undefined;
    setDragMessage(
      profileName
        ? `Dragging ${profileName}. Choose a seat to assign or move, or the tray to unassign.`
        : token.startsWith("profile:")
          ? "Dragging Profile. Choose an empty or occupied seat to assign or replace."
          : "Dragging assigned seat. Choose another seat to move or swap, or the tray to unassign.",
    );
  }

  function handleDragEnd(event: DragEndEvent): void {
    setDraggingToken(null);
    if (nativeDropHandledRef.current) {
      nativeDropHandledRef.current = false;
      return;
    }
    const token = String(event.active.id);
    const target = event.over ? String(event.over.id) : null;
    if (target === "tray") {
      handleDropToken(token);
      setDragMessage("Profile unassigned and returned to the tray.");
      return;
    }
    if (target?.startsWith("seat:")) {
      handleDropToken(token, target.slice("seat:".length));
      setDragMessage("Seating assignment updated.");
      return;
    }
    setDragMessage("Drag canceled.");
  }

  function handleNativeDrop(token: string, targetSeatKey?: string): void {
    nativeDropHandledRef.current = true;
    setDraggingToken(null);
    handleDropToken(token, targetSeatKey);
    setDragMessage(
      targetSeatKey
        ? "Seating assignment updated."
        : "Profile unassigned and returned to the tray.",
    );
  }

  return {
    dragMessage,
    draggingToken,
    handleDragEnd,
    handleDragStart,
    handleNativeDrop,
    nativeDropHandledRef,
    sensors,
    setDragMessage,
    setDraggingToken,
  };
}
