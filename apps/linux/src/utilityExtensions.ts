import type { ArdiaHost } from "./host";

export function followExtensionChanges(host: Pick<ArdiaHost, "onEvent">, shown: () => Record<string, unknown>, refresh: (profile: string) => unknown) {
  return host.onEvent((module, event, payload) => {
    if (module !== "ArdiaExtensions" || event !== "extensions" || !payload || typeof payload !== "object") return;
    const { name, data } = payload as { name?: unknown; data?: { profile?: unknown } | null };
    if (name !== "extensions.changed" || typeof data?.profile !== "string") return;
    if (Object.hasOwn(shown(), data.profile)) void refresh(data.profile);
  });
}
