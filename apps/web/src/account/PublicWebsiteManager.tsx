import {
  publicWebsiteSettingsRequestSchema,
  type PublicWebsiteSettings,
  type PublicWebsiteSettingsRequest,
} from "@choir/contracts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@choir/ui";
import { type ChangeEvent, useEffect, useRef, useState } from "react";

import {
  AuthApiError,
  deletePrivateOrganizationFile,
  getOrganizationPublicWebsiteSettings,
  getPublishedOrganizationProjection,
  publishOrganizationPublicWebsite,
  updateOrganizationPublicWebsiteSettings,
  uploadPrivateOrganizationFile,
} from "../auth/api";
import { useSaveRegistration } from "../persistence";
import {
  AppearanceTabContent,
  HistoryTabContent,
  HomeTabContent,
  NavigationTabContent,
} from "./components/PublicWebsiteEditorTabs";
import { FooterTabContent } from "./components/PublicWebsiteFooterEditor";
import { PublicWebsitePreview } from "./components/PublicWebsitePreview";

type LoadState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly settings: PublicWebsiteSettings; readonly status: "ready" };

type EditorTab = "appearance" | "history" | "home" | "navigation" | "footer";
type PublicationVerificationStatus =
  "confirmed" | "idle" | "publishing" | "uncertain" | "verifying";

function requestFrom(settings: PublicWebsiteSettings): PublicWebsiteSettingsRequest {
  return {
    pageLabels: settings.pageLabels ?? {},
    footerText: settings.footerText ?? "",
    footerEmbeds: settings.footerEmbeds ?? [],
    aboutUsText: settings.aboutUsText,
    bodyFont: settings.bodyFont,
    contactEmail: settings.contactEmail,
    enabledNavigation: settings.enabledNavigation,
    headerFont: settings.headerFont,
    heroFileId: settings.heroFileId,
    heroPosition: settings.heroPosition ?? { x: 50, y: 50 },
    heroHeadline: settings.heroHeadline,
    heroSubtitle: settings.heroSubtitle,
    historyText: settings.historyText,
    logoFileId: settings.logoFileId,
    showBrandingHeaderFooter: settings.showBrandingHeaderFooter,
  };
}

function customWebsiteSettingsChanged(
  draft: PublicWebsiteSettingsRequest,
  saved: PublicWebsiteSettingsRequest,
): boolean {
  return (
    heroSettingsChanged(draft, saved) ||
    JSON.stringify(draft.pageLabels) !== JSON.stringify(saved.pageLabels) ||
    draft.footerText !== saved.footerText ||
    JSON.stringify(draft.footerEmbeds) !== JSON.stringify(saved.footerEmbeds)
  );
}

function heroSettingsChanged(
  draft: PublicWebsiteSettingsRequest,
  saved: PublicWebsiteSettingsRequest,
): boolean {
  return (
    draft.heroFileId !== saved.heroFileId ||
    JSON.stringify(draft.heroPosition) !== JSON.stringify(saved.heroPosition)
  );
}

function settingsValidationError(
  draft: PublicWebsiteSettingsRequest,
  heroFile: File | null,
  logoFile: File | null,
): string | null {
  const result = publicWebsiteSettingsRequestSchema.safeParse(draft);
  if (!result.success) return result.error.issues[0]?.message ?? "Check the website settings.";
  return validateImage(heroFile) ?? validateImage(logoFile);
}

function isWebsiteDraftDirty(
  loadState: LoadState,
  draft: PublicWebsiteSettingsRequest | null,
  heroFile: File | null,
  logoFile: File | null,
): boolean {
  if (loadState.status !== "ready" || !draft) return false;
  if (heroFile !== null || logoFile !== null) return true;
  const saved = requestFrom(loadState.settings);
  return (
    customWebsiteSettingsChanged(draft, saved) ||
    draft.aboutUsText !== saved.aboutUsText ||
    draft.bodyFont !== saved.bodyFont ||
    draft.contactEmail !== saved.contactEmail ||
    draft.headerFont !== saved.headerFont ||
    draft.heroHeadline !== saved.heroHeadline ||
    draft.heroSubtitle !== saved.heroSubtitle ||
    draft.historyText !== saved.historyText ||
    draft.showBrandingHeaderFooter !== saved.showBrandingHeaderFooter ||
    draft.enabledNavigation.length !== saved.enabledNavigation.length ||
    draft.enabledNavigation.some((item) => !saved.enabledNavigation.includes(item))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof AuthApiError
    ? error.message
    : "The public website could not be updated. Please try again.";
}

function validateImage(file: File | null): string | null {
  if (!file) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return "Choose a JPEG, PNG, or WebP image.";
  }
  return file.size <= 5 * 1024 * 1024 ? null : "Public images must be 5 MB or smaller.";
}

