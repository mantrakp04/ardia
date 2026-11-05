import { useEffect, useState } from "react";
import { switchOn } from "../../platform/killSwitches";

const PREWARM_AFTER_LAUNCH_MS = 1500;
let launchSettled = false;
setTimeout(() => void (launchSettled = true), PREWARM_AFTER_LAUNCH_MS);
export const prewarmAllowed = () => launchSettled;
export const setLaunchSettledForTests = (settled: boolean) => void (launchSettled = settled);

const PREWARM_DELAY_MS = 120;
let prewarmOn = true;
export const setNewTabPrewarm = (on: boolean) => void (prewarmOn = on);
export const newTabPrewarmOn = () => prewarmOn && prewarmAllowed() && switchOn("newTabPrewarm");
export function usePrewarm(want: boolean) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!want || !newTabPrewarmOn()) {
      setReady(false);
      return;
    }
    const timer = setTimeout(() => setReady(true), PREWARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [want]);
  return want && ready;
}
