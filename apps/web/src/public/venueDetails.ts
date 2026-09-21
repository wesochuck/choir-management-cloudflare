export interface EventVenueInput {
  readonly location?: string;
  readonly venueAddress?: string;
  readonly venueName?: string;
}

export interface EventVenueDetails {
  readonly displayName: string;
  readonly googleMapsUrl: string | null;
  readonly venueAddress: string;
}

function resolveDisplayAndAddress(input: EventVenueInput): {
  readonly displayName: string;
  readonly venueAddress: string;
} {
  const name = input.venueName?.trim() ?? "";
  const address = input.venueAddress?.trim() ?? "";
  const location = input.location?.trim() ?? "";

  if (!name) {
    if (!address) {
      return { displayName: location, venueAddress: "" };
    }
    const displayName = location !== address ? location : "";
    return { displayName, venueAddress: address };
  }

  const resolvedAddress = address || (location && location !== name ? location : "");
  return { displayName: name, venueAddress: resolvedAddress };
}

export function getEventVenueDetails(event: EventVenueInput): EventVenueDetails {
  const { displayName, venueAddress } = resolveDisplayAndAddress(event);
  const queryParts = [displayName, venueAddress].filter(Boolean);
  const mapQuery = queryParts.join(", ");
  const googleMapsUrl = mapQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`
    : null;

  return {
    displayName,
    googleMapsUrl,
    venueAddress,
  };
}