function WebsiteReadinessChecklist({
  dirty,
  draft,
  settings,
  verificationStatus,
  verifiedVersion,
}: {
  readonly dirty: boolean;
  readonly draft: PublicWebsiteSettingsRequest;
  readonly settings: PublicWebsiteSettings;
  readonly verificationStatus: PublicationVerificationStatus;
  readonly verifiedVersion: number | null;
}) {
  let versionText: string;
  if (settings.publicationVersion === 0) {
    versionText =
      "Your public website is not published yet. Visitors see default placeholder information until you publish.";
  } else if (
    verificationStatus === "confirmed" &&
    verifiedVersion === settings.publicationVersion
  ) {
    versionText = `Live version ${String(settings.publicationVersion)}${
      settings.publishedAt
        ? ` (published ${new Date(settings.publishedAt).toLocaleDateString()})`
        : ""
    }. Version ${String(settings.publicationVersion)} is live.`;
  } else if (verificationStatus === "verifying") {
    versionText = `Publishing version ${String(settings.publicationVersion)}: Verifying public website availability…`;
  } else if (verificationStatus === "uncertain") {
    versionText = `Live version ${String(settings.publicationVersion)}${
      settings.publishedAt
        ? ` (published ${new Date(settings.publishedAt).toLocaleDateString()})`
        : ""
    } (public verification pending or unconfirmed).`;
  } else {
    versionText = `Live version ${String(settings.publicationVersion)}${
      settings.publishedAt
        ? ` (published ${new Date(settings.publishedAt).toLocaleDateString()})`
        : ""
    }.`;
  }

  const navigationSummary =
    draft.enabledNavigation.length > 0
      ? draft.enabledNavigation
          .map((m) => (m === "tickets" ? "Tickets" : m === "donations" ? "Donate" : "Auditions"))
          .join(", ")
      : "Standard (Performances & History appear when published)";

  return (
    <section aria-label="Website publication readiness" className="panel website-readiness">
      <header className="website-readiness__header">
        <h2>Website publication readiness</h2>
        <p className="field-help website-readiness__status">
          {versionText}
          {dirty ? " You have unsaved changes in your draft." : ""}
        </p>
      </header>
      <ul className="website-readiness__items">
        <li>
          <strong>About Us:</strong>{" "}
          {draft.aboutUsText.trim() ? "Draft ready" : "Empty (omitted from home page)"}
        </li>
        <li>
          <strong>Our History:</strong>{" "}
          {draft.historyText.trim()
            ? "Draft ready (History page appears in navigation)"
            : "Empty (History link stays hidden from navigation until published)"}
        </li>
        <li>
          <strong>Contact email:</strong>{" "}
          {draft.contactEmail.trim()
            ? `Configured (${draft.contactEmail.trim()})`
            : "Not configured (no contact link in footer)"}
        </li>
        <li>
          <strong>Navigation:</strong> {navigationSummary}
        </li>
      </ul>
      <p className="field-help website-readiness__guidance">
        Saving updates your administrative draft. Edits do not appear on your public website until
        you click <strong>Publish saved draft</strong>. Public navigation links (Performances and
        History) are hidden automatically whenever no published content exists for that section.
        Once your website has been published, public Performance changes update automatically when
        saved in Events.
      </p>
    </section>
  );
}

