import { runAppleScript, useCachedPromise } from "@raycast/utils";
import {
  activateScript,
  closeTabScript,
  focusTabScript,
  listSpacesScript,
  listTabsScript,
  newTabScript,
  newWindowScript,
  parseSpaces,
  parseTabs,
  spaceNamed,
  showSpaceScript,
  type NewWindowOptions,
  type Space,
  type Tab,
} from "./scripts";

export type { Space, Tab } from "./scripts";

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

export async function getSpaces(): Promise<Space[]> {
  return parseSpaces(await runAppleScript(listSpacesScript(), { timeout: 10_000 }));
}

export function useSpaces() {
  return useCachedPromise(getSpaces, [], { keepPreviousData: true });
}

export async function spaceIdNamed(name: string) {
  return spaceNamed(await getSpaces(), name).id;
}

export async function showSpace(space: Space) {
  await runAppleScript(showSpaceScript(space));
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
