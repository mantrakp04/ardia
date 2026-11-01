import type { ArdiaHost } from "./host";
import { cached } from "../../browser/src/state/settings/resources";
import { extensionList } from "../../browser/src/state/settings/paneData";
import { useExtensions } from "./extensionsStore";

export const settingsShowsExtensions = (profile: string) =>
  Object.hasOwn(useExtensions.getState().lists, profile) || cached(extensionList, [profile]) !== undefined;

export function followExtensionChanges(host: Pick<ArdiaHost, "onEvent">, shows: (profile: string) => boolean, refresh: (profile: string) => unknown) {
  return host.onEvent((module, event, payload) => {
    if (module !== "ArdiaExtensions" || event !== "extensions" || !payload || typeof payload !== "object") return;
    const { name, data } = payload as { name?: unknown; data?: { profile?: unknown } | null };
    if (name !== "extensions.changed" || typeof data?.profile !== "string") return;
    if (shows(data.profile)) void refresh(data.profile);
  });
}
