import { showMenu } from "@ardia/shell";
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { withLivePage } from "../../lib/livePage";
import { webviews } from "../../lib/webviews";
import { ToolbarButton } from "../layout/controls";
import type { ToolbarPalette } from "../layout/toolbarColors";
import { developerReloadFor, setDeveloperReload } from "./developerMode";

const PANELS = [
  { panel: "console", icon: "terminal", tooltip: "Toggle Console" },
  { panel: "network", icon: "network", tooltip: "Toggle Network Panel" },
  { panel: "elements", icon: "scope", tooltip: "Inspect Element" },
] as const;

export const DeveloperButtons = memo(function DeveloperButtons({ tabId, palette, onFocus }: { tabId: string; palette: ToolbarPalette; onFocus: () => void }) {
  const divider = <View style={{ width: StyleSheet.hairlineWidth * 2, height: 16, marginHorizontal: 5, backgroundColor: palette.divider }} />;
  return (
    <>
      {divider}
      {PANELS.map(({ panel, icon, tooltip }) => (
        <ToolbarButton
          key={panel}
          palette={palette}
          icon={icon}
          size={13}
          box={24}
          radius={6}
          onPress={() => {
            onFocus();
            void webviews.get(tabId)?.showDevTools(`toggle:${panel}`);
          }}
          tooltip={tooltip}
        />
      ))}
      {divider}
    </>
  );
});

export function developerReload(tabId: string) {
  const force = developerReloadFor(tabId) === "forceReload";
  void withLivePage(tabId, (page) => (force ? page.forceReload() : page.reload()));
}

export async function showDeveloperReloadMenu(tabId: string) {
  const current = developerReloadFor(tabId);
  const choice = await showMenu([
    { id: "reload", title: "Refresh page", checked: current === "reload" },
    { id: "forceReload", title: "Refresh (Ignore Cache)", checked: current === "forceReload" },
    { id: "clearCookies", title: "Clear Cookies and Refresh" },
  ]);
  if (choice) await runDeveloperReloadChoice(tabId, choice);
}

export async function runDeveloperReloadChoice(tabId: string, choice: string) {
  if (choice === "reload" || choice === "forceReload") {
    setDeveloperReload(tabId, choice);
    return developerReload(tabId);
  }
  if (choice !== "clearCookies") return;
  await webviews.get(tabId)?.clearSiteData();
  void withLivePage(tabId, (page) => page.reload());
}
