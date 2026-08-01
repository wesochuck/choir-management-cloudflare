import { SeatingManagerView } from "./view";
import { useSeatingManagerController } from "./hooks";

export function SeatingManager({ enabled }: { readonly enabled: boolean }) {
  return <SeatingManagerView model={useSeatingManagerController({ enabled })} />;
}
