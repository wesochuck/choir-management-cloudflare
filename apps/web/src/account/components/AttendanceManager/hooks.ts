import type {
  OrganizationAttendanceRow,
  OrganizationAttendanceStatus,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { selectDefaultEvent } from "@choir/domain";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useReducer, useRef, useState } from "react";

import {
  AuthApiError,
  getOrganizationCalendarSettings,
  getOrganizationRosterConfiguration,
  listOrganizationEventAttendance,
  listOrganizationEvents,
  listOrganizationVenues,
  queryKeys,
  updateOrganizationEventAttendance,
} from "../../../api";
import { type AttendanceGroup, groupRowsBySection } from "./grouping";
import { type AttendanceUndoEntry, attendanceActionLabel, undoReducer } from "./undoHistory";

export type { AttendanceGroup, AttendanceUndoEntry };
export type AttendanceFilter = "All" | "Present" | "Absent" | "Pending";

const nextAttendance: Record<OrganizationAttendanceStatus, OrganizationAttendanceStatus> = {
  Absent: "Pending",
  Pending: "Present",
  Present: "Absent",
};

export function useAttendanceQueries(enabled: boolean) {
  const { data: events = [] } = useQuery({
    enabled,
    queryFn: ({ signal }) => listOrganizationEvents(signal),
    queryKey: queryKeys.organization.events,
  });

  const { data: venues = [] } = useQuery({
    enabled,
    queryFn: ({ signal }) => listOrganizationVenues(signal),
    queryKey: queryKeys.organization.venues,
  });

  const { data: rosterConfiguration } = useQuery({
    enabled,
    queryFn: ({ signal }) => getOrganizationRosterConfiguration(signal),
    queryKey: queryKeys.organization.rosterConfiguration,
  });

  const { data: calendarSettings } = useQuery({
    enabled,
    queryFn: ({ signal }) => getOrganizationCalendarSettings(signal),
    queryKey: queryKeys.organization.calendarSettings,
  });

  const defaultEventId = useMemo(
    () =>
      calendarSettings
        ? (selectDefaultEvent(events, new Date(), calendarSettings.timezone)?.id ?? "")
        : "",
    [events, calendarSettings],
  );
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const eventId = selectedEventId || defaultEventId;

  const queryClient = useQueryClient();
  const attendanceKey = queryKeys.organization.attendance(eventId);
  const pendingSaves = useIsMutating({ exact: true, mutationKey: attendanceKey });

  const { data: rows = [], dataUpdatedAt } = useQuery({
    enabled: enabled && Boolean(eventId),
    queryFn: ({ signal }) => listOrganizationEventAttendance(eventId, signal),
    queryKey: queryKeys.organization.attendance(eventId),
    refetchInterval: () =>
      pendingSaves > 0 || queryClient.isMutating({ exact: true, mutationKey: attendanceKey }) > 0
        ? false
        : 5_000,
    refetchIntervalInBackground: false,
  });

  return {
    dataUpdatedAt,
    eventId,
    events,
    rosterConfiguration,
    rows,
    setSelectedEventId,
    venues,
  };
}

