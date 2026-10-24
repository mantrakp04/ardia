import { getContentBlocker, onContentBlockerChange, setContentBlockerProvider, type ContentBlockerProvider } from "@ardia/ardiacore";
import { confirmAdClicking } from "./contentBlockerConsent";

const listeners = new Set<() => void>();
let activating: ContentBlockerProvider | null = null;
let selecting = false;

export const getActivatingBlocker = () => activating;
const notify = () => {
  for (const listener of listeners) listener();
};

export async function selectContentBlocker(provider: ContentBlockerProvider, options: { windowId?: string; isCurrent?: () => boolean } = {}) {
  if (selecting) throw new Error("Another content blocker is being selected. Please wait.");
  selecting = true;
  try {
    const isCurrent = options.isCurrent ?? (() => true);
    if (!isCurrent()) return false;
    if (provider === "adnauseam") {
      const current = await getContentBlocker();
      if (!isCurrent()) return false;
      const alreadyConsented = current.provider === provider && current.selectedProvider === provider && current.clickAds && current.stats.ready;
      if (!alreadyConsented && !(await confirmAdClicking(options.windowId))) return false;
      if (!isCurrent()) return false;
    }
    activating = provider;
    notify();
    await setContentBlockerProvider(provider, provider === "adnauseam");
    return isCurrent();
  } finally {
    selecting = false;
    const wasActivating = activating !== null;
    activating = null;
    if (wasActivating) notify();
  }
}

export function onBlockerSettingsChange(listener: () => void) {
  listeners.add(listener);
  const native = onContentBlockerChange(() => {
    if (!activating) listener();
  });
  return {
    remove() {
      listeners.delete(listener);
      native.remove();
    },
  };
}
