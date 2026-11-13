const counts = { asked: 0, noApp: 0, opened: 0, remembered: 0, declined: 0 };

export type ExternalAppOutcome = keyof typeof counts;

export const noteExternalApp = (outcome: ExternalAppOutcome) => void (counts[outcome] += 1);

export function takeExternalAppCounts() {
  const taken = {
    external_app_prompts: counts.asked,
    external_app_prompts_no_app: counts.noApp,
    external_app_opens: counts.opened,
    external_app_opens_remembered: counts.remembered,
    external_app_declines: counts.declined,
  };
  for (const key of Object.keys(counts) as ExternalAppOutcome[]) counts[key] = 0;
  return taken;
}