export function useAttendanceFiltering({
  filter,
  query,
  rosterConfiguration,
  rows,
  savingIds,
}: {
  readonly filter: AttendanceFilter;
  readonly query: string;
  readonly rosterConfiguration?: OrganizationRosterConfiguration | null | undefined;
  readonly rows: readonly OrganizationAttendanceRow[];
  readonly savingIds: ReadonlySet<string>;
}) {
  const counts = useMemo(() => {
    const expected = rows.filter((row) => row.rsvp === "Yes");
    return {
      absent: expected.filter((row) => row.attendance === "Absent").length,
      expected: expected.length,
      pending: expected.filter((row) => row.attendance === "Pending").length,
      present: expected.filter((row) => row.attendance === "Present").length,
      presentTotal: expected.filter((row) => row.attendance === "Present").length,
      roster: expected.length,
    };
  }, [rows]);

  const groupedRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = rows.filter((row) => {
      const matchesFilter =
        filter === "All" ||
        (filter === "Pending" && row.attendance === "Pending") ||
        (filter === "Present" && row.attendance === "Present") ||
        (filter === "Absent" && row.attendance === "Absent");
      const matchesQuery =
        !normalizedQuery ||
        row.displayName.toLocaleLowerCase().includes(normalizedQuery) ||
        row.voicePart.toLocaleLowerCase().includes(normalizedQuery);
      const isSearchResult = normalizedQuery.length > 0;
      return matchesFilter && matchesQuery && (isSearchResult || row.rsvp === "Yes");
    });
    return {
      notRsvped: groupRowsBySection(
        filtered.filter((row) => row.rsvp !== "Yes"),
        rosterConfiguration,
      ),
      rsvped: groupRowsBySection(
        filtered.filter((row) => row.rsvp === "Yes"),
        rosterConfiguration,
      ),
    };
  }, [filter, query, rosterConfiguration, rows]);

  const markableRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.rsvp === "Yes" && row.attendance !== "Present" && !savingIds.has(row.profileId),
      ),
    [rows, savingIds],
  );

  return { counts, groupedRows, markableRows };
}

