export function localBriefDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function parseBriefDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && localBriefDate(date) === value ? date : null;
}

export function briefDateFromUrl(url: string): string {
  const date = /^ardia:\/\/brief\/([^/?#]+)/i.exec(url)?.[1] ?? "";
  return parseBriefDate(date) ? date : localBriefDate();
}

export function briefDue(settings: { dailyBriefEnabled: boolean; dailyBriefTime: string; dailyBriefDelivery: string; dailyBriefLastOpened: string }, now = new Date()): boolean {
  if (!settings.dailyBriefEnabled || settings.dailyBriefLastOpened === localBriefDate(now)) return false;
  if (settings.dailyBriefDelivery === "onOpen") return true;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.dailyBriefTime)) return false;
  const [hour, minute] = settings.dailyBriefTime.split(":").map(Number);
  return now.getHours() * 60 + now.getMinutes() >= hour! * 60 + minute!;
}

export function briefRetryDue(attempt: { count: number; lastAttempt: number } | undefined, now: number): boolean {
  return !attempt || attempt.count < 3 && now - attempt.lastAttempt >= 5 * 60_000;
}
