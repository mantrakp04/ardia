export type ClearRange = "lastHour" | "today" | "todayAndYesterday" | "allTime";
import { copy, type DefaultBrowserSteps } from "../../lib/platformCopy.ts";

export const CLEAR_RANGES: { id: ClearRange; title: string; phrase: string }[] = [
  { id: "lastHour", title: "Last Hour", phrase: "from the last hour" },
  { id: "today", title: "Today", phrase: "from today" },
  { id: "todayAndYesterday", title: "Today and Yesterday", phrase: "from today and yesterday" },
  { id: "allTime", title: "All Time", phrase: "from all time" },
];

export function clearSince(range: ClearRange, now: number): number | null {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  switch (range) {
    case "lastHour":
      return now - 3_600_000;
    case "today":
      return start.getTime();
    case "todayAndYesterday":
      start.setDate(start.getDate() - 1);
      return start.getTime();
    case "allTime":
      return null;
  }
}

export type ClearChoice = { history: boolean; cache: boolean; cookies: boolean; archive: boolean };

export const clearChoice = (history: boolean, cache: boolean, cookies: boolean, archive: boolean, range: ClearRange): ClearChoice => ({
  history,
  cache,
  cookies,
  archive: archive && range === "allTime",
});

export const clearIsEmpty = (choice: ClearChoice) => !choice.history && !choice.cache && !choice.cookies && !choice.archive;

export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function clearNames(choice: ClearChoice): string[] {
  const names: string[] = [];
  if (choice.history) names.push("History");
  if (choice.cache) names.push("Cache");
  if (choice.cookies) names.push("Cookies");
  if (choice.archive) names.push("Archived Tabs");
  return names;
}

export const clearTitle = (choice: ClearChoice, range: ClearRange) =>
  `Clear ${joinList(clearNames(choice))} ${CLEAR_RANGES.find((r) => r.id === range)!.phrase}?`;

export const clearMessage = (choice: ClearChoice) =>
  choice.cookies ? "You’ll be signed out of websites. Open tabs stay open." : "Open tabs stay open, and you stay signed in to websites.";

export function clearFooter(choice: ClearChoice): string {
  if (clearIsEmpty(choice)) return "Choose what to clear.";
  const lines: string[] = [];
  if (choice.history) lines.push(copy().historyClears);
  lines.push(choice.cookies ? "Clearing cookies signs you out of websites." : "You’ll stay signed in to websites.");
  return lines.join(" ");
}

export function websiteDataKinds(choice: ClearChoice): ("cache" | "cookiesAndSiteData")[] {
  const kinds: ("cache" | "cookiesAndSiteData")[] = [];
  if (choice.cache) kinds.push("cache");
  if (choice.cookies) kinds.push("cookiesAndSiteData");
  return kinds;
}

export const formatNumber = (value: number) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const plural = (count: number, one: string, other: string) => `${formatNumber(count)} ${count === 1 ? one : other}`;

export const rulesText = (count: number) => plural(count, "rule", "rules");
export const listsText = (count: number) => plural(count, "list", "lists");

