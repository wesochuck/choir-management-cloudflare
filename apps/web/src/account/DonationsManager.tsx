import {
  donationRecordSchema,
  donationRecordsResponseSchema,
  patronRecordsResponseSchema,
  type DonationRecord,
  type PatronRecord,
} from "@choir/contracts";
import { useEffect, useState } from "react";

type DonationState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly donations: readonly DonationRecord[]; readonly status: "ready" };

type PatronState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly patrons: readonly PatronRecord[]; readonly status: "ready" };

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

function tributeLabel(type: string): string {
  switch (type) {
    case "honor":
      return "In Honor Of";
    case "memory":
      return "In Memory Of";
    case "anonymous":
      return "Anonymous";
    default:
      return "None";
  }
}

function parseDonations(body: unknown): readonly DonationRecord[] {
  const parsed = donationRecordsResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.donations : [];
}

function parsePatrons(body: unknown): readonly PatronRecord[] {
  const parsed = patronRecordsResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.patrons : [];
}

export function DonationsManager({ enabled }: { readonly enabled: boolean }) {
  const [donationState, setDonationState] = useState<DonationState>({ status: "loading" });
  const [patronState, setPatronState] = useState<PatronState>({ status: "loading" });
  const [refundId, setRefundId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"donations" | "patrons">("donations");

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      fetch("/api/organization/donations", {
        credentials: "same-origin",
        signal: controller.signal,
      }),
      fetch("/api/organization/patrons", { credentials: "same-origin", signal: controller.signal }),
    ])
      .then(async ([donationsRes, patronsRes]) => {
        if (!donationsRes.ok || !patronsRes.ok) {
          if (!controller.signal.aborted) {
            setDonationState({ status: "error" });
            setPatronState({ status: "error" });
          }
          return;
        }
        const donationsBody: unknown = await donationsRes.json();
        const patronsBody: unknown = await patronsRes.json();
        setDonationState({ donations: parseDonations(donationsBody), status: "ready" });
        setPatronState({ patrons: parsePatrons(patronsBody), status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDonationState({ status: "error" });
          setPatronState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  async function refund(donationId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/refund-donation", {
        body: JSON.stringify({ donationId }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Refund failed");
      const body: unknown = await response.json();
      const parsed = donationRecordSchema.safeParse(body);
      const refunded = parsed.success ? parsed.data : null;
      if (!refunded) throw new Error("Invalid response");
      setDonationState((current) =>
        current.status === "ready"
          ? {
              donations: current.donations.map((d) => (d.id === refunded.id ? refunded : d)),
              status: "ready",
            }
          : current,
      );
      setRefundId(null);
      setMessage("Donation refunded.");
    } catch {
      setMessage("The donation could not be refunded.");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;
  return (
    <section className="panel" aria-labelledby="donations-manager-heading">
      <p className="eyebrow">Manager tools</p>
      <h2 id="donations-manager-heading">Donations</h2>
      {message ? (
        <p className="notice notice--info" role="status">
          {message}
        </p>
      ) : null}
      <div className="form-actions">
        <button
          className={`button ${tab === "donations" ? "button--primary" : "button--secondary"}`}
          onClick={() => {
            setTab("donations");
          }}
          type="button"
        >
          Donations
        </button>
        <button
          className={`button ${tab === "patrons" ? "button--primary" : "button--secondary"}`}
          onClick={() => {
            setTab("patrons");
          }}
          type="button"
        >
          Patrons
        </button>
      </div>
      {tab === "donations" ? (
        <DonationsTab
          busy={busy}
          donationState={donationState}
          refund={refund}
          refundId={refundId}
          setRefundId={setRefundId}
        />
      ) : (
        <PatronsTab patronState={patronState} />
      )}
    </section>
  );
}

function DonationsTab({
  busy,
  donationState,
  refund,
  refundId,
  setRefundId,
}: {
  readonly busy: boolean;
  readonly donationState: DonationState;
  readonly refund: (id: string) => Promise<void>;
  readonly refundId: string | null;
  readonly setRefundId: (id: string | null) => void;
}) {
  if (donationState.status === "loading") return <p>Loading donations…</p>;
  if (donationState.status === "error")
    return <p className="notice notice--error">Donations could not be loaded.</p>;
  if (donationState.donations.length === 0) return <p>No donations yet.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Donor</th>
            <th>Amount</th>
            <th>Tribute</th>
            <th>Status</th>
            <th>Date</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {donationState.donations.map((donation) => (
            <tr key={donation.id}>
              <td>
                {donation.anonymous ? "Anonymous" : donation.buyerName}
                <br />
                <small>{donation.anonymous ? "" : donation.buyerEmail}</small>
              </td>
              <td>{money(donation.amountCents)}</td>
              <td>
                {tributeLabel(donation.tributeType)}
                {donation.tributeName ? `: ${donation.tributeName}` : ""}
              </td>
              <td>{donation.status}</td>
              <td>{new Date(donation.createdAt).toLocaleDateString()}</td>
              <td>
                {refundId === donation.id ? (
                  <div className="danger-confirmation">
                    <p>Refund this donation?</p>
                    <div className="form-actions">
                      <button
                        className="button button--secondary"
                        disabled={busy}
                        onClick={() => {
                          setRefundId(null);
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className="button button--danger"
                        disabled={busy}
                        onClick={() => void refund(donation.id)}
                        type="button"
                      >
                        {busy ? "Refunding…" : "Confirm refund"}
                      </button>
                    </div>
                  </div>
                ) : donation.status === "paid" ? (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setRefundId(donation.id);
                    }}
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

function PatronsTab({ patronState }: { readonly patronState: PatronState }) {
  if (patronState.status === "loading") return <p>Loading patrons…</p>;
  if (patronState.status === "error")
    return <p className="notice notice--error">Patrons could not be loaded.</p>;
  if (patronState.patrons.length === 0) return <p>No patrons yet.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Total Donated</th>
            <th>Donations</th>
            <th>First</th>
            <th>Latest</th>
          </tr>
        </thead>
        <tbody>
          {patronState.patrons.map((patron) => (
            <tr key={patron.id}>
              <td>{patron.name}</td>
              <td>{patron.email}</td>
              <td>{money(patron.totalDonatedCents)}</td>
              <td>{patron.donationCount}</td>
              <td>{new Date(patron.firstDonatedAt).toLocaleDateString()}</td>
              <td>{new Date(patron.lastDonatedAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
