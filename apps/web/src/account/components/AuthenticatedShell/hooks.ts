import { useEffect, useRef, useState } from "react";
import { requestGlobalLeave } from "../../../persistence";
import { readRoute } from "./utils";
import type { RouteState } from "./types";

export function useRoute(): [RouteState, (href: string) => Promise<boolean>] {
  const [route, setRoute] = useState<RouteState>(readRoute);
  const routeRef = useRef(route);
  useEffect(() => {
    routeRef.current = route;
  });

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

  function navigate(href: string): Promise<boolean> {
    const target = new URL(href, window.location.origin);
    return requestGlobalLeave({
      action: () => {
        if (target.origin !== window.location.origin) {
          window.location.assign(target.href);
          return;
        }
        window.history.pushState(null, "", `${target.pathname}${target.search}${target.hash}`);
        setRoute(readRoute());
        const reduceMotion =
          typeof window !== "undefined" &&
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ behavior: reduceMotion ? "auto" : "smooth", top: 0 });
      },
      reason: "navigate",
    });
  }

  return [route, navigate];
}
