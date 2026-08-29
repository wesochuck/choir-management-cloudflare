import type {
  DonationRecord,
  DonationSettings,
  ManualDonationCreateRequest,
} from "@choir/contracts";
import { useConfirmation } from "@choir/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createManualOrganizationDonation,
  queryKeys,
  refundOrganizationDonation,
  updateOrganizationDonationSettings,
  updateOrganizationDonationThankYou,
} from "../api";
import { DonationHistoryTab } from "./components/DonationsManager/DonationHistoryTab";
import { DonationLevelDialog } from "./components/DonationsManager/DonationLevelDialog";
import { DonationLevelsTab } from "./components/DonationsManager/DonationLevelsTab";
import { DonationPageSettingsTab } from "./components/DonationsManager/DonationPageSettingsTab";
import { DonationPortalTab } from "./components/DonationsManager/DonationPortalTab";
import {
  useDonationLevels,
  useDonationPortalCopy,
  useDonationQueries,
  useDonorSuggestions,
} from "./components/DonationsManager/hooks";
import { ManualDonationModal } from "./components/DonationsManager/ManualDonationModal";
import type { DonationTab } from "./components/DonationsManager/types";

export function DonationsManager({ enabled }: { readonly enabled: boolean }) {
  const queryClient = useQueryClient();

  const { donationState, patronState, patrons, settings, settingsState, timezone } =
    useDonationQueries(enabled);

  const [refundId, setRefundId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<DonationTab>("history");
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const { confirm, confirmationDialog } = useConfirmation();

  async function saveSettings(newSettings: DonationSettings): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await updateOrganizationDonationSettings(newSettings);
      queryClient.setQueryData(queryKeys.organization.donationSettings, saved);
      setMessage("Donation settings saved.");
    } catch {
      setMessage("The donation settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const {
    deleteLevel,
    editingLevelId,
    levelAmount,
    levelBenefit,
    levelError,
    levelLabel,
    openEditLevel,
    openNewLevel,
    saveLevel,
    setLevelAmount,
    setLevelBenefit,
    setLevelLabel,
    setSettingsDialogOpen,
    settingsDialogOpen,
  } = useDonationLevels({
    confirm,
    onSaveSettings: saveSettings,
    setBusy,
    setMessage,
    settings,
  });

  const {
    portalButtonText,
    portalDescription,
    savePortalSettings,
    setPortalButtonText,
    setPortalDescription,
  } = useDonationPortalCopy({
    busy,
    onSaveSettings: saveSettings,
    settings,
  });

  const donorSuggestions = useDonorSuggestions(manualModalOpen, patrons);

  async function refund(donationId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const refunded = await refundOrganizationDonation(donationId);
      queryClient.setQueryData(
        queryKeys.organization.donations,
        (current: readonly DonationRecord[] | undefined) =>
          (current ?? []).map((d) => (d.id === refunded.id ? refunded : d)),
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
      queryClient.setQueryData(
        queryKeys.organization.donations,
        (current: readonly DonationRecord[] | undefined) => [created, ...(current ?? [])],
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.organization.patrons });
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
      queryClient.setQueryData(
        queryKeys.organization.donations,
        (current: readonly DonationRecord[] | undefined) =>
          (current ?? []).map((d) => (d.id === updated.id ? updated : d)),
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

  if (!enabled) return null;
  return (
    <section className="panel" aria-label="Donations and giving management">
      {message && !settingsDialogOpen && !manualModalOpen ? (
        <p className="notice notice--info" role="status">
          {message}
        </p>
      ) : null}

      <nav
        aria-label="Donation sections"
        className="ticketing-tabs donation-manager-tabs"
        role="tablist"
      >
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
            portalButtonText={portalButtonText}
            portalDescription={portalDescription}
            savePortalSettings={savePortalSettings}
            setPortalButtonText={setPortalButtonText}
            setPortalDescription={setPortalDescription}
            settingsState={settingsState}
          />
        )}
      </div>

      <DonationLevelDialog
        busy={busy}
        editingLevelId={editingLevelId}
        error={levelError}
        levelAmount={levelAmount}
        levelBenefit={levelBenefit}
        levelLabel={levelLabel}
        onClose={() => {
          setSettingsDialogOpen(false);
        }}
        open={settingsDialogOpen}
        saveLevel={saveLevel}
        setLevelAmount={setLevelAmount}
        setLevelBenefit={setLevelBenefit}
        setLevelLabel={setLevelLabel}
      />

      <ManualDonationModal
        busy={busy}
        onClose={() => {
          setManualModalOpen(false);
        }}
        onSave={handleSaveManualDonation}
        open={manualModalOpen}
        suggestions={donorSuggestions}
      />

      {confirmationDialog}
    </section>
  );
}
