import QRCode from "qrcode";
import { importWithRetry } from "../offline/chunkRecovery";

const pendingLogos = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => {
      finish();
      reject(new Error("Image loading timed out."));
    }, 4_000);
    function finish() {
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
    }
    image.onload = () => {
      finish();
      resolve(image);
    };
    image.onerror = () => {
      finish();
      reject(new Error("Image could not be loaded."));
    };
    image.src = src;
  });
}

function loadLogo(src: string): Promise<HTMLImageElement | null> {
  const url = new URL(src, window.location.href).href;
  const pending = pendingLogos.get(url);
  if (pending) return pending;
  // Coalesce simultaneous cards, but do not permanently cache a missing or replaced logo.
  const request = (async () => {
    try {
      const response = await fetch(src, {
        cache: "no-cache",
        credentials: "same-origin",
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return null;
      const objectUrl = URL.createObjectURL(await response.blob());
      try {
        return await loadImage(objectUrl);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      return null;
    }
  })();
  pendingLogos.set(url, request);
  void request.then(() => pendingLogos.delete(url));
  return request;
}

export async function overlayLogoOnQrCode(
  qrDataUrl: string,
  logoUrl: string,
  payload: string,
): Promise<string> {
  try {
    const logoImage = await loadLogo(logoUrl);
    if (!logoImage || logoImage.naturalWidth === 0 || logoImage.naturalHeight === 0)
      return qrDataUrl;
    const qrImage = await loadImage(qrDataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = qrImage.naturalWidth;
    canvas.height = qrImage.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return qrDataUrl;
    const decode = (await importWithRetry(() => import("jsqr"))).default;
    // Keep the logo small. Retry once at a smaller size if this symbol's layout is sensitive.
    for (const fraction of [0.18, 0.14]) {
      context.drawImage(qrImage, 0, 0);
      const box = canvas.width * fraction;
      const backing = box * 1.2;
      context.fillStyle = "#ffffff";
      context.fillRect(
        (canvas.width - backing) / 2,
        (canvas.height - backing) / 2,
        backing,
        backing,
      );
      const scale = Math.min(box / logoImage.naturalWidth, box / logoImage.naturalHeight);
      const width = logoImage.naturalWidth * scale;
      const height = logoImage.naturalHeight * scale;
      context.drawImage(
        logoImage,
        (canvas.width - width) / 2,
        (canvas.height - height) / 2,
        width,
        height,
      );
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      if (
        decode(pixels.data, pixels.width, pixels.height, { inversionAttempts: "dontInvert" })
          ?.data === payload
      ) {
        return canvas.toDataURL("image/png");
      }
    }
    return qrDataUrl;
  } catch {
    return qrDataUrl;
  }
}

export async function generateQRCodeDataUrl({
  errorCorrectionLevel = "H",
  logoUrl = "/api/public/logo",
  margin = 4,
  payload,
  width = 320,
}: {
  readonly errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  readonly logoUrl?: string | null | undefined;
  readonly margin?: number;
  readonly payload: string;
  readonly width?: number;
}): Promise<string> {
  const correction = logoUrl ? "H" : errorCorrectionLevel;
  const quietZone = Math.max(4, margin);
  const modules = QRCode.create(payload, { errorCorrectionLevel: correction }).modules.size;
  const baseDataUrl = await QRCode.toDataURL(payload, {
    color: { dark: "#0f172a", light: "#ffffff" },
    errorCorrectionLevel: correction,
    margin: quietZone,
    // Dense credentials need enough source pixels per module for reliable decoding/printing.
    width: Math.max(width, (modules + quietZone * 2) * 4),
  });

  return logoUrl ? overlayLogoOnQrCode(baseDataUrl, logoUrl, payload) : baseDataUrl;
}
