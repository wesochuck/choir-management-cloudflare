import { accessibleSeatingRequestLabel } from "./attendanceContext";

export function AccessibleSeatingMarker({
  decorative = false,
  visible = true,
}: {
  readonly decorative?: boolean;
  readonly visible?: boolean;
}) {
  if (!visible) return null;
  return (
    <svg
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : accessibleSeatingRequestLabel}
      className="seating-accessibility-icon no-print"
      fill="none"
      role={decorative ? undefined : "img"}
      viewBox="0 0 24 24"
    >
      {!decorative ? <title>{accessibleSeatingRequestLabel}</title> : null}
      <circle cx="12" cy="4" r="2.5" fill="currentColor" />
      <path
        d="M4 9h16M12 9v5m0 0-4 7m4-7 4 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.5"
      />
    </svg>
  );
}
