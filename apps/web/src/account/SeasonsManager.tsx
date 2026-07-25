import { duesRecordSchema, duesRecordsResponseSchema, seasonsResponseSchema, type DuesRecord, type Season } from "@choir/contracts";
import { useEffect, useState } from "react";

type SeasonState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly seasons: readonly Season[]; readonly status: "ready" };

type DuesState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly dues: readonly DuesRecord[]; readonly status: "ready" };

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

function parseSeasons(body: unknown): readonly Season[] {
  const parsed = seasonsResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.seasons : [];
}

function parseDues(body: unknown): readonly DuesRecord[] {
  const parsed = duesRecordsResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.dues : [];
}

export function SeasonsManager({ enabled }: { readonly enabled: boolean }) {
  const [seasonState, setSeasonState] = useState<SeasonState>({ status: "loading" });
  const [duesState, setDuesState] = useState<DuesState>({ status: "loading" });
  const [refundId, setRefundId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"seasons" | "dues">("seasons");

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      fetch("/api/organization/seasons", { credentials: "same-origin", signal: controller.signal }),
      fetch("/api/organization/dues", { credentials: "same-origin", signal: controller.signal }),
    ])
      .then(async ([seasonsRes, duesRes]) => {
        if (!seasonsRes.ok || !duesRes.ok) {
          if (!controller.signal.aborted) {
            setSeasonState({ status: "error" });
            setDuesState({ status: "error" });
          }
          return;
        }
        const seasonsBody: unknown = await seasonsRes.json();
        const duesBody: unknown = await duesRes.json();
        setSeasonState({ seasons: parseSeasons(seasonsBody), status: "ready" });
        setDuesState({ dues: parseDues(duesBody), status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSeasonState({ status: "error" });
          setDuesState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  async function refund(duesId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/refund-dues", {
        body: JSON.stringify({ duesId }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Refund failed");
      const body: unknown = await response.json();
      const parsed = duesRecordSchema.safeParse(body);
      const refunded = parsed.success ? parsed.data : null;
      if (!refunded) throw new Error("Invalid response");
      setDuesState((current) =>
        current.status === "ready"
          ? {
              dues: current.dues.map((d) => (d.id === refunded.id ? refunded : d)),
              status: "ready",
            }
          : current,
      );
      setRefundId(null);
      setMessage("Dues refunded.");
    } catch {
      setMessage("The dues could not be refunded.");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;
  return (
    <section className="panel" aria-labelledby="seasons-manager-heading">
      <p className="eyebrow">Manager tools</p>
      <h2 id="seasons-manager-heading">Seasons &amp; Dues</h2>
      {message ? (
        <p className="notice notice--info" role="status">
          {message}
        </p>
      ) : null}
      <div className="form-actions">
        <button
          className={`button ${tab === "seasons" ? "button--primary" : "button--secondary"}`}
          onClick={() => { setTab("seasons"); }}
          type="button"
        >
          Seasons
        </button>
        <button
          className={`button ${tab === "dues" ? "button--primary" : "button--secondary"}`}
          onClick={() => { setTab("dues"); }}
          type="button"
        >
          Dues Records
        </button>
      </div>
      {tab === "seasons" ? (
        <SeasonsTab seasonState={seasonState} />
      ) : (
        <DuesTab
          busy={busy}
          duesState={duesState}
          refund={refund}
          refundId={refundId}
          setRefundId={setRefundId}
        />
      )}
    </section>
  );
}

function SeasonsTab({ seasonState }: { readonly seasonState: SeasonState }) {
  if (seasonState.status === "loading") return <p>Loading seasons…</p>;
  if (seasonState.status === "error") return <p className="notice notice--error">Seasons could not be loaded.</p>;
  if (seasonState.seasons.length === 0) return <p>No seasons yet.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Starts</th>
            <th>Ends</th>
            <th>Dues Amount</th>
          </tr>
        </thead>
        <tbody>
          {seasonState.seasons.map((season) => (
            <tr key={season.id}>
              <td>{season.name}</td>
              <td>{new Date(season.startsAt).toLocaleDateString()}</td>
              <td>{new Date(season.endsAt).toLocaleDateString()}</td>
              <td>{money(season.duesAmountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DuesTab({
  busy, duesState, refund, refundId, setRefundId,
}: {
  readonly busy: boolean;
  readonly duesState: DuesState;
  readonly refund: (id: string) => Promise<void>;
  readonly refundId: string | null;
  readonly setRefundId: (id: string | null) => void;
}) {
  if (duesState.status === "loading") return <p>Loading dues records…</p>;
  if (duesState.status === "error") return <p className="notice notice--error">Dues records could not be loaded.</p>;
  if (duesState.dues.length === 0) return <p>No dues records yet.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Profile</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Paid At</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {duesState.dues.map((record) => (
            <tr key={record.id}>
              <td>{record.profileId}</td>
              <td>{money(record.amountCents)}</td>
              <td>{record.status}</td>
              <td>{record.paidAt ? new Date(record.paidAt).toLocaleDateString() : ""}</td>
              <td>
                {refundId === record.id ? (
                  <div className="danger-confirmation">
                    <p>Refund this dues record?</p>
                    <div className="form-actions">
                      <button
                        className="button button--secondary"
                        disabled={busy}
                        onClick={() => { setRefundId(null); }}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className="button button--danger"
                        disabled={busy}
                        onClick={() => void refund(record.id)}
                        type="button"
                      >
                        {busy ? "Refunding…" : "Confirm refund"}
                      </button>
                    </div>
                  </div>
                ) : record.status === "paid" ? (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => { setRefundId(record.id); }}
                    type="button"
                  >
                    Refund
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
