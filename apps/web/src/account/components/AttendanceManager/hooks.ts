import type {
  OrganizationAttendanceRow,
  OrganizationAttendanceStatus,
  OrganizationEvent,
} from "@choir/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  listOrganizationEventAttendance,
  listOrganizationEvents,
  listOrganizationVenues,
  queryKeys,
  updateOrganizationEventAttendance,
} from "../../../api";

export type AttendanceFilter = "All" | "Present" | "Absent" | "Pending";
export type AttendanceGroup = readonly [string, readonly OrganizationAttendanceRow[]];

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

function groupRowsByVoicePart(
  rows: readonly OrganizationAttendanceRow[],
): readonly AttendanceGroup[] {
  const groups = new Map<string, OrganizationAttendanceRow[]>();
  [...rows]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .forEach((row) => {
      const label = row.voicePart || "Other";
      const group = groups.get(label) ?? [];
      group.push(row);
      groups.set(label, group);
    });
  return [...groups.entries()];
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
    rows,
    setSelectedEventId,
    venues,
  };
}

export function useAttendanceFiltering({
  filter,
  query,
  rows,
  savingIds,
}: {
  readonly filter: AttendanceFilter;
  readonly query: string;
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
      notRsvped: groupRowsByVoicePart(filtered.filter((row) => row.rsvp !== "Yes")),
      rsvped: groupRowsByVoicePart(filtered.filter((row) => row.rsvp === "Yes")),
    };
  }, [filter, query, rows]);

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
    markSaving(row.profileId, true);
    setMessage(null);
    const nextValue = updates.attendance ?? row.attendance;
    const previous = queryClient.getQueryData<readonly OrganizationAttendanceRow[]>(
      queryKeys.organization.attendance(eventId),
    );
    queryClient.setQueryData(
      queryKeys.organization.attendance(eventId),
      (current: readonly OrganizationAttendanceRow[] | undefined) =>
        (current ?? []).map((candidate) =>
          candidate.profileId === row.profileId
            ? { ...candidate, attendance: nextValue }
            : candidate,
        ),
    );
    try {
      const saved = await updateOrganizationEventAttendance(eventId, [
        {
          attendance: nextValue,
          profileId: row.profileId,
        },
      ]);
      const savedRow = saved.find((candidate) => candidate.profileId === row.profileId);
      if (savedRow) {
        queryClient.setQueryData(
          queryKeys.organization.attendance(eventId),
          (current: readonly OrganizationAttendanceRow[] | undefined) =>
            (current ?? []).map((candidate) =>
              candidate.profileId === row.profileId ? savedRow : candidate,
            ),
        );
      }
    } catch {
      queryClient.setQueryData(queryKeys.organization.attendance(eventId), previous);
      setMessage("That attendance update could not be saved. Try again.");
      throw new Error("attendance_update_failed");
    } finally {
      markSaving(row.profileId, false);
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
    setBulkBusy(true);
    setMessage(null);
    const previous = queryClient.getQueryData<readonly OrganizationAttendanceRow[]>(
      queryKeys.organization.attendance(eventId),
    );
    const targetProfileIds = new Set(markableRows.map((row) => row.profileId));
    queryClient.setQueryData(
      queryKeys.organization.attendance(eventId),
      (current: readonly OrganizationAttendanceRow[] | undefined) =>
        (current ?? []).map((row) =>
          targetProfileIds.has(row.profileId) ? { ...row, attendance: "Present" as const } : row,
        ),
    );
    try {
      const saved = await updateOrganizationEventAttendance(
        eventId,
        markableRows.map((row) => ({
          attendance: "Present" as const,
          profileId: row.profileId,
        })),
      );
      const savedById = new Map(saved.map((row) => [row.profileId, row]));
      queryClient.setQueryData(
        queryKeys.organization.attendance(eventId),
        (current: readonly OrganizationAttendanceRow[] | undefined) =>
          (current ?? []).map((row) => savedById.get(row.profileId) ?? row),
      );
    } catch {
      queryClient.setQueryData(queryKeys.organization.attendance(eventId), previous);
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
