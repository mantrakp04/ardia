import { runAppleScript, useCachedPromise } from "@raycast/utils";
import {
  activateScript,
  closeTabScript,
  findProfile,
  focusProfileScript,
  focusTabScript,
  listProfilesScript,
  listTabsScript,
  newTabScript,
  newWindowScript,
  parseProfiles,
  parseTabs,
  type NewWindowOptions,
  type Profile,
  type Tab,
} from "./scripts";

export type { Profile, Tab } from "./scripts";

export async function getTabs(): Promise<Tab[]> {
  return parseTabs(await runAppleScript(listTabsScript(), { timeout: 10_000 }));
}

export function useTabs() {
  return useCachedPromise(getTabs, [], { keepPreviousData: true });
}

export async function focusTab(tab: Tab) {
  await runAppleScript(focusTabScript(tab));
  await runAppleScript(activateScript());
}

export async function closeTab(tab: Tab) {
  await runAppleScript(closeTabScript(tab));
}

export async function getProfiles(): Promise<Profile[]> {
  return parseProfiles(await runAppleScript(listProfilesScript(), { timeout: 10_000 }));
}

export function useProfiles() {
  return useCachedPromise(getProfiles, [], { keepPreviousData: true });
}

export async function profileIdNamed(name: string) {
  const profiles = await getProfiles();
  const profile = findProfile(profiles, name);
  if (profile) return profile.id;
  const names = profiles.map((p) => p.name).join(", ");
  throw new Error(`No profile is named “${name.trim()}”. Ardia has ${names}.`);
}

export async function focusProfile(profile: Profile) {
  await runAppleScript(focusProfileScript(profile));
  await runAppleScript(activateScript());
}

export async function newWindow(options?: NewWindowOptions) {
  await runAppleScript(newWindowScript(options));
  await runAppleScript(activateScript());
}

export async function newTab(input: string) {
  await runAppleScript(newTabScript(input));
  await runAppleScript(activateScript());
}
