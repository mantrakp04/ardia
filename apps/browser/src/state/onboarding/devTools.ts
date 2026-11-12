import { devTestValue } from "../../platform/launchConfig";
import { useBrowser } from "../browser/store";
import { resolveWindowId } from "../browser/model";
import { DEFAULT_SETTINGS } from "../settings/settings";
import {
  activeSteps,
  cancelOnboarding,
  chooseSource,
  confirmAnswer,
  finishOnboarding,
  forgetOnboardingProgress,
  goToStep,
  customizeMore,
  nextStep,
  presetPatch,
  previewLive,
  PRESETS,
  questionsFor,
  redoOnboarding,
  resolveDraft,
  startOnboarding,
  useOnboarding,
} from "./onboarding";
import { pinSites } from "./sites";

export const onboardingTestRun = () => devTestValue("onboarding") === "1";

export function resetOnboarding(windowId?: string | null) {
  const id = resolveWindowId(useBrowser.getState(), windowId);
  if (!id) return;
  forgetOnboardingProgress();
  useBrowser.setState((s) => ({ settings: DEFAULT_SETTINGS, windows: { ...s.windows, [id]: { ...s.windows[id]!, tabLayout: DEFAULT_SETTINGS.tabLayout } } }));
  startOnboarding(id);
}

if (__DEV__)
  (globalThis as { acOnboarding?: unknown }).acOnboarding = {
    store: useOnboarding,
    go: goToStep,
    start: startOnboarding,
    reset: resetOnboarding,
    chooseSource,
    confirmAnswer,
    presetPatch,
    nextStep,
    activeSteps,
    finish: finishOnboarding,
    redo: redoOnboarding,
    cancel: cancelOnboarding,
    customizeMore,
    previewLive,
    pinSites,
    resolveDraft,
    questionsFor,
    PRESETS,
  };
