import {
  donationRecordSchema,
  donationRecordsResponseSchema,
  patronRecordsResponseSchema,
  type DonationLevel,
  type DonationSettings,
  type DonationRecord,
  type PatronRecord,
} from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { useEffect, useMemo, useState, type SyntheticEvent } from "react";

import { getOrganizationDonationSettings, updateOrganizationDonationSettings } from "../auth/api";
import { QRCodeShareCard } from "./QRCodeShareCard";

type DonationState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly donations: readonly DonationRecord[]; readonly status: "ready" };

type PatronState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly patrons: readonly PatronRecord[]; readonly status: "ready" };

type DonationSettingsState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly settings: DonationSettings; readonly status: "ready" };

type DonationTab = "history" | "levels" | "portal" | "pageSettings";

const EMPTY_DONATIONS: readonly DonationRecord[] = [];

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

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function donationsCsv(donations: readonly DonationRecord[]): string {
  const rows = [
    ["Donor", "Email", "Amount", "Processing fee", "Tribute", "Status", "Date"],
    ...donations.map((donation) => [
      donation.anonymous ? "Anonymous" : donation.buyerName,
      donation.anonymous ? "" : donation.buyerEmail,
      money(donation.amountCents),
      money(donation.feeCents),
      `${tributeLabel(donation.tributeType)}${donation.tributeName ? `: ${donation.tributeName}` : ""}`,
      donation.status,
      donation.createdAt,
    ]),
  ];
  return rows.map((row) => row.map((value) => csvCell(value)).join(",")).join("\n");
}