function PublicWebsiteActions({
  busy,
  dirty,
  onPublish,
  onRetryVerification,
  onSave,
  publicationVersion,
  verificationStatus,
}: {
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly onPublish: () => void;
  readonly onRetryVerification: () => void;
  readonly onSave: () => void;
  readonly publicationVersion: number;
  readonly verificationStatus: PublicationVerificationStatus;
}) {
  return (
    <div className="form-actions">
      <button className="button button--secondary" disabled={busy} onClick={onSave} type="button">
        {busy && verificationStatus === "idle" ? "Working…" : "Save draft"}
      </button>
      <button
        aria-describedby={dirty ? "publish-dirty-hint" : undefined}
        className="button button--primary"
        disabled={busy || dirty}
        onClick={onPublish}
        title={dirty ? "Save your draft before publishing" : undefined}
        type="button"
      >
        {verificationStatus === "publishing"
          ? "Publishing…"
          : verificationStatus === "verifying"
            ? "Verifying…"
            : "Publish saved draft"}
      </button>
      {verificationStatus === "uncertain" ? (
        <button
          className="button button--secondary"
          disabled={busy}
          onClick={onRetryVerification}
          type="button"
        >
          Retry verification
        </button>
      ) : null}
      {publicationVersion > 0 ? (
        <a className="button button--secondary" href="/" rel="noopener noreferrer" target="_blank">
          View live website
        </a>
      ) : null}
      {dirty ? (
        <span className="field-help" id="publish-dirty-hint">
          Save your draft before publishing.
        </span>
      ) : null}
    </div>
  );
}

interface WebsiteEditorNoticesProps {
  readonly error: string | null;
  readonly success: string | null;
  readonly verificationError: string | null;
}

function WebsiteEditorNotices({ error, success, verificationError }: WebsiteEditorNoticesProps) {
  return (
    <>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {verificationError ? (
        <div className="notice notice--warning" role="alert">
          <p>{verificationError}</p>
        </div>
      ) : null}
      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
    </>
  );
}

interface WebsiteEditorViewToggleProps {
  readonly mobileView: "edit" | "preview";
  readonly onToggle: (view: "edit" | "preview") => void;
}

function WebsiteEditorViewToggle({ mobileView, onToggle }: WebsiteEditorViewToggleProps) {
  return (
    <div
      aria-label="Editor view mode"
      className="segmented-control website-editor-view-toggle"
      role="group"
    >
      <button
        aria-pressed={mobileView === "edit"}
        className={`button button--sm ${mobileView === "edit" ? "button--primary" : "button--secondary"}`}
        onClick={() => {
          onToggle("edit");
        }}
        type="button"
      >
        Edit
      </button>
      <button
        aria-pressed={mobileView === "preview"}
        className={`button button--sm ${mobileView === "preview" ? "button--primary" : "button--secondary"}`}
        onClick={() => {
          onToggle("preview");
        }}
        type="button"
      >
        Preview
      </button>
    </div>
  );
}

