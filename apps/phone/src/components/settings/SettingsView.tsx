import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, { SlideInDown, SlideInLeft, SlideInRight, SlideOutDown, SlideOutRight } from "react-native-reanimated";
import { refreshSettings } from "../../state/settings/actions";
import { useSettingsNav, type SettingsRoute } from "../../state/settings/hooks";
import { tabsMotion } from "../ui";
import { FilterListDetailPage, FilterListsPage, MyFiltersPage, TrustedSitesPage } from "./BlockingPages";
import { AboutPage, ClearDataPage, LicensesPage } from "./DataPages";
import { SettingsRoot } from "./SettingsRoot";
import { SearchEnginePage, SiteSettingsPage } from "./SitePages";

const rise = SlideInDown.springify().stiffness(tabsMotion.sheetIn.stiffness).damping(tabsMotion.sheetIn.damping);
const fall = SlideOutDown.springify().stiffness(tabsMotion.sheetOut.stiffness).damping(tabsMotion.sheetOut.damping);
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
  if (!open || !stack.length) return null;
  const depth = stack.length;
  const top = stack[depth - 1]!;
  return (
    <Animated.View entering={rise} exiting={fall} style={StyleSheet.absoluteFill}>
      <Animated.View key={`${depth}:${top.page}`} entering={depth === 1 ? undefined : popping ? reveal : push} exiting={popping ? leave : undefined} style={StyleSheet.absoluteFill}>
        <Page route={top} />
      </Animated.View>
    </Animated.View>
  );
}
