import { useEffect, useRef } from "react";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/** Only mounted by the published public website, never by previews or transaction layouts. */
export function GoogleAdsTag({ tagId }: { readonly tagId?: string | undefined }) {
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
    document.head.append(script);
    return () => {
      script.remove();
    };
  }, [tagId]);
  return null;
}
