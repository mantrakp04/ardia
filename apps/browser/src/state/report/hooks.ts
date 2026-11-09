import { useShallow } from "zustand/react/shallow";
import { useReportSheet, type ReportSheetState } from "./store";

export function useReport<T>(select: (s: ReportSheetState) => T): T {
  return useReportSheet(select);
}

export function useReportShallow<T extends object>(select: (s: ReportSheetState) => T): T {
  return useReportSheet(useShallow(select));
}

export const useReportOpenIn = (windowId: string) => useReportSheet((s) => s.windowId === windowId);
