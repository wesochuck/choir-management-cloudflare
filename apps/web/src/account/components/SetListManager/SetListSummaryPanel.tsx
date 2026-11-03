import type { OrganizationEvent } from "@choir/contracts";
import { formatSetListDuration } from "@choir/domain";

import { printTimeOnly, type setListRecordingCoverage } from "./utils";

export function SetListSummaryPanel({
  coverage,
  defaultTransitionCount,
  defaultTransitionDuration,
  defaultTransitionSeconds,
  estimatedRuntime,
  intermissionsDuration,
  itemsCount,
  missingDurationCustomCount,
  quickCueCount,
  selectedEvent,
  songsDuration,
}: {
  readonly coverage: ReturnType<typeof setListRecordingCoverage>;
  readonly defaultTransitionCount: number;
  readonly defaultTransitionDuration: number;
  readonly defaultTransitionSeconds: number;
  readonly estimatedRuntime: number;
  readonly intermissionsDuration: number;
  readonly itemsCount: number;
  readonly missingDurationCustomCount: number;
  readonly quickCueCount: number;
  readonly selectedEvent: OrganizationEvent;
  readonly songsDuration: number;
}) {
  return (
    <>
      <div className="set-list-summary" aria-live="polite">
        <section className="set-list-summary__contents" aria-label="Set list summary">
          <h3>Set list</h3>
          <dl className="set-list-summary__breakdown">
            <div className="set-list-summary__counts">
              <dt>Items</dt>{" "}
              <dd>
                <span>{itemsCount}</span>
                <small>
                  {coverage.songsWithRecording}/{coverage.songCount} recorded
                  {coverage.songsMissingRecording > 0
                    ? ` · ${String(coverage.songsMissingRecording)} missing`
                    : ""}
                </small>
              </dd>
            </div>
            <div>
              <dt>Songs</dt> <dd>{formatSetListDuration(songsDuration)}</dd>
            </div>
            <div>
              <dt>Custom entries</dt> <dd>{formatSetListDuration(intermissionsDuration)}</dd>
            </div>
            {quickCueCount > 0 ? (
              <div>
                <dt>Quick cues</dt> <dd>{quickCueCount}</dd>
              </div>
            ) : null}
            {defaultTransitionDuration > 0 ? (
              <div>
                <dt className="set-list-summary__transition-label">
                  <span>Between-song time</span>{" "}
                  <small>
                    {defaultTransitionCount} transition
                    {defaultTransitionCount === 1 ? "" : "s"} × {defaultTransitionSeconds} sec
                  </small>
                </dt>{" "}
                <dd>{formatSetListDuration(defaultTransitionDuration)}</dd>
              </div>
            ) : null}
          </dl>
        </section>
        <section className="set-list-summary__totals" aria-label="Set list timing">
          <h3>Timing</h3>
          <dl className="set-list-summary__timing">
            <div className="set-list-summary__estimated">
              <dt>Estimated runtime</dt> <dd>{formatSetListDuration(estimatedRuntime)}</dd>
            </div>
            {selectedEvent.durationMinutes ? (
              <>
                <div>
                  <dt>Scheduled duration</dt>{" "}
                  <dd>{formatSetListDuration(selectedEvent.durationMinutes * 60)}</dd>
                </div>
                {estimatedRuntime <= selectedEvent.durationMinutes * 60 ? (
                  <div>
                    <dt>Remaining time</dt>{" "}
                    <dd>
                      {formatSetListDuration(selectedEvent.durationMinutes * 60 - estimatedRuntime)}
                    </dd>
                  </div>
                ) : (
                  <div className="set-list-summary__overage">
                    <dt>Over by</dt>{" "}
                    <dd>
                      {formatSetListDuration(estimatedRuntime - selectedEvent.durationMinutes * 60)}
                    </dd>
                  </div>
                )}
              </>
            ) : null}
            {selectedEvent.startsAt && estimatedRuntime > 0 ? (
              <div>
                <dt>Estimated concert end</dt>{" "}
                <dd>
                  {printTimeOnly(
                    new Date(
                      new Date(selectedEvent.startsAt).getTime() + estimatedRuntime * 1000,
                    ).toISOString(),
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>
      {missingDurationCustomCount > 0 ? (
        <p className="notice notice--warning set-list-duration-warning" role="status">
          <strong>
            {missingDurationCustomCount === 1
              ? "1 Custom entry has no duration and is not included in the estimated runtime."
              : `${String(missingDurationCustomCount)} Custom entries have no duration and are not included in the estimated runtime.`}
          </strong>
        </p>
      ) : null}
    </>
  );
}
