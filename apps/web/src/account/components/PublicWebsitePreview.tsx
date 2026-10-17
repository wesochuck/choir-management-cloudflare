import { PublicWebsiteHero } from "../../public/PublicWebsiteHero";
import { PublicWebsiteFooter } from "../../public/PublicWebsiteFooter";
import type { PublicWebsiteSettingsRequest } from "@choir/contracts";
import type { CSSProperties } from "react";

import { PublicCopy } from "../../public/PublicCopy";
import { publicWebsiteFontStacks } from "../../public/publicWebsiteFonts";

export interface PublicWebsitePreviewProps {
  readonly draft: PublicWebsiteSettingsRequest;
  readonly heroImageUrl: string | null;
  readonly logoImageUrl: string | null;
  readonly onPageChange: (page: "home" | "history") => void;
  readonly onViewportChange: (viewport: "desktop" | "mobile") => void;
  readonly organizationName: string;
  readonly page: "home" | "history";
  readonly viewport: "desktop" | "mobile";
}

interface PreviewToolbarProps {
  readonly onPageChange: (page: "home" | "history") => void;
  readonly onViewportChange: (viewport: "desktop" | "mobile") => void;
  readonly page: "home" | "history";
  readonly viewport: "desktop" | "mobile";
}

function PreviewToolbar({ onPageChange, onViewportChange, page, viewport }: PreviewToolbarProps) {
  return (
    <div className="website-preview-toolbar">
      <span className="badge badge--neutral">Draft — not public</span>
      <div aria-label="Preview page" className="segmented-control" role="group">
        <button
          aria-pressed={page === "home"}
          className={`button button--sm ${page === "home" ? "button--primary" : "button--secondary"}`}
          onClick={() => {
            onPageChange("home");
          }}
          type="button"
        >
          Home
        </button>
        <button
          aria-pressed={page === "history"}
          className={`button button--sm ${page === "history" ? "button--primary" : "button--secondary"}`}
          onClick={() => {
            onPageChange("history");
          }}
          type="button"
        >
          History
        </button>
      </div>
      <div aria-label="Preview device" className="segmented-control" role="group">
        <button
          aria-pressed={viewport === "desktop"}
          className={`button button--sm ${viewport === "desktop" ? "button--primary" : "button--secondary"}`}
          onClick={() => {
            onViewportChange("desktop");
          }}
          type="button"
        >
          Desktop
        </button>
        <button
          aria-pressed={viewport === "mobile"}
          className={`button button--sm ${viewport === "mobile" ? "button--primary" : "button--secondary"}`}
          onClick={() => {
            onViewportChange("mobile");
          }}
          type="button"
        >
          Mobile
        </button>
      </div>
    </div>
  );
}

interface PreviewHeaderProps {
  readonly draft: PublicWebsiteSettingsRequest;
  readonly logoImageUrl: string | null;
  readonly onPageChange: (page: "home" | "history") => void;
  readonly organizationName: string;
  readonly page: "home" | "history";
}

function PreviewHeader({
  draft,
  logoImageUrl,
  onPageChange,
  organizationName,
  page,
}: PreviewHeaderProps) {
  return (
    <header className="public-site-header">
      <div className="public-brand">
        {logoImageUrl ? <img alt="" className="public-brand__logo" src={logoImageUrl} /> : null}
        <span className="public-brand__name">{organizationName}</span>
      </div>
      <nav aria-label="Preview navigation">
        {draft.historyText.trim() ? (
          <button
            aria-current={page === "history" ? "page" : undefined}
            className={`preview-nav-link ${page === "history" ? "is-active" : ""}`}
            onClick={() => {
              onPageChange("history");
            }}
            type="button"
          >
            History
          </button>
        ) : null}
        {draft.enabledNavigation.includes("tickets") ? (
          <span className="preview-nav-link">Tickets</span>
        ) : null}
        {draft.enabledNavigation.includes("donations") ? (
          <span className="preview-nav-link">Donate</span>
        ) : null}
        {draft.enabledNavigation.includes("auditions") ? (
          <span className="preview-nav-link">Auditions</span>
        ) : null}
      </nav>
    </header>
  );
}

interface PreviewHomeProps {
  readonly organizationName: string;
  readonly draft: PublicWebsiteSettingsRequest;
  readonly heroImageUrl: string | null;
}

function PreviewHome({ draft, heroImageUrl, organizationName }: PreviewHomeProps) {
  return (
    <>
      <PublicWebsiteHero
        headline={draft.heroHeadline}
        subtitle={draft.heroSubtitle}
        imageUrl={heroImageUrl}
        organizationName={organizationName}
      />
      {draft.aboutUsText.trim() ? (
        <section className="public-section public-section--narrow" id="about-us">
          <h2>About Us</h2>
          <PublicCopy text={draft.aboutUsText} />
        </section>
      ) : (
        <section className="public-section public-section--narrow">
          <div className="empty-state">
            <p>Welcome! Our public schedule and choir story are currently being updated.</p>
          </div>
        </section>
      )}
    </>
  );
}

interface PreviewHistoryProps {
  readonly historyText: string;
}

function PreviewHistory({ historyText }: PreviewHistoryProps) {
  return (
    <section className="public-section public-section--narrow">
      <h1>Our History</h1>
      {historyText.trim() ? (
        <PublicCopy text={historyText} />
      ) : (
        <div aria-label="Unpublished history notice" className="empty-state">
          <p>Our history has not been published yet.</p>
        </div>
      )}
    </section>
  );
}

export function PublicWebsitePreview({
  draft,
  heroImageUrl,
  logoImageUrl,
  onPageChange,
  onViewportChange,
  organizationName,
  page,
  viewport,
}: PublicWebsitePreviewProps) {
  const currentYear = String(new Date().getUTCFullYear());

  return (
    <section aria-label="Public website draft preview" className="panel website-preview-panel">
      <PreviewToolbar
        onPageChange={onPageChange}
        onViewportChange={onViewportChange}
        page={page}
        viewport={viewport}
      />

      <div className={`website-preview-frame website-preview-frame--${viewport}`}>
        <div
          className="public-site website-preview-content"
          style={
            {
              "--public-body-font": publicWebsiteFontStacks[draft.bodyFont],
              "--public-heading-font": publicWebsiteFontStacks[draft.headerFont],
            } as CSSProperties
          }
        >
          <PreviewHeader
            draft={draft}
            logoImageUrl={logoImageUrl}
            onPageChange={onPageChange}
            organizationName={organizationName}
            page={page}
          />

          <main>
            {page === "home" ? (
              <PreviewHome
                draft={draft}
                heroImageUrl={heroImageUrl}
                organizationName={organizationName}
              />
            ) : (
              <PreviewHistory historyText={draft.historyText} />
            )}
          </main>

          <PublicWebsiteFooter
            settings={draft}
            year={currentYear}
            organizationName={organizationName}
          />
        </div>
      </div>
    </section>
  );
}
