import { useEffect, useRef, useState } from "react";
import { generateQRCodeDataUrl } from "./qrCode";

export interface QRCodeImageProps {
  readonly alt: string;
  readonly className?: string;
  readonly errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  readonly fallbackMessage?: string;
  readonly logoUrl?: string | null;
  readonly margin?: number;
  readonly onError?: (error: Error) => void;
  readonly payload: string;
  readonly width?: number;
}

export function QRCodeImage({
  alt,
  className,
  errorCorrectionLevel = "H",
  fallbackMessage = "The QR code could not be displayed.",
  logoUrl,
  margin = 2,
  onError,
  payload,
  width = 320,
}: QRCodeImageProps) {
  const [loadState, setLoadState] = useState<{
    readonly error: boolean;
    readonly key: string;
    readonly url: string | null;
  }>({
    error: false,
    key: "",
    url: null,
  });

  const requestKey = `${payload}:${String(width)}:${String(margin)}:${errorCorrectionLevel}:${logoUrl ?? ""}`;

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    let active = true;

    generateQRCodeDataUrl({
      errorCorrectionLevel,
      logoUrl,
      margin,
      payload,
      width,
    })
      .then((url) => {
        if (active) {
          setLoadState({ error: false, key: requestKey, url });
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setLoadState({ error: true, key: requestKey, url: null });
          onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
        }
      });

    return () => {
      active = false;
    };
  }, [errorCorrectionLevel, logoUrl, margin, payload, requestKey, width]);

  const hasError = loadState.key === requestKey && loadState.error;
  const dataUrl = loadState.key === requestKey ? loadState.url : null;

  if (hasError) {
    return (
      <p className="notice notice--error" role="alert">
        {fallbackMessage}
      </p>
    );
  }

  if (!dataUrl) {
    return <p className="field-help">Generating QR code…</p>;
  }

  return (
    <img
      alt={alt}
      className={className}
      height={width}
      src={dataUrl}
      style={{ display: "block", height: "auto", maxWidth: "100%" }}
      width={width}
    />
  );
}
