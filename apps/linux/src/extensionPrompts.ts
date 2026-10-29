import type { ArdiaHost } from "./host";

type InstallStore = {
  getState(): { install: { status: string; prompt?: { requestId: string } } | null };
  setState(patch: { install: null }): void;
};

export function watchInstallPromptCancellations(host: ArdiaHost, store: InstallStore) {
  return host.onEvent((module, event, payload) => {
    if (module !== "ArdiaExtensions" || event !== "extensions" || !payload || typeof payload !== "object") return;
    const { name, data } = payload as { name?: unknown; data?: { requestId?: unknown } | null };
    if (name !== "extensions.installPromptCancelled" || typeof data?.requestId !== "string") return;
    if (store.getState().install?.prompt?.requestId === data.requestId) store.setState({ install: null });
  });
}
