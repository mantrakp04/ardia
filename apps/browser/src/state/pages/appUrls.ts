import { appUrlRoute } from "@ardia/core";
import { SETTINGS_PANES, type SettingsPane } from "../settings/settingsWindows";

const PANE_ALIASES: Record<string, SettingsPane> = {
  people: "profiles",
  manageprofile: "profiles",
  syncsetup: "sync",
  addresses: "autofill",
  payments: "autofill",
  searchengines: "search",
};

export type AppUrlAction = { kind: "newTab" } | { kind: "settings"; pane: SettingsPane | undefined };

export function appUrlAction(url: string): AppUrlAction | null {
  const route = appUrlRoute(url);
  if (route?.kind === "newTab") return { kind: "newTab" };
  if (route?.kind !== "settings") return null;
  if (route.section === null) return { kind: "settings", pane: undefined };
  const section = route.section.toLowerCase();
  const pane = PANE_ALIASES[section] ?? SETTINGS_PANES.find((p) => p.toLowerCase() === section);
  return pane ? { kind: "settings", pane } : null;
}
