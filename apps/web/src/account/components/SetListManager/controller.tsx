import { SetListManagerView } from "./view";
import { useSetListManagerController } from "./hooks";

export function SetListManager({
  enabled,
  initialEventId,
  navigate,
}: {
  readonly enabled: boolean;
  readonly initialEventId?: string | null | undefined;
  readonly navigate?: ((href: string) => void) | undefined;
}) {
  return (
    <SetListManagerView
      model={useSetListManagerController({ enabled, initialEventId })}
      navigate={navigate}
    />
  );
}
