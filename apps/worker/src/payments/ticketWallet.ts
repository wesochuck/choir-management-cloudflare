import { ticketWalletResponseSchema } from "@choir/contracts";
import type { PublicTicketReceipt } from "@choir/contracts";
import { renderCommunicationText } from "../communications/provider";
import type { Env } from "../env";

export function walletApiKey(
  env: Pick<Env, "EXTERNAL_EFFECTS_MODE" | "WALLETWALLET_API_KEY"> & Partial<Pick<Env, "APP_ENV">>,
) {
  if (!env.APP_ENV || env.APP_ENV === "local" || env.EXTERNAL_EFFECTS_MODE !== "sandbox")
    return undefined;
  return env.WALLETWALLET_API_KEY?.trim();
}

type WalletOrder = Pick<
  PublicTicketReceipt,
  | "eventId"
  | "eventTitle"
  | "eventStartsAt"
  | "doorsOpenTime"
  | "location"
  | "venueAddress"
  | "venueName"
  | "timezone"
  | "bundleTitle"
  | "includedEvents"
  | "quantity"
>;

export function walletPassBody(
  order: WalletOrder,
  scanToken: string,
  organizationName: string,
  details: { id: string; details: string }[],
) {
  const dates = new Intl.DateTimeFormat("en-US", {
    timeZone: order.timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const publicDetails = new Map(details.map((row) => [row.id, row.details]));
  const events = order.includedEvents.length
    ? order.includedEvents
    : [{ ...order, id: order.eventId, startsAt: order.eventStartsAt, title: order.eventTitle }];
  const backFields = events.map((event) => {
    const doors = event.doorsOpenTime;
    const hour = Number(doors.slice(0, 2));
    const raw = publicDetails.get(event.id) ?? "";
    const instructions =
      renderCommunicationText(raw.slice(0, 2048)) + (raw.length > 2048 ? "…" : "");
    return {
      label: event.title,
      value: [
        dates.format(new Date(event.startsAt)),
        doors &&
          `Doors open ${String(hour % 12 || 12)}:${doors.slice(3)} ${hour >= 12 ? "PM" : "AM"}`,
        event.venueName || event.location,
        event.venueAddress,
        instructions,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  });
  return {
    barcodeFormat: "QR",
    barcodeValue: scanToken,
    barcodeAltText: "",
    logoText: organizationName,
    organizationName: organizationName.slice(0, 64),
    primaryFields: [{ label: "Admission", value: order.bundleTitle || order.eventTitle }],
    headerFields: [{ label: "Admits", value: String(order.quantity) }],
    secondaryFields: order.bundleTitle
      ? [{ label: "Concerts", value: String(events.length) }]
      : [{ label: "Starts", value: dates.format(new Date(order.eventStartsAt)) }],
    backFields,
  };
}

export async function issueWalletPass(key: string, body: ReturnType<typeof walletPassBody>) {
  const response = await fetch("https://api.walletwallet.dev/api/passes?format=pkpass", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(12000),
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  // Only the install URL is needed. Avoid buffering or retaining the signed pass.
  await response.body?.cancel();
  if ([400, 401, 403, 429].includes(response.status)) return { rejected: true } as const;
  if (!response.ok) throw new Error("Unknown wallet issuance outcome");
  return ticketWalletResponseSchema.parse({ shareUrl: response.headers.get("X-Pass-Url") });
}
