import type { DonationLevel, DonationSettings, PatronRecord } from "@choir/contracts";
import { buildDonorSuggestions, type DonorSuggestion } from "@choir/domain";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type SyntheticEvent } from "react";

import {
  getOrganizationCalendarSettings,
  getOrganizationDonationSettings,
  listOrganizationDirectory,
  listOrganizationDonations,
  listOrganizationPatrons,
  listOrganizationTicketOrders,
  queryKeys,
} from "../../../api";
import { usePersistedDraft } from "../../../persistence";
import type { DonationSettingsState, DonationState, PatronState } from "./types";

const DEFAULT_DONATION_THANK_YOU_MESSAGE =
  "Your support helps us continue our programs and share our music with the community.";

export function useDonationQueries(enabled: boolean) {
  const {
    data: donations = [],
    isLoading: donationsLoading,
    isError: donationsError,
  } = useQuery({
    enabled,
    queryFn: ({ signal }) => listOrganizationDonations(signal),
    queryKey: queryKeys.organization.donations,
  });

  const {
    data: patrons = [],
    isLoading: patronsLoading,
    isError: patronsError,
  } = useQuery({
    enabled,
    queryFn: ({ signal }) => listOrganizationPatrons(signal),
    queryKey: queryKeys.organization.patrons,
  });

  const {
    data: settings,
    isLoading: settingsLoading,
    isError: settingsError,
  } = useQuery({
    enabled,
    queryFn: ({ signal }) => getOrganizationDonationSettings(signal),
    queryKey: queryKeys.organization.donationSettings,
  });

  const { data: calendarSettings } = useQuery({
    enabled,
    queryFn: ({ signal }) =>
      getOrganizationCalendarSettings(signal).catch(() => ({ timezone: "UTC" })),
    queryKey: queryKeys.organization.calendarSettings,
  });

  const timezone = calendarSettings?.timezone ?? "UTC";

  const donationState: DonationState = useMemo(
    () =>
      donationsError
        ? { status: "error" }
        : donationsLoading
          ? { status: "loading" }
          : { donations, status: "ready" },
    [donations, donationsError, donationsLoading],
  );

  const patronState: PatronState = useMemo(
    () =>
      patronsError
        ? { status: "error" }
        : patronsLoading
          ? { status: "loading" }
          : { patrons, status: "ready" },
    [patrons, patronsError, patronsLoading],
  );

  const settingsState: DonationSettingsState = useMemo(
    () =>
      settingsError
        ? { status: "error" }
        : settingsLoading || !settings
          ? { status: "loading" }
          : { settings, status: "ready" },
    [settings, settingsError, settingsLoading],
  );

  return {
    donationState,
    patronState,
    patrons,
    settings,
    settingsState,
    timezone,
  };
}

export function useDonorSuggestions(
  manualModalOpen: boolean,
  patrons: readonly PatronRecord[],
): readonly DonorSuggestion[] {
  const [suggestions, setSuggestions] = useState<readonly DonorSuggestion[]>([]);

  useEffect(() => {
    if (!manualModalOpen) return;
    let cancelled = false;
    async function gather(): Promise<void> {
      const [ordersResult, directoryResult] = await Promise.allSettled([
        listOrganizationTicketOrders(),
        listOrganizationDirectory(),
      ]);
      if (cancelled) return;
      const patronList = patrons.map((patron) => ({
        email: patron.email,
        name: patron.name,
        totalDonatedCents: patron.totalDonatedCents,
      }));
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
      setSuggestions(buildDonorSuggestions(patronList, buyers, members));
    }
    void gather();
    return () => {
      cancelled = true;
    };
  }, [manualModalOpen, patrons]);

  return suggestions;
}

