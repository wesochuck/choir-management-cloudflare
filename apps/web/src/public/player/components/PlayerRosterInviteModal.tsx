import { Dialog } from "@choir/ui";

import { JoinRosterView } from "../../../auth/JoinRosterView";

export function PlayerRosterInviteModal({
  initialVoicePart,
  onClose,
  onComplete,
  open,
  organizationName,
  token,
}: {
  readonly initialVoicePart?: string | null | undefined;
  readonly onClose: () => void;
  readonly onComplete: () => void;
  readonly open: boolean;
  readonly organizationName?: string | undefined;
  readonly token: string;
}) {
  const trimmed = organizationName?.trim();
  const displayName = trimmed && trimmed.length > 0 ? trimmed : "Choir";

  return (
    <Dialog
      className="player-roster-invite-dialog"
      onClose={onClose}
      open={open}
      title={`Join ${displayName}`}
    >
      <JoinRosterView
        embedded
        initialToken={token}
        initialVoicePart={initialVoicePart}
        onCancel={onClose}
        onComplete={onComplete}
      />
    </Dialog>
  );
}
