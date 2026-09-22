import { calculateRsvpDeadline } from "@choir/domain";
import type {
  OrganizationEvent,
  OrganizationMusicBulkUpdateRequest,
  OrganizationMusicPiece,
} from "@choir/contracts";
import { useState, type Dispatch, type SetStateAction } from "react";
import {
  AuthApiError,
  bulkDeleteOrganizationMusicPieces,
  bulkUpdateOrganizationMusicPieces,
  createOrganizationEvent,
  listOrganizationMusic,
  renameOrganizationMusicCredit,
  updateOrganizationEvent,
} from "../../../../auth/api";
import { eventRequestFrom, performanceSetListItem } from "../tableUtils";
export function useMusicBulk({
  busy,
  events,
  pieces,
  selectedPieces,
  selectedPieceIds,
  setBusy,
  setError,
  setEvents,
  setMessage,
  setPieces,
  setSelectedPieceIds,
  timezone,
}: {
  readonly busy: boolean;
  readonly events: readonly OrganizationEvent[];
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly selectedPieces: readonly OrganizationMusicPiece[];
  readonly selectedPieceIds: readonly string[];
  readonly setBusy: (value: boolean) => void;
  readonly setError: (value: string | null) => void;
  readonly setEvents: Dispatch<SetStateAction<readonly OrganizationEvent[]>>;
  readonly setMessage: (value: string | null) => void;
  readonly setPieces: Dispatch<SetStateAction<readonly OrganizationMusicPiece[]>>;
  readonly setSelectedPieceIds: Dispatch<SetStateAction<readonly string[]>>;
  readonly timezone: string;
}) {
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  void pieces;
  void selectedPieceIds;
  const [setListDialogOpen, setSetListDialogOpen] = useState(false);
  const [setListError, setSetListError] = useState<string | null>(null);
  function closeBulkDialog(): void {
    if (busy) return;
    setBulkDialogOpen(false);
    setBulkError(null);
  }
  async function applyBulkChanges(
    changes: OrganizationMusicBulkUpdateRequest["changes"],
  ): Promise<void> {
    if (selectedPieces.length === 0) return;
    setBusy(true);
    setBulkError(null);
    setError(null);
    setMessage(null);
    try {
      const updated = await bulkUpdateOrganizationMusicPieces({
        changes,
        pieceIds: selectedPieces.map(({ id }) => id),
      });
      const updatedById = new Map(updated.map((candidate) => [candidate.id, candidate]));
      setPieces((current) =>
        current.map((candidate) => updatedById.get(candidate.id) ?? candidate),
      );
      setSelectedPieceIds([]);
      setBulkDialogOpen(false);
      setMessage(`${String(updated.length)} music piece(s) updated.`);
    } catch (caught: unknown) {
      setBulkError(
        caught instanceof AuthApiError ? caught.message : "The music pieces could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function applyBulkDelete(unlinkChildren: boolean): Promise<void> {
    if (selectedPieces.length === 0) return;
    setBusy(true);
    setBulkError(null);
    setError(null);
    setMessage(null);
    try {
      const deletedIds = await bulkDeleteOrganizationMusicPieces({
        pieceIds: selectedPieces.map(({ id }) => id),
        unlinkChildren,
      });
      const deletedSet = new Set(deletedIds);
      setPieces((current) => current.filter((candidate) => !deletedSet.has(candidate.id)));
      setSelectedPieceIds([]);
      setBulkDialogOpen(false);
      setMessage(`${String(deletedIds.length)} music piece(s) deleted.`);
    } catch (caught: unknown) {
      if (caught instanceof AuthApiError) {
        if (caught.code === "music_piece_in_set_list") {
          setBulkError(
            "One or more selected pieces is referenced by a concert set list and cannot be deleted.",
          );
        } else if (caught.code === "music_piece_has_movements") {
          setBulkError(
            "One or more selected pieces has movements. Enable “Keep movements as top-level works” to delete.",
          );
        } else {
          setBulkError(caught.message);
        }
      } else {
        setBulkError("The music pieces could not be deleted.");
      }
    } finally {
      setBusy(false);
    }
  }
  async function renameCredit(currentName: string, newName: string): Promise<number> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await renameOrganizationMusicCredit({ currentName, newName });
      const updatedById = new Map(updated.map((candidate) => [candidate.id, candidate]));
      setPieces((current) =>
        current.map((candidate) => updatedById.get(candidate.id) ?? candidate),
      );
      setMessage(
        `Renamed ${currentName} to ${newName} across ${String(updated.length)} distinct music piece${updated.length === 1 ? "" : "s"}.`,
      );
      return updated.length;
    } finally {
      setBusy(false);
    }
  }
  async function handlePerformanceChanged(event: OrganizationEvent): Promise<void> {
    setEvents((current) => {
      const exists = current.some((candidate) => candidate.id === event.id);
      return exists
        ? current.map((candidate) => (candidate.id === event.id ? event : candidate))
        : [...current, event].toSorted((left, right) =>
            left.startsAt.localeCompare(right.startsAt),
          );
    });
    try {
      setPieces(await listOrganizationMusic());
    } catch {
      /* event link saved; later refresh recalculates */
    }
  }
  async function addSelectedPiecesToSetList(
    payload:
      | { readonly mode: "existing"; readonly eventId: string }
      | {
          readonly mode: "new";
          readonly startsAt: string;
          readonly title: string;
          readonly venueId?: string | null;
        },
  ): Promise<void> {
    if (selectedPieces.length === 0) return;
    setBusy(true);
    setSetListError(null);
    try {
      const itemsToAdd = selectedPieces.map((p) => performanceSetListItem(p));
      let targetEvent: OrganizationEvent;
      let actionLabel = "";
      if (payload.mode === "existing") {
        const existingEvent = events.find((e) => e.id === payload.eventId);
        if (!existingEvent) throw new Error("Selected concert event not found.");
        const nextSetList = [...existingEvent.setList, ...itemsToAdd];
        targetEvent = await updateOrganizationEvent(existingEvent.id, {
          ...eventRequestFrom(existingEvent),
          setList: nextSetList,
        });
        actionLabel = `Added ${String(itemsToAdd.length)} piece(s) to "${targetEvent.title}".`;
      } else {
        targetEvent = await createOrganizationEvent({
          advancePriceCents: 0,
          callTime: "",
          dayOfPriceCents: 0,
          details: "",
          doorsOpenTime: "",
          durationMinutes: null,
          isTicketingEnabled: false,
          location: "",
          parentPerformanceId: null,
          publicDetails: "",
          publicGraphicFileId: null,
          publishOnWebsite: false,
          rsvpDeadlineDate:
            calculateRsvpDeadline({ startsAt: payload.startsAt, type: "Performance" }, 7, timezone)
              ?.deadlineDate ?? null,
          rsvpFollowUpLeadHours: null,
          rsvpFollowUpMode: "inherit",
          setList: itemsToAdd,
          setListApproved: false,
          setListDefaultTransitionSeconds: 0,
          startsAt: payload.startsAt,
          ticketCapacity: null,
          title: payload.title,
          type: "Performance",
          venueId: payload.venueId ?? null,
        });
        actionLabel = `Created "${targetEvent.title}" and added ${String(itemsToAdd.length)} piece(s) to its set list.`;
      }
      setEvents((current) => {
        const exists = current.some((e) => e.id === targetEvent.id);
        return exists
          ? current.map((e) => (e.id === targetEvent.id ? targetEvent : e))
          : [...current, targetEvent];
      });
      setSelectedPieceIds([]);
      setSetListDialogOpen(false);
      setMessage(actionLabel);
    } catch (caught: unknown) {
      setSetListError(
        caught instanceof AuthApiError
          ? caught.message
          : "Pieces could not be added to the concert set list.",
      );
    } finally {
      setBusy(false);
    }
  }
  return {
    addSelectedPiecesToSetList,
    applyBulkChanges,
    applyBulkDelete,
    bulkDialogOpen,
    bulkError,
    closeBulkDialog,
    handlePerformanceChanged,
    renameCredit,
    setBulkDialogOpen,
    setBulkError,
    setListDialogOpen,
    setListError,
    setSetListDialogOpen,
    setSetListError,
  };
}
