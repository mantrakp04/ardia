import { setLittleArdiaOpensNewTabLinks } from "../../platform/pageOptions";
import { tolerateMissingCall } from "../../lib/fallback";
import { useBrowser } from "../browser/store";

let started = false;

export function startLittleArdiaNewTabLinks() {
  if (started) return;
  started = true;
  let sent: boolean | null = null;
  const sync = () => {
    const enabled = !!useBrowser.getState().settings.littleArdiaOpensNewTabLinks;
    if (enabled !== sent) void setLittleArdiaOpensNewTabLinks((sent = enabled)).catch(tolerateMissingCall);
  };
  sync();
  useBrowser.subscribe(sync);
}
