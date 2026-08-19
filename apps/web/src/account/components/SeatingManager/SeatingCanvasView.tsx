import { closestCenter, DndContext, DragOverlay } from "@dnd-kit/core";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";
import { UnassignedTray } from "./chartParts";
import { SeatingGridCanvas } from "./SeatingGridCanvas";
import type { SeatingManagerModel } from "./hooks";
import { emptyProfile, resolveDraggingProfile, seatingProfileLabel } from "./utils";

export function SeatingCanvasView({ model }: { readonly model: SeatingManagerModel }) {
  const { partLabel } = useOrganizationTerminology();
  const {
    chart,
    currentFormation,
    dragMessage,
    draggingToken,
    handleDragEnd,
    handleDragStart,
    handleNativeDrop,
    isNarrow,
    markNotAttending,
    mobileEditing,
    profilesById,
    query,
    requestRemoveRow,
    requestRemoveSeat,
    resources,
    sensors,
    setDragMessage,
    setDraggingToken,
    setLookupQuery,
    setMobileEditing,
    setProfileDialog,
    setProfileForm,
    setQuery,
    setSelectedSeat,
    unassignedProfiles,
    updateLayout,
  } = model;

  if (!resources) return null;

  const isEditing = !isNarrow || mobileEditing;
  const rows = chart.rowCounts.map((_count, index) => index).reverse();
  const { profile: draggingProfile, fallbackName: draggingFallbackName } = resolveDraggingProfile(
    draggingToken,
    chart.assignments,
    profilesById,
  );

  return (
    <>
      <p aria-live="polite" className={draggingToken ? "seating-drag-status" : "sr-only"}>
        {dragMessage}
      </p>
      <DndContext
        collisionDetection={closestCenter}
        onDragCancel={() => {
          setDraggingToken(null);
          setDragMessage("Drag canceled.");
        }}
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
        sensors={sensors}
      >
        <SeatingGridCanvas
          chart={chart}
          currentFormation={currentFormation}
          handleNativeDrop={handleNativeDrop}
          isEditing={isEditing}
          profilesById={profilesById}
          requestRemoveRow={requestRemoveRow}
          requestRemoveSeat={requestRemoveSeat}
          roster={resources.roster}
          rows={rows}
          setSelectedSeat={setSelectedSeat}
          updateLayout={updateLayout}
        />
        {isEditing ? (
          <UnassignedTray
            onAdd={() => {
              setProfileForm(emptyProfile);
              setProfileDialog("add");
            }}
            onDrop={(token) => {
              handleNativeDrop(token);
            }}
            onLookup={() => {
              setLookupQuery("");
              setProfileDialog("lookup");
            }}
            onRemoveRsvp={(profile) => {
              markNotAttending(profile);
            }}
            profiles={unassignedProfiles}
            query={query}
            roster={resources.roster}
            setQuery={setQuery}
          />
        ) : (
          <button
            className="button button--secondary no-print"
            onClick={() => {
              setMobileEditing(true);
            }}
            type="button"
          >
            Edit chart
          </button>
        )}
        <DragOverlay dropAnimation={null}>
          {draggingToken ? (
            <div className="seating-drag-overlay">
              <span>Moving</span>
              <strong>
                {draggingProfile ? seatingProfileLabel(draggingProfile) : draggingFallbackName}
              </strong>
              {draggingProfile ? (
                <small>
                  {draggingProfile.voicePart.trim()
                    ? `${partLabel}: ${draggingProfile.voicePart}`
                    : `No ${partLabel.toLowerCase()}`}
                </small>
              ) : null}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
