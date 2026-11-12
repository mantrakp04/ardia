import { launchLinks } from "../../platform/launchLinks";
import { takeAnimationBursts, watchAnimationBursts } from "./animationBursts";

export const watchPlatformCounts = watchAnimationBursts;

export const takePlatformCounts = () => ({ ...takeAnimationBursts(), launch_command_line_links: launchLinks.takeOpenedAtLaunch() });
