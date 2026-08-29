import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";

import { getOrganizationPublicWebsiteSettings } from "../auth/api";

interface QRCodeShareCardProps {
  readonly asFieldset?: boolean;
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

const organizationLogoUrlPromises = new Map<string, Promise<string | null>>();

function getOrganizationLogoUrl(): Promise<string | null> {
  const hostname = typeof window === "undefined" ? "localhost" : window.location.hostname;
  const existing = organizationLogoUrlPromises.get(hostname);
  if (existing) return existing;
  const request = getOrganizationPublicWebsiteSettings()
    .then(({ logoFileId }) =>
      logoFileId ? `/api/organization/files/${encodeURIComponent(logoFileId)}` : null,
    )
    .catch(() => null);
  organizationLogoUrlPromises.set(hostname, request);
  return request;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error("Image could not be loaded."));
    };
    image.src = src;
  });
}

async function overlayOrganizationLogo(qrDataUrl: string, logoUrl: string): Promise<string> {
  try {
    const [qrImage, logoImage] = await Promise.all([loadImage(qrDataUrl), loadImage(logoUrl)]);
    const canvas = document.createElement("canvas");
    canvas.width = qrImage.width;
    canvas.height = qrImage.height;
    const context = canvas.getContext("2d");
    if (!context) return qrDataUrl;

    context.drawImage(qrImage, 0, 0);

    const logoBoxSize = qrImage.width * 0.2;
    const logoBackgroundRadius = (logoBoxSize * 1.4) / 2;
    const centerX = qrImage.width / 2;
    const centerY = qrImage.height / 2;
    context.beginPath();
    context.arc(centerX, centerY, logoBackgroundRadius, 0, Math.PI * 2);
    context.fillStyle = "#ffffff";
    context.fill();

    const logoScale = Math.min(
      logoBoxSize / logoImage.naturalWidth,
      logoBoxSize / logoImage.naturalHeight,
    );
    const logoWidth = logoImage.naturalWidth * logoScale;
    const logoHeight = logoImage.naturalHeight * logoScale;
    context.drawImage(
      logoImage,
      centerX - logoWidth / 2,
      centerY - logoHeight / 2,
      logoWidth,
      logoHeight,
    );
    return canvas.toDataURL("image/png");
  } catch {
    return qrDataUrl;
  }
}

export function QRCodeShareCard({
  asFieldset = false,
  description,
  path,
  title,
}: QRCodeShareCardProps) {
  const [qrCode, setQrCode] = useState<
    | { readonly dataUrl: string; readonly path: string }
    | { readonly error: true; readonly path: string }
    | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const absoluteUrl = useMemo(() => {
    const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
    return new URL(path, origin).toString();
  }, [path]);

  useEffect(() => {
    let active = true;
    void getOrganizationLogoUrl().then((nextLogoUrl) => {
      if (active) setLogoUrl(nextLogoUrl);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(absoluteUrl, {
      color: { dark: "#0f172a", light: "#ffffff" },
      errorCorrectionLevel: "H",
      margin: 2,
      width: 512,
    })
      .then(async (dataUrl) => {
        const compositedDataUrl = logoUrl
          ? await overlayOrganizationLogo(dataUrl, logoUrl)
          : dataUrl;
        if (active) setQrCode({ dataUrl: compositedDataUrl, path: absoluteUrl });
      })
      .catch(() => {
        if (active) setQrCode({ error: true, path: absoluteUrl });
      });
    return () => {
      active = false;
    };
  }, [absoluteUrl, logoUrl]);

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

  const cardContent = (
    <>
      <div className="public-link-share__details">
        {asFieldset ? null : <h3>{title}</h3>}
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
            {copied ? "✓ Copied!" : "Copy link"}
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
    </>
  );

  return asFieldset ? (
    <fieldset className="public-link-share public-link-share--fieldset">
      <legend>{title}</legend>
      {cardContent}
    </fieldset>
  ) : (
    <article className="public-link-share">{cardContent}</article>
  );
}
