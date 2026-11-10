import type { BrowserState } from "../browser/store";
import { capture } from "./client";

type Counts = Record<string, number | boolean | string | null>;

export type TopAppsSharingPath = "synced_record" | "link_profiles" | "linked_profile_created";

const MAX_HELD = 16;
const held: [string, Counts][] = [];
let released = false;

export function noteTopAppsSharing(event: string, counts: Counts) {
  if (released) capture(event, counts);
  else if (held.length < MAX_HELD) held.push([event, counts]);
}

export function releaseTopAppsSharing() {
  released = true;
  for (const [event, counts] of held.splice(0)) capture(event, counts);
}

export function topAppsSharingCounts(s: Pick<BrowserState, "profiles">) {
  const profiles = Object.values(s.profiles);
  return { profile_count: profiles.length, sharing_profiles: profiles.filter((p) => p.shareTopApps).length };
}

export function topAppsSharingAtLaunch(s: Pick<BrowserState, "profiles" | "topAppsMerged">, updatedFrom: string | null) {
  return { ...topAppsSharingCounts(s), merge_recorded: s.topAppsMerged !== "", from_version: updatedFrom };
}

export function noteTopAppsSharingFromSync(s: Pick<BrowserState, "profiles">, path: TopAppsSharingPath, on: boolean) {
  noteTopAppsSharing("top_apps_sharing_synced", { path, on, ...topAppsSharingCounts(s) });
}
