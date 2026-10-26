import { useContext } from "react";
import { SeatingAttendanceContext, describeSeatingAttendanceWarning } from "./attendanceContext";

export function AttendanceWarningBadge({ profileId }: { readonly profileId: string }) {
  const warning = useContext(SeatingAttendanceContext).get(profileId);
  const description = describeSeatingAttendanceWarning(warning);
  if (!warning || !description) return null;
  return (
    <span
      className="seating-attendance-warning"
      role="img"
      aria-label={description}
      title={description}
    >
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4m0 4h.01" />
      </svg>
      <span aria-hidden="true">{warning.missedRehearsals}</span>
    </span>
  );
}
