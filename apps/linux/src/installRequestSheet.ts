type InstallRequest = { windowId: string; source?: string; status?: string; pkg?: object };

type InstallRequestStore = {
  getState(): { install: InstallRequest | null };
  subscribe(listener: (state: { install: InstallRequest | null }, previous: { install: InstallRequest | null }) => void): () => void;
};

const leftBehind = new WeakSet<object>();
const failedInstallOf = new WeakMap<InstallRequest, object>();

const lineageOf = (install: InstallRequest): object => install.pkg ?? failedInstallOf.get(install) ?? install;

export const leftoverInstallRequest = <T extends InstallRequest>(install: T | null): T | null =>
  install && leftBehind.has(lineageOf(install)) ? install : null;

export const ownsInstallRequest = (install: InstallRequest | null, windowId: string, leftover: InstallRequest | null) =>
  !!install && install.windowId === windowId && (!leftover || lineageOf(install) !== lineageOf(leftover));

export function followInstallFailures(store: InstallRequestStore) {
  let failing: object | null = null;
  const stop = store.subscribe(({ install }, previous) => {
    if (!failing || install === previous.install) return;
    if (install?.source === "unpacked" && install.status === "error") failedInstallOf.set(install, failing);
    failing = null;
  });
  return { failed: (pkg: object) => void (failing = pkg), stop };
}

export function followInstallRequest(store: InstallRequestStore, windowId: string, onClosed: () => void, leftover: InstallRequest | null = null) {
  let shown = ownsInstallRequest(store.getState().install, windowId, leftover);
  const stop = store.subscribe((state) => {
    if (ownsInstallRequest(state.install, windowId, leftover)) shown = true;
    else if (shown) {
      shown = false;
      onClosed();
    }
  });
  return () => {
    stop();
    const install = store.getState().install;
    if (install?.windowId === windowId && install.source === "unpacked") leftBehind.add(lineageOf(install));
  };
}