export function useDonationLevels({
  confirm,
  onSaveSettings,
  setBusy,
  setMessage,
  settings,
}: {
  readonly confirm: (options: {
    readonly confirmLabel: string;
    readonly description: string;
    readonly destructive?: boolean;
    readonly title: string;
  }) => Promise<boolean>;
  readonly onSaveSettings: (settings: DonationSettings) => Promise<void>;
  readonly setBusy: (busy: boolean) => void;
  readonly setMessage: (msg: string | null) => void;
  readonly settings: DonationSettings | undefined;
}) {
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [editingLevelId, setEditingLevelId] = useState<string | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);
  const [levelLabel, setLevelLabel] = useState("");
  const [levelAmount, setLevelAmount] = useState("");
  const [levelBenefit, setLevelBenefit] = useState("");

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

  async function saveLevel(formEvent: SyntheticEvent<HTMLFormElement>): Promise<void> {
    formEvent.preventDefault();
    if (!settings) return;
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
      ? settings.levels.map((candidate) => (candidate.id === editingLevelId ? level : candidate))
      : [...settings.levels, level];
    setBusy(true);
    setMessage(null);
    try {
      await onSaveSettings({ ...settings, levels });
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
    if (!settings) return;
    const ok = await confirm({
      confirmLabel: "Delete level",
      description: "This donor level will be permanently removed from the public donation page.",
      destructive: true,
      title: "Delete donation level?",
    });
    if (!ok) return;
    await onSaveSettings({
      ...settings,
      levels: settings.levels.filter((level) => level.id !== levelId),
    });
  }

  return {
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
  };
}

interface DonationPortalCopyDraft {
  buttonText: string;
  description: string;
  thankYouMessage: string;
}

export function useDonationPortalCopy({
  onSaveSettings,
  settings,
}: {
  readonly busy: boolean;
  readonly onSaveSettings: (settings: DonationSettings) => Promise<void>;
  readonly settings: DonationSettings | undefined;
}) {
  const initialValue = useMemo<DonationPortalCopyDraft | null>(() => {
    if (!settings) return null;
    return {
      buttonText: settings.buttonText,
      description: settings.description,
      thankYouMessage: settings.thankYouMessage ?? DEFAULT_DONATION_THANK_YOU_MESSAGE,
    };
  }, [settings]);

  const {
    draft,
    save: saveDraft,
    updateField,
  } = usePersistedDraft<DonationPortalCopyDraft>({
    initialValue,
    normalize: (val) => ({
      buttonText: val.buttonText.trim(),
      description: val.description.trim(),
      thankYouMessage: val.thankYouMessage.trim(),
    }),
    resourceKey: "organization-donation-portal-copy",
    save: async (currentDraft) => {
      if (!settings || !currentDraft.buttonText.trim()) {
        throw new Error("Button text is required.");
      }
      const updated: DonationSettings = {
        ...settings,
        buttonText: currentDraft.buttonText.trim(),
        description: currentDraft.description.trim(),
        thankYouMessage: currentDraft.thankYouMessage.trim(),
      };
      await onSaveSettings(updated);
      return {
        buttonText: updated.buttonText,
        description: updated.description,
        thankYouMessage: currentDraft.thankYouMessage.trim(),
      };
    },
  });

  const portalButtonText = draft?.buttonText ?? settings?.buttonText ?? "";
  const portalDescription = draft?.description ?? settings?.description ?? "";
  const portalThankYouMessage =
    draft?.thankYouMessage ?? settings?.thankYouMessage ?? DEFAULT_DONATION_THANK_YOU_MESSAGE;

  async function savePortalSettings(formEvent: SyntheticEvent<HTMLFormElement>): Promise<void> {
    formEvent.preventDefault();
    await saveDraft();
  }

  return {
    portalButtonText,
    portalDescription,
    portalThankYouMessage,
    savePortalSettings,
    setPortalButtonText: (text: string) => {
      updateField("buttonText", text);
    },
    setPortalDescription: (desc: string) => {
      updateField("description", desc);
    },
    setPortalThankYouMessage: (message: string) => {
      updateField("thankYouMessage", message);
    },
  };
}
