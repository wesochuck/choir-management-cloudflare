import { timestampedExportFilename } from "@choir/domain";
import type { OrganizationEvent } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import { useState } from "react";

import type { PublicPlayerLinkStatus } from "../../../../api/player";
import { QRCodeImage } from "../../../../shared/QRCodeImage";
import { generateQRCodeDataUrl } from "../../../../shared/qrCode";
import { formatPracticePlayerExpiration } from "../utils";

function safeFileName(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "practice_player"
  );
}

export interface PracticePlayerShareDialogProps {
  readonly event: OrganizationEvent | null;
  readonly linkStatus: PublicPlayerLinkStatus | null;
  readonly onClose: () => void;
  readonly onCopyLink: () => Promise<void>;
  readonly open: boolean;
  readonly url: string;
}

export function PracticePlayerShareDialog({
  event,
  linkStatus,
  onClose,
  onCopyLink,
  open,
  url,
}: PracticePlayerShareDialogProps) {
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!event || !open || !url) return null;

  async function handleDownload(): Promise<void> {
    if (!event || downloading) return;
    setDownloading(true);
    try {
      const dataUrl = await generateQRCodeDataUrl({
        errorCorrectionLevel: "H",
        margin: 2,
        payload: url,
        width: 512,
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = timestampedExportFilename(
        `${safeFileName(event.title)}_practice_player_qr_code.png`,
        new Date(),
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setDownloading(false);
    }
  }

  async function handleCopy(): Promise<void> {
    await onCopyLink();
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 2000);
  }

  const expirationText = formatPracticePlayerExpiration(linkStatus);

  return (
    <Dialog
      description={`Share the practice player for ${event.title}.`}
      onClose={onClose}
      open={open}
      title="Practice Player QR Code"
    >
      <div className="practice-player-share-dialog__content">
        <p className="practice-player-share-dialog__event">{event.title}</p>
        <div className="practice-player-share-dialog__qr-wrap">
          <QRCodeImage
            alt={`Practice Player QR code for ${event.title}`}
            payload={url}
            width={280}
          />
        </div>
        <p className="field-help practice-player-share-dialog__expiration">{expirationText}</p>
        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Close
            </button>
          </DialogClose>
          <button
            className="button button--secondary"
            onClick={() => void handleCopy()}
            type="button"
          >
            {copied ? "✓ Copied!" : "Copy player link"}
          </button>
          <button
            className="button button--primary"
            disabled={downloading}
            onClick={() => void handleDownload()}
            type="button"
          >
            {downloading ? "Downloading…" : "Download QR code"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
