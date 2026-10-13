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
  return (
    <SeatingManagerView
      model={useSeatingManagerController({ enabled })}
      navigate={navigate}
      canReviewRsvps={enabled && canReviewRsvps}
    />
  );
}
