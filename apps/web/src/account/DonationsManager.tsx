import {
  donationRecordSchema,
  type DonationLevel,
  type DonationSettings,
  type ManualDonationCreateRequest,
} from "@choir/contracts";
import { buildDonorSuggestions, type DonorSuggestion } from "@choir/domain";
import { useConfirmation } from "@choir/ui";
import { useEffect, useMemo, useState, type SyntheticEvent } from "react";

import {
  createManualOrganizationDonation,
  getOrganizationCalendarSettings,
  getOrganizationDonationSettings,
  listOrganizationDirectory,
  listOrganizationTicketOrders,
  updateOrganizationDonationSettings,
  updateOrganizationDonationThankYou,
} from "../auth/api";
import { useFloatingSaveAction } from "./useFloatingSaveAction";
import { DonationHistoryTab } from "./components/DonationsManager/DonationHistoryTab";
import { DonationLevelDialog } from "./components/DonationsManager/DonationLevelDialog";
import { DonationLevelsTab } from "./components/DonationsManager/DonationLevelsTab";
import { DonationPageSettingsTab } from "./components/DonationsManager/DonationPageSettingsTab";
import { DonationPortalTab } from "./components/DonationsManager/DonationPortalTab";
import { ManualDonationModal } from "./components/DonationsManager/ManualDonationModal";
import {
  parseDonations,
  parsePatrons,
  type DonationSettingsState,
  type DonationState,
  type DonationTab,
  type PatronState,
} from "./components/DonationsManager/types";

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
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [donorSuggestions, setDonorSuggestions] = useState<readonly DonorSuggestion[]>([]);
  const [editingLevelId, setEditingLevelId] = useState<string | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);
  const [levelLabel, setLevelLabel] = useState("");
  const [levelAmount, setLevelAmount] = useState("");
  const [levelBenefit, setLevelBenefit] = useState("");
  const [portalButtonText, setPortalButtonText] = useState("");
  const [portalDescription, setPortalDescription] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const { confirm, confirmationDialog } = useConfirmation();

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
      getOrganizationCalendarSettings(controller.signal).catch(() => ({ timezone: "UTC" })),
    ])
      .then(async ([donationsRes, patronsRes, settings, calendarSettings]) => {
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
        setTimezone(calendarSettings.timezone);
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

  useEffect(() => {
    if (!manualModalOpen) return;
    let cancelled = false;
    async function gather(): Promise<void> {
      const [ordersResult, directoryResult] = await Promise.allSettled([
        listOrganizationTicketOrders(),
        listOrganizationDirectory(),
      ]);
      if (cancelled) return;
      const patrons =
        patronState.status === "ready"
          ? patronState.patrons.map((patron) => ({
              email: patron.email,
              name: patron.name,
              totalDonatedCents: patron.totalDonatedCents,
            }))
          : [];
      const buyers =
        ordersResult.status === "fulfilled"
          ? ordersResult.value.map((order) => ({
              buyerEmail: order.buyerEmail,
              buyerName: order.buyerName,
            }))
          : [];
      const members =
        directoryResult.status === "fulfilled"
          ? directoryResult.value.map((profile) => ({
              displayName: profile.displayName,
              email: profile.email,
            }))
          : [];
      setDonorSuggestions(buildDonorSuggestions(patrons, buyers, members));
    }
    void gather();
    return () => {
      cancelled = true;
    };
  }, [manualModalOpen, patronState]);

  function openNewLevel(): void {
    setEditingLevelId(null);
    setLevelLabel("");
    setLevelAmount("");
    setLevelBenefit("");
    setLevelError(null);
    setSettingsDialogOpen(true);
  }

  function openEditLevel(level: DonationLevel): void {
    setEditingLevelId(level.id);
    setLevelLabel(level.label);
    setLevelAmount((level.amountCents / 100).toFixed(2));
    setLevelBenefit(level.benefit);
    setLevelError(null);
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
    setLevelError(null);
    const amountCents = Math.round(Number(levelAmount) * 100);
    if (!levelLabel.trim() || !Number.isFinite(amountCents) || amountCents <= 0) {
      setLevelError("Provide a level label and a valid positive amount.");
      return;
    }
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
    setBusy(true);
    setMessage(null);
    try {
      const saved = await updateOrganizationDonationSettings({ ...settingsState.settings, levels });
      setSettingsState({ settings: saved, status: "ready" });
      setPortalButtonText(saved.buttonText);
      setPortalDescription(saved.description);
      setLevelError(null);
      setSettingsDialogOpen(false);
      setMessage("Donation level saved.");
    } catch (saveError: unknown) {
      setLevelError(
        saveError instanceof Error ? saveError.message : "The donation level could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteLevel(levelId: string): Promise<void> {
    if (settingsState.status !== "ready") return;
    if (
      !(await confirm({
        confirmLabel: "Delete level",
        description: "This donor level will be permanently removed from the public donation page.",
        destructive: true,
        title: "Delete donation level?",
      }))
    ) {
      return;
    }
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
      const response = await fetch(
        `/api/organization/donations/${encodeURIComponent(donationId)}/refund`,
        {
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
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

  async function handleSaveManualDonation(payload: ManualDonationCreateRequest): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const created = await createManualOrganizationDonation(payload);
      setDonationState((current) =>
        current.status === "ready"
          ? { donations: [created, ...current.donations], status: "ready" }
          : current,
      );
      const patronsRes = await fetch("/api/organization/patrons", { credentials: "same-origin" });
      if (patronsRes.ok) {
        const patronsBody: unknown = await patronsRes.json();
        setPatronState({ patrons: parsePatrons(patronsBody), status: "ready" });
      }
      setMessage("Manual donation recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateThankYou(donationId: string, thankYouSent: boolean): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await updateOrganizationDonationThankYou({ donationId, thankYouSent });
      setDonationState((current) =>
        current.status === "ready"
          ? {
              donations: current.donations.map((d) => (d.id === updated.id ? updated : d)),
              status: "ready",
            }
          : current,
      );
      setMessage(
        thankYouSent ? "Thank-you letter marked as sent." : "Thank-you letter marked as pending.",
      );
    } catch {
      setMessage("The thank-you letter status could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  const portalCopyDirty = useMemo(() => {
    if (settingsState.status !== "ready") return false;
    return (
      portalButtonText !== settingsState.settings.buttonText ||
      portalDescription !== settingsState.settings.description
    );
  }, [portalButtonText, portalDescription, settingsState]);

  useFloatingSaveAction({
    busy,
    dirty: portalCopyDirty,
    id: "organization-donation-portal-copy",
    onDiscard: () => {
      if (settingsState.status === "ready") {
        setPortalButtonText(settingsState.settings.buttonText);
        setPortalDescription(settingsState.settings.description);
      }
    },
    onSave: async () => {
      if (settingsState.status !== "ready" || !portalButtonText.trim()) return;
      await saveSettings({
        ...settingsState.settings,
        buttonText: portalButtonText.trim(),
        description: portalDescription.trim(),
      });
    },
  });

  if (!enabled) return null;
  return (
    <section className="panel" aria-label="Donations and giving management">
      {message && !settingsDialogOpen && !manualModalOpen ? (
        <p className="notice notice--info" role="status">
          {message}
        </p>
      ) : null}
      <nav aria-label="Donation sections" className="ticketing-tabs" role="tablist">
        <button
          aria-controls="donation-history-panel"
          aria-selected={tab === "history"}
          className={tab === "history" ? "is-active" : undefined}
          id="donation-history-tab"
          onClick={() => {
            setTab("history");
          }}
          role="tab"
          type="button"
        >
          Donation History
        </button>
        <button
          aria-controls="donation-levels-panel"
          aria-selected={tab === "levels"}
          className={tab === "levels" ? "is-active" : undefined}
          id="donation-levels-tab"
          onClick={() => {
            setTab("levels");
          }}
          role="tab"
          type="button"
        >
          Donor levels
        </button>
        <button
          aria-controls="donation-portal-panel"
          aria-selected={tab === "portal"}
          className={tab === "portal" ? "is-active" : undefined}
          id="donation-portal-tab"
          onClick={() => {
            setTab("portal");
          }}
          role="tab"
          type="button"
        >
          Public portal
        </button>
        <button
          aria-controls="donation-page-settings-panel"
          aria-selected={tab === "pageSettings"}
          className={tab === "pageSettings" ? "is-active" : undefined}
          id="donation-page-settings-tab"
          onClick={() => {
            setTab("pageSettings");
          }}
          role="tab"
          type="button"
        >
          Page settings
        </button>
      </nav>
      <div
        aria-labelledby={`donation-${tab === "pageSettings" ? "page-settings" : tab}-tab`}
        id={`donation-${tab === "pageSettings" ? "page-settings" : tab}-panel`}
        role="tabpanel"
      >
        {tab === "history" ? (
          <DonationHistoryTab
            busy={busy}
            donationState={donationState}
            onOpenManualModal={() => {
              setManualModalOpen(true);
            }}
            patronState={patronState}
            refund={refund}
            refundId={refundId}
            setRefundId={setRefundId}
            timezone={timezone}
            updateThankYou={handleUpdateThankYou}
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
      </div>
      <ManualDonationModal
        busy={busy}
        onClose={() => {
          if (!busy) setManualModalOpen(false);
        }}
        onSave={handleSaveManualDonation}
        open={manualModalOpen}
        suggestions={donorSuggestions}
      />
      <DonationLevelDialog
        busy={busy}
        editingLevelId={editingLevelId}
        error={levelError}
        levelAmount={levelAmount}
        levelBenefit={levelBenefit}
        levelLabel={levelLabel}
        onClose={() => {
          if (!busy) setSettingsDialogOpen(false);
        }}
        open={settingsDialogOpen}
        saveLevel={saveLevel}
        setLevelAmount={setLevelAmount}
        setLevelBenefit={setLevelBenefit}
        setLevelLabel={setLevelLabel}
      />
      {confirmationDialog}
    </section>
  );
}
