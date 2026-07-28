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
import { useEffect, useState, type SyntheticEvent } from "react";

import { getOrganizationDonationSettings, updateOrganizationDonationSettings } from "../auth/api";

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
  const [tab, setTab] = useState<"donations" | "patrons" | "settings">("donations");
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
        <button
          className={`button ${tab === "settings" ? "button--primary" : "button--secondary"}`}
          onClick={() => {
            setTab("settings");
          }}
          type="button"
        >
          Levels & settings
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
      ) : tab === "patrons" ? (
        <PatronsTab patronState={patronState} />
      ) : (
        <DonationSettingsTab
          busy={busy}
          deleteLevel={deleteLevel}
          editLevel={openEditLevel}
          newLevel={openNewLevel}
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

function DonationSettingsTab({
  busy,
  deleteLevel,
  editLevel,
  newLevel,
  portalButtonText,
  portalDescription,
  savePortalSettings,
  setPortalButtonText,
  setPortalDescription,
  settingsState,
}: {
  readonly busy: boolean;
  readonly deleteLevel: (levelId: string) => Promise<void>;
  readonly editLevel: (level: DonationLevel) => void;
  readonly newLevel: () => void;
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
    <div className="donation-settings-grid">
      <form
        className="surface-card form-stack"
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
      <section className="surface-card" aria-labelledby="donation-levels-heading">
        <div className="section-heading section-heading--compact">
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
        <div className="donation-level-list">
          {settingsState.settings.levels.map((level) => (
            <article className="compact-card" key={level.id}>
              <div>
                <h4>{level.label}</h4>
                <p>{money(level.amountCents)}</p>
                <small>{level.benefit || "No benefit specified"}</small>
              </div>
              <div className="form-actions">
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
            </article>
          ))}
        </div>
      </section>
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
