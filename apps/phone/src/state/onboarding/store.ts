import { create } from "zustand";
import { presentSearch } from "../search/store";
import { closeSettings } from "../settings/nav";
import { defaultBrowserStatus, refreshDefaultBrowser } from "../settings/defaultBrowser";
import { nextStep, offersDefaultBrowser, previousStep, type OnboardingStep } from "../settings/settingsRules";
import { currentPreferences, setPreference } from "../settings/store";
import { useTabs } from "../tabs/store";
import { heldLinks } from "../links/heldLinks";
import { opensLaunchTray } from "../links/linkRules";

export const useOnboarding = create<{ showing: boolean; step: OnboardingStep; forward: boolean }>()(() => ({ showing: false, step: "welcome", forward: true }));

export const onboardingShowing = () => useOnboarding.getState().showing;

export function showOnboarding() {
  closeSettings();
  useOnboarding.setState({ showing: true, step: "welcome", forward: true });
  void refreshDefaultBrowser();
}

const offers = () => offersDefaultBrowser(defaultBrowserStatus());

export function advanceOnboarding() {
  const next = nextStep(useOnboarding.getState().step, offers());
  if (next) useOnboarding.setState({ step: next, forward: true });
  else finishOnboarding();
}

export function onboardingBack(): boolean {
  const { showing, step } = useOnboarding.getState();
  if (!showing) return false;
  const previous = previousStep(step, offers());
  if (previous) useOnboarding.setState({ step: previous, forward: false });
  else finishOnboarding();
  return true;
}

export function finishOnboarding() {
  const raisesTray = opensLaunchTray(currentPreferences().autoOpensKeyboard, heldLinks());
  setPreference("hasFinishedOnboarding", true);
  useOnboarding.setState({ showing: false });
  if (raisesTray) presentSearch("home", "", useTabs.getState().incognito);
}
