import type {
  CommunicationOverviewItem,
  CommunicationOverview as OverviewData,
} from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import { CommunicationDeliveryDetails } from "./CommunicationDeliveryDetails";
import { TicketNotificationDetails } from "./TicketNotificationDetails";
import type { CommunicationCenterControllerModel } from "./types";

type Model = CommunicationCenterControllerModel;
const groups = [
  {
    title: "Ticket confirmations & receipts",
    description: "Triggered by purchases, refunds, and upcoming concerts.",
    href: "/admin/tickets?tab=confirmation",
    label: "Ticket settings",
  },
  {
    title: "Event reminders & reports",
    description: "Managed in event settings and RSVP automation.",
    href: "/admin/rsvp?tab=automation",
    label: "Event automation",
  },
  {
    title: "Audition messages",
    description: "Confirmations and reminders managed with auditions.",
    href: "/admin/auditions",
    label: "Audition settings",
  },
  {
    title: "Incomplete checkout reminders",
    description: "Follow-ups for unfinished ticket and donation checkouts.",
    href: "/admin/settings?tab=payments",
    label: "Reminder settings",
  },
] as const;

export function CommunicationAutomationDirectory({
  compact = false,
}: {
  readonly compact?: boolean;
}) {
  return (
    <section aria-label="Automatic messages" className="communication-overview__panel">
      <h2>Automatic messages</h2>
      {!compact ? (
        <p className="field-help">
          These messages run from settings in other parts of the app. Open the relevant area to
          review its rules and wording.
        </p>
      ) : null}
      <ul className="communication-overview__rows">
        {(compact ? groups.slice(0, 2) : groups).map((group) => (
          <li key={group.title} className="communication-overview__row">
            <div>
              <h3>{group.title}</h3>
              <p className="field-help">{group.description}</p>
            </div>
            <a href={group.href} className="text-button">
              {group.label}
            </a>
          </li>
        ))}
      </ul>
      {compact ? (
        <a href="/admin/communications?tab=automations" className="text-button">
          View all automations
        </a>
      ) : null}
    </section>
  );
}

