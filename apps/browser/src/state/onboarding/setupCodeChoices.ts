import type { SetupChoices } from "../presets/setupCode";
import type { Settings } from "../settings/settings";
import { useOnboarding } from "./onboarding";

export function adoptSetupChoices(choices: SetupChoices, lines: string[]) {
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
}
