import type { ArdiaHost } from "./host";

export function watchHistoryImports(host: Pick<ArdiaHost, "onEvent">, reload: () => Promise<unknown>) {
  return host.onEvent((module, event, payload) => {
    if (module !== "ArdiaHistory" || event !== "history" || !payload || typeof payload !== "object") return;
    if ((payload as { name?: unknown }).name !== "history.imported") return;
    void reload();
  });
}
