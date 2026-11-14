import { useToasts } from "./store";

export const useToast = () => useToasts((s) => s.toast);

export const useDeckBarTop = () => useToasts((s) => s.barTopY);
