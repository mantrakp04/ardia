import { externalAppCounts } from "../../platform/externalAppCounts";

const counts = { allowed: 0, allowedAlways: 0, declined: 0 };

export type ExternalAppOutcome = keyof typeof counts;

export const noteExternalApp = (outcome: ExternalAppOutcome) => void (counts[outcome] += 1);

export function takeExternalAppCounts() {
  const launches = externalAppCounts.takeLaunches();
  const taken = {
    external_app_allows: counts.allowed,
    external_app_allows_always: counts.allowedAlways,
    external_app_declines: counts.declined,
    external_app_launches: launches.opened,
    external_app_launches_refused: launches.refused,
    external_app_launches_automatic: launches.automatic,
  };
  for (const key of Object.keys(counts) as ExternalAppOutcome[]) counts[key] = 0;
  return taken;
}
