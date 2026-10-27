import type { DonationRecord } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import { useState, type ChangeEvent } from "react";

import { attachDonationArtwork, getDonationSponsorLink } from "../../../api/donations";
import { uploadPrivateOrganizationFile } from "../../../api/files";

export function SponsorArtworkDialog({
  donation,
  onArtworkUpdated,
  onClose,
  open,
}: {
  readonly donation: DonationRecord | null;
  readonly onArtworkUpdated: () => Promise<void>;
  readonly onClose: () => void;
  readonly open: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!donation) return null;

  async function handleCopyLink(): Promise<void> {
    if (!donation) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await getDonationSponsorLink(donation.id);
      await navigator.clipboard.writeText(result.link);
      setMessage("Sponsor submission link copied to clipboard!");
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "Could not generate submission link.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file || !donation) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const uploaded = await uploadPrivateOrganizationFile(file);
      await attachDonationArtwork(donation.id, uploaded.id);
      await onArtworkUpdated();
      setMessage(`Artwork updated: ${uploaded.fileName}`);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "Artwork upload failed.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <Dialog
      description="Manage program advertisement artwork and submission capability for this sponsor."
      onClose={onClose}
      open={open}
      title="Program advertisement sponsorship"
    >
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="notice notice--success" role="status">
          {message}
        </p>
      ) : null}

      <div className="form-stack">
        <div className="surface-card">
          <dl className="info-grid">
            <div>
              <dt>Sponsor / business name</dt>
              <dd>
                <strong>{donation.sponsorName ?? donation.buyerName}</strong>
              </dd>
            </div>
            <div>
              <dt>Donor</dt>
              <dd>
                {donation.buyerName} ({donation.buyerEmail})
              </dd>
            </div>
            <div>
              <dt>Sponsorship level</dt>
              <dd>{donation.selectedLevelName ?? "Program Advertisement"}</dd>
            </div>
            <div>
              <dt>Artwork status</dt>
              <dd>
                {donation.artworkStatus === "received" ? (
                  <span className="badge badge--success">Received</span>
                ) : (
                  <span className="badge badge--warning">Not received</span>
                )}
              </dd>
            </div>
            {donation.artworkFileName ? (
              <div>
                <dt>Submitted file</dt>
                <dd>
                  {donation.artworkFileName}{" "}
                  {donation.artworkUploadedAt
                    ? `(${new Date(donation.artworkUploadedAt).toLocaleDateString()})`
                    : ""}
                </dd>
              </div>
            ) : null}
            {donation.artworkInstructions ? (
              <div>
                <dt>Level artwork instructions</dt>
                <dd className="field-help">{donation.artworkInstructions}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="form-actions" style={{ marginTop: "1rem" }}>
          {donation.artworkFileId ? (
            <a
              className="button button--secondary"
              download={donation.artworkFileName ?? "sponsor-artwork"}
              href={`/api/organization/files/${encodeURIComponent(donation.artworkFileId)}`}
            >
              Download artwork
            </a>
          ) : null}

          <button
            className="button button--secondary"
            disabled={busy}
            onClick={() => void handleCopyLink()}
            type="button"
          >
            Copy submission link
          </button>

          <label
            className="button button--secondary"
            style={{ cursor: busy ? "not-allowed" : "pointer" }}
          >
            {busy ? "Uploading…" : donation.artworkFileId ? "Replace artwork" : "Upload artwork"}
            <input
              accept="application/pdf,image/png,image/jpeg"
              disabled={busy}
              hidden
              onChange={(e) => void handleFileUpload(e)}
              type="file"
            />
          </label>
        </div>

        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Close
            </button>
          </DialogClose>
        </div>
      </div>
    </Dialog>
  );
}
