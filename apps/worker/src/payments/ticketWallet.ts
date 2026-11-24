import { ticketWalletResponseSchema } from "@choir/contracts";
import type { PublicTicketReceipt } from "@choir/contracts";
import { renderCommunicationText } from "../communications/provider";
import type { Env } from "../env";

const WALLET_API_URL = "https://api.walletwallet.dev/api/passes";
const MAX_LABEL_CHARS = 64;
const MAX_FIELD_VALUE_CHARS = 256;
const MAX_BACK_FIELDS = 10;

export function walletApiKey(
  env: Pick<Env, "EXTERNAL_EFFECTS_MODE" | "WALLETWALLET_API_KEY"> & Partial<Pick<Env, "APP_ENV">>,
) {
  if (!env.APP_ENV || env.APP_ENV === "local" || env.EXTERNAL_EFFECTS_MODE !== "sandbox")
    return undefined;
  return env.WALLETWALLET_API_KEY?.trim();
}

function truncateField(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
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
  const backFields = events.slice(0, MAX_BACK_FIELDS).map((event) => {
    const doors = event.doorsOpenTime;
    const hour = Number(doors.slice(0, 2));
    const raw = publicDetails.get(event.id) ?? "";
    const instructions = renderCommunicationText(raw.slice(0, MAX_FIELD_VALUE_CHARS));
    const value = [
      dates.format(new Date(event.startsAt)),
      doors &&
        `Doors open ${String(hour % 12 || 12)}:${doors.slice(3)} ${hour >= 12 ? "PM" : "AM"}`,
      event.venueName || event.location,
      event.venueAddress,
      instructions,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      label: truncateField(event.title, MAX_LABEL_CHARS),
      value: truncateField(value, MAX_FIELD_VALUE_CHARS),
    };
  });
  const safeOrgName = truncateField(organizationName, MAX_LABEL_CHARS);
  return {
    barcodeFormat: "QR",
    barcodeValue: scanToken,
    barcodeAltText: "",
    logoText: safeOrgName,
    organizationName: safeOrgName,
    primaryFields: [
      {
        label: "Admission",
        value: truncateField(order.bundleTitle || order.eventTitle, MAX_FIELD_VALUE_CHARS),
      },
    ],
    headerFields: [{ label: "Admits", value: String(order.quantity) }],
    secondaryFields: order.bundleTitle
      ? [{ label: "Concerts", value: String(events.length) }]
      : [
          {
            label: "Starts",
            value: truncateField(
              dates.format(new Date(order.eventStartsAt)),
              MAX_FIELD_VALUE_CHARS,
            ),
          },
        ],
    backFields,
  };
}

async function readSafeProviderError(response: Response): Promise<string | undefined> {
  try {
    const text = (await response.text()).slice(0, 512);
    if (!text) return undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "error" in parsed &&
        typeof parsed.error === "string"
      ) {
        return parsed.error.slice(0, 200);
      }
    } catch {
      // Fall back to bounded plain text when provider response is non-JSON.
    }
    return text.slice(0, 200);
  } catch {
    return undefined;
  }
}

export async function issueWalletPass(key: string, body: ReturnType<typeof walletPassBody>) {
  const response = await fetch(WALLET_API_URL, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(12000),
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    return {
      providerError: "Unexpected provider redirect",
      rejected: true,
      status: response.status,
    } as const;
  }
  if ([400, 401, 403, 429].includes(response.status)) {
    const providerError = await readSafeProviderError(response);
    return { providerError, rejected: true, status: response.status } as const;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Unknown wallet issuance outcome (HTTP ${String(response.status)})`);
  }
  const headerShareUrl = response.headers.get("X-Pass-Url");
  if (headerShareUrl) {
    await response.body?.cancel();
    return ticketWalletResponseSchema.parse({ shareUrl: headerShareUrl });
  }
  const payload: unknown = await response.json();
  const shareUrl =
    typeof payload === "object" &&
    payload !== null &&
    "shareUrl" in payload &&
    typeof payload.shareUrl === "string"
      ? payload.shareUrl
      : null;
  return ticketWalletResponseSchema.parse({ shareUrl });
}
