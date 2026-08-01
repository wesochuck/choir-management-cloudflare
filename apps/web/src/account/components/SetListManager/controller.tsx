import { SetListManagerView } from "./view";
import { useSetListManagerController } from "./hooks";

export function SetListManager({ enabled }: { readonly enabled: boolean }) {
  return <SetListManagerView model={useSetListManagerController({ enabled })} />;
}
