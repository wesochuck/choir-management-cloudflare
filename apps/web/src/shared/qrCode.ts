import QRCode from "qrcode";

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

export async function overlayLogoOnQrCode(qrDataUrl: string, logoUrl: string): Promise<string> {
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

export async function generateQRCodeDataUrl({
  errorCorrectionLevel = "H",
  logoUrl,
  margin = 2,
  payload,
  width = 320,
}: {
  readonly errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  readonly logoUrl?: string | null | undefined;
  readonly margin?: number;
  readonly payload: string;
  readonly width?: number;
}): Promise<string> {
  const baseDataUrl = await QRCode.toDataURL(payload, {
    color: { dark: "#0f172a", light: "#ffffff" },
    errorCorrectionLevel,
    margin,
    width,
  });

  if (logoUrl) {
    return overlayLogoOnQrCode(baseDataUrl, logoUrl);
  }
  return baseDataUrl;
}
