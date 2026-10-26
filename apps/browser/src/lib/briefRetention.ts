import { localBriefDate, parseBriefDate } from "./briefDates";

export function retainedBriefDates(dates: string[], now = new Date()): string[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 12);
  const first = localBriefDate(start);
  const last = localBriefDate(now);
  return [...new Set(dates)].filter((date) => parseBriefDate(date) && date >= first && date <= last).sort((a, b) => b.localeCompare(a));
}
