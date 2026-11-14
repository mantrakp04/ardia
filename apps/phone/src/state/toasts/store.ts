import { create } from "zustand";

export type ToastIcon = "checkmark" | "warning" | "download" | "blocking" | "link" | "laptop" | "star" | "sent";

export type Toast = { id: number; message: string; icon: ToastIcon; durationMs: number; onTap: (() => void) | null };

export const TOAST_DURATION_MS = 2400;
export const TOAST_LONG_DURATION_MS = 3200;

export const useToasts = create<{ toast: Toast | null; barTopY: number | null }>()(() => ({ toast: null, barTopY: null }));

export const noteDeckBarTop = (barTopY: number | null) => {
  if (useToasts.getState().barTopY !== barTopY) useToasts.setState({ barTopY });
};

let measureDeckBar: (() => void) | null = null;

export function watchDeckBar(measure: (() => void) | null) {
  measureDeckBar = measure;
  if (!measure) noteDeckBarTop(null);
}

let next = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, icon: ToastIcon, durationMs = TOAST_DURATION_MS, onTap: (() => void) | null = null) {
  next += 1;
  const id = next;
  measureDeckBar?.();
  useToasts.setState({ toast: { id, message, icon, durationMs, onTap } });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (useToasts.getState().toast?.id === id) useToasts.setState({ toast: null });
  }, durationMs);
}

export function tapToast() {
  const toast = useToasts.getState().toast;
  useToasts.setState({ toast: null });
  toast?.onTap?.();
}

export const dismissToast = () => useToasts.setState({ toast: null });
