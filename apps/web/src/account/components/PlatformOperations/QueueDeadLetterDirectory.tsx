import type { PlatformJobDeadLetterSummary, PlatformJobDeadLetterView } from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  dismissPlatformJobDeadLetter,
  listPlatformJobDeadLetters,
  retryPlatformJobDeadLetter,
} from "../../../auth/api";
import { QueueDeadLetterActionDialog } from "./QueueDeadLetterActionDialog";
import { QueueDeadLetterContent } from "./QueueDeadLetterContent";
import type { DeadLetterActionTarget, DeadLetterState } from "./shared";

async function performQueueAction(target: DeadLetterActionTarget, reason: string) {
  if (target.action === "retry") {
    return retryPlatformJobDeadLetter(target.deadLetter.id, reason);
  }
  return dismissPlatformJobDeadLetter(target.deadLetter.id, reason);
}

export function QueueDeadLetterDirectory() {
  const [deadLetters, setDeadLetters] = useState<DeadLetterState>({ status: "loading" });
  const [view, setView] = useState<PlatformJobDeadLetterView>("open");
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionTarget, setActionTarget] = useState<DeadLetterActionTarget | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    listPlatformJobDeadLetters(null, abortController.signal, view)
      .then((result) => {
        setDeadLetters({
          deadLetters: result.deadLetters,
          hasMore: result.nextCursor !== null,
          status: "ready",
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setDeadLetters({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, [refreshKey, view]);

  function openAction(
    action: DeadLetterActionTarget["action"],
    deadLetter: PlatformJobDeadLetterSummary,
  ): void {
    setActionTarget({ action, deadLetter });
    setActionError(null);
    setActionReason("");
  }

  function closeAction(): void {
    if (actionBusy) return;
    setActionTarget(null);
    setActionError(null);
    setActionReason("");
  }

  async function submitAction(): Promise<void> {
    if (!actionTarget) return;
    const reason = actionReason.trim();
    if (reason.length < 3 || reason.length > 500) {
      setActionError("Enter a reason between 3 and 500 characters.");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      const result = await performQueueAction(actionTarget, reason);
      setSuccess(
        result.actionStatus === "retry_queued"
          ? "The job was reset and a fresh queue attempt was created."
          : "The dead-letter record was dismissed. The originating job was not deleted.",
      );
      setDeadLetters({ status: "loading" });
      setActionTarget(null);
      setActionReason("");
      setRefreshKey((current) => current + 1);
    } catch (failure: unknown) {
      setActionError(
        failure instanceof AuthApiError
          ? failure.message
          : "The queue failure action could not be completed. Refresh and try again.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  function refresh(): void {
    setSuccess(null);
    setRefreshKey((current) => current + 1);
  }

  function changeView(nextView: PlatformJobDeadLetterView): void {
    setDeadLetters({ status: "loading" });
    setView(nextView);
  }

  return (
    <div className="platform-directory" aria-live="polite">
      <h4>Queue dead letters</h4>
      <p>
        These are final queue-failure records, not a second inbox. The original queue message has
        already been acknowledged and its payload is not stored here. Retry creates a fresh attempt
        from the originating record; dismiss only clears this incident from the needs-review list.
      </p>
      <QueueDeadLetterContent
        deadLetters={deadLetters}
        onRefresh={refresh}
        onViewChange={changeView}
        openAction={openAction}
        success={success}
        setSuccess={setSuccess}
        view={view}
      />
      <QueueDeadLetterActionDialog
        actionBusy={actionBusy}
        actionError={actionError}
        actionReason={actionReason}
        actionTarget={actionTarget}
        closeAction={closeAction}
        setActionReason={setActionReason}
        submitAction={submitAction}
      />
    </div>
  );
}
