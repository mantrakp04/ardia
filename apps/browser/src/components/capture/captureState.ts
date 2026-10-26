import { create } from "zustand";

export const useCapture = create<{ windowId: string | null }>(() => ({ windowId: null }));

export function toggleCapture(windowId: string) {
  useCapture.setState({ windowId: useCapture.getState().windowId === windowId ? null : windowId });
}

export function endCapture(windowId: string) {
  if (useCapture.getState().windowId === windowId) useCapture.setState({ windowId: null });
}
