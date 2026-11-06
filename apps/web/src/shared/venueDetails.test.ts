import { describe, expect, it } from "vitest";
import { getEventVenueDetails } from "./venueDetails";

describe("getEventVenueDetails", () => {
  it("resolves both venue name and venue address into the query", () => {
    const details = getEventVenueDetails({
      location: "",
      venueAddress: "163 E Wheeling St Lancaster, Ohio 43130",
      venueName: "First United Methodist Church - Choir Room (Upstairs)",
    });
    expect(details.displayName).toBe("First United Methodist Church - Choir Room (Upstairs)");
    expect(details.venueAddress).toBe("163 E Wheeling St Lancaster, Ohio 43130");
    expect(details.googleMapsUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=First%20United%20Methodist%20Church%20-%20Choir%20Room%20(Upstairs)%2C%20163%20E%20Wheeling%20St%20Lancaster%2C%20Ohio%2043130",
    );
  });

  it("handles fallback location as address when venue name is present", () => {
    const details = getEventVenueDetails({
      location: "456 State St",
      venueAddress: "",
      venueName: "Community Center",
    });
    expect(details.displayName).toBe("Community Center");
    expect(details.venueAddress).toBe("456 State St");
    expect(details.googleMapsUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=Community%20Center%2C%20456%20State%20St",
    );
  });

  it("handles address only without venue name", () => {
    const details = getEventVenueDetails({
      location: "",
      venueAddress: "789 Broadway",
      venueName: "",
    });
    expect(details.displayName).toBe("");
    expect(details.venueAddress).toBe("789 Broadway");
    expect(details.googleMapsUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=789%20Broadway",
    );
  });

  it("handles location without venue name or address", () => {
    const details = getEventVenueDetails({
      location: "Fairfield County Fairgrounds",
      venueAddress: "",
      venueName: "",
    });
    expect(details.displayName).toBe("Fairfield County Fairgrounds");
    expect(details.venueAddress).toBe("");
    expect(details.googleMapsUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=Fairfield%20County%20Fairgrounds",
    );
  });

  it("returns null map url when no venue or address information exists", () => {
    const details = getEventVenueDetails({
      location: "",
      venueAddress: "",
      venueName: "",
    });
    expect(details.displayName).toBe("");
    expect(details.venueAddress).toBe("");
    expect(details.googleMapsUrl).toBeNull();
  });

  it("returns null map url for placeholder venue names when address is empty", () => {
    expect(
      getEventVenueDetails({
        location: "",
        venueAddress: "",
        venueName: "Location to be announced",
      }).googleMapsUrl,
    ).toBeNull();

    expect(
      getEventVenueDetails({
        location: "TBD",
        venueAddress: "",
        venueName: "",
      }).googleMapsUrl,
    ).toBeNull();

    expect(
      getEventVenueDetails({
        location: "",
        venueAddress: "",
        venueName: "To be determined",
      }).googleMapsUrl,
    ).toBeNull();
  });

  it("uses address only when venue name is a placeholder", () => {
    const details = getEventVenueDetails({
      location: "",
      venueAddress: "163 E Wheeling St, Lancaster, OH",
      venueName: "TBD",
    });
    expect(details.googleMapsUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=163%20E%20Wheeling%20St%2C%20Lancaster%2C%20OH",
    );
  });
});
