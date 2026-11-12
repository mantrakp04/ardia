import { TurboModuleRegistry, type TurboModule } from "react-native";
import { emitWhenListened } from "../events";
import { launchAddresses, type LaunchArguments } from "./addresses";

type WindowsHost = TurboModule & { launchArguments?(): LaunchArguments };

let read = false;
let openedAtLaunch = 0;

function launchArguments(): LaunchArguments | null {
  try {
    return TurboModuleRegistry.get<WindowsHost>("ArdiaWindowsHost")?.launchArguments?.() ?? null;
  } catch {
    return null;
  }
}

export function openLaunchLinks() {
  if (read) return;
  read = true;
  const urls = launchAddresses(launchArguments());
  if (!urls.length) return;
  console.info(`[ardia windows] launch links: ${urls.length} held until the app listens`);
  emitWhenListened("ArdiaShell", "onOpenURLs", { urls }, () => {
    openedAtLaunch += urls.length;
    console.info(`[ardia windows] launch links: ${urls.length} sent to the app`);
  });
}

export const windowsLaunchLinks = {
  takeOpenedAtLaunch() {
    const taken = openedAtLaunch;
    openedAtLaunch = 0;
    return taken;
  },
};
