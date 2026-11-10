import { titleBands, type TitleBand } from "../../platform/titleBand";
import { useBrowser, type BrowserState } from "../browser/store";
import { useOnboarding } from "../onboarding/onboarding";
import { titleBandFree } from "./layout";

const sent = new Map<string, TitleBand>();

export function syncTitleBands(s: BrowserState, onboardingWindow: string | null) {
  for (const id of Object.keys(s.windows)) {
    const mode: TitleBand = titleBandFree(s, id, id === onboardingWindow) ? "caption" : "content";
    if ((sent.get(id) ?? "content") === mode) continue;
    sent.set(id, mode);
    titleBands.set(id, mode);
  }
  for (const id of [...sent.keys()]) if (!s.windows[id]) sent.delete(id);
}

export function startTitleBandSync() {
  const sync = () => syncTitleBands(useBrowser.getState(), useOnboarding.getState().windowId);
  sync();
  useBrowser.subscribe(sync);
  useOnboarding.subscribe(sync);
}
