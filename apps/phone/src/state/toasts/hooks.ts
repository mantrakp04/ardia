import { useToasts } from "./store";

export const useToast = () => useToasts((s) => s.toast);
