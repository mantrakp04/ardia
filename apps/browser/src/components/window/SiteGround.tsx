import type { ReactNode } from "react";
import { Animated, StyleSheet } from "react-native";
import { useActiveTabId, useSettings } from "../../state/browser/hooks";
import { useSiteColor } from "../toolbar/useSitePalette";
import { SiteGroundContext, useSiteGround } from "../ui/siteGround";
import { useEasedColor } from "../ui/toolbarColors";

export function SiteGroundScope({ children }: { children: ReactNode }) {
  const siteColor = useSiteColor(useActiveTabId());
  const extend = useSettings((s) => s.extendWebsiteColorToSidebar);
  return <SiteGroundContext.Provider value={extend ? siteColor : null}>{children}</SiteGroundContext.Provider>;
}

export function SiteGroundFill() {
  const band = useEasedColor(useSiteGround());
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: band }]} />;
}
