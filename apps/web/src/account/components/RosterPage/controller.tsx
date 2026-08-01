import { RosterPageView } from "./view";
import { useRosterPageController } from "./hooks";
import type { ProfileTab } from "./types";

export function RosterPage({
  enabled,
  initialProfileId,
  initialProfileTab = "info",
}: {
  readonly enabled: boolean;
  readonly initialProfileId?: string | null;
  readonly initialProfileTab?: ProfileTab;
}) {
  return (
    <RosterPageView
      model={useRosterPageController({
        enabled,
        ...(initialProfileId === undefined ? {} : { initialProfileId }),
        initialProfileTab,
      })}
    />
  );
}
