import { AppLink } from "../AuthenticatedShell/navigation";
import { OrganizationMfaPrompt } from "../../OrganizationMfaPrompt";
import { FormationEditor } from "./shared";
import { SeatingChartPanel } from "./SeatingChartPanel";
import { SeatingHeader } from "./SeatingHeader";
import { SeatingTabs } from "./SeatingTabs";
import type { SeatingManagerModel } from "./hooks";

export function SeatingManagerView({
  model,
  navigate,
}: {
  readonly model: SeatingManagerModel;
  readonly navigate?: ((href: string) => void) | undefined;
}) {
  const {
    chart,
    eligibleProfiles,
    enabled,
    enterFocus,
    error,
    eventId,
    exitFocus,
    fallbackFocus,
    focusMode,
    formationTab,
    isNarrow,
    loading,
    mobileEditing,
    resources,
    setFormationTab,
    setMobileEditing,
    setResources,
    workspaceRef,
  } = model;

  if (!enabled) {
    return <OrganizationMfaPrompt message="Verify Organization MFA to manage seating." />;
  }
  if (loading && !resources) {
    return <p role="status">Loading seating resources…</p>;
  }
  if (error && !resources) {
    return (
      <p className="notice notice--error" role="alert">
        {error}
      </p>
    );
  }
  if (!resources) return null;
  if (resources.events.length === 0) {
    return (
      <div className="empty-state">
        <h2>Create an event first</h2>
        <p>Seating charts belong to active Performance events.</p>
        <div className="button-row" style={{ marginTop: "1rem" }}>
          <AppLink
            className="button button--primary"
            href="/admin/events?action=create&type=Performance&returnTo=/admin/seating"
            onNavigate={
              navigate ??
              ((href) => {
                window.location.assign(href);
              })
            }
          >
            Create an event
          </AppLink>
        </div>
      </div>
    );
  }

  const activeEvent = resources.events.find(({ id }) => id === eventId);
  const totalSeats = chart.rowCounts.reduce((sum, count) => sum + count, 0);
  const assignedCount = Object.keys(chart.assignments).length;
  const eligibleCount = eligibleProfiles.length;

  return (
    <div
      className={`seating-workspace${focusMode ? " seating-workspace--focus" : ""}${fallbackFocus ? " seating-workspace--fallback-focus" : ""}`}
      ref={workspaceRef}
    >
      <SeatingHeader
        activeEvent={activeEvent}
        assignedCount={assignedCount}
        eligibleCount={eligibleCount}
        enterFocus={() => {
          void enterFocus();
        }}
        exitFocus={() => {
          void exitFocus();
        }}
        focusMode={focusMode}
        isNarrow={isNarrow}
        mobileEditing={mobileEditing}
        setMobileEditing={setMobileEditing}
        totalSeats={totalSeats}
      />

      <SeatingTabs formationTab={formationTab} setFormationTab={setFormationTab} />

      {formationTab === "formations" ? (
        <div
          aria-labelledby="seating-formations-tab"
          className="seating-tab-panel"
          id="seating-formations-panel"
          role="tabpanel"
        >
          <FormationEditor
            initial={resources.seating}
            key={JSON.stringify(resources.seating)}
            onSaved={(seating) => {
              setResources((current) => (current ? { ...current, seating } : current));
            }}
            roster={resources.roster}
          />
        </div>
      ) : (
        <SeatingChartPanel model={model} />
      )}
    </div>
  );
}
