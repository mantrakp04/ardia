import { launchLinks } from "../../platform/launchLinks";
import { takeAnimationBursts, watchAnimationBursts } from "./animationBursts";
import { checkDefaultBrowserAtLaunch, takeDefaultBrowserCounts } from "./defaultBrowserCounts";

export function watchPlatformCounts() {
  watchAnimationBursts();
  checkDefaultBrowserAtLaunch();
}

export const takePlatformCounts = () => ({ ...takeAnimationBursts(), ...takeDefaultBrowserCounts(), launch_command_line_links: launchLinks.takeOpenedAtLaunch() });
