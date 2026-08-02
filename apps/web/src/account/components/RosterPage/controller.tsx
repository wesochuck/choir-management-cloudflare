import { RosterPageView } from "./view";
import { useRosterPageController } from "./hooks";
import type { ProfileTab } from "./types";

export function RosterPage({
  enabled,
  initialSection = "roster",
  initialProfileId,
  initialProfileTab = "info",
}: {
  readonly enabled: boolean;
  readonly initialSection?: "roster" | "settings";
  readonly initialProfileId?: string | null;
  readonly initialProfileTab?: ProfileTab;
}) {
  return (
    <RosterPageView
      initialSection={initialSection}
      model={useRosterPageController({
        enabled,
        ...(initialProfileId === undefined ? {} : { initialProfileId }),
        initialProfileTab,
      })}
    />
  );
}
