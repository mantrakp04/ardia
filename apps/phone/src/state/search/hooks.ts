import { useSearch } from "./store";

export const useSearchOpen = () => useSearch((s) => s.open);
export const useSearchOrigin = () => useSearch((s) => s.origin);
export const useSearchSession = () => useSearch((s) => s.session);
export const useSearchInitialText = () => useSearch((s) => s.initialText);
export const useSearchText = () => useSearch((s) => s.text);
export const useSearchRows = () => useSearch((s) => s.rows);
export const useSearchFieldVersion = () => useSearch((s) => s.fieldVersion);
