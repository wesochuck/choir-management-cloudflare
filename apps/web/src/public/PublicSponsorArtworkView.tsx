import type { PublicSponsorDonationResponse } from "@choir/contracts";
import { useEffect, useState } from "react";

import { getPublicSponsorDonation, submitPublicSponsorArtwork } from "../api";
import { formatDonationMoney } from "./donationFormat";

function artworkDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function SponsorDetailsCard({
  isReceived,
  sponsor,
}: {
  readonly isReceived: boolean;
  readonly sponsor: PublicSponsorDonationResponse;
}) {
  return (
    <div className="panel public-sponsor-details-card">
      <dl className="public-sponsor-details-grid">
        <div>
          <dt>Sponsor name</dt>
          <dd>
            <strong>{sponsor.sponsorName ?? sponsor.buyerName}</strong>
          </dd>
        </div>
        <div>
          <dt>Sponsorship level</dt>
          <dd>
            {sponsor.selectedLevelName ?? "Donation"} ({formatDonationMoney(sponsor.amountCents)})
          </dd>
        </div>
        <div>
          <dt>Purchased by</dt>
          <dd>{sponsor.buyerName}</dd>
        </div>
        <div>
          <dt>Artwork status</dt>
          <dd>
            {isReceived ? (
              <span className="status-pill status-pill--success">Artwork received</span>
            ) : (
              <span className="status-pill status-pill--warning">Artwork needed</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function SponsorArtworkUploadCard({
  handleFileSelected,
  isReceived,
  sponsor,
  token,
  uploadError,
  uploadSuccess,
  uploading,
}: {
  readonly handleFileSelected: (file: File) => Promise<void>;
  readonly isReceived: boolean;
  readonly sponsor: PublicSponsorDonationResponse;
  readonly token: string;
  readonly uploadError: string | null;
  readonly uploadSuccess: string | null;
  readonly uploading: boolean;
}) {
  return (
    <div className="panel public-sponsor-upload-card">
      <h2>{isReceived ? "Submitted artwork" : "Upload your artwork"}</h2>

      {isReceived ? (
        <div className="public-sponsor-current-artwork">
          <p>
            <strong>Current file:</strong> {sponsor.artworkFileName ?? "Artwork attached"}
          </p>
          {sponsor.artworkUploadedAt ? (
            <p>
              <small>Submitted on {artworkDate(sponsor.artworkUploadedAt)}</small>
            </p>
          ) : null}

          {sponsor.artworkFileId ? (
            <div className="public-sponsor-file-preview-action">
              <a
                className="button button--secondary button--small"
                href={`/api/public/donations/artwork/${encodeURIComponent(sponsor.artworkFileId)}?token=${encodeURIComponent(token)}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                View uploaded artwork
              </a>
            </div>
          ) : null}

          <hr className="public-sponsor-divider" />
          <p className="field-help">
            Need to make a change? You can replace your artwork anytime before program printing.
          </p>
        </div>
      ) : (
        <p>Please choose a print-ready file (PDF, PNG, or JPG up to 20 MB).</p>
      )}

      <label className="public-donation-artwork-dropzone">
        <input
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          className="visually-hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFileSelected(file);
          }}
          type="file"
        />
        <span className="public-donation-artwork-dropzone__prompt">
          {uploading ? (
            <span>Uploading artwork…</span>
          ) : (
            <>
              <strong>
                {isReceived ? "Choose replacement artwork" : "Choose an artwork file"}
              </strong>{" "}
              or drag and drop
              <small>PDF, PNG, or JPG up to 20 MB</small>
            </>
          )}
        </span>
      </label>

      {uploadError ? (
        <p className="notice notice--error" role="alert">
          {uploadError}
        </p>
      ) : null}
      {uploadSuccess ? (
        <p className="notice notice--success" role="status">
          {uploadSuccess}
        </p>
      ) : null}
    </div>
  );
}

export function PublicSponsorArtworkView() {
  const token = new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
  const [sponsor, setSponsor] = useState<PublicSponsorDonationResponse | null>(null);
  const [loading, setLoading] = useState(() => Boolean(token));
  const [loadError, setLoadError] = useState<string | null>(() =>
    !token ? "This sponsor link is invalid or has expired." : null,
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    getPublicSponsorDonation(token, controller.signal)
      .then((data) => {
        setSponsor(data);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(
            err instanceof Error ? err.message : "This sponsor link is invalid or has expired.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, [token]);

  async function handleFileSelected(file: File): Promise<void> {
    if (!token) return;
    if (file.size > 20 * 1024 * 1024) {
      setUploadError("Artwork file must be at most 20 MB.");
      return;
    }
    const lowerType = file.type.toLowerCase();
    if (
      lowerType !== "application/pdf" &&
      lowerType !== "image/png" &&
      lowerType !== "image/jpeg" &&
      lowerType !== "image/jpg"
    ) {
      setUploadError("Artwork must be a PDF, PNG, or JPEG file.");
      return;
    }
    setUploadError(null);
    setUploadSuccess(null);
    setUploading(true);
    try {
      const updated = await submitPublicSponsorArtwork(token, file);
      setSponsor(updated);
      setUploadSuccess("Artwork uploaded successfully!");
    } catch (err: unknown) {
      setUploadError(
        err instanceof Error ? err.message : "Artwork upload failed. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <section className="public-section public-section--narrow">
        <h1>Program ad artwork</h1>
        <p role="status">Loading sponsorship details…</p>
      </section>
    );
  }

  if (loadError || !sponsor) {
    return (
      <section className="public-section public-section--narrow">
        <h1>Program ad artwork</h1>
        <p className="notice notice--error" role="alert">
          {loadError ?? "This sponsor link is invalid or has expired."}
        </p>
        <a className="button button--secondary" href="/">
          Return home
        </a>
      </section>
    );
  }

  const isReceived = sponsor.artworkStatus === "received";

  return (
    <section className="public-section public-section--narrow public-sponsor-artwork-view">
      <h1>Program ad artwork</h1>
      <p className="public-sponsor-artwork-intro">
        Thank you for supporting our choir! Use this page to submit or replace your print-ready
        advertisement artwork for the concert program.
      </p>

      <SponsorDetailsCard isReceived={isReceived} sponsor={sponsor} />

      {sponsor.artworkInstructions ? (
        <div className="public-donation-artwork-instructions notice notice--info">
          <p className="public-donation-artwork-instructions-title">Artwork specifications:</p>
          <p>{sponsor.artworkInstructions}</p>
        </div>
      ) : null}

      <SponsorArtworkUploadCard
        handleFileSelected={handleFileSelected}
        isReceived={isReceived}
        sponsor={sponsor}
        token={token}
        uploadError={uploadError}
        uploadSuccess={uploadSuccess}
        uploading={uploading}
      />

      <div className="public-sponsor-actions">
        <a className="button button--secondary" href="/">
          Return home
        </a>
      </div>
    </section>
  );
}
