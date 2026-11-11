import { CommunicationCenterView } from "./view";
import { useCommunicationCenterController } from "./hooks";

export function CommunicationCenter({
  enabled,
  search,
  navigate,
}: {
  readonly enabled: boolean;
  readonly search?: string;
  readonly navigate?: ((href: string) => void) | undefined;
}) {
  return (
    <CommunicationCenterView
      model={useCommunicationCenterController({ enabled, search, navigate })}
    />
  );
}