export function relativeTime(date: number, now: number): string {
  const minutes = Math.max(1, Math.round((now - date) / 60_000));
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function updatedText(date: number | null, now: number): string {
  if (date === null) return "Not updated yet";
  if (now - date < 60_000) return "Updated just now";
  return `Updated ${relativeTime(date, now)}`;
}

export function listsStatus(isUpdating: boolean, isOffline: boolean, lastUpdated: number | null, now: number): string {
  if (isUpdating) return "Updating…";
  if (isOffline) return `Offline · ${updatedText(lastUpdated, now)}`;
  return updatedText(lastUpdated, now);
}

export type ListLike = {
  state: "ready" | "downloading" | "compiling" | "failed" | "offline" | "tooLarge";
  isEnabled: boolean;
  updatedAt: number | null;
  ruleCount: number;
};

export function listFacts(list: ListLike, now: number): { text: string; isWarning: boolean } {
  switch (list.state) {
    case "downloading":
      return { text: "Downloading…", isWarning: false };
    case "compiling":
      return { text: "Compiling…", isWarning: false };
    case "failed":
      return { text: "Couldn’t update", isWarning: true };
    case "tooLarge":
      return { text: "Too large for Ardia to use", isWarning: true };
    case "offline":
      return { text: `${rulesText(list.ruleCount)} · Waiting for a connection`, isWarning: false };
    case "ready":
      if (!list.isEnabled && list.updatedAt === null) return { text: "Downloads when you turn it on", isWarning: false };
      return { text: `${rulesText(list.ruleCount)} · ${updatedText(list.updatedAt, now)}`, isWarning: false };
  }
}

export function listStatus(list: ListLike): string {
  switch (list.state) {
    case "downloading":
      return "Downloading…";
    case "compiling":
      return "Compiling…";
    case "failed":
      return "Couldn’t Update";
    case "tooLarge":
      return "Too Large";
    case "offline":
      return "Offline";
    case "ready":
      return list.isEnabled ? "On" : "Off";
  }
}

export const listIsBusy = (list: ListLike) => list.state === "downloading" || list.state === "compiling";

export function resetMessage(customLists: number): string {
  if (customLists <= 0) return "uBlock Origin’s default lists turn back on and the rest turn off.";
  const removed = `${formatNumber(customLists)} ${customLists === 1 ? "list" : "lists"} you added`;
  return `uBlock Origin’s default lists turn back on, the rest turn off, and ${removed} will be removed.`;
}

export const myFiltersCount = (ruleCount: number) => (ruleCount === 0 ? "None" : rulesText(ruleCount));

export function myFiltersSummary(ruleCount: number, skippedCount: number, hasChanges: boolean): string {
  if (hasChanges) return "Changes aren’t applied yet";
  if (ruleCount === 0 && skippedCount === 0) return "No rules yet";
  const rules = rulesText(ruleCount);
  return skippedCount > 0 ? `${rules} · ${formatNumber(skippedCount)} skipped` : rules;
}

export function validListUrl(text: string): string | null {
  const trimmed = text.trim();
  return /^https?:\/\/[^\s/?#]+\.[^\s/?#]+[^\s]*$/i.test(trimmed) ? trimmed : null;
}

export type OnboardingStep = "welcome" | "blocking" | "defaultBrowser" | "sync" | "allSet";

export const ONBOARDING_STEPS: readonly OnboardingStep[] = ["welcome", "blocking", "defaultBrowser", "sync", "allSet"];

const shownSteps = (offersDefaultBrowser: boolean) => ONBOARDING_STEPS.filter((step) => step !== "defaultBrowser" || offersDefaultBrowser);

export const nextStep = (step: OnboardingStep, offersDefaultBrowser = false): OnboardingStep | null => {
  const steps = shownSteps(offersDefaultBrowser);
  const at = steps.indexOf(step);
  return at < 0 ? (shownSteps(true).slice(shownSteps(true).indexOf(step) + 1).find((s) => steps.includes(s)) ?? null) : (steps[at + 1] ?? null);
};

export const previousStep = (step: OnboardingStep, offersDefaultBrowser = false): OnboardingStep | null => {
  const steps = shownSteps(offersDefaultBrowser);
  const at = steps.indexOf(step);
  return at <= 0 ? null : (steps[at - 1] ?? null);
};

export type DefaultBrowserAction = "askForRole" | "openDefaultApps" | "openAppSettings";

export type DefaultBrowserCopy = { title: string; subtitle: string; steps: string[]; action: string | null; does: DefaultBrowserAction | null };

export const DEFAULT_BROWSER_ACTION = "Set as Default Browser";
export const OPEN_DEFAULT_APPS = "Open Default Apps";

type Status = { isDefault: boolean; canAsk: boolean };

export function offersDefaultBrowser(status: Status | null, always = copy().offersDefaultBrowserAlways): boolean {
  if (!status) return false;
  return always || status.canAsk || status.isDefault;
}

export function defaultBrowserCopy(status: Status, instructions: DefaultBrowserSteps | null = copy().defaultBrowserInstructions): DefaultBrowserCopy {
  if (instructions) {
    return { title: instructions.title, subtitle: instructions.subtitle, steps: instructions.steps, action: instructions.action, does: "openAppSettings" };
  }
  if (status.isDefault) return { title: "Ardia is your default browser", subtitle: "Links from other apps open in Ardia.", steps: [], action: null, does: null };
  const action = status.canAsk ? DEFAULT_BROWSER_ACTION : OPEN_DEFAULT_APPS;
  return {
    title: "Make Ardia your default browser",
    subtitle: "Open links from other apps in Ardia.",
    steps: [`Tap “${action}”`, status.canAsk ? "Select Ardia" : "Choose Browser app"],
    action,
    does: status.canAsk ? "askForRole" : "openDefaultApps",
  };
}

export const exportableUrls = (tabs: readonly { url: string; isPrivate: boolean }[]) =>
  tabs.filter((tab) => !tab.isPrivate && /^https?:\/\//i.test(tab.url)).map((tab) => tab.url);
