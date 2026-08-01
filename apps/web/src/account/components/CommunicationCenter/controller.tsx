import { CommunicationCenterView } from "./view";
import { useCommunicationCenterController } from "./hooks";

export function CommunicationCenter({ enabled }: { readonly enabled: boolean }) {
  return <CommunicationCenterView model={useCommunicationCenterController({ enabled })} />;
}
