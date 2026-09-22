import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import QRCode from "qrcode";
import { QRCodeImage } from "./QRCodeImage";
import { generateQRCodeDataUrl } from "./qrCode";

describe("generateQRCodeDataUrl", () => {
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