export function PublicWebsiteManager({ enabled }: { readonly enabled: boolean }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [draft, setDraft] = useState<PublicWebsiteSettingsRequest | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>("home");
  const [previewPage, setPreviewPage] = useState<"home" | "history">("home");
  const [previewViewport, setPreviewViewport] = useState<"desktop" | "mobile">("desktop");
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [heroBlobUrl, setHeroBlobUrl] = useState<string | null>(null);
  const [logoBlobUrl, setLogoBlobUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] =
    useState<PublicationVerificationStatus>("idle");
  const [verifiedVersion, setVerifiedVersion] = useState<number | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  const draftRevisionRef = useRef(0);
  const aboutUsRef = useRef<HTMLTextAreaElement | null>(null);
  const historyRef = useRef<HTMLTextAreaElement | null>(null);

  const heroPreviewUrl =
    heroBlobUrl ?? (draft?.heroFileId ? `/api/organization/files/${draft.heroFileId}` : null);
  const logoPreviewUrl =
    logoBlobUrl ?? (draft?.logoFileId ? `/api/organization/files/${draft.logoFileId}` : null);

  useEffect(() => {
    return () => {
      if (heroBlobUrl) URL.revokeObjectURL(heroBlobUrl);
      if (logoBlobUrl) URL.revokeObjectURL(logoBlobUrl);
    };
  }, [heroBlobUrl, logoBlobUrl]);

  function handleHeroFileSelect(file: File | null) {
    setHeroFile(file);
    setHeroBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  function handleLogoFileSelect(file: File | null) {
    setLogoFile(file);
    setLogoBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getOrganizationPublicWebsiteSettings(controller.signal)
      .then((settings) => {
        setLoadState({ settings, status: "ready" });
        setDraft(requestFrom(settings));
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === "AbortError")) {
          setLoadState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  function change<K extends keyof PublicWebsiteSettingsRequest>(
    key: K,
    value: PublicWebsiteSettingsRequest[K],
  ) {
    draftRevisionRef.current += 1;
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setSuccess(null);
    setVerificationStatus("idle");
    setVerificationError(null);
  }

  function handleTabChange(tab: EditorTab) {
    setActiveTab(tab);
    if (tab === "home") setPreviewPage("home");
    if (tab === "history") setPreviewPage("history");
  }

  async function save() {
    if (!draft || loadState.status !== "ready") return;
    const imageError = settingsValidationError(draft, heroFile, logoFile);
    if (imageError) {
      setError(imageError);
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    const uploadedIds: string[] = [];
    const saveRevision = draftRevisionRef.current;
    const draftSnapshot = draft;
    const heroFileSnapshot = heroFile;
    const logoFileSnapshot = logoFile;
    try {
      const [heroUpload, logoUpload] = await Promise.all([
        heroFileSnapshot ? uploadPrivateOrganizationFile(heroFileSnapshot) : null,
        logoFileSnapshot ? uploadPrivateOrganizationFile(logoFileSnapshot) : null,
      ]);
      if (heroUpload) uploadedIds.push(heroUpload.id);
      if (logoUpload) uploadedIds.push(logoUpload.id);
      const next = {
        ...draftSnapshot,
        heroFileId: heroUpload?.id ?? draftSnapshot.heroFileId,
        logoFileId: logoUpload?.id ?? draftSnapshot.logoFileId,
      };
      const saved = await updateOrganizationPublicWebsiteSettings(next);
      const oldIds = [loadState.settings.heroFileId, loadState.settings.logoFileId].filter(
        (fileId): fileId is string =>
          fileId !== null && fileId !== saved.heroFileId && fileId !== saved.logoFileId,
      );
      await Promise.all(oldIds.map((fileId) => deletePrivateOrganizationFile(fileId))).catch(
        () => undefined,
      );
      setLoadState({ settings: saved, status: "ready" });
      if (draftRevisionRef.current === saveRevision) {
        setDraft(requestFrom(saved));
        handleHeroFileSelect(null);
        handleLogoFileSelect(null);
        setSuccess("Public website draft saved. Publish when it is ready for visitors.");
      } else {
        setDraft((current) =>
          current
            ? {
                ...current,
                heroFileId:
                  current.heroFileId === draftSnapshot.heroFileId
                    ? saved.heroFileId
                    : current.heroFileId,
                logoFileId:
                  current.logoFileId === draftSnapshot.logoFileId
                    ? saved.logoFileId
                    : current.logoFileId,
              }
            : current,
        );
        setSuccess("Draft saved; newer edits remain unsaved.");
      }
    } catch (failure: unknown) {
      await Promise.all(uploadedIds.map((fileId) => deletePrivateOrganizationFile(fileId))).catch(
        () => undefined,
      );
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function verifyPublication(targetVersion: number) {
    setVerificationStatus("verifying");
    setVerificationError(null);
    try {
      const projection = await getPublishedOrganizationProjection(undefined, {
        bypassCache: true,
      });
      if (projection?.version === targetVersion) {
        setVerificationStatus("confirmed");
        setVerifiedVersion(targetVersion);
        setSuccess(`Version ${String(targetVersion)} is live.`);
      } else {
        setVerificationStatus("uncertain");
        setVerificationError(
          `Publication completed, but public verification timed out or returned version ${String(projection?.version ?? "unknown")}. Visitors may see updates shortly.`,
        );
      }
    } catch {
      setVerificationStatus("uncertain");
      setVerificationError(
        "Publication completed, but public verification could not be confirmed. Check your connection or retry verification.",
      );
    }
  }

  async function publish() {
    if (dirty) {
      setError("Please save your draft edits before publishing.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    setVerificationStatus("publishing");
    setVerificationError(null);
    try {
      const result = await publishOrganizationPublicWebsite();
      setLoadState((current) =>
        current.status === "ready"
          ? {
              settings: {
                ...current.settings,
                publicationVersion: result.version,
                publishedAt: result.publishedAt,
              },
              status: "ready",
            }
          : current,
      );
      await verifyPublication(result.version);
    } catch (failure: unknown) {
      setVerificationStatus("idle");
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function retryVerification() {
    if (loadState.status !== "ready" || loadState.settings.publicationVersion === 0) return;
    setBusy(true);
    setError(null);
    try {
      await verifyPublication(loadState.settings.publicationVersion);
    } finally {
      setBusy(false);
    }
  }

  const dirty = isWebsiteDraftDirty(loadState, draft, heroFile, logoFile);

  useSaveRegistration({
    busy,
    dirty,
    discard: () => {
      if (loadState.status === "ready") {
        setDraft(requestFrom(loadState.settings));
        handleHeroFileSelect(null);
        handleLogoFileSelect(null);
        setError(null);
      }
    },
    id: "organization-public-website-settings",
    resourceKey: "organization-public-website-settings",
    save: async () => {
      await save();
      return true;
    },
  });

  if (!enabled) return null;
  if (loadState.status === "loading") {
    return <p className="notice notice--info">Loading public website settings…</p>;
  }
  if (loadState.status === "error" || !draft) {
    return (
      <p className="notice notice--error" role="alert">
        Public website settings could not be loaded.
      </p>
    );
  }

  return (
    <div className="settings-stack">
      <WebsiteReadinessChecklist
        dirty={dirty}
        draft={draft}
        settings={loadState.settings}
        verificationStatus={verificationStatus}
        verifiedVersion={verifiedVersion}
      />

      <WebsiteEditorViewToggle mobileView={mobileView} onToggle={setMobileView} />

      <div className={`website-editor-layout website-editor-layout--${mobileView}`}>
        <section aria-label="Website editor" className="panel website-editor-controls">
          <WebsiteEditorNotices
            error={error}
            success={success}
            verificationError={verificationError}
          />

          <Tabs onValueChange={handleTabChange} value={activeTab}>
            <TabsList aria-label="Public website sections" className="website-editor-tabs-list">
              <TabsTrigger value="home">Home</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="appearance">Appearance</TabsTrigger>
              <TabsTrigger value="navigation">Navigation</TabsTrigger>
              <TabsTrigger value="footer">Footer</TabsTrigger>
            </TabsList>

            <TabsContent value="home">
              <HomeTabContent
                aboutUsRef={aboutUsRef}
                busy={busy}
                draft={draft}
                heroImageUrl={heroPreviewUrl}
                onChange={change}
                onHeroFileChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const file = event.target.files?.[0] ?? null;
                  handleHeroFileSelect(file);
                  change("heroPosition", { x: 50, y: 50 });
                }}
                onRemoveHeroImage={() => {
                  handleHeroFileSelect(null);
                  change("heroFileId", null);
                }}
              />
            </TabsContent>

            <TabsContent value="history">
              <HistoryTabContent
                busy={busy}
                draft={draft}
                historyRef={historyRef}
                onChange={change}
              />
            </TabsContent>

            <TabsContent value="appearance">
              <AppearanceTabContent
                busy={busy}
                draft={draft}
                logoImageUrl={logoPreviewUrl}
                onChange={change}
                onLogoFileChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const file = event.target.files?.[0] ?? null;
                  handleLogoFileSelect(file);
                }}
                onRemoveLogo={() => {
                  handleLogoFileSelect(null);
                  change("logoFileId", null);
                }}
              />
            </TabsContent>

            <TabsContent value="footer">
              <FooterTabContent busy={busy} draft={draft} onChange={change} />
            </TabsContent>

            <TabsContent value="navigation">
              <NavigationTabContent busy={busy} draft={draft} onChange={change} />
            </TabsContent>
          </Tabs>

          <PublicWebsiteActions
            busy={busy}
            dirty={dirty}
            onPublish={() => {
              void publish();
            }}
            onRetryVerification={() => {
              void retryVerification();
            }}
            onSave={() => {
              void save();
            }}
            publicationVersion={loadState.settings.publicationVersion}
            verificationStatus={verificationStatus}
          />
        </section>

        <PublicWebsitePreview
          draft={draft}
          heroImageUrl={heroPreviewUrl}
          logoImageUrl={logoPreviewUrl}
          onPageChange={setPreviewPage}
          onViewportChange={setPreviewViewport}
          organizationName={loadState.settings.organizationName}
          page={previewPage}
          viewport={previewViewport}
        />
      </div>
    </div>
  );
}
