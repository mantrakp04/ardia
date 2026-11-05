import { create } from "zustand";

type Toast = { id: number; title: string; message?: string } & ToastOptions;
export type ToastOptions = { icon?: string; action?: { title: string; run(): void }; key?: string; sticky?: boolean };
export const useToasts = create<{ toasts: Record<string, Toast | null> }>()(() => ({ toasts: {} }));
let toastSeq = 0;
export function showToast(windowId: string, title: string, message?: string, options?: ToastOptions) {
  useToasts.setState((s) => {
    const current = s.toasts[windowId];
    const id = options?.key && current?.key === options.key ? current.id : ++toastSeq;
    return { toasts: { ...s.toasts, [windowId]: { id, title, message, ...options } } };
  });
}
export function hideToast(windowId: string, id: number) {
  useToasts.setState((s) => (s.toasts[windowId]?.id === id ? { toasts: { ...s.toasts, [windowId]: null } } : s));
}
export function hideKeyedToast(windowId: string, key: string) {
  useToasts.setState((s) => (s.toasts[windowId]?.key === key ? { toasts: { ...s.toasts, [windowId]: null } } : s));
}
