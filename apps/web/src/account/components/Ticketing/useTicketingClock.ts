import { useEffect, useState } from "react";

export function useTicketingClock(): number {
  const [nowMs, setNowMs] = useState(Date.now);

  useEffect(() => {
    const refresh = () => {
      setNowMs(Date.now());
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return nowMs;
}
