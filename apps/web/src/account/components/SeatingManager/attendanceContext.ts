import { hasAttendanceWarning } from "@choir/domain";
import { createContext } from "react";
import type { OrganizationAttendanceRow, OrganizationProfile } from "@choir/contracts";

export type SeatingAttendanceWarning = NonNullable<OrganizationAttendanceRow["attendanceWarning"]>;
export const SeatingAttendanceContext = createContext<
  ReadonlyMap<string, SeatingAttendanceWarning>
>(new Map());

export function describeSeatingAttendanceWarning(
  warning: SeatingAttendanceWarning | undefined,
): string | undefined {
  if (!warning || !hasAttendanceWarning(warning.missedRehearsals, warning.threshold))
    return undefined;
  return `Attendance warning: ${String(warning.missedRehearsals)} of ${String(warning.totalRehearsals)} linked rehearsals missed; threshold ${String(warning.threshold)}.`;
}

export function seatingSeatAccessibleLabel(
  label: string,
  profile: OrganizationProfile | undefined,
  warnings: ReadonlyMap<string, SeatingAttendanceWarning>,
): string {
  const name = `${label}${profile ? `, assigned to ${profile.displayName}` : ", empty"}`;
  const description = describeSeatingAttendanceWarning(warnings.get(profile?.id ?? ""));
  return description ? `${name}, ${description}` : name;
}
