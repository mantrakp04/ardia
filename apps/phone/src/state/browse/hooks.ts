import { useBrowse } from "./store";

export const useOpenPage = () => useBrowse((s) => s.page);
export const useNavigation = <T>(select: (navigation: ReturnType<typeof useBrowse.getState>["navigation"]) => T) => useBrowse((s) => select(s.navigation));
export const usePageTone = () => useBrowse((s) => s.tone);
