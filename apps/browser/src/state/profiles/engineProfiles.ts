import type { BrowserState } from "../browser/store";

export const engineProfiles = (s: Pick<BrowserState, "profiles">) =>
  [...new Set(Object.values(s.profiles).map((profile) => profile.engineId))];

export const profilesUsing = (s: Pick<BrowserState, "profiles">, engine: string) =>
  Object.keys(s.profiles).filter((id) => s.profiles[id]!.engineId === engine);
