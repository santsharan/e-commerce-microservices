"use client";

import { useEffect } from "react";
import { expireSession } from "@/server/actions";

const expiredLogin = "/login?expired=1";

export function SessionWatch({ expiresAt }: { expiresAt: number | undefined }) {
  useEffect(() => {
    if (expiresAt === undefined) {
      return;
    }
    let stopped = false;
    const check = () => {
      if (stopped) {
        return;
      }
      void expireSession().then((expired) => {
        if (expired && !stopped) {
          stopped = true;
          window.location.assign(expiredLogin);
        }
      });
    };
    const delay = Math.max(0, expiresAt - Date.now());
    const timer = window.setTimeout(check, delay);
    const interval = window.setInterval(check, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        check();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [expiresAt]);
  return null;
}
