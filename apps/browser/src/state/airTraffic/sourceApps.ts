import type { LinkSource } from "../../lib/linkSource";
import { parseSaved, unchanged, versionedJson, type Migrations } from "../../lib/savedDocument";
import { sourceAppOf, type SourceApp } from "./rules";

export const LINK_SOURCES_DOC = "link-sources.json";
export const LINK_SOURCES_VERSION = 1;
export const MAX_RECENT_APPS = 20;
const MIGRATIONS: Migrations = { 0: unchanged };

export const COMMON_APPS: readonly SourceApp[] = [
  { bundleId: "com.tinyspeck.slackmacgap", name: "Slack" },
  { bundleId: "com.apple.mail", name: "Mail" },
  { bundleId: "com.apple.MobileSMS", name: "Messages" },
  { bundleId: "notion.id", name: "Notion" },
  { bundleId: "com.linear", name: "Linear" },
  { bundleId: "com.hnc.Discord", name: "Discord" },
  { bundleId: "com.microsoft.teams2", name: "Microsoft Teams" },
  { bundleId: "us.zoom.xos", name: "Zoom" },
  { bundleId: "com.apple.iCal", name: "Calendar" },
  { bundleId: "com.microsoft.Outlook", name: "Microsoft Outlook" },
  { bundleId: "ru.keepcoder.Telegram", name: "Telegram" },
  { bundleId: "net.whatsapp.WhatsApp", name: "WhatsApp" },
];

export const sourceAppKey = (app: SourceApp) => (app.bundleId ?? `name:${app.name}`).toLowerCase();

export function sourceAppFrom(source: LinkSource): SourceApp | null {
  const bundleId = source?.bundleId?.trim() || null;
  const name = source?.appName?.trim() || bundleId;
  return name ? { bundleId, name } : null;
}

export function withRecentApp(recent: readonly SourceApp[], source: LinkSource): readonly SourceApp[] {
  const app = sourceAppFrom(source);
  if (!app) return recent;
  const key = sourceAppKey(app);
  const first = recent[0];
  if (first && sourceAppKey(first) === key && first.name === app.name) return recent;
  return [app, ...recent.filter((a) => sourceAppKey(a) !== key)].slice(0, MAX_RECENT_APPS);
}

export function parseRecentApps(json: string | null | undefined): SourceApp[] {
  const doc = parseSaved(json, LINK_SOURCES_VERSION, MIGRATIONS);
  if (!doc || !Array.isArray(doc.apps)) return [];
  const seen = new Set<string>();
  return doc.apps
    .map(sourceAppOf)
    .filter((a): a is SourceApp => !!a && !seen.has(sourceAppKey(a)) && !!seen.add(sourceAppKey(a)))
    .slice(0, MAX_RECENT_APPS);
}

export const recentAppsJson = (apps: readonly SourceApp[]) => versionedJson({ apps }, LINK_SOURCES_VERSION);

export function pickableApps(recent: readonly SourceApp[], extras: readonly (SourceApp | null)[]): { recent: SourceApp[]; common: SourceApp[] } {
  const seen = new Set<string>();
  const fresh = (app: SourceApp | null): app is SourceApp => !!app && !seen.has(sourceAppKey(app)) && !!seen.add(sourceAppKey(app));
  const listed = [...recent, ...extras].filter(fresh);
  return { recent: listed, common: COMMON_APPS.filter(fresh) };
}