export function useAttendanceMutations({
  eventId,
  rows,
}: {
  readonly eventId: string;
  readonly rows: readonly OrganizationAttendanceRow[];
}) {
  const queryClient = useQueryClient();
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const mutationGenerations = useRef<Map<string, number>>(new Map());
  const pendingSaveCounts = useRef<Map<string, number>>(new Map());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [rescueCandidate, setRescueCandidate] = useState<OrganizationAttendanceRow | null>(null);
  const [rescueBusy, setRescueBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [{ entries: undoEntries }, dispatchUndo] = useReducer(undoReducer, { entries: [] });
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState<{
    readonly kind: "error" | "conflict";
    readonly profileId: string;
  } | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const actionSequenceRef = useRef(0);
  const [eventContext, setEventContext] = useState({ eventId, generation: 0 });

  if (eventContext.eventId !== eventId) {
    setEventContext((prev) => ({ eventId, generation: prev.generation + 1 }));
    dispatchUndo({ type: "clear" });
    setUndoError(null);
    setUndoBusy(false);
    setLiveAnnouncement("");
  }

  function markSaving(profileId: string, saving: boolean) {
    setSavingIds((current) => {
      const next = new Set(current);
      if (saving) next.add(profileId);
      else next.delete(profileId);
      return next;
    });
  }

  async function saveRow({
    targetEventId,
    row,
    nextValue,
    expectedUpdatedAt,
  }: {
    readonly targetEventId: string;
    readonly row: OrganizationAttendanceRow;
    readonly nextValue: OrganizationAttendanceStatus;
    readonly expectedUpdatedAt?: string | null | undefined;
  }): Promise<OrganizationAttendanceRow | undefined> {
    const profileId = row.profileId;

    const generation = (mutationGenerations.current.get(profileId) ?? 0) + 1;
    mutationGenerations.current.set(profileId, generation);

    markSaving(profileId, true);
    setMessage(null);

    const currentRows = queryClient.getQueryData<readonly OrganizationAttendanceRow[]>(
      queryKeys.organization.attendance(targetEventId),
    );
    const previousRow = currentRows?.find((candidate) => candidate.profileId === profileId) ?? row;
    const optimisticRow = { ...previousRow, attendance: nextValue };

    queryClient.setQueryData(
      queryKeys.organization.attendance(targetEventId),
      (current: readonly OrganizationAttendanceRow[] | undefined) =>
        (current ?? []).map((candidate) =>
          candidate.profileId === profileId ? optimisticRow : candidate,
        ),
    );
    const optimisticVersion = queryClient
      .getQueryData<readonly OrganizationAttendanceRow[]>(
        queryKeys.organization.attendance(targetEventId),
      )
      ?.find((candidate) => candidate.profileId === profileId);
    try {
      const saved = await updateOrganizationEventAttendance(targetEventId, [
        {
          attendance: nextValue,
          ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}),
          profileId,
        },
      ]);
      const savedRow = saved.find((candidate) => candidate.profileId === profileId);
      if (savedRow) {
        queryClient.setQueryData(
          queryKeys.organization.attendance(targetEventId),
          (current: readonly OrganizationAttendanceRow[] | undefined) =>
            (current ?? []).map((candidate) => {
              if (
                candidate.profileId === profileId &&
                mutationGenerations.current.get(profileId) === generation
              ) {
                return savedRow;
              }
              return candidate;
            }),
        );
      }
      return savedRow;
    } catch (error: unknown) {
      queryClient.setQueryData(
        queryKeys.organization.attendance(targetEventId),
        (current: readonly OrganizationAttendanceRow[] | undefined) =>
          (current ?? []).map((candidate) => {
            if (
              candidate.profileId === profileId &&
              mutationGenerations.current.get(profileId) === generation &&
              candidate === optimisticVersion
            ) {
              return previousRow;
            }
            return candidate;
          }),
      );
      setMessage(
        error instanceof AuthApiError && error.code === "attendance_profile_ineligible"
          ? error.message
          : error instanceof AuthApiError && error.code === "attendance_conflict"
            ? error.message
            : "That attendance update could not be saved. Try again.",
      );
      throw error;
    } finally {
      if (mutationGenerations.current.get(profileId) === generation) {
        markSaving(profileId, false);
      }
    }
  }

  async function applyAttendanceChange(
    row: OrganizationAttendanceRow,
    next: OrganizationAttendanceStatus,
    expectedUpdatedAt?: string | null,
  ): Promise<OrganizationAttendanceRow | null> {
    try {
      const saved = await rowMutation.mutateAsync({
        expectedUpdatedAt,
        nextValue: next,
        row,
        targetEventId: eventId,
      });
      return saved ?? null;
    } catch {
      return null;
    }
  }

  function changeAttendance(profileId: string) {
    const row = rows.find((candidate) => candidate.profileId === profileId);
    if (!row || savingIds.has(profileId) || bulkBusy || rescueBusy) return;
    const next = nextAttendance[row.attendance];
    if (next === "Present" && row.rsvp !== "Yes") {
      setRescueCandidate(row);
      return;
    }
    const priorAttendance = row.attendance;
    const actionSequence = ++actionSequenceRef.current;
    const currentGeneration = eventContext.generation;
    const currentEventId = eventId;
    void applyAttendanceChange(row, next).then((savedRow) => {
      if (savedRow && eventContext.generation === currentGeneration && eventId === currentEventId) {
        dispatchUndo({
          entry: {
            actionSequence,
            displayName: row.displayName,
            eventId: currentEventId,
            expectedUpdatedAt: savedRow.updatedAt,
            id: crypto.randomUUID(),
            previousAttendance: priorAttendance,
            profileId: row.profileId,
            resultingAttendance: next,
          },
          type: "add",
        });
        setUndoError(null);
        setLiveAnnouncement(
          `${row.displayName} marked ${attendanceActionLabel(next)}. Undo is available.`,
        );
      }
    });
  }

  async function confirmUnexpectedAttendance() {
    const candidate = rescueCandidate;
    if (!candidate || rescueBusy) return;
    const row = rows.find((current) => current.profileId === candidate.profileId);
    if (!row) {
      setRescueCandidate(null);
      return;
    }
    if (row.rsvp === "Yes") {
      setRescueCandidate(null);
      void applyAttendanceChange(row, "Present");
      return;
    }
    setRescueBusy(true);
    const candidateProfileId = candidate.profileId;
    const saved = await applyAttendanceChange(row, "Present");
    setRescueBusy(false);
    if (saved) {
      dispatchUndo({ profileIds: new Set([candidateProfileId]), type: "invalidateProfiles" });
      setRescueCandidate(null);
    }
  }

  async function saveRemainingPresent({
    targetEventId,
    markableRows,
  }: {
    readonly targetEventId: string;
    readonly markableRows: readonly OrganizationAttendanceRow[];
  }) {
    setBulkBusy(true);
    setMessage(null);
    const affectedProfileIds = new Set(markableRows.map((r) => r.profileId));
    dispatchUndo({ profileIds: affectedProfileIds, type: "invalidateProfiles" });

    const currentRows = queryClient.getQueryData<readonly OrganizationAttendanceRow[]>(
      queryKeys.organization.attendance(targetEventId),
    );
    const currentById = new Map((currentRows ?? []).map((row) => [row.profileId, row]));
    const previousRows = new Map<string, OrganizationAttendanceRow>();
    const optimisticRows = new Map<string, OrganizationAttendanceRow>();
    for (const row of markableRows) {
      const previous = currentById.get(row.profileId) ?? row;
      previousRows.set(row.profileId, previous);
      optimisticRows.set(row.profileId, { ...previous, attendance: "Present" });
    }

    const rowGenerations = new Map<string, number>();
    for (const r of markableRows) {
      const gen = (mutationGenerations.current.get(r.profileId) ?? 0) + 1;
      mutationGenerations.current.set(r.profileId, gen);
      rowGenerations.set(r.profileId, gen);
    }

    queryClient.setQueryData(
      queryKeys.organization.attendance(targetEventId),
      (current: readonly OrganizationAttendanceRow[] | undefined) =>
        (current ?? []).map((row) => optimisticRows.get(row.profileId) ?? row),
    );
    const optimisticVersions = new Map(
      (
        queryClient.getQueryData<readonly OrganizationAttendanceRow[]>(
          queryKeys.organization.attendance(targetEventId),
        ) ?? []
      ).map((row) => [row.profileId, row]),
    );
    try {
      const saved = await updateOrganizationEventAttendance(
        targetEventId,
        markableRows.map((row) => ({
          attendance: "Present" as const,
          profileId: row.profileId,
        })),
      );
      const savedById = new Map(saved.map((row) => [row.profileId, row]));
      queryClient.setQueryData(
        queryKeys.organization.attendance(targetEventId),
        (current: readonly OrganizationAttendanceRow[] | undefined) =>
          (current ?? []).map((row) => {
            const gen = rowGenerations.get(row.profileId);
            if (gen !== undefined && mutationGenerations.current.get(row.profileId) === gen) {
              return savedById.get(row.profileId) ?? row;
            }
            return row;
          }),
      );
    } catch (error: unknown) {
      queryClient.setQueryData(
        queryKeys.organization.attendance(targetEventId),
        (current: readonly OrganizationAttendanceRow[] | undefined) =>
          (current ?? []).map((row) => {
            const gen = rowGenerations.get(row.profileId);
            if (
              gen !== undefined &&
              mutationGenerations.current.get(row.profileId) === gen &&
              row === optimisticVersions.get(row.profileId)
            ) {
              return previousRows.get(row.profileId) ?? row;
            }
            return row;
          }),
      );
      setMessage(
        error instanceof AuthApiError && error.code === "attendance_profile_ineligible"
          ? error.message
          : "The remaining attendance could not be saved. Try again.",
      );
    } finally {
      setBulkBusy(false);
    }
  }

  const mutationKey = queryKeys.organization.attendance(eventId);
  async function cancelAttendanceRefresh({ targetEventId }: { readonly targetEventId: string }) {
    pendingSaveCounts.current.set(
      targetEventId,
      (pendingSaveCounts.current.get(targetEventId) ?? 0) + 1,
    );
    await queryClient.cancelQueries({
      exact: true,
      queryKey: queryKeys.organization.attendance(targetEventId),
    });
  }
  async function refreshAfterLastSave(
    _data: unknown,
    _error: Error | null,
    { targetEventId }: { readonly targetEventId: string },
  ) {
    const queryKey = queryKeys.organization.attendance(targetEventId);
    // Count completed writes synchronously: simultaneous settlements can otherwise
    // each see the other mutation as pending and both skip the final refresh.
    const remaining = (pendingSaveCounts.current.get(targetEventId) ?? 1) - 1;
    if (remaining > 0) {
      pendingSaveCounts.current.set(targetEventId, remaining);
      return;
    }
    pendingSaveCounts.current.delete(targetEventId);
    await queryClient.invalidateQueries({ exact: true, queryKey });
  }
  const rowMutation = useMutation({
    mutationFn: saveRow,
    mutationKey,
    onMutate: cancelAttendanceRefresh,
    onSettled: refreshAfterLastSave,
  });
  const bulkMutation = useMutation({
    mutationFn: saveRemainingPresent,
    mutationKey,
    onMutate: cancelAttendanceRefresh,
    onSettled: refreshAfterLastSave,
  });

  async function markRemainingPresent(markableRows: readonly OrganizationAttendanceRow[]) {
    if (!eventId || markableRows.length === 0 || bulkBusy || bulkMutation.isPending) return;
    await bulkMutation.mutateAsync({ targetEventId: eventId, markableRows });
  }

  async function undoLatest(): Promise<boolean> {
    const topEntry = undoEntries[undoEntries.length - 1];
    if (!topEntry || undoBusy || savingIds.has(topEntry.profileId) || bulkBusy || rescueBusy) {
      return false;
    }
    setUndoBusy(true);
    setUndoError(null);
    setLiveAnnouncement(`Restoring ${topEntry.displayName}…`);

    const currentRow = rows.find((r) => r.profileId === topEntry.profileId);
    const restoreRow: OrganizationAttendanceRow = currentRow ?? {
      attendance: topEntry.resultingAttendance,
      displayName: topEntry.displayName,
      profileId: topEntry.profileId,
      rsvp: "Pending",
      updatedAt: topEntry.expectedUpdatedAt,
      voicePart: "",
    };

    try {
      const savedRow = await rowMutation.mutateAsync({
        expectedUpdatedAt: topEntry.expectedUpdatedAt,
        nextValue: topEntry.previousAttendance,
        row: restoreRow,
        targetEventId: topEntry.eventId,
      });

      dispatchUndo({
        id: topEntry.id,
        nextUpdatedAt: savedRow?.updatedAt ?? null,
        type: "remove",
      });
      setLiveAnnouncement(
        `${topEntry.displayName} restored to ${attendanceActionLabel(topEntry.previousAttendance)}.`,
      );
      return true;
    } catch (error: unknown) {
      if (error instanceof AuthApiError && error.code === "attendance_conflict") {
        dispatchUndo({
          profileIds: new Set([topEntry.profileId]),
          type: "invalidateProfiles",
        });
        setMessage(
          `Could not restore ${topEntry.displayName}. That attendance record was updated elsewhere.`,
        );
        setLiveAnnouncement(
          `Could not restore ${topEntry.displayName}. Attendance was updated elsewhere.`,
        );
        setUndoError({
          kind: "conflict",
          profileId: topEntry.profileId,
        });
        await queryClient.invalidateQueries({
          exact: true,
          queryKey: queryKeys.organization.attendance(eventId),
        });
      } else {
        setUndoError({
          kind: "error",
          profileId: topEntry.profileId,
        });
        setLiveAnnouncement(`Could not restore ${topEntry.displayName}. Try again.`);
      }
      return false;
    } finally {
      setUndoBusy(false);
    }
  }

  return {
    bulkBusy,
    bulkConfirmOpen,
    changeAttendance,
    confirmUnexpectedAttendance,
    latestUndoEntry: undoEntries[undoEntries.length - 1] ?? null,
    liveAnnouncement,
    markRemainingPresent,
    message,
    rescueBusy,
    rescueCandidate,
    savingIds,
    setBulkConfirmOpen,
    setRescueCandidate,
    undoBusy,
    undoEntries,
    undoError,
    undoLatest,
  };
}
