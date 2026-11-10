import { useEffect, useRef } from "react";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

interface AdsConversion {
  readonly label: string;
  readonly transactionId: string;
  readonly value: number;
  readonly currency: string;
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
  useEffect(() => {
    if (!tagId || !/^AW-[0-9]{1,29}$/.test(tagId)) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${tagId}`;
    script.referrerPolicy = "no-referrer";
    const layer = (window.dataLayer ??= []);
    // gtag expects an arguments object in the data layer.
    function gtag(...args: unknown[]): void;
    function gtag() {
      // eslint-disable-next-line prefer-rest-params -- Google requires an Arguments object in dataLayer.
      layer.push(arguments);
    }
    if (configured.current !== tagId) {
      configured.current = tagId;
      gtag("js", new Date());
      gtag("config", tagId, {
        page_location: `${window.location.origin}${window.location.pathname}`,
        page_referrer: "",
        allow_enhanced_conversions: false,
      });
    }
    if (conversion && /^[A-Za-z0-9_-]{1,100}$/.test(conversion.label)) {
      const key = `google-ads:${tagId}/${conversion.label}`;
      let reported: string[] = [];
      try {
        const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
        if (Array.isArray(stored))
          reported = stored.filter((item): item is string => typeof item === "string").slice(-100);
      } catch {
        /* Storage may be unavailable; transaction_id still supports Google deduplication. */
      }
      if (!reported.includes(conversion.transactionId)) {
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
    }
    document.head.append(script);
    return () => {
      script.remove();
    };
  }, [tagId, conversion]);
  return null;
}
