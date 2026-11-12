import { useShallow } from "zustand/react/shallow";
import { useReportSheet, type ReportSheetState } from "./store";
import { useBrowser } from "../browser/store";

export function useReport<T>(select: (s: ReportSheetState) => T): T {
  return useReportSheet(select);
}

export function useReportShallow<T extends object>(select: (s: ReportSheetState) => T): T {
  return useReportSheet(useShallow(select));
}

export const useReportOpenIn = (windowId: string) => useReportSheet((s) => s.windowId === windowId);

export function useReportWindowIsPrivate(): boolean {
  const windowId = useReportSheet((s) => s.windowId);
  return useBrowser((s) => !!windowId && s.windows[windowId]?.kind === "private");
}