export function DonationsManager({ enabled }: { readonly enabled: boolean }) {
  const [donationState, setDonationState] = useState<DonationState>({ status: "loading" });
  const [patronState, setPatronState] = useState<PatronState>({ status: "loading" });
  const [refundId, setRefundId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<DonationTab>("history");
  const [settingsState, setSettingsState] = useState<DonationSettingsState>({
    status: "loading",
  });
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [editingLevelId, setEditingLevelId] = useState<string | null>(null);
  const [levelLabel, setLevelLabel] = useState("");
  const [levelAmount, setLevelAmount] = useState("");
  const [levelBenefit, setLevelBenefit] = useState("");
  const [portalButtonText, setPortalButtonText] = useState("");
  const [portalDescription, setPortalDescription] = useState("");

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      fetch("/api/organization/donations", {
        credentials: "same-origin",
        signal: controller.signal,
      }),
      fetch("/api/organization/patrons", { credentials: "same-origin", signal: controller.signal }),
      getOrganizationDonationSettings(controller.signal),
    ])
      .then(async ([donationsRes, patronsRes, settings]) => {
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
        setSettingsState({ settings, status: "ready" });
        setPortalButtonText(settings.buttonText);
        setPortalDescription(settings.description);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDonationState({ status: "error" });
          setPatronState({ status: "error" });
          setSettingsState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  function openNewLevel(): void {
    setEditingLevelId(null);
    setLevelLabel("");
    setLevelAmount("");
    setLevelBenefit("");
    setSettingsDialogOpen(true);
  }

  function openEditLevel(level: DonationLevel): void {
    setEditingLevelId(level.id);
    setLevelLabel(level.label);
    setLevelAmount((level.amountCents / 100).toFixed(2));
    setLevelBenefit(level.benefit);
    setSettingsDialogOpen(true);
  }

  async function saveSettings(settings: DonationSettings): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await updateOrganizationDonationSettings(settings);
      setSettingsState({ settings: saved, status: "ready" });
      setPortalButtonText(saved.buttonText);
      setPortalDescription(saved.description);
      setMessage("Donation settings saved.");
    } catch {
      setMessage("The donation settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveLevel(formEvent: SyntheticEvent<HTMLFormElement>): Promise<void> {
    formEvent.preventDefault();
    if (settingsState.status !== "ready") return;
    const amountCents = Math.round(Number(levelAmount) * 100);
    if (!levelLabel.trim() || !Number.isFinite(amountCents) || amountCents <= 0) return;
    const level: DonationLevel = {
      amountCents,
      benefit: levelBenefit.trim(),
      id: editingLevelId ?? `level-${crypto.randomUUID()}`,
      label: levelLabel.trim(),
    };
    const levels = editingLevelId
      ? settingsState.settings.levels.map((candidate) =>
          candidate.id === editingLevelId ? level : candidate,
        )
      : [...settingsState.settings.levels, level];
    await saveSettings({ ...settingsState.settings, levels });
    setSettingsDialogOpen(false);
  }

  async function deleteLevel(levelId: string): Promise<void> {
    if (settingsState.status !== "ready") return;
    if (!window.confirm("Delete this donation level?")) return;
    await saveSettings({
      ...settingsState.settings,
      levels: settingsState.settings.levels.filter((level) => level.id !== levelId),
    });
  }

  async function savePortalSettings(formEvent: SyntheticEvent<HTMLFormElement>): Promise<void> {
    formEvent.preventDefault();
    if (settingsState.status !== "ready" || !portalButtonText.trim()) return;
    await saveSettings({
      ...settingsState.settings,
      buttonText: portalButtonText.trim(),
      description: portalDescription.trim(),
    });
  }

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
  const donationExportHref =
    donationState.status === "ready"
      ? `data:text/csv;charset=utf-8,${encodeURIComponent(donationsCsv(donationState.donations))}`
      : undefined;
  return (
    <section className="panel" aria-label="Donations and giving management">
      {message ? (
        <p className="notice notice--info" role="status">
          {message}
        </p>
      ) : null}
      <header className="ticketing-page-header">
        <div>
          <p>
            Monitor your choir&apos;s incoming donations, giving activity, and donor recognition
            tiers.
          </p>
        </div>
        <a className="button button--secondary" download="donations.csv" href={donationExportHref}>
          Export CSV
        </a>
      </header>
      <nav aria-label="Donation sections" className="ticketing-tabs" role="tablist">
        <button
          aria-selected={tab === "history"}
          className={tab === "history" ? "is-active" : undefined}
          onClick={() => {
            setTab("history");
          }}
          role="tab"
          type="button"
        >
          Donation History
        </button>
        <button
          aria-selected={tab === "levels"}
          className={tab === "levels" ? "is-active" : undefined}
          onClick={() => {
            setTab("levels");
          }}
          role="tab"
          type="button"
        >
          Donor levels
        </button>
        <button
          aria-selected={tab === "portal"}
          className={tab === "portal" ? "is-active" : undefined}
          onClick={() => {
            setTab("portal");
          }}
          role="tab"
          type="button"
        >
          Public portal
        </button>
        <button
          aria-selected={tab === "pageSettings"}
          className={tab === "pageSettings" ? "is-active" : undefined}
          onClick={() => {
            setTab("pageSettings");
          }}
          role="tab"
          type="button"
        >
          Page settings
        </button>
      </nav>
      {tab === "history" ? (
        <DonationHistoryTab
          busy={busy}
          donationState={donationState}
          patronState={patronState}
          refund={refund}
          refundId={refundId}
          setRefundId={setRefundId}
        />
      ) : tab === "levels" ? (
        <DonationLevelsTab
          busy={busy}
          deleteLevel={deleteLevel}
          editLevel={openEditLevel}
          newLevel={openNewLevel}
          settingsState={settingsState}
        />
      ) : tab === "portal" ? (
        <DonationPortalTab settingsState={settingsState} />
      ) : (
        <DonationPageSettingsTab
          busy={busy}
          savePortalSettings={savePortalSettings}
          settingsState={settingsState}
          portalButtonText={portalButtonText}
          portalDescription={portalDescription}
          setPortalButtonText={setPortalButtonText}
          setPortalDescription={setPortalDescription}
        />
      )}
      <Dialog
        description="Set the recognition label, suggested amount, and benefit shown to donors."
        onClose={() => {
          if (!busy) setSettingsDialogOpen(false);
        }}
        open={settingsDialogOpen}
        title={editingLevelId ? "Edit donation level" : "New donation level"}
      >
        <form className="form-stack" onSubmit={(event) => void saveLevel(event)}>
          <label className="field">
            Level label
            <input
              required
              maxLength={120}
              value={levelLabel}
              onChange={(event) => {
                setLevelLabel(event.target.value);
              }}
            />
          </label>
          <label className="field">
            Suggested amount (USD)
            <input
              required
              min="0.01"
              step="0.01"
              type="number"
              value={levelAmount}
              onChange={(event) => {
                setLevelAmount(event.target.value);
              }}
            />
          </label>
          <label className="field">
            Benefit or perks
            <textarea
              maxLength={1000}
              rows={3}
              value={levelBenefit}
              onChange={(event) => {
                setLevelBenefit(event.target.value);
              }}
            />
          </label>
          <div className="form-actions">
            <button className="button button--primary" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save level"}
            </button>
            <button
              className="button button--secondary"
              disabled={busy}
              onClick={() => {
                setSettingsDialogOpen(false);
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

type DonationSort = "dateDesc" | "dateAsc" | "donor";

function DonationHistoryTab({
  busy,
  donationState,
  patronState,
  refund,
  refundId,
  setRefundId,
}: {
  readonly busy: boolean;
  readonly donationState: DonationState;
  readonly patronState: PatronState;
  readonly refund: (id: string) => Promise<void>;
  readonly refundId: string | null;
  readonly setRefundId: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState<DonationSort>("dateDesc");
  const donations = donationState.status === "ready" ? donationState.donations : EMPTY_DONATIONS;
  const paidDonations = donations.filter((donation) => donation.status === "paid");
  const totalRaisedCents = paidDonations.reduce(
    (total, donation) => total + donation.amountCents,
    0,
  );
  const averageGiftCents = paidDonations.length
    ? Math.round(totalRaisedCents / paidDonations.length)
    : 0;
  const filteredDonations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return donations
      .filter((donation) => {
        const donorText = [
          donation.anonymous ? "Anonymous" : donation.buyerName,
          donation.anonymous ? "" : donation.buyerEmail,
          donation.tributeName,
        ]
          .join(" ")
          .toLocaleLowerCase();
        const donationDate = donation.createdAt.slice(0, 10);
        return (
          (!normalizedQuery || donorText.includes(normalizedQuery)) &&
          (!fromDate || donationDate >= fromDate) &&
          (!toDate || donationDate <= toDate)
        );
      })
      .toSorted((left, right) => {
        if (sort === "donor") {
          const leftName = left.anonymous ? "Anonymous" : left.buyerName;
          const rightName = right.anonymous ? "Anonymous" : right.buyerName;
          return leftName.localeCompare(rightName);
        }
        const direction = sort === "dateDesc" ? -1 : 1;
        return direction * left.createdAt.localeCompare(right.createdAt);
      });
  }, [donations, fromDate, query, sort, toDate]);

  if (donationState.status === "loading") return <p>Loading donations…</p>;
  if (donationState.status === "error")
    return <p className="notice notice--error">Donations could not be loaded.</p>;

  return (
    <div className="donation-history">
      <section
        className="ticket-dashboard donation-dashboard"
        aria-labelledby="donation-summary-heading"
      >
        <div className="ticket-dashboard__section-heading">
          <div>
            <h3 id="donation-summary-heading">Donation summary</h3>
            <p>Review incoming gifts and donor activity.</p>
          </div>
        </div>
        <div className="ticket-dashboard__metrics donation-dashboard__metrics">
          <article className="summary-card ticket-dashboard__metric">
            <span className="summary-card__label">Donations count</span>
            <strong>{paidDonations.length}</strong>
          </article>
          <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--sales">
            <span className="summary-card__label">Total raised</span>
            <strong>{money(totalRaisedCents)}</strong>
          </article>
          <article className="summary-card ticket-dashboard__metric ticket-dashboard__metric--revenue">
            <span className="summary-card__label">Average gift</span>
            <strong>{money(averageGiftCents)}</strong>
          </article>
        </div>
      </section>
      <section
        className="ticket-dashboard__will-call donation-register"
        aria-labelledby="donation-register-heading"
      >
        <div className="ticket-dashboard__section-heading">
          <div>
            <h3 id="donation-register-heading">Donations register</h3>
            <p>Search donation history, review payment status, and process refunds.</p>
          </div>
          <span className="field-help">{filteredDonations.length} shown</span>
        </div>
        <div className="ticket-dashboard__filters donation-dashboard__filters">
          <label className="field">
            Search
            <input
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Donor name or email…"
              type="search"
              value={query}
            />
          </label>
          <label className="field">
            From date
            <input
              onChange={(event) => {
                setFromDate(event.target.value);
              }}
              type="date"
              value={fromDate}
            />
          </label>
          <label className="field">
            To date
            <input
              onChange={(event) => {
                setToDate(event.target.value);
              }}
              type="date"
              value={toDate}
            />
          </label>
          <label className="field">
            Sort by
            <select
              onChange={(event) => {
                const value = event.target.value;
                if (value === "dateDesc" || value === "dateAsc" || value === "donor") {
                  setSort(value);
                }
              }}
              value={sort}
            >
              <option value="dateDesc">Date (Newest First)</option>
              <option value="dateAsc">Date (Oldest First)</option>
              <option value="donor">Donor name</option>
            </select>
          </label>
        </div>
        {donations.length === 0 ? <p>No donations yet.</p> : null}
        {donations.length > 0 && filteredDonations.length === 0 ? (
          <p className="empty-state">No donations match these filters.</p>
        ) : null}
        {filteredDonations.length > 0 ? (
          <div className="table-scroll">
            <table className="table--actions">
              <thead>
                <tr>
                  <th>Donor</th>
                  <th>Amount</th>
                  <th>Processing fee</th>
                  <th>Tribute</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredDonations.map((donation) => (
                  <tr key={donation.id}>
                    <td>
                      {donation.anonymous ? "Anonymous" : donation.buyerName}
                      <br />
                      <small>{donation.anonymous ? "" : donation.buyerEmail}</small>
                    </td>
                    <td>{money(donation.amountCents)}</td>
                    <td>{donation.feeCents > 0 ? money(donation.feeCents) : "Covered"}</td>
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
        ) : null}
      </section>
      <details className="donation-patrons">
        <summary>
          Patron summaries ({patronState.status === "ready" ? patronState.patrons.length : "…"})
        </summary>
        <PatronsTab patronState={patronState} />
      </details>
    </div>
  );
}

function DonationPortalTab({ settingsState }: { readonly settingsState: DonationSettingsState }) {
  if (settingsState.status === "loading") return <p>Loading donation settings…</p>;
  if (settingsState.status === "error") {
    return <p className="notice notice--error">Donation settings could not be loaded.</p>;
  }
  return (
    <QRCodeShareCard
      description="Share this page with supporters so they can choose a donation level or enter a custom amount."
      path="/donate"
      title="Public donation page"
    />
  );
}

function DonationPageSettingsTab({
  busy,
  portalButtonText,
  portalDescription,
  savePortalSettings,
  setPortalButtonText,
  setPortalDescription,
  settingsState,
}: {
  readonly busy: boolean;
  readonly portalButtonText: string;
  readonly portalDescription: string;
  readonly savePortalSettings: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
  readonly setPortalButtonText: (value: string) => void;
  readonly setPortalDescription: (value: string) => void;
  readonly settingsState: DonationSettingsState;
}) {
  if (settingsState.status === "loading") return <p>Loading donation settings…</p>;
  if (settingsState.status === "error") {
    return <p className="notice notice--error">Donation settings could not be loaded.</p>;
  }
  return (
    <form
      className="surface-card form-stack donation-page-settings"
      onSubmit={(event) => void savePortalSettings(event)}
    >
      <div>
        <p className="eyebrow">Public portal</p>
        <h3>Donation page settings</h3>
        <p>Customize the headline and explanation shown to donors before checkout.</p>
      </div>
      <label className="field">
        Call-to-action heading
        <input
          required
          maxLength={200}
          value={portalButtonText}
          onChange={(event) => {
            setPortalButtonText(event.target.value);
          }}
        />
      </label>
      <label className="field">
        Portal description
        <textarea
          maxLength={2000}
          rows={5}
          value={portalDescription}
          onChange={(event) => {
            setPortalDescription(event.target.value);
          }}
        />
      </label>
      <button className="button button--primary" disabled={busy} type="submit">
        {busy ? "Saving…" : "Save page settings"}
      </button>
    </form>
  );
}

function DonationLevelsTab({
  busy,
  deleteLevel,
  editLevel,
  newLevel,
  settingsState,
}: {
  readonly busy: boolean;
  readonly deleteLevel: (levelId: string) => Promise<void>;
  readonly editLevel: (level: DonationLevel) => void;
  readonly newLevel: () => void;
  readonly settingsState: DonationSettingsState;
}) {
  if (settingsState.status === "loading") return <p>Loading donation settings…</p>;
  if (settingsState.status === "error") {
    return <p className="notice notice--error">Donation settings could not be loaded.</p>;
  }
  return (
    <section className="surface-card" aria-labelledby="donation-levels-heading">
      <div className="section-heading section-heading--compact donation-levels-heading">
        <div>
          <p className="eyebrow">Recognition tiers</p>
          <h3 id="donation-levels-heading">Donor levels</h3>
        </div>
        <button className="button button--primary" onClick={newLevel} type="button">
          Add level
        </button>
      </div>
      <p>Suggested amounts and benefits appear on the public donation page.</p>
      {settingsState.settings.levels.length === 0 ? <p>No donor levels configured yet.</p> : null}
      {settingsState.settings.levels.length > 0 ? (
        <div className="table-scroll donation-level-table-scroll">
          <table className="data-table donation-level-table table--actions">
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Suggested amount</th>
                <th scope="col">Recognition benefit</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {settingsState.settings.levels.map((level) => (
                <tr key={level.id}>
                  <th scope="row">{level.label}</th>
                  <td>{money(level.amountCents)}</td>
                  <td>{level.benefit || "No benefit specified"}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          editLevel(level);
                        }}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="text-button text-button--danger"
                        disabled={busy}
                        onClick={() => {
                          void deleteLevel(level.id);
                        }}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
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
