import type {
  OrganizationAttendanceRow,
  OrganizationAttendanceStatus,
  OrganizationEvent,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import {
  getOrganizationRosterConfiguration,
  listOrganizationEventAttendance,
  listOrganizationEvents,
  listOrganizationVenues,
  queryKeys,
  updateOrganizationEventAttendance,
} from "../../../api";
import { type AttendanceGroup, groupRowsBySection } from "./grouping";

export type { AttendanceGroup };
export type AttendanceFilter = "All" | "Present" | "Absent" | "Pending";

const nextAttendance: Record<OrganizationAttendanceStatus, OrganizationAttendanceStatus> = {
  Absent: "Pending",
  Pending: "Present",
  Present: "Absent",
};

function closestFutureEvent(
  events: readonly OrganizationEvent[],
  now = Date.now(),
): OrganizationEvent | undefined {
  let closest: OrganizationEvent | undefined;
  let closestStartsAt = Number.POSITIVE_INFINITY;
  for (const event of events) {
    const startsAt = Date.parse(event.startsAt);
    if (!Number.isFinite(startsAt) || startsAt <= now || startsAt >= closestStartsAt) continue;
    closest = event;
    closestStartsAt = startsAt;
  }
  return closest;
}

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

  const defaultEventId = useMemo(
    () => closestFutureEvent(events)?.id ?? events[0]?.id ?? "",
    [events],
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
  }: {
    readonly targetEventId: string;
    readonly row: OrganizationAttendanceRow;
    readonly nextValue: OrganizationAttendanceStatus;
  }) {
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
    } catch {
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
      setMessage("That attendance update could not be saved. Try again.");
      throw new Error("attendance_update_failed");
    } finally {
      if (mutationGenerations.current.get(profileId) === generation) {
        markSaving(profileId, false);
      }
    }
  }

  async function applyAttendanceChange(
    row: OrganizationAttendanceRow,
    next: OrganizationAttendanceStatus,
  ): Promise<boolean> {
    try {
      await rowMutation.mutateAsync({ targetEventId: eventId, row, nextValue: next });
      return true;
    } catch {
      return false;
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
    void applyAttendanceChange(row, next);
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
    const saved = await applyAttendanceChange(row, "Present");
    setRescueBusy(false);
    if (saved) setRescueCandidate(null);
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
    } catch {
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
      setMessage("The remaining attendance could not be saved. Try again.");
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

  return {
    bulkBusy,
    bulkConfirmOpen,
    changeAttendance,
    confirmUnexpectedAttendance,
    markRemainingPresent,
    message,
    rescueBusy,
    rescueCandidate,
    savingIds,
    setBulkConfirmOpen,
    setRescueCandidate,
  };
}
