import { SeatingAttendanceContext } from "./attendanceContext";
import { SeatingManagerView } from "./view";
import { useSeatingManagerController } from "./hooks";

export function SeatingManager({
  enabled,
  navigate,
  canReviewRsvps = false,
}: {
  readonly enabled: boolean;
  readonly canReviewRsvps?: boolean;
  readonly navigate?: ((href: string) => void) | undefined;
}) {
  const model = useSeatingManagerController({ enabled });
  return (
    <SeatingAttendanceContext.Provider
      value={model.loadedEventId === model.eventId ? model.attendanceWarnings : new Map()}
    >
      <SeatingManagerView
        model={model}
        navigate={navigate}
        canReviewRsvps={enabled && canReviewRsvps}
      />
    </SeatingAttendanceContext.Provider>
  );
}
