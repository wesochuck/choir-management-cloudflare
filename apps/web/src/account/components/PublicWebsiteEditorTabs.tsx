import type { PublicWebsiteSettingsRequest } from "@choir/contracts";
import { type ChangeEvent, type RefObject } from "react";

import {
  fontLabel,
  isPublicWebsiteFont,
  publicWebsiteFontStacks,
  websiteFonts,
  type PublicWebsiteFont,
} from "../../public/publicWebsiteFonts";
import { HeroImagePositionEditor } from "./HeroImagePositionEditor";
import { PublicWebsitePageLabelsEditor } from "./PublicWebsitePageLabelsEditor";
import { MarkdownToolbar } from "./MarkdownToolbar";

const fontPreviewText = "Aa Bb Cc — The quick brown fox jumps over the lazy dog.";

export function FontPreview({ font }: { readonly font: PublicWebsiteFont }) {
  return (
    <div aria-label={`${fontLabel(font)} font preview`} className="website-font-preview">
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

interface TabContentProps {
  readonly onManageDocuments?: (() => Promise<boolean>) | undefined;
  readonly busy: boolean;
  readonly draft: PublicWebsiteSettingsRequest;
  readonly onChange: <K extends keyof PublicWebsiteSettingsRequest>(
    key: K,
    value: PublicWebsiteSettingsRequest[K],
  ) => void;
}

export function HomeTabContent({
  aboutUsRef,
  onManageDocuments,
  busy,
  draft,
  heroImageUrl,
  onChange,
  onHeroFileChange,
  onRemoveHeroImage,
}: TabContentProps & {
  readonly aboutUsRef: RefObject<HTMLTextAreaElement | null>;
  readonly heroImageUrl: string | null;
  readonly onHeroFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onRemoveHeroImage: () => void;
}) {
  return (
    <div className="form-stack">
      <div className="field">
        <label htmlFor="website-hero-headline">Hero headline</label>
        <input
          disabled={busy}
          id="website-hero-headline"
          maxLength={300}
          onChange={(event) => {
            onChange("heroHeadline", event.target.value);
          }}
          value={draft.heroHeadline}
        />
        <p className="field-help">
          Leave the headline and subtitle blank to show the image without a text overlay.
        </p>
      </div>

      <div className="field">
        <label htmlFor="website-hero-subtitle">Hero subtitle</label>
        <textarea
          disabled={busy}
          id="website-hero-subtitle"
          maxLength={1_000}
          onChange={(event) => {
            onChange("heroSubtitle", event.target.value);
          }}
          rows={2}
          value={draft.heroSubtitle}
        />
      </div>

      <div className="field">
        <label htmlFor="website-hero-image">Hero background image</label>
        {heroImageUrl ? (
          <div className="image-field-preview">
            <img alt="Hero preview" className="image-field-preview__thumbnail" src={heroImageUrl} />
            <button
              className="button button--secondary button--sm"
              disabled={busy}
              onClick={onRemoveHeroImage}
              type="button"
            >
              Remove hero image
            </button>
          </div>
        ) : null}
        <input
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          id="website-hero-image"
          onChange={onHeroFileChange}
          type="file"
        />
        <p className="field-help">JPEG, PNG, or WebP; maximum 5 MB.</p>
      </div>

      {heroImageUrl ? (
        <details>
          <summary>Adjust image</summary>
          <HeroImagePositionEditor
            imageUrl={heroImageUrl}
            position={draft.heroPosition ?? { x: 50, y: 50 }}
            disabled={busy}
            onChange={(position) => {
              onChange("heroPosition", position);
            }}
          />
        </details>
      ) : null}
      <div className="field">
        <label htmlFor="website-about">Content (Markdown)</label>
        <MarkdownToolbar
          allowImages
          disabled={busy}
          onManageDocuments={onManageDocuments}
          onChange={(next) => {
            onChange("aboutUsText", next);
          }}
          textareaRef={aboutUsRef}
          value={draft.aboutUsText}
        />
        <textarea
          disabled={busy}
          id="website-about"
          maxLength={100_000}
          onChange={(event) => {
            onChange("aboutUsText", event.target.value);
          }}
          ref={aboutUsRef}
          rows={8}
          value={draft.aboutUsText}
        />
      </div>
    </div>
  );
}

export function AppearanceTabContent({
  busy,
  draft,
  logoImageUrl,
  onChange,
  onLogoFileChange,
  onRemoveLogo,
}: TabContentProps & {
  readonly logoImageUrl: string | null;
  readonly onLogoFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onRemoveLogo: () => void;
}) {
  return (
    <div className="form-stack">
      <div className="field">
        <label htmlFor="website-logo-image">Organization logo</label>
        {logoImageUrl ? (
          <div className="image-field-preview">
            <img alt="Logo preview" className="image-field-preview__thumbnail" src={logoImageUrl} />
            <button
              className="button button--secondary button--sm"
              disabled={busy}
              onClick={onRemoveLogo}
              type="button"
            >
              Remove logo
            </button>
          </div>
        ) : null}
        <input
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          id="website-logo-image"
          onChange={onLogoFileChange}
          type="file"
        />
        <p className="field-help">JPEG, PNG, or WebP; maximum 5 MB.</p>
      </div>

      <div className="field">
        <label htmlFor="website-header-font">Heading font</label>
        <select
          disabled={busy}
          id="website-header-font"
          onChange={(event) => {
            if (isPublicWebsiteFont(event.target.value)) {
              onChange("headerFont", event.target.value);
            }
          }}
          value={draft.headerFont}
        >
          {websiteFonts.map((font) => (
            <option key={font} value={font}>
              {fontLabel(font)}
            </option>
          ))}
        </select>
        <FontPreview font={draft.headerFont} />
      </div>

      <div className="field">
        <label htmlFor="website-body-font">Body font</label>
        <select
          disabled={busy}
          id="website-body-font"
          onChange={(event) => {
            if (isPublicWebsiteFont(event.target.value)) {
              onChange("bodyFont", event.target.value);
            }
          }}
          value={draft.bodyFont}
        >
          {websiteFonts.map((font) => (
            <option key={font} value={font}>
              {fontLabel(font)}
            </option>
          ))}
        </select>
        <FontPreview font={draft.bodyFont} />
      </div>
    </div>
  );
}

export function NavigationTabContent({ busy, draft, onChange }: TabContentProps) {
  function toggleModule(moduleName: "tickets" | "donations" | "auditions", checked: boolean) {
    const next = checked
      ? [...draft.enabledNavigation.filter((item) => item !== moduleName), moduleName]
      : draft.enabledNavigation.filter((item) => item !== moduleName);
    onChange("enabledNavigation", next);
  }

  return (
    <div className="form-stack">
      <div className="field">
        <label htmlFor="website-contact-email">Public contact email</label>
        <input
          disabled={busy}
          id="website-contact-email"
          maxLength={254}
          onChange={(event) => {
            onChange("contactEmail", event.target.value);
          }}
          type="email"
          value={draft.contactEmail}
        />
        <p className="field-help">Displayed in the public website footer when provided.</p>
      </div>

      <PublicWebsitePageLabelsEditor
        draft={draft}
        busy={busy}
        onChange={(labels) => {
          onChange("pageLabels", labels);
        }}
      />

      <label className="choice-field">
        <input
          checked={draft.showBrandingHeaderFooter}
          disabled={busy}
          onChange={(event) => {
            onChange("showBrandingHeaderFooter", event.target.checked);
          }}
          type="checkbox"
        />
        <span className="choice-field__content">
          Show website navigation on ticket, donation, and audition pages
        </span>
      </label>
      <p className="field-help">
        Shows the same menu links visitors see on your main website. Save and publish to apply.
      </p>

      <fieldset className="field">
        <legend>Public modules navigation links</legend>
        {(["tickets", "donations", "auditions"] as const).map((item) => (
          <label className="choice-field" key={item}>
            <input
              checked={draft.enabledNavigation.includes(item)}
              disabled={busy}
              onChange={(event) => {
                toggleModule(item, event.target.checked);
              }}
              type="checkbox"
            />
            <span className="choice-field__content">
              {item === "tickets"
                ? "Tickets"
                : item === "donations"
                  ? "Donate"
                  : "Auditions & Inquiries"}
            </span>
          </label>
        ))}
        <p className="field-help">
          Enable links only after the matching public module is ready. Standard public links
          (Performances) appear automatically when content exists. Custom page links are configured
          in Pages.
        </p>
      </fieldset>
    </div>
  );
}
