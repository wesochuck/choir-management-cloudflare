import { useEffect, useRef } from "react";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

interface AdsConversion {
  readonly label: string;
  readonly transactionId: string;
  readonly value: number;
  readonly currency: string;
}

const ALLOWED_ADS_QUERY_PARAMS = new Set(["gclid", "gbraid", "wbraid", "gclsrc", "gtm_debug"]);

function sanitizedPageLocation(location: Location): string {
  const incoming = new URLSearchParams(location.search);
  const filtered = new URLSearchParams();
  for (const [key, value] of incoming) {
    if (ALLOWED_ADS_QUERY_PARAMS.has(key)) {
      filtered.append(key, value);
    }
  }
  const query = filtered.toString();
  return `${location.origin}${location.pathname}${query ? `?${query}` : ""}`;
}

function reportConversionOnce(
  gtag: (...args: unknown[]) => void,
  tagId: string,
  conversion: AdsConversion,
): void {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(conversion.label)) return;
  const key = `google-ads:${tagId}/${conversion.label}`;
  let reported: string[] = [];
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    if (Array.isArray(stored))
      reported = stored.filter((item): item is string => typeof item === "string").slice(-100);
  } catch {
    /* Storage may be unavailable; transaction_id still supports Google deduplication. */
  }
  if (reported.includes(conversion.transactionId)) return;
  gtag("event", "conversion", {
    send_to: `${tagId}/${conversion.label}`,
    value: conversion.value,
    currency: conversion.currency,
    transaction_id: conversion.transactionId,
    page_location: `${window.location.origin}/tickets/order/success`,
    page_referrer: "",
  });
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify([...reported, conversion.transactionId].slice(-100)),
    );
  } catch {
    /* Best-effort browser deduplication. */
  }
}

/** Mounted by published public content and confirmed ticket receipts. */
export function GoogleAdsTag({
  tagId,
  conversion,
}: {
  readonly tagId?: string | undefined;
  readonly conversion?: AdsConversion | undefined;
}) {
  const configured = useRef<string | null>(null);
  const conversionLabel = conversion?.label;
  const conversionTransactionId = conversion?.transactionId;
  const conversionValue = conversion?.value;
  const conversionCurrency = conversion?.currency;
  useEffect(() => {
    if (!tagId || !/^AW-[0-9]{1,29}$/.test(tagId)) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${tagId}`;
    const layer = (window.dataLayer ??= []);
    // gtag expects an arguments object in the data layer.
    function gtag(...args: unknown[]): void;
    function gtag() {
      // eslint-disable-next-line prefer-rest-params -- Google requires an Arguments object in dataLayer.
      layer.push(arguments);
    }
    window.gtag ??= gtag;
    if (configured.current !== tagId) {
      configured.current = tagId;
      gtag("js", new Date());
      gtag("config", tagId, {
        page_location: sanitizedPageLocation(window.location),
        page_referrer: "",
        allow_enhanced_conversions: false,
      });
    }
    if (
      conversionLabel !== undefined &&
      conversionTransactionId !== undefined &&
      conversionValue !== undefined &&
      conversionCurrency !== undefined
    ) {
      reportConversionOnce(gtag, tagId, {
        label: conversionLabel,
        transactionId: conversionTransactionId,
        value: conversionValue,
        currency: conversionCurrency,
      });
    }
    document.head.append(script);
    return () => {
      script.remove();
    };
  }, [tagId, conversionLabel, conversionTransactionId, conversionValue, conversionCurrency]);
  return null;
}
