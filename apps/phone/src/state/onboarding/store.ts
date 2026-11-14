import { create } from "zustand";
import { presentSearch } from "../search/store";
import { closeSettings } from "../settings/nav";
import { nextStep, previousStep, type OnboardingStep } from "../settings/settingsRules";
import { currentPreferences, setPreference } from "../settings/store";
import { useTabs } from "../tabs/store";

export const useOnboarding = create<{ showing: boolean; step: OnboardingStep; forward: boolean }>()(() => ({ showing: false, step: "welcome", forward: true }));

export const onboardingShowing = () => useOnboarding.getState().showing;

export function showOnboarding() {
  closeSettings();
  useOnboarding.setState({ showing: true, step: "welcome", forward: true });
}

export function advanceOnboarding() {
  const next = nextStep(useOnboarding.getState().step);
  if (next) useOnboarding.setState({ step: next, forward: true });
  else finishOnboarding();
}

export function onboardingBack(): boolean {
  const { showing, step } = useOnboarding.getState();
  if (!showing) return false;
  const previous = previousStep(step);
  if (previous) useOnboarding.setState({ step: previous, forward: false });
  else finishOnboarding();
  return true;
}

export function finishOnboarding() {
  setPreference("hasFinishedOnboarding", true);
  useOnboarding.setState({ showing: false });
  if (currentPreferences().autoOpensKeyboard) presentSearch("home", "", useTabs.getState().incognito);
}
