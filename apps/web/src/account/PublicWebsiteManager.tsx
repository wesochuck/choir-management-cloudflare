import type { PublicWebsiteSettings, PublicWebsiteSettingsRequest } from "@choir/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AuthApiError,
  deletePrivateOrganizationFile,
  getOrganizationPublicWebsiteSettings,
  publishOrganizationPublicWebsite,
  updateOrganizationPublicWebsiteSettings,
  uploadPrivateOrganizationFile,
} from "../auth/api";
import { publicWebsiteFontStacks, type PublicWebsiteFont } from "../public/publicWebsiteFonts";
import { useFloatingSaveAction } from "./useFloatingSaveAction";

type LoadState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly settings: PublicWebsiteSettings; readonly status: "ready" };

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

const websiteFonts = [
  "system",
  "serif",
  "modern-serif",
  "friendly-sans",
  "formal-sans",
  "casual-handwritten",
  "formal-script",
] as const satisfies readonly PublicWebsiteFont[];

function fontLabel(font: PublicWebsiteFont): string {
  return font
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

const fontPreviewText = "Aa Bb Cc — The quick brown fox jumps over the lazy dog.";

function FontPreview({ font }: { readonly font: PublicWebsiteFont }) {
  return (
    <div className="website-font-preview" aria-label={`${fontLabel(font)} font preview`}>
      <span className="website-font-preview__label">Sample in {fontLabel(font)}</span>
      <p
        aria-live="polite"
        className="website-font-preview__sample"
        style={{ fontFamily: publicWebsiteFontStacks[font] }}
      >
        {fontPreviewText}
      </p>
    </div>
  );
}

function requestFrom(settings: PublicWebsiteSettings): PublicWebsiteSettingsRequest {
  return {
    aboutUsText: settings.aboutUsText,
    bodyFont: settings.bodyFont,
    contactEmail: settings.contactEmail,
    enabledNavigation: settings.enabledNavigation,
    headerFont: settings.headerFont,
    heroFileId: settings.heroFileId,
    heroHeadline: settings.heroHeadline,
    heroSubtitle: settings.heroSubtitle,
    historyText: settings.historyText,
    logoFileId: settings.logoFileId,
    showBrandingHeaderFooter: settings.showBrandingHeaderFooter,
  };
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

export function PublicWebsiteManager({ enabled }: { readonly enabled: boolean }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [draft, setDraft] = useState<PublicWebsiteSettingsRequest | null>(null);
  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const draftRevisionRef = useRef(0);

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
  }

  async function save() {
    if (!draft || loadState.status !== "ready") return;
    const imageError = validateImage(heroFile) ?? validateImage(logoFile);
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
        setHeroFile(null);
        setLogoFile(null);
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

  async function publish() {
    setBusy(true);
    setError(null);
    setSuccess(null);
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
    } catch (failure: unknown) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const dirty = useMemo(
    () => isWebsiteDraftDirty(loadState, draft, heroFile, logoFile),
    [draft, heroFile, loadState, logoFile],
  );

  useFloatingSaveAction({
    busy,
    dirty,
    id: "organization-public-website-settings",
    onDiscard: () => {
      if (loadState.status === "ready") {
        setDraft(requestFrom(loadState.settings));
        setHeroFile(null);
        setLogoFile(null);
        setError(null);
      }
    },
    onSave: save,
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
    <section className="panel public-website-settings" aria-label="Public website settings">
      <p className="section-description">
        Edit a private draft, then publish an immutable edge-cached version for Organization
        visitors.
      </p>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      <div className="form-stack">
        <div className="field">
          <label htmlFor="website-hero-headline">Hero headline</label>
          <input
            id="website-hero-headline"
            maxLength={300}
            onChange={(event) => {
              change("heroHeadline", event.target.value);
            }}
            value={draft.heroHeadline}
          />
        </div>
        <div className="field">
          <label htmlFor="website-hero-subtitle">Hero subtitle</label>
          <textarea
            id="website-hero-subtitle"
            maxLength={1_000}
            onChange={(event) => {
              change("heroSubtitle", event.target.value);
            }}
            rows={2}
            value={draft.heroSubtitle}
          />
        </div>
        <div className="field">
          <label htmlFor="website-about">About Us (Markdown)</label>
          <textarea
            id="website-about"
            maxLength={100_000}
            onChange={(event) => {
              change("aboutUsText", event.target.value);
            }}
            rows={8}
            value={draft.aboutUsText}
          />
        </div>
        <div className="field">
          <label htmlFor="website-history">Our History (Markdown)</label>
          <textarea
            id="website-history"
            maxLength={100_000}
            onChange={(event) => {
              change("historyText", event.target.value);
            }}
            rows={8}
            value={draft.historyText}
          />
        </div>
        <div className="field">
          <label htmlFor="website-contact-email">Contact email</label>
          <input
            id="website-contact-email"
            maxLength={320}
            onChange={(event) => {
              change("contactEmail", event.target.value);
            }}
            type="email"
            value={draft.contactEmail}
          />
        </div>
        <div className="settings-grid">
          <div className="field">
            <label htmlFor="website-header-font">Heading font</label>
            <select
              id="website-header-font"
              onChange={(event) => {
                const font = websiteFonts.find((candidate) => candidate === event.target.value);
                if (font) change("headerFont", font);
              }}
              style={{ fontFamily: publicWebsiteFontStacks[draft.headerFont] }}
              value={draft.headerFont}
            >
              {websiteFonts.map((font) => (
                <option
                  key={font}
                  style={{ fontFamily: publicWebsiteFontStacks[font] }}
                  value={font}
                >
                  {fontLabel(font)}
                </option>
              ))}
            </select>
            <FontPreview font={draft.headerFont} />
          </div>
          <div className="field">
            <label htmlFor="website-body-font">Body font</label>
            <select
              id="website-body-font"
              onChange={(event) => {
                const font = websiteFonts.find((candidate) => candidate === event.target.value);
                if (font) change("bodyFont", font);
              }}
              style={{ fontFamily: publicWebsiteFontStacks[draft.bodyFont] }}
              value={draft.bodyFont}
            >
              {websiteFonts.map((font) => (
                <option
                  key={font}
                  style={{ fontFamily: publicWebsiteFontStacks[font] }}
                  value={font}
                >
                  {fontLabel(font)}
                </option>
              ))}
            </select>
            <FontPreview font={draft.bodyFont} />
          </div>
          <div className="field">
            <label htmlFor="website-logo">Organization logo</label>
            <input
              accept="image/jpeg,image/png,image/webp"
              id="website-logo"
              onChange={(event) => {
                draftRevisionRef.current += 1;
                setLogoFile(event.target.files?.item(0) ?? null);
              }}
              type="file"
            />
            {draft.logoFileId ? (
              <button
                className="text-button"
                onClick={() => {
                  change("logoFileId", null);
                  setLogoFile(null);
                }}
                type="button"
              >
                Remove current logo
              </button>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="website-hero-image">Hero image</label>
            <input
              accept="image/jpeg,image/png,image/webp"
              id="website-hero-image"
              onChange={(event) => {
                draftRevisionRef.current += 1;
                setHeroFile(event.target.files?.item(0) ?? null);
              }}
              type="file"
            />
            {draft.heroFileId ? (
              <button
                className="text-button"
                onClick={() => {
                  change("heroFileId", null);
                  setHeroFile(null);
                }}
                type="button"
              >
                Remove current hero image
              </button>
            ) : null}
          </div>
        </div>
        <fieldset>
          <legend>Public navigation</legend>
          {(["tickets", "donations", "auditions"] as const).map((item) => (
            <label key={item}>
              <input
                checked={draft.enabledNavigation.includes(item)}
                onChange={(event) => {
                  change(
                    "enabledNavigation",
                    event.target.checked
                      ? [...new Set([...draft.enabledNavigation, item])]
                      : draft.enabledNavigation.filter((candidate) => candidate !== item),
                  );
                }}
                type="checkbox"
              />
              {item === "tickets"
                ? "Tickets"
                : item === "donations"
                  ? "Donate"
                  : "Auditions & Inquiries"}
            </label>
          ))}
          <p className="field-help">Enable links only after the matching public module is ready.</p>
        </fieldset>
        <label>
          <input
            checked={draft.showBrandingHeaderFooter}
            onChange={(event) => {
              change("showBrandingHeaderFooter", event.target.checked);
            }}
            type="checkbox"
          />
          Use this header and footer on public transaction pages
        </label>
        <div className="form-actions">
          <button className="button button--secondary" disabled={busy} onClick={() => void save()}>
            {busy ? "Working…" : "Save draft"}
          </button>
          <button className="button button--primary" disabled={busy} onClick={() => void publish()}>
            Publish saved draft
          </button>
          {loadState.settings.publicationVersion > 0 ? (
            <a className="button button--secondary" href="/" target="_blank">
              View live website
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
