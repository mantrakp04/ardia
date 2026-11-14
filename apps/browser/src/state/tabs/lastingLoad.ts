import { useEffect, useRef, useState } from "react";
import { useTabLive } from "../browser/hooks";
import { notePageOverlay } from "../telemetry/usage";

const SHOW_AFTER_MS = 150;

export function useLastingLoad(tabId: string) {
  const loading = useTabLive(tabId, (live) => live.isLoading);
  const [lasting, setLasting] = useState(false);
  const waiting = useRef(false);
  useEffect(() => {
    if (!loading) {
      if (waiting.current) notePageOverlay("loadingSkipped");
      waiting.current = false;
      return;
    }
    waiting.current = true;
    const wait = setTimeout(() => {
      waiting.current = false;
      setLasting(true);
    }, SHOW_AFTER_MS);
    return () => {
      clearTimeout(wait);
      setLasting(false);
    };
  }, [loading]);
  return loading && lasting;
}
