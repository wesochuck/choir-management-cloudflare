function asObject(value) {
  return typeof value === "object" && value !== null ? value : null;
}

function asString(value) {
  return typeof value === "string" ? value : null;
}

function eventMatchesPrefix(event, titlePrefix) {
  const candidate = asObject(event);
  const id = asString(candidate?.id);
  const title = asString(candidate?.title);
  return id !== null && title !== null && title.startsWith(titlePrefix);
}

export function selectQualificationEvents(events, titlePrefix) {
  if (!Array.isArray(events) || titlePrefix.trim().length === 0) return [];
  return events
    .filter((event) => eventMatchesPrefix(event, titlePrefix))
    .map((event) => ({
      id: event.id,
      isCanceled: event.isCanceled === true,
      startsAt: asString(event.startsAt),
      title: event.title,
      type: asString(event.type),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function matchingEventId(value, eventIds) {
  const eventId = asString(value);
  return eventId !== null && eventIds.has(eventId) ? eventId : null;
}

function countByKey(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = asString(row[key]);
    if (value !== null) counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function summarizeScheduledMessages(messages, eventIds) {
  const ids = new Set(eventIds);
  const rows = Array.isArray(messages)
    ? messages
        .map((message) => {
          const candidate = asObject(message);
          const eventId = matchingEventId(candidate?.eventId, ids);
          const id = asString(candidate?.id);
          const kind = asString(candidate?.kind);
          const status = asString(candidate?.status);
          if (eventId === null || id === null || kind === null || status === null) return null;
          return {
            eventId,
            id,
            kind,
            recipientCount:
              typeof candidate?.recipientCount === "number" &&
              Number.isInteger(candidate.recipientCount) &&
              candidate.recipientCount >= 0
                ? candidate.recipientCount
                : 0,
            status,
          };
        })
        .filter((row) => row !== null)
    : [];
  rows.sort((left, right) => left.id.localeCompare(right.id));
  return {
    byKind: countByKey(rows, "kind"),
    byStatus: countByKey(rows, "status"),
    recipientCount: rows.reduce((total, row) => total + row.recipientCount, 0),
    rowKeys: rows.map((row) => `${row.kind}:${row.eventId}:${row.id}`),
    rows,
    total: rows.length,
  };
}

export function summarizeCommunicationMessages(messages, eventIds) {
  const ids = new Set(eventIds);
  const rows = Array.isArray(messages)
    ? messages
        .map((message) => {
          const candidate = asObject(message);
          const audience = asObject(candidate?.audience);
          const eventId = matchingEventId(audience?.eventId, ids);
          const id = asString(candidate?.id);
          const status = asString(candidate?.status);
          const channel = asString(candidate?.channel);
          if (eventId === null || id === null || status === null || channel === null) return null;
          const reach = asObject(candidate?.reach);
          return {
            channel,
            eventId,
            id,
            reachTotal:
              typeof reach?.total === "number" && Number.isInteger(reach.total) && reach.total >= 0
                ? reach.total
                : 0,
            status,
          };
        })
        .filter((row) => row !== null)
    : [];
  rows.sort((left, right) => left.id.localeCompare(right.id));
  return {
    byStatus: countByKey(rows, "status"),
    rowKeys: rows.map((row) => `${row.eventId}:${row.id}`),
    rows,
    total: rows.length,
  };
}

export function summarizeDeliverySummary(body) {
  const candidate = asObject(body);
  const total = asObject(candidate?.total);
  const email = asObject(candidate?.email);
  const sms = asObject(candidate?.sms);
  return {
    emailSent: typeof email?.sent === "number" ? email.sent : 0,
    emailTotal: typeof email?.total === "number" ? email.total : 0,
    smsSent: typeof sms?.sent === "number" ? sms.sent : 0,
    smsTotal: typeof sms?.total === "number" ? sms.total : 0,
    state: asString(candidate?.state) ?? "unknown",
    totalSent: typeof total?.sent === "number" ? total.sent : 0,
    total: typeof total?.total === "number" ? total.total : 0,
  };
}

export function qualificationSnapshot(scheduled, communications, deliveries = []) {
  return {
    communications: {
      rowKeys: [...communications.rowKeys],
      total: communications.total,
    },
    deliveries: deliveries.map((delivery) => ({
      messageId: delivery.messageId,
      summary: delivery.summary,
      status: delivery.status,
    })),
    scheduled: {
      recipientCount: scheduled.recipientCount,
      rowKeys: [...scheduled.rowKeys],
      total: scheduled.total,
    },
  };
}

export function qualificationSnapshotsMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function formatQualificationSummary(snapshot) {
  const scheduledKinds = Object.entries(snapshot.scheduled.byKind ?? {})
    .map(([kind, count]) => `${kind}=${String(count)}`)
    .join(", ");
  const scheduledStatuses = Object.entries(snapshot.scheduled.byStatus ?? {})
    .map(([status, count]) => `${status}=${String(count)}`)
    .join(", ");
  const communicationStatuses = Object.entries(snapshot.communications.byStatus ?? {})
    .map(([status, count]) => `${status}=${String(count)}`)
    .join(", ");
  const deliveryStates = snapshot.deliveries
    .map((delivery) => `${delivery.messageId}=${delivery.summary.state}`)
    .join(", ");
  return [
    `scheduled=${String(snapshot.scheduled.total)} (${scheduledKinds || "none"}; ${scheduledStatuses || "none"})`,
    `scheduledRecipients=${String(snapshot.scheduled.recipientCount)}`,
    `communications=${String(snapshot.communications.total)} (${communicationStatuses || "none"})`,
    `deliveries=${deliveryStates || "none"}`,
  ].join("; ");
}
