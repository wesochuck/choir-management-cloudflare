import type {
  OrganizationAttendanceRow,
  OrganizationAttendanceStatus,
  OrganizationEvent,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

  const { data: rows = [], dataUpdatedAt } = useQuery({
    enabled: enabled && Boolean(eventId),
    queryFn: ({ signal }) => listOrganizationEventAttendance(eventId, signal),
    queryKey: queryKeys.organization.attendance(eventId),
    refetchInterval: 30_000,
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

  async function saveRow(
    row: OrganizationAttendanceRow,
    updates: Partial<OrganizationAttendanceRow>,
  ) {
    const targetEventId = eventId;
    const profileId = row.profileId;
    const nextValue = updates.attendance ?? row.attendance;

    const generation = (mutationGenerations.current.get(profileId) ?? 0) + 1;
    mutationGenerations.current.set(profileId, generation);

    markSaving(profileId, true);
    setMessage(null);

    const currentRows = queryClient.getQueryData<readonly OrganizationAttendanceRow[]>(
      queryKeys.organization.attendance(targetEventId),
    );
    const previousAttendance =
      currentRows?.find((candidate) => candidate.profileId === profileId)?.attendance ??
      row.attendance;

    queryClient.setQueryData(
      queryKeys.organization.attendance(targetEventId),
      (current: readonly OrganizationAttendanceRow[] | undefined) =>
        (current ?? []).map((candidate) =>
          candidate.profileId === profileId ? { ...candidate, attendance: nextValue } : candidate,
        ),
    );
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
              mutationGenerations.current.get(profileId) === generation
            ) {
              return { ...candidate, attendance: previousAttendance };
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
      await saveRow(row, { attendance: next });
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

  async function markRemainingPresent(markableRows: readonly OrganizationAttendanceRow[]) {
    if (!eventId || markableRows.length === 0 || bulkBusy) return;
    const targetEventId = eventId;
    setBulkBusy(true);
    setMessage(null);

    const targetProfileIds = new Set(markableRows.map((row) => row.profileId));
    const currentRows = queryClient.getQueryData<readonly OrganizationAttendanceRow[]>(
      queryKeys.organization.attendance(targetEventId),
    );
    const previousAttendanceMap = new Map<string, OrganizationAttendanceStatus>();
    for (const r of markableRows) {
      const prev =
        currentRows?.find((c) => c.profileId === r.profileId)?.attendance ?? r.attendance;
      previousAttendanceMap.set(r.profileId, prev);
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
        (current ?? []).map((row) =>
          targetProfileIds.has(row.profileId) ? { ...row, attendance: "Present" as const } : row,
        ),
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
            if (gen !== undefined && mutationGenerations.current.get(row.profileId) === gen) {
              const prev = previousAttendanceMap.get(row.profileId);
              if (prev !== undefined) {
                return { ...row, attendance: prev };
              }
            }
            return row;
          }),
      );
      setMessage("The remaining attendance could not be saved. Try again.");
    } finally {
      setBulkBusy(false);
    }
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