function date(value: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(value));
}
function RowAction({
  item,
  model,
  drafts,
}: {
  readonly item: CommunicationOverviewItem;
  readonly model: Model;
  readonly drafts: boolean;
}) {
  if (drafts && item.message)
    return (
      <button
        type="button"
        className="text-button"
        onClick={() => {
          if (item.message) model.resumeDraft(item.message);
        }}
      >
        Continue writing
      </button>
    );
  if (item.source === "message" && item.message)
    return (
      <button
        type="button"
        className="text-button"
        disabled={model.loadingDeliveryId === item.id}
        onClick={() => {
          if (item.message) void model.openDeliveryDetails(item.message);
        }}
      >
        View details
      </button>
    );
  if (item.source === "ticket")
    return (
      <TicketNotificationDetails
        notificationId={item.id}
        onCancel={model.cancelQueuedMessage}
        timezone={model.overview.data?.timezone}
      />
    );
  return (
    <a href={item.href} className="text-button">
      {item.projected ? "View settings" : "Review"}
    </a>
  );
}
function statusClass(status: CommunicationOverviewItem["status"]) {
  if (status === "Sent") return "sent";
  return status === "Failed" || status === "Sent with issues" ? "failed" : "neutral";
}
function statusLabel(item: CommunicationOverviewItem) {
  if (item.projected) return "Automatic preview";
  return item.status === "Scheduled" ? "Scheduled send" : item.status;
}
function OverviewRow({
  item,
  model,
  drafts,
}: {
  readonly item: CommunicationOverviewItem;
  readonly model: Model;
  readonly drafts: boolean;
}) {
  const recipients =
    item.recipientCount === null || drafts
      ? ""
      : ` · ${String(item.recipientCount)} ${item.recipientCount === 1 ? "recipient" : "recipients"}`;
  return (
    <li className="communication-overview__row">
      <div className="communication-overview__row-copy">
        <h3>{item.subject}</h3>
        <p className="field-help">
          {date(item.timestamp, model.overview.data?.timezone ?? "UTC")} · {item.channel}
          {item.automatic ? " · Automatic" : ""}
          {recipients}
        </p>
        {!drafts ? (
          <span
            className={`communication-overview__status communication-overview__status--${statusClass(item.status)}`}
          >
            {statusLabel(item)}
          </span>
        ) : null}
      </div>
      <RowAction item={item} model={model} drafts={drafts} />
    </li>
  );
}
function OverviewRows({
  items,
  model,
  drafts = false,
}: {
  readonly items: readonly CommunicationOverviewItem[];
  readonly model: Model;
  readonly drafts?: boolean;
}) {
  return (
    <ul className="communication-overview__rows">
      {items.map((item) => (
        <OverviewRow key={`${item.source}:${item.id}`} item={item} model={model} drafts={drafts} />
      ))}
    </ul>
  );
}
function HistoryLink({
  model,
  query,
  children,
}: {
  readonly model: Model;
  readonly query: string;
  readonly children: string;
}) {
  return (
    <button
      type="button"
      className="text-button"
      onClick={() => {
        model.navigateCommunication(`/admin/communications?${query}`);
      }}
    >
      {children}
    </button>
  );
}
function DeliveryStatus({ data, model }: { readonly data: OverviewData; readonly model: Model }) {
  const { loading } = model.overview;
  let message = "No delivery problems to review";
  if (loading) message = "Checking delivery status…";
  else if (data.attention.length) message = "Delivery needs attention";
  return (
    <section aria-label="Delivery status" className="communication-overview__health">
      <p>{message}</p>
      <HistoryLink model={model} query="tab=messages">
        View delivery history
      </HistoryLink>
      {!loading && data.attention.length ? (
        <>
          <p className="field-help">
            Review failed deliveries and potentially delayed messages. An email already sent cannot
            be recalled.
          </p>
          <OverviewRows items={data.attention} model={model} />
        </>
      ) : null}
    </section>
  );
}
function DraftsAndRecent({ data, model }: { readonly data: OverviewData; readonly model: Model }) {
  const draftCount =
    !data.hasMore.drafts && data.drafts.length
      ? ` · ${String(data.drafts.length)} ${data.drafts.length === 1 ? "draft" : "drafts"}`
      : "";
  return (
    <div className="communication-overview__main">
      <section aria-labelledby="communication-drafts-heading">
        <div className="communication-overview__section-heading">
          <h2 id="communication-drafts-heading">
            Drafts<span className="field-help">{draftCount}</span>
          </h2>
          <HistoryLink model={model} query="tab=messages&status=draft">
            View all drafts
          </HistoryLink>
        </div>
        {data.drafts.length ? (
          <OverviewRows items={data.drafts} model={model} drafts />
        ) : (
          <p className="field-help">No drafts. Start a new message when you’re ready.</p>
        )}
      </section>
      <section aria-labelledby="communication-recent-heading">
        <div className="communication-overview__section-heading">
          <h2 id="communication-recent-heading">Recent messages</h2>
          <HistoryLink model={model} query="tab=messages">
            View all messages
          </HistoryLink>
        </div>
        {data.recent.length ? (
          <OverviewRows items={data.recent} model={model} />
        ) : (
          <p className="field-help">No messages have been sent yet.</p>
        )}
      </section>
    </div>
  );
}
function Upcoming({ data, model }: { readonly data: OverviewData; readonly model: Model }) {
  return (
    <section
      aria-labelledby="communication-upcoming-heading"
      className="communication-overview__panel"
    >
      <div className="communication-overview__section-heading">
        <h2 id="communication-upcoming-heading">Coming up</h2>
        <span className="field-help">Next 7 days</span>
      </div>
      {data.upcoming.length ? (
        <OverviewRows items={data.upcoming} model={model} />
      ) : (
        <p className="field-help">
          No scheduled messages or automatic previews in the next seven days.
        </p>
      )}
      <p className="field-help">
        Previews are based on event settings. Recipients are confirmed when messages run.
      </p>
      <HistoryLink model={model} query="tab=messages&status=scheduled">
        View upcoming messages
      </HistoryLink>
    </section>
  );
}
function OverviewContent({
  data,
  model,
  automations,
}: {
  readonly data: OverviewData;
  readonly model: Model;
  readonly automations: boolean;
}) {
  return (
    <>
      {!automations ? <DeliveryStatus data={data} model={model} /> : null}
      <div className="communication-overview__columns">
        {automations ? (
          <CommunicationAutomationDirectory />
        ) : (
          <DraftsAndRecent data={data} model={model} />
        )}
        <div className="communication-overview__aside">
          <Upcoming data={data} model={model} />
          {!automations ? <CommunicationAutomationDirectory compact /> : null}
        </div>
      </div>
      <p className="field-help">Updated {date(data.asOf, data.timezone)}</p>
    </>
  );
}
function DeliveryDialog({ model }: { readonly model: Model }) {
  return (
    <Dialog
      open={model.deliveryDetailsMessage !== null}
      title={model.deliveryDetailsMessage?.subject ?? "Delivery details"}
      onClose={model.clearDeliveryDetails}
      footer={
        <DialogClose asChild>
          <button type="button" className="button button--secondary">
            Close
          </button>
        </DialogClose>
      }
    >
      {model.deliveryDetailsMessage && model.deliverySummary ? (
        <CommunicationDeliveryDetails
          branding={model.branding}
          busy={model.busy}
          events={model.events}
          message={model.deliveryDetailsMessage}
          onRetry={async () => {
            if (model.deliveryDetailsMessage)
              await model.retryDeliveries(model.deliveryDetailsMessage.id);
          }}
          summary={model.deliverySummary}
          timezone={model.timezone}
          venues={model.venues}
        />
      ) : null}
    </Dialog>
  );
}
export function CommunicationOverview({
  model,
  automations = false,
}: {
  readonly model: Model;
  readonly automations?: boolean;
}) {
  const { data, loading, error } = model.overview;
  return (
    <div className="communication-overview">
      {error ? (
        <div className="notice notice--error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              void model.overview.refresh();
            }}
          >
            Try again
          </button>
        </div>
      ) : null}
      {loading ? <p role="status">Refreshing communications…</p> : null}
      {data && !error ? (
        <OverviewContent data={data} model={model} automations={automations} />
      ) : null}
      <DeliveryDialog model={model} />
    </div>
  );
}
