import type { OrganizationEvent, TicketScanResult } from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { AuthApiError, validateTicketScan } from "../auth/api";

const storageKey = "ticket-scan-event-id";
const historySize = 50;
const recentPreviewSize = 3;

interface HistoryItem {
  readonly result: TicketScanResult;
  readonly timestamp: number;
  readonly token: string;
}

function extractToken(input: string): string {
  try {
    const url = new URL(input);
    return url.searchParams.get("token") ?? input.trim();
  } catch {
    return input.trim();
  }
}

function invalidReasonText(reason: "not_found" | "not_paid" | "wrong_event"): string {
  if (reason === "not_found") return "Ticket not found or the QR code is not valid.";
  if (reason === "not_paid") return "This ticket has not been paid or has been refunded.";
  return "This ticket is for a different performance.";
}

function ScanResult({ result }: { readonly result: TicketScanResult }) {
  if (result.valid) {
    return (
      <section className="ticket-scan-result ticket-scan-result--valid" aria-live="polite">
        <p className="eyebrow">Valid ticket</p>
        <p>
          Valid: {result.buyerName}, {result.quantity} ticket
          {result.quantity === 1 ? "" : "s"}.
        </p>
        <h3>{result.eventTitle}</h3>
        <dl>
          <div>
            <dt>Will call</dt>
            <dd>{result.buyerName}</dd>
          </div>
          <div>
            <dt>Quantity</dt>
            <dd>
              {result.quantity} ticket{result.quantity === 1 ? "" : "s"}
            </dd>
          </div>
          <div>
            <dt>Performance</dt>
            <dd>{new Date(result.eventStartsAt).toLocaleString()}</dd>
          </div>
        </dl>
      </section>
    );
  }

  return (
    <section className="ticket-scan-result ticket-scan-result--invalid" aria-live="polite">
      <p className="eyebrow">Invalid ticket</p>
      <h3>{invalidReasonText(result.reason)}</h3>
    </section>
  );
}

