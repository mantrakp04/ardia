type InstallRequest = { windowId: string; source?: string };

type InstallRequestStore = {
  getState(): { install: InstallRequest | null };
  subscribe(listener: (state: { install: InstallRequest | null }) => void): () => void;
};

export const leftoverInstallRequest = <T extends InstallRequest>(install: T | null): T | null =>
  install?.source === "unpacked" ? install : null;

export const ownsInstallRequest = (install: InstallRequest | null, windowId: string, leftover: InstallRequest | null) =>
  !!install && install.windowId === windowId && install !== leftover;

export function followInstallRequest(store: InstallRequestStore, windowId: string, onClosed: () => void, leftover: InstallRequest | null = null) {
  let shown = ownsInstallRequest(store.getState().install, windowId, leftover);
  return store.subscribe((state) => {
    if (ownsInstallRequest(state.install, windowId, leftover)) shown = true;
    else if (shown) {
      shown = false;
      onClosed();
    }
  });
}
