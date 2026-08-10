import type { PlatformJobDeadLetterSummary } from "@choir/contracts";

import { QueueDeadLetterActions } from "./QueueDeadLetterActions";
import { QueueDeadLetterCopy } from "./QueueDeadLetterCopy";
import type { DeadLetterActionTarget } from "./shared";

export function QueueDeadLetterRow({
  deadLetter,
  openAction,
}: {
  readonly deadLetter: PlatformJobDeadLetterSummary;
  readonly openAction: (
    action: DeadLetterActionTarget["action"],
    deadLetter: PlatformJobDeadLetterSummary,
  ) => void;
}) {
  return (
    <li>
      <QueueDeadLetterCopy deadLetter={deadLetter} />
      <QueueDeadLetterActions deadLetter={deadLetter} openAction={openAction} />
    </li>
  );
}
