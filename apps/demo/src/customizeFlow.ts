import { useBrowser } from "../../browser/src/state/browser/store";
import { PRESETS, presetFor, startOnboarding, useOnboarding } from "../../browser/src/state/onboarding/onboarding";
import { onboardingSetupCode } from "../../browser/src/state/presets/actions";
import { DEFAULT_SETTINGS, type Settings } from "../../browser/src/state/settings/settings";
import { focusedWindowOf } from "../../browser/src/state/windows/ui";

export const DEMO_PRESET = presetFor("arc");

export const demoSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...PRESETS[DEMO_PRESET] });

export function startCustomize() {
  if (useOnboarding.getState().windowId) return;
  startOnboarding(focusedWindowOf(useBrowser.getState()));
  useOnboarding.setState({ preset: DEMO_PRESET });
}

export type CustomizeState = { active: boolean; code: string | null };

let code: string | null = null;

export function customizeState(): CustomizeState {
  const o = useOnboarding.getState();
  if (o.windowId && o.step === "outro") code = onboardingSetupCode().code;
  return { active: !!o.windowId && !o.leaving, code };
}

export function watchCustomize(listener: (state: CustomizeState) => void) {
  let last = "";
  const publish = () => {
    const state = customizeState();
    const snapshot = JSON.stringify(state);
    if (snapshot === last) return;
    last = snapshot;
    listener(state);
  };
  publish();
  return useOnboarding.subscribe(publish);
}
