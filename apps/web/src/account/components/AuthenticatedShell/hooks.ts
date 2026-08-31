import { useEffect, useRef, useState } from "react";
import { requestGlobalLeave } from "../../../persistence";
import { readRoute } from "./utils";
import type { RouteState } from "./types";

export function useRoute(): [RouteState, (href: string) => void] {
  const [route, setRoute] = useState<RouteState>(readRoute);
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    const onPopState = () => {
      const targetRoute = readRoute();
      const current = routeRef.current;
      void requestGlobalLeave({
        reason: "popstate",
      }).then((allowed) => {
        if (allowed) {
          setRoute(targetRoute);
        } else {
          window.history.pushState(null, "", `${current.pathname}${current.search}`);
        }
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  function navigate(href: string) {
    const target = new URL(href, window.location.origin);
    void requestGlobalLeave({
      action: () => {
        if (target.origin !== window.location.origin) {
          window.location.assign(target.href);
          return;
        }
        window.history.pushState(null, "", `${target.pathname}${target.search}${target.hash}`);
        setRoute(readRoute());
        window.scrollTo({ behavior: "smooth", top: 0 });
      },
      reason: "navigate",
    });
  }

  return [route, navigate];
}
