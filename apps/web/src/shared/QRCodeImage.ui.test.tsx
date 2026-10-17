import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import QRCode from "qrcode";
import { QRCodeImage } from "./QRCodeImage";
import { generateQRCodeDataUrl } from "./qrCode";

describe("generateQRCodeDataUrl", () => {
  it("keeps a plain QR when the Organization has no logo", async () => {
    const fetchLogo = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const render = vi.spyOn(QRCode, "toDataURL");
    try {
      const result = await generateQRCodeDataUrl({
        payload: "tickets-url",
        errorCorrectionLevel: "L",
        margin: 0,
      });
      expect(result).toMatch(/^data:image\/png;base64,/);
      expect(fetchLogo).toHaveBeenCalledWith(
        "/api/public/logo",
        expect.objectContaining({ credentials: "same-origin", cache: "no-cache" }),
      );
      expect(render).toHaveBeenCalledWith(
        "tickets-url",
        expect.objectContaining({ errorCorrectionLevel: "H", margin: 4 }),
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("can explicitly generate an unbranded QR without a logo request", async () => {
    const fetchLogo = vi.spyOn(globalThis, "fetch");
    try {
      expect(await generateQRCodeDataUrl({ payload: "plain-code", logoUrl: null })).toMatch(
        /^data:image\/png;base64,/,
      );
      expect(fetchLogo).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("generates a data URL for a given payload", async () => {
    const dataUrl = await generateQRCodeDataUrl({ payload: "test-scan-token" });
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

describe("QRCodeImage", () => {
  it("displays loading state initially and renders image on success", async () => {
    render(<QRCodeImage alt="Test Ticket QR" payload="test-token" />);

    expect(screen.getByText("Generating QR code…")).toBeInTheDocument();

    await waitFor(() => {
      const img = screen.getByRole("img", { name: "Test Ticket QR" });
      expect(img).toBeInTheDocument();
      expect(img.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    });
  });

  it("renders fallback message on generation error", async () => {
    vi.spyOn(QRCode, "toDataURL").mockRejectedValueOnce(new Error("QR generation failed"));
    const onError = vi.fn();

    render(
      <QRCodeImage
        alt="Failing QR"
        fallbackMessage="Custom QR error message"
        onError={onError}
        payload="fail-token"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Custom QR error message")).toBeInTheDocument();
      expect(onError).toHaveBeenCalled();
    });

    vi.restoreAllMocks();
  });
});