function HistoryRow({ item }: { readonly item: HistoryItem }) {
  return (
    <div className={`ticket-scan-history-row ${item.result.valid ? "is-valid" : "is-invalid"}`}>
      <strong>{item.result.valid ? "Valid" : "Invalid"}</strong>
      <span>
        {item.result.valid ? item.result.buyerName : invalidReasonText(item.result.reason)}
      </span>
      <time dateTime={new Date(item.timestamp).toISOString()}>
        {new Date(item.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </time>
    </div>
  );
}

// This coordinator intentionally owns camera, manual entry, result history, and event selection.
// eslint-disable-next-line complexity
export function TicketScanner({ events }: { readonly events: readonly OrganizationEvent[] }) {
  const [eventId, setEventId] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [validating, setValidating] = useState(false);
  const [scanResult, setScanResult] = useState<TicketScanResult | null>(null);
  const [history, setHistory] = useState<readonly HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanPaused, setScanPaused] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanningRef = useRef(false);
  const validatingRef = useRef(false);
  const lastScannedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    const queryEventId = new URLSearchParams(window.location.search).get("eventId");
    const storedEventId = (() => {
      try {
        return window.localStorage.getItem(storageKey) ?? "";
      } catch {
        return "";
      }
    })();
    const preferred = queryEventId ?? storedEventId;
    const selected = events.some((event) => event.id === preferred)
      ? preferred
      : (events[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize the saved event after events load.
    setEventId(selected);
    if (selected) {
      try {
        window.localStorage.setItem(storageKey, selected);
      } catch {
        // Local storage is optional; scanning still works without it.
      }
    }
  }, [events]);

  const pauseScanning = useCallback(() => {
    scanningRef.current = false;
    setScanPaused(true);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const addToHistory = useCallback((result: TicketScanResult, token: string) => {
    setHistory((current) =>
      [{ result, timestamp: Date.now(), token }, ...current].slice(0, historySize),
    );
  }, []);

  const validateToken = useCallback(
    async (rawToken: string) => {
      if (!eventId || validatingRef.current) return;
      const token = extractToken(rawToken);
      if (!token) return;
      validatingRef.current = true;
      setValidating(true);
      setScanError(null);
      setScanResult(null);
      try {
        const result = await validateTicketScan({ eventId, token });
        setScanResult(result);
        addToHistory(result, token);
      } catch (error: unknown) {
        if (error instanceof AuthApiError && error.status === 404) {
          const result: TicketScanResult = { reason: "not_found", valid: false };
          setScanResult(result);
          addToHistory(result, token);
        } else {
          setScanError(
            error instanceof AuthApiError
              ? error.message
              : "The ticket credential could not be validated.",
          );
        }
      } finally {
        validatingRef.current = false;
        setValidating(false);
      }
    },
    [addToHistory, eventId],
  );

  const startFrameCapture = useCallback(async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setCameraError(null);
    let decodeQr:
      | ((data: Uint8ClampedArray, width: number, height: number) => { data: string } | null)
      | undefined;
    try {
      decodeQr = (await import("jsqr")).default;
    } catch {
      setCameraError("The QR scanner could not be loaded. Use manual entry instead.");
      return;
    }
    scanningRef.current = true;
    intervalRef.current = setInterval(() => {
      if (
        !scanningRef.current ||
        validatingRef.current ||
        !videoRef.current ||
        !canvasRef.current
      ) {
        return;
      }
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = decodeQr(image.data, image.width, image.height);
      if (!code?.data) return;
      const token = extractToken(code.data);
      if (!token || token === lastScannedTokenRef.current) return;
      lastScannedTokenRef.current = token;
      pauseScanning();
      void validateToken(token);
    }, 150);
  }, [pauseScanning, validateToken]);

  const startCamera = useCallback(async () => {
    if (!eventId) {
      setCameraError("Select a performance before starting the camera.");
      return;
    }
    setCameraError(null);
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          height: { ideal: 720 },
          width: { ideal: 1280 },
        },
      });
      setCameraActive(true);
    } catch {
      setCameraError("Camera access was denied or is unavailable. Use manual entry instead.");
    }
  }, [eventId]);

  useEffect(() => {
    if (!cameraActive || !streamRef.current || !videoRef.current) return;
    const video = videoRef.current;
    let cancelled = false;
    video.srcObject = streamRef.current;
    video.muted = true;
    video.playsInline = true;
    void video
      .play()
      .then(() => {
        if (!cancelled) void startFrameCapture();
      })
      .catch(() => {
        if (!cancelled)
          setCameraError("The camera preview could not start. Use manual entry instead.");
      });
    return () => {
      cancelled = true;
    };
  }, [cameraActive, startFrameCapture]);

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
    lastScannedTokenRef.current = null;
    setCameraActive(false);
    setScanPaused(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  function selectEvent(nextEventId: string): void {
    stopCamera();
    setEventId(nextEventId);
    setScanResult(null);
    setScanError(null);
    if (nextEventId) {
      try {
        window.localStorage.setItem(storageKey, nextEventId);
      } catch {
        // Local storage is optional.
      }
      const url = new URL(window.location.href);
      url.searchParams.set("eventId", nextEventId);
      window.history.replaceState(null, "", url);
    } else {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Local storage is optional.
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("eventId");
      window.history.replaceState(null, "", url);
    }
  }

  function scanNext(): void {
    setScanResult(null);
    setScanError(null);
    setScanPaused(false);
    lastScannedTokenRef.current = null;
    if (cameraActive) void startFrameCapture();
  }

  return (
    <section className="ticket-scanner" aria-labelledby="ticket-scanner-heading">
      <div className="section-heading section-heading--compact">
        <div>
          <p className="eyebrow">Door validation</p>
          <h3 id="ticket-scanner-heading">Scan tickets</h3>
        </div>
      </div>
      <div className="ticket-scanner__toolbar">
        <label className="field">
          Performance
          <select
            value={eventId}
            onChange={(event) => {
              selectEvent(event.target.value);
            }}
          >
            <option value="">Select a performance</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title} — {new Date(event.startsAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
        <div className="table-actions">
          {cameraActive ? (
            <button className="button button--secondary" onClick={stopCamera} type="button">
              Stop camera
            </button>
          ) : (
            <button
              className="button button--primary"
              disabled={!eventId}
              onClick={() => void startCamera()}
              type="button"
            >
              Start camera
            </button>
          )}
          {eventId ? (
            <a
              className="button button--secondary"
              href={`/api/organization/tickets/will-call?eventId=${encodeURIComponent(eventId)}`}
            >
              Download will-call CSV
            </a>
          ) : null}
        </div>
      </div>
      {events.length === 0 ? (
        <p className="notice notice--warning">Create a ticketed performance before scanning.</p>
      ) : null}
      {cameraError ? (
        <p className="notice notice--error" role="alert">
          {cameraError}
        </p>
      ) : null}
      {scanError ? (
        <p className="notice notice--error" role="alert">
          {scanError}
        </p>
      ) : null}
      {eventId ? (
        <div className="ticket-scanner__grid">
          <div>
            {cameraActive ? (
              <>
                <div className="ticket-scanner__video">
                  <video ref={videoRef} autoPlay muted playsInline />
                </div>
                <canvas ref={canvasRef} hidden />
                <p className="field-help">
                  {scanPaused
                    ? "Scan paused. Review the result, then scan the next ticket."
                    : "Point the camera at one ticket QR code."}
                </p>
              </>
            ) : (
              <p className="field-help">
                Start the camera to scan QR codes, or paste a ticket credential below.
              </p>
            )}
            {validating ? (
              <p className="notice notice--info" role="status">
                Validating ticket…
              </p>
            ) : null}
            {scanResult ? <ScanResult result={scanResult} /> : null}
          </div>
          <div className="ticket-scanner__side-panel">
            {history.length > 0 ? (
              <section className="ticket-scanner__history" aria-labelledby="recent-scans-heading">
                <div className="section-heading section-heading--compact">
                  <h3 id="recent-scans-heading">Recent scans</h3>
                  {history.length > recentPreviewSize ? (
                    <button
                      className="text-button"
                      onClick={() => {
                        setShowHistory(true);
                      }}
                      type="button"
                    >
                      View all
                    </button>
                  ) : null}
                </div>
                {history.slice(0, recentPreviewSize).map((item) => (
                  <HistoryRow key={`${String(item.timestamp)}-${item.token}`} item={item} />
                ))}
              </section>
            ) : null}
            <form
              className="ticket-scanner__manual"
              onSubmit={(event) => {
                event.preventDefault();
                setManualToken("");
                void validateToken(manualToken);
              }}
            >
              <h3>Manual entry</h3>
              <label className="field">
                Ticket credential
                <textarea
                  required
                  rows={4}
                  value={manualToken}
                  onChange={(event) => {
                    setManualToken(event.target.value);
                    setScanResult(null);
                    setScanError(null);
                  }}
                />
              </label>
              <button
                className="button button--primary"
                disabled={validating || !manualToken.trim()}
                type="submit"
              >
                {validating ? "Validating…" : "Validate ticket"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
      {cameraActive && scanPaused ? (
        <button
          className="button button--primary ticket-scanner__next"
          onClick={scanNext}
          type="button"
        >
          Scan next ticket
        </button>
      ) : null}
      <Dialog
        description="The most recent ticket validation attempts on this device."
        onClose={() => {
          setShowHistory(false);
        }}
        open={showHistory}
        title="Scan history"
      >
        <div className="ticket-scanner__history-list">
          {history.map((item) => (
            <HistoryRow key={`${String(item.timestamp)}-${item.token}`} item={item} />
          ))}
        </div>
      </Dialog>
    </section>
  );
}
