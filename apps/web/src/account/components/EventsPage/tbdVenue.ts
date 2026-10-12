import type { OrganizationVenue } from "@choir/contracts";

export function normalizeVenueName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function isTbdVenueName(name: string): boolean {
  return normalizeVenueName(name) === "tbd";
}

export function findTbdVenue(venues: readonly OrganizationVenue[]): OrganizationVenue | undefined {
  return venues.find((venue) => isTbdVenueName(venue.name));
}

export function isTbdVenueId(
  venueId: string | null,
  venues: readonly OrganizationVenue[],
): boolean {
  if (!venueId) return false;
  const venue = venues.find((candidate) => candidate.id === venueId);
  return venue ? isTbdVenueName(venue.name) : false;
}

let tbdInFlight: Promise<OrganizationVenue> | null = null;

export function clearTbdInFlightForTest(): void {
  tbdInFlight = null;
}

export async function ensureTbdVenue(options: {
  readonly createVenue: (name: string, address: string) => Promise<OrganizationVenue>;
  readonly listVenues?: () => Promise<readonly OrganizationVenue[]>;
  readonly venues: readonly OrganizationVenue[];
}): Promise<OrganizationVenue> {
  const local = findTbdVenue(options.venues);
  if (local) return local;
  if (tbdInFlight) {
    const shared = await tbdInFlight;
    const refreshedLocal = findTbdVenue(options.venues);
    return refreshedLocal ?? shared;
  }
  const creation: Promise<OrganizationVenue> = (async () => {
    if (options.listVenues) {
      try {
        const fresh = await options.listVenues();
        const freshMatch = findTbdVenue(fresh);
        if (freshMatch) return freshMatch;
      } catch {
        // Fall through to creation; API error surfaces below.
      }
    }
    return options.createVenue("TBD", "");
  })();
  tbdInFlight = creation;
  try {
    return await creation;
  } finally {
    tbdInFlight = null;
  }
}
