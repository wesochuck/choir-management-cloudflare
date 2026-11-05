import { donationStatusDisplay } from "./types";
import { formatTimezoneName } from "@choir/domain";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataTable, useConfirmation, type DataTableColumn } from "@choir/ui";
import type { DonationRecord } from "@choir/contracts";
import {
  listDonationPublications,
  reviewDonationPublications,
  setDonationInclusion,
} from "../../../api/donations";
import { queryKeys } from "../../../api";

export function PublicationReview() {
  const [publicationId, setPublicationId] = useState("");
  const [filter, setFilter] = useState("review");
  const [cursor, setCursor] = useState<string>();
  const [publicationCursor, setPublicationCursor] = useState<string>();
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, confirmationDialog } = useConfirmation();
  const publications = useQuery({
    queryKey: queryKeys.organization.donationPublications(publicationCursor),
    queryFn: () => listDonationPublications(publicationCursor),
  });
  const query = useQuery({
    queryKey: queryKeys.organization.donationPublicationReview(publicationId, filter, cursor),
    queryFn: () =>
      reviewDonationPublications({
        ...(publicationId ? { publicationId } : {}),
        filter,
        ...(cursor ? { cursor } : {}),
      }),
  });
  async function include(d: DonationRecord, remove = false) {
    const name = publications.data?.publications.find((p) => p.id === target)?.name;
    if (!remove && !name) {
      setError("Choose a publication for inclusion first.");
      return;
    }
    if (
      !(await confirm({
        title: remove ? "Correct inclusion?" : "Record publication inclusion?",
        description: remove
          ? "Remove this inclusion decision while preserving its audit history."
          : inclusionDescription(d, name),
        confirmLabel: remove ? "Remove inclusion" : "Mark included",
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await setDonationInclusion({
        donationId: d.id,
        publicationId: remove ? null : target,
        expectedRevision: d.inclusionRevision ?? 0,
        requestId: crypto.randomUUID(),
      });
      await query.refetch();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Inclusion could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  const columns: DataTableColumn<DonationRecord>[] = [
    {
      id: "buyerName",
      sortValue: (d) => d.buyerName,
      header: "Donor",
      render: (d) => (
        <span>
          {d.buyerName}
          {d.anonymous ? " (Anonymous)" : ""}
        </span>
      ),
    },
    {
      id: "paymentStatus",
      header: "Payment status",
      sortValue: (d) => donationStatusDisplay(d).label,
      render: (d) => (
        <span className={donationStatusDisplay(d).badgeClass}>
          {donationStatusDisplay(d).label}
        </span>
      ),
    },
    {
      id: "publication",
      header: "Original publication",
      sortValue: (d) => d.publicationContext?.publication.name ?? "",
      render: (d) => (
        <div>
          {d.publicationContext?.publication.name ?? "Unassigned"}
          {d.publicationContext ? (
            <div className="field-help">
              {d.publicationContext.publication.recognitionDate ? (
                <span>Name cutoff: {d.publicationContext.publication.recognitionDate}. </span>
              ) : null}
              {d.publicationContext.publication.artworkDate ? (
                <span>Artwork deadline: {d.publicationContext.publication.artworkDate}. </span>
              ) : null}
              {formatTimezoneName(
                d.publicationContext.publication.timezone,
                d.publicationContext.publication.recognitionDate ??
                  d.publicationContext.publication.artworkDate,
              )}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "late",
      header: "Deadline status",
      sortValue: (d) => d.publicationContext?.recognitionStatus ?? "",
      render: (d) => (
        <span>
          {d.publicationContext?.recognitionStatus === "after_cutoff"
            ? "After name cutoff — review for inclusion"
            : ""}
          {d.publicationContext?.artworkStatus === "after_cutoff" ? (
            <span> After artwork deadline — review for inclusion</span>
          ) : null}
          {!d.publicationContext ? "Unassigned" : null}
        </span>
      ),
    },
    {
      id: "included",
      header: "Recorded inclusion",
      sortValue: (d) => d.includedPublicationName ?? "",
      render: (d) =>
        d.includedPublicationName ? `Included in ${d.includedPublicationName}` : "Not recorded",
    },
    {
      id: "actions",
      header: "Actions",
      render: (d) => (
        <div className="table-actions">
          <button
            className="button button--secondary button--small"
            disabled={busy || d.status !== "paid" || !target}
            type="button"
            onClick={() => void include(d)}
          >
            Mark included
          </button>
          {d.includedPublicationId ? (
            <button
              className="button button--subtle button--small"
              type="button"
              disabled={busy}
              onClick={() => void include(d, true)}
            >
              Correct inclusion
            </button>
          ) : null}
        </div>
      ),
    },
  ];
  return (
    <section className="form-stack" aria-label="Publication review">
      <h3>Publication review</h3>
      <div className="form-grid">
        <label className="field">
          Original publication
          <select
            value={publicationId}
            onChange={(e) => {
              setPublicationId(e.target.value);
              setCursor(undefined);
            }}
          >
            <option value="">All publications and unassigned</option>
            {publications.data?.publications.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Review status
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setCursor(undefined);
            }}
          >
            <option value="review">Outstanding review</option>
            <option value="all">All gifts</option>
            <option value="late_gift">After name cutoff</option>
            <option value="late_artwork">After artwork deadline</option>
          </select>
        </label>
        <label className="field">
          Include in publication
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
            }}
          >
            <option value="">Choose publication</option>
            {publications.data?.publications.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {publications.data?.nextCursor ? (
        <button
          className="button button--secondary"
          type="button"
          onClick={() => {
            setPublicationCursor(publications.data.nextCursor ?? undefined);
          }}
        >
          More publication choices
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="notice notice--error">
          {error}
        </p>
      ) : null}
      {query.isError || publications.isError ? (
        <p role="alert">Publication review could not be loaded.</p>
      ) : query.isPending ? (
        <p>Loading publication review…</p>
      ) : (
        <DataTable
          columns={columns}
          rows={query.data.donations}
          keySelector={(d) => d.id}
          emptyMessage="No matching gifts on this page."
        />
      )}
      <div className="table-actions">
        {cursor ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              setCursor(undefined);
            }}
          >
            First page
          </button>
        ) : null}
        {query.data?.nextCursor ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              setCursor(query.data.nextCursor ?? undefined);
            }}
          >
            Next page
          </button>
        ) : null}
      </div>
      {confirmationDialog}
    </section>
  );
}

function inclusionDescription(d: DonationRecord, name: string | undefined) {
  return `Record this gift as included in ${name ?? "the selected publication"}? ${d.anonymous ? "This donor is anonymous; their name must remain private." : "The original donation publication remains unchanged."}`;
}
