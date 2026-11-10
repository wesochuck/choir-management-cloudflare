import { StrictMode } from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { GoogleAdsTag } from "./GoogleAdsTag";

afterEach(() => {
  cleanup();
  delete window.dataLayer;
  sessionStorage.clear();
});
it("loads only a valid enabled Ads tag and avoids duplicate StrictMode configuration", () => {
  const view = render(
    <StrictMode>
      <GoogleAdsTag tagId="AW-123456789" />
    </StrictMode>,
  );
  expect(document.querySelectorAll('script[src*="googletagmanager.com"]')).toHaveLength(1);
  expect(window.dataLayer).toHaveLength(2);
  view.unmount();
  expect(document.querySelectorAll('script[src*="googletagmanager.com"]')).toHaveLength(0);
});
it("does not load a tag for omitted, cleared, or invalid IDs", () => {
  for (const tagId of [undefined, "", "<script>", "GTM-ABC"]) {
    const view = render(<GoogleAdsTag tagId={tagId} />);
    expect(document.querySelectorAll('script[src*="googletagmanager.com"]')).toHaveLength(0);
    view.unmount();
  }
});

it("reports confirmed conversions once across remounts using a stable transaction ID", () => {
  const conversion = {
    label: "ticket_label",
    transactionId: "org:purchase",
    value: 12.5,
    currency: "USD",
  };
  const first = render(
    <StrictMode>
      <GoogleAdsTag tagId="AW-123456789" conversion={conversion} />
    </StrictMode>,
  );
  first.unmount();
  render(<GoogleAdsTag tagId="AW-123456789" conversion={conversion} />);
  const events = (window.dataLayer ?? []).filter(
    (entry) =>
      typeof entry === "object" && entry !== null && "1" in entry && entry[1] === "conversion",
  );
  expect(events).toHaveLength(1);
});
