import type { ImageSourcePropType } from "react-native";
import type { BrowserSourceId } from "../../state/onboarding/onboarding";

const BUNDLED: Partial<Record<BrowserSourceId, ImageSourcePropType>> = {
  arc: require("../../../assets/browsers/arc.png"),
  dia: require("../../../assets/browsers/dia.png"),
  chrome: require("../../../assets/browsers/chrome.png"),
  safari: require("../../../assets/browsers/safari.png"),
  firefox: require("../../../assets/browsers/firefox.png"),
  zen: require("../../../assets/browsers/zen.png"),
  brave: require("../../../assets/browsers/brave.png"),
  edge: require("../../../assets/browsers/edge.png"),
};

export const browserIcon = (id: BrowserSourceId, installedIcon: string | null): ImageSourcePropType | null =>
  installedIcon ? { uri: installedIcon } : (BUNDLED[id] ?? null);
