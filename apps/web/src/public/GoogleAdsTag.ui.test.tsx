import { StrictMode } from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { GoogleAdsTag } from "./GoogleAdsTag";

afterEach(() => {
  cleanup();
  delete window.dataLayer;
  delete window.gtag;
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
it("loads only a valid enabled Ads tag and avoids duplicate StrictMode configuration", () => {
  const view = render(
    <StrictMode>
      <GoogleAdsTag tagId="AW-123456789" />
    </StrictMode>,
  );
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[src*="googletagmanager.com"]',
  );
  expect(scripts).toHaveLength(1);
  expect(scripts[0]?.referrerPolicy).not.toBe("no-referrer");
  expect(typeof window.gtag).toBe("function");
  expect(window.dataLayer).toHaveLength(2);
  view.unmount();
  expect(document.querySelectorAll('script[src*="googletagmanager.com"]')).toHaveLength(0);
});
it("preserves Google Ads attribution and debug query parameters while stripping tokens and fragments", () => {
  window.history.replaceState(
    null,
    "",
    "/tickets?token=secret-receipt-token&gclid=test-gclid&gbraid=test-gbraid&gtm_debug=123&email=user%40example.com#section",
  );
  render(<GoogleAdsTag tagId="AW-123456789" />);
  const configCalls = (window.dataLayer ?? []).filter(
    (entry): entry is IArguments =>
      typeof entry === "object" && entry !== null && "0" in entry && entry[0] === "config",
  );
  expect(configCalls).toHaveLength(1);
  expect(configCalls[0]?.[2]).toEqual({
    page_location: `${window.location.origin}/tickets?gclid=test-gclid&gbraid=test-gbraid&gtm_debug=123`,
    page_referrer: "",
    allow_enhanced_conversions: false,
  });
});
it("does not remove and re-append the script when re-rendered with an equivalent conversion object", () => {
  const view = render(
    <GoogleAdsTag
      tagId="AW-123456789"
      conversion={{
        label: "ticket_label",
        transactionId: "org:purchase",
        value: 12.5,
        currency: "USD",
      }}
    />,
  );
  const initialScript = document.querySelector('script[src*="googletagmanager.com"]');
  expect(initialScript).not.toBeNull();
  view.rerender(
    <GoogleAdsTag
      tagId="AW-123456789"
      conversion={{
        label: "ticket_label",
        transactionId: "org:purchase",
        value: 12.5,
        currency: "USD",
      }}
    />,
  );
  expect(document.querySelector('script[src*="googletagmanager.com"]')).toBe(initialScript);
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
