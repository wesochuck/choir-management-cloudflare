import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@choir/ui";

import { EmailProviderFeedbackDirectory } from "./EmailProviderFeedbackDirectory";
import { QueueDeadLetterDirectory } from "./QueueDeadLetterDirectory";
import type { PlatformDeadLetterTab } from "./shared";

export function PlatformDeadLetterWorkspace() {
  const [tab, setTab] = useState<PlatformDeadLetterTab>("queue");
  return (
    <Tabs onValueChange={setTab} value={tab}>
      <TabsList aria-label="Dead-letter sections" as="nav" className="ticketing-tabs">
        <TabsTrigger
          aria-controls="platform-email-provider-events-panel"
          id="platform-email-provider-events-tab"
          value="email-provider"
        >
          Email provider events
        </TabsTrigger>
        <TabsTrigger
          aria-controls="platform-queue-dead-letters-panel"
          id="platform-queue-dead-letters-tab"
          value="queue"
        >
          Queue DLQ
        </TabsTrigger>
      </TabsList>
      <TabsContent
        aria-labelledby="platform-email-provider-events-tab"
        id="platform-email-provider-events-panel"
        value="email-provider"
      >
        <EmailProviderFeedbackDirectory />
      </TabsContent>
      <TabsContent
        aria-labelledby="platform-queue-dead-letters-tab"
        id="platform-queue-dead-letters-panel"
        value="queue"
      >
        <QueueDeadLetterDirectory />
      </TabsContent>
    </Tabs>
  );
}
