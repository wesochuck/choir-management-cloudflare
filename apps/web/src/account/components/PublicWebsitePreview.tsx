import { publicPageNavigationLabel } from "../../public/publicPageLabels";
import { PublicWebsiteHero } from "../../public/PublicWebsiteHero";
import { PublicWebsiteFooter } from "../../public/PublicWebsiteFooter";
import type { PublicWebsiteSettingsRequest } from "@choir/contracts";
import { useEffect, useRef, useState, type CSSProperties } from "react";

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
  readonly onViewportChange: (viewport: "desktop" | "mobile") => void;
  readonly viewport: "desktop" | "mobile";
}

function PreviewToolbar({ onViewportChange, viewport }: PreviewToolbarProps) {
  return (
    <div className="website-preview-toolbar">
      <span className="badge badge--neutral">Draft — not public</span>
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
            {publicPageNavigationLabel(draft, "history")}
          </button>
        ) : null}
        {draft.enabledNavigation.includes("tickets") ? (
          <span className="preview-nav-link">{publicPageNavigationLabel(draft, "tickets")}</span>
        ) : null}
        {draft.enabledNavigation.includes("donations") ? (
          <span className="preview-nav-link">{publicPageNavigationLabel(draft, "donations")}</span>
        ) : null}
        {draft.enabledNavigation.includes("auditions") ? (
          <span className="preview-nav-link">{publicPageNavigationLabel(draft, "auditions")}</span>
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
        position={draft.heroPosition}
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
  readonly heading: string | undefined;
}

function PreviewHistory({ historyText, heading }: PreviewHistoryProps) {
  return (
    <section className="public-section public-section--narrow">
      <h1>{heading ?? "Our History"}</h1>
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
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const viewportWidth = viewport === "desktop" ? 1280 : 390;
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setScale(Math.min(1, width / viewportWidth));
    });
    observer.observe(frame);
    return () => {
      observer.disconnect();
    };
  }, [viewportWidth]);

  return (
    <section aria-label="Public website draft preview" className="panel website-preview-panel">
      <PreviewToolbar onViewportChange={onViewportChange} viewport={viewport} />

      <p className="field-help">
        {viewport === "desktop" ? "Desktop" : "Mobile"} preview · {viewportWidth}px wide, scaled to
        fit. The image crop changes with screen width.
      </p>
      <div ref={frameRef} className={`website-preview-frame website-preview-frame--${viewport}`}>
        <div
          className="public-site website-preview-content"
          style={
            {
              width: viewportWidth,
              zoom: scale,
              "--public-hero-subtitle-size": `clamp(1.1rem, ${String(viewportWidth * 0.02)}px, 1.45rem)`,
              "--public-hero-title-size": `clamp(2.8rem, ${String(viewportWidth * 0.08)}px, 6rem)`,
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
              <PreviewHistory
                historyText={draft.historyText}
                heading={draft.pageLabels?.history?.heading}
              />
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
