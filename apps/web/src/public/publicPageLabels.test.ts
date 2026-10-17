import { describe, expect, it } from "vitest";
import { publicPageHeading, publicPageNavigationLabel } from "./publicPageLabels";

describe("public page labels", () => {
  it("keeps defaults when neither a heading nor a navigation label is configured", () => {
    expect(publicPageNavigationLabel({}, "auditions")).toBe("Auditions");
    expect(publicPageNavigationLabel({ pageLabels: {} }, "history")).toBe("History");
    expect(publicPageHeading({}, "auditions", "Audition Inquiry")).toBe("Audition Inquiry");
  });

  it("uses a custom page heading in navigation when the navigation override is blank", () => {
    const settings = {
      pageLabels: { auditions: { heading: "Join" }, history: { heading: "Our story" } },
    };
    expect(publicPageNavigationLabel(settings, "auditions")).toBe("Join");
    expect(publicPageNavigationLabel(settings, "history")).toBe("Our story");
    expect(publicPageHeading(settings, "auditions", "Audition Inquiry")).toBe("Join");
  });

  it("lets an explicit navigation label differ from the page heading", () => {
    const settings = {
      pageLabels: { auditions: { heading: "Sing with us", navigationLabel: "Join" } },
    };
    expect(publicPageNavigationLabel(settings, "auditions")).toBe("Join");
    expect(publicPageHeading(settings, "auditions", "Audition Inquiry")).toBe("Sing with us");
  });
});
