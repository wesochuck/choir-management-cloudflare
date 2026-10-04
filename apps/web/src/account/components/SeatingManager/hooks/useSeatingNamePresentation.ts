import { useLayoutEffect, useRef } from "react";
import type { OrganizationSeatingChartRequest } from "@choir/contracts";

function hasFontReady(val: unknown): val is { ready: Promise<unknown> } {
  if (typeof val !== "object" || val === null) return false;
  if (!("ready" in val)) return false;
  const ready: unknown = Reflect.get(val, "ready");
  return typeof ready === "object" && ready !== null && "then" in ready;
}

export function useSeatingNamePresentation(
  canvasRef: React.RefObject<HTMLDivElement | null>,
  chart: OrganizationSeatingChartRequest,
): void {
  const isPrintingRef = useRef(false);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function measure(): void {
      if (isPrintingRef.current || !canvas) return;
      const rootFontSize =
        parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const threshold = 5.25 * rootFontSize;

      const rows = canvas.querySelectorAll<HTMLElement>(".seating-row--canvas");
      for (const row of rows) {
        const firstSeat = row.querySelector<HTMLElement>(".seating-seat--canvas");
        if (!firstSeat) continue;
        const seatWidth = firstSeat.getBoundingClientRect().width;
        if (seatWidth <= 0) continue;
        const presentation = seatWidth <= threshold ? "initials" : "full";

        if (row.getAttribute("data-name-presentation") !== presentation) {
          row.setAttribute("data-name-presentation", presentation);
        }
        const seats = row.querySelectorAll<HTMLElement>(".seating-seat--canvas");
        for (const seat of seats) {
          if (seat.getAttribute("data-name-presentation") !== presentation) {
            seat.setAttribute("data-name-presentation", presentation);
          }
        }
      }
    }

    measure();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        measure();
      });
      resizeObserver.observe(canvas);
      const rows = canvas.querySelectorAll<HTMLElement>(".seating-row--canvas");
      for (const row of rows) {
        resizeObserver.observe(row);
      }
    }

    let active = true;
    const fonts: unknown = Reflect.get(document, "fonts");
    if (hasFontReady(fonts)) {
      void fonts.ready.then(() => {
        if (active && !isPrintingRef.current) {
          measure();
        }
      });
    }

    const onBeforePrint = (): void => {
      isPrintingRef.current = true;
    };
    const onAfterPrint = (): void => {
      isPrintingRef.current = false;
      measure();
    };

    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);

    return () => {
      active = false;
      resizeObserver?.disconnect();
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [canvasRef, chart]);
}
