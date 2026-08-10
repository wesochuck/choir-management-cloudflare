import { useState } from "react";

import { EmailProviderFeedbackDirectory } from "./EmailProviderFeedbackDirectory";
import { QueueDeadLetterDirectory } from "./QueueDeadLetterDirectory";
import type { PlatformDeadLetterTab } from "./shared";

export function PlatformDeadLetterWorkspace() {
  const [tab, setTab] = useState<PlatformDeadLetterTab>("queue");
  return (
    <>
      <nav aria-label="Dead-letter sections" className="ticketing-tabs" role="tablist">
        <button
          aria-controls="platform-email-provider-events-panel"
          aria-selected={tab === "email-provider"}
          className={tab === "email-provider" ? "is-active" : undefined}
          id="platform-email-provider-events-tab"
          onClick={() => {
            setTab("email-provider");
          }}
          role="tab"
          type="button"
        >
          Email provider events
        </button>
        <button
          aria-controls="platform-queue-dead-letters-panel"
          aria-selected={tab === "queue"}
          className={tab === "queue" ? "is-active" : undefined}
          id="platform-queue-dead-letters-tab"
          onClick={() => {
            setTab("queue");
          }}
          role="tab"
          type="button"
        >
          Queue DLQ
        </button>
      </nav>
      {tab === "email-provider" ? (
        <div
          aria-labelledby="platform-email-provider-events-tab"
          id="platform-email-provider-events-panel"
          role="tabpanel"
        >
          <EmailProviderFeedbackDirectory />
        </div>
      ) : (
        <div
          aria-labelledby="platform-queue-dead-letters-tab"
          id="platform-queue-dead-letters-panel"
          role="tabpanel"
        >
          <QueueDeadLetterDirectory />
        </div>
      )}
    </>
  );
}
