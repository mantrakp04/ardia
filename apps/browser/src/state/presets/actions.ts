import { copyText } from "../../platform/clipboard";
import { useBrowser } from "../browser/store";
import { resolveWindowId, tabLayoutOf } from "../browser/model";
import { useOnboarding } from "../onboarding/onboarding";
import { PINNABLE_SITES, pinSites } from "../onboarding/sites";
import { choosePresetColor } from "../profiles/themeActions";
import type { Settings } from "../settings/settings";
import { chooseTabLayout } from "../settings/actions";
import { decodeSetupCode, describeSetupChoices, encodeSetupCode, SETUP_SETTING_KEYS, type SetupChoices } from "./setupCode";

export type SetupCodeApplied = { ok: true; lines: string[] } | { ok: false; error: string };

export function onboardingSetupChoices(): SetupChoices {
  const { windowId, preset, picked, extras, baseline } = useOnboarding.getState();
  const s = useBrowser.getState();
  const id = resolveWindowId(s, windowId);
  const live: Partial<Settings> = { ...s.settings, tabLayout: tabLayoutOf(s, id) };
  const settings = Object.fromEntries(SETUP_SETTING_KEYS.map((k) => [k, k in baseline ? baseline[k] : live[k]]));
  const profileId = id ? s.windows[id]?.profileId : undefined;
  const color = baseline.color ?? (profileId ? s.profiles[profileId]?.color : undefined);
  return { preset, settings, color, pins: picked.pins ? (extras.pins ?? []) : undefined };
}

export function onboardingSetupCode(): { code: string; lines: string[] } {
  const choices = onboardingSetupChoices();
  return { code: encodeSetupCode(choices), lines: describeSetupChoices(choices) };
}

export const copySetupCode = (code: string) => copyText(code);

function applyChoices(choices: SetupChoices, windowId: string | null) {
  const { tabLayout, ...rest } = choices.settings;
  if (tabLayout) chooseTabLayout(tabLayout);
  if (Object.keys(rest).length) useBrowser.getState().updateSettings(rest);
  const s = useBrowser.getState();
  const id = resolveWindowId(s, windowId);
  const profileId = id ? s.windows[id]?.profileId : undefined;
  if (choices.color && profileId && s.profiles[profileId]) choosePresetColor(profileId, choices.color);
  const pins = (choices.pins ?? []).filter((pin) => PINNABLE_SITES.some((site) => site.id === pin));
  if (id && pins.length) pinSites(id, pins);
}

export function applySetupCode(code: string, windowId: string | null = null): SetupCodeApplied {
  const decoded = decodeSetupCode(code);
  if (!decoded.ok) return decoded;
  applyChoices(decoded.choices, windowId);
  return { ok: true, lines: describeSetupChoices(decoded.choices) };
}

export function applySetupCodeInOnboarding(code: string): SetupCodeApplied {
  const decoded = decodeSetupCode(code);
  if (!decoded.ok) return decoded;
  const { choices } = decoded;
  applyChoices(choices, useOnboarding.getState().windowId);
  const lines = describeSetupChoices(choices);
  useOnboarding.setState((o) => {
    const draft = { ...o.draft };
    const baseline = { ...o.baseline };
    for (const key of Object.keys(choices.settings)) {
      delete draft[key as keyof Settings];
      delete baseline[key as keyof Settings];
    }
    if (choices.color) delete baseline.color;
    return {
      preset: choices.preset ?? o.preset,
      draft,
      baseline,
      extras: choices.pins ? { ...o.extras, pins: choices.pins } : o.extras,
      picked: { ...o.picked, source: lines },
    };
  });
  return { ok: true, lines };
}
