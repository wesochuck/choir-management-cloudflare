import { SeatingManagerView } from "./view";
import { useSeatingManagerController } from "./hooks";

export function SeatingManager({
  enabled,
  navigate,
}: {
  readonly enabled: boolean;
  readonly navigate?: ((href: string) => void) | undefined;
}) {
  return (
    <SeatingManagerView model={useSeatingManagerController({ enabled })} navigate={navigate} />
  );
}
