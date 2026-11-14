import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import Animated, { SlideInLeft, SlideInRight, SlideOutRight } from "react-native-reanimated";
import { refreshSettings } from "../../state/settings/actions";
import { useSettingsNav, type SettingsRoute } from "../../state/settings/hooks";
import { tabsMotion } from "../ui";
import { FilterListDetailPage, FilterListsPage, MyFiltersPage, TrustedSitesPage } from "./BlockingPages";
import { AboutPage, ClearDataPage, LicensesPage } from "./DataPages";
import { SettingsRoot } from "./SettingsRoot";
import { SearchEnginePage, SiteSettingsPage } from "./SitePages";
import { SyncConnect } from "../sync/SyncConnect";
import { SyncPage } from "../sync/SyncPage";
import { DefaultBrowserPage } from "./DefaultBrowserPage";
import { popSettings } from "../../state/settings/nav";

const push = SlideInRight.springify().stiffness(tabsMotion.sheetIn.stiffness).damping(tabsMotion.sheetIn.damping);
const reveal = SlideInLeft.springify().stiffness(tabsMotion.sheetIn.stiffness).damping(tabsMotion.sheetIn.damping);
const leave = SlideOutRight.springify().stiffness(tabsMotion.sheetOut.stiffness).damping(tabsMotion.sheetOut.damping);

function Page({ route }: { route: SettingsRoute }) {
  switch (route.page) {
    case "root":
      return <SettingsRoot />;
    case "searchEngine":
      return <SearchEnginePage />;
    case "siteSettings":
      return <SiteSettingsPage />;
    case "filterLists":
      return <FilterListsPage />;
    case "filterList":
      return <FilterListDetailPage id={route.id} />;
    case "myFilters":
      return <MyFiltersPage />;
    case "trustedSites":
      return <TrustedSitesPage />;
    case "clearData":
      return <ClearDataPage />;
    case "sync":
      return <SyncPage />;
    case "defaultBrowser":
      return <DefaultBrowserPage />;
    case "syncConnect":
      return <SyncConnect onClose={popSettings} onConnected={popSettings} />;
    case "about":
      return <AboutPage />;
    case "licenses":
      return <LicensesPage />;
  }
}

export function SettingsView() {
  const open = useSettingsNav((s) => s.open);
  const stack = useSettingsNav((s) => s.stack);
  const popping = useSettingsNav((s) => s.popping);
  useEffect(() => {
    if (open) void refreshSettings();
  }, [open]);
  const shown = useRef<{ depth: number; route: SettingsRoute } | null>(null);
  if (open && stack.length) shown.current = { depth: stack.length, route: stack[stack.length - 1]! };
  const last = shown.current;
  if (!last) return null;
  return (
    <Animated.View
      key={`${last.depth}:${last.route.page}`}
      entering={last.depth === 1 || !open ? undefined : popping ? reveal : push}
      exiting={popping && open ? leave : undefined}
      style={StyleSheet.absoluteFill}
    >
      <Page route={last.route} />
    </Animated.View>
  );
}
