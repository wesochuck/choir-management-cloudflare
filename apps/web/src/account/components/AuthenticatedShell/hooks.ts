import { useEffect, useState } from "react";
import { readRoute } from "./utils";
import type { RouteState } from "./types";

export function useRoute(): [RouteState, (href: string) => void] {
  const [route, setRoute] = useState<RouteState>(readRoute);
  useEffect(() => {
    const onPopState = () => {
      setRoute(readRoute());
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);
  function navigate(href: string) {
    const target = new URL(href, window.location.origin);
    if (target.origin !== window.location.origin) {
      window.location.assign(target.href);
      return;
    }
    window.history.pushState(null, "", `${target.pathname}${target.search}${target.hash}`);
    setRoute(readRoute());
    window.scrollTo({ behavior: "smooth", top: 0 });
  }
  return [route, navigate];
}
