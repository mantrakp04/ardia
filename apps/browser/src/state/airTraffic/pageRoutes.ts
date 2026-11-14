import { setLinkRoutes } from "../../platform/pageOptions";
import { useBrowser } from "../browser/store";
import { pageLinkRoutes } from "./inside";
import { currentAirTraffic, useAirTraffic } from "./store";

let started = false;
const FIRST_RETRY_MS = 250;
const LAST_RETRY_MS = 30_000;

export function startPageRoutes() {
  if (started) return;
  started = true;
  let sent = "";
  let wanted = "";
  let request = 0;
  let retryMs = FIRST_RETRY_MS;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const sync = () => {
    const routes = pageLinkRoutes(useBrowser.getState(), currentAirTraffic());
    const json = JSON.stringify(routes);
    if (json === sent) return;
    clearTimeout(retry);
    if (json !== wanted) {
      wanted = json;
      retryMs = FIRST_RETRY_MS;
    }
    sent = json;
    const current = ++request;
    setLinkRoutes(routes).catch(() => {
      if (current !== request) return;
      sent = "";
      retry = setTimeout(sync, retryMs);
      retryMs = Math.min(retryMs * 2, LAST_RETRY_MS);
    });
  };
  sync();
  useAirTraffic.subscribe((s, prev) => s.config !== prev.config && sync());
  useBrowser.subscribe((s, prev) => (s.profiles !== prev.profiles || s.groups !== prev.groups || s.parkedPins !== prev.parkedPins) && sync());
}
