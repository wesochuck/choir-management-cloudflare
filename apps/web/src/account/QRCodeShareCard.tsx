import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";

interface QRCodeShareCardProps {
  readonly description: string;
  readonly path: string;
  readonly title: string;
}

function safeFileName(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "public_link"
  );
}

export function QRCodeShareCard({ description, path, title }: QRCodeShareCardProps) {
  const [qrCode, setQrCode] = useState<
    | { readonly dataUrl: string; readonly path: string }
    | { readonly error: true; readonly path: string }
    | null
  >(null);
  const [copied, setCopied] = useState(false);
  const absoluteUrl = useMemo(() => {
    const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
    return new URL(path, origin).toString();
  }, [path]);

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(absoluteUrl, {
      color: { dark: "#0f172a", light: "#ffffff" },
      errorCorrectionLevel: "H",
      margin: 2,
      width: 512,
    })
      .then((dataUrl) => {
        if (active) setQrCode({ dataUrl, path: absoluteUrl });
      })
      .catch(() => {
        if (active) setQrCode({ error: true, path: absoluteUrl });
      });
    return () => {
      active = false;
    };
  }, [absoluteUrl]);

  const qrCodeUrl = qrCode?.path === absoluteUrl && "dataUrl" in qrCode ? qrCode.dataUrl : null;
  const generationError = qrCode?.path === absoluteUrl && "error" in qrCode;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 2_000);
    } catch {
      setCopied(false);
    }
  }

  function downloadQrCode() {
    if (!qrCodeUrl) return;
    const link = document.createElement("a");
    link.href = qrCodeUrl;
    link.download = `${safeFileName(title)}_qr_code.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <article className="public-link-share">
      <div className="public-link-share__details">
        <p className="eyebrow">Public link</p>
        <h3>{title}</h3>
        <p>{description}</p>
        <div className="public-link-share__url-row">
          <a href={absoluteUrl} rel="noreferrer" target="_blank">
            {absoluteUrl}
          </a>
          <button
            className="button button--secondary"
            onClick={() => void copyLink()}
            type="button"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <button
          className="button button--secondary"
          disabled={!qrCodeUrl}
          onClick={downloadQrCode}
          type="button"
        >
          Download QR code
        </button>
      </div>
      <div className="public-link-share__qr">
        {generationError ? (
          <p className="notice notice--error">QR code could not be generated.</p>
        ) : qrCodeUrl ? (
          <img alt={`QR code for ${title}`} src={qrCodeUrl} />
        ) : (
          <p className="field-help">Generating QR code…</p>
        )}
      </div>
    </article>
  );
}
