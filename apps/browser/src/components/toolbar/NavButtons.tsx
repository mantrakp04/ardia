import { memo } from "react";
import type { ViewStyle } from "react-native";
import { webviews } from "../../state/tabs/webviewHandles";
import { withLivePage } from "../../state/tabs/livePage";
import { newTab } from "../../state/tabs/actions";
import type { Tab } from "../../state/browser/types";
import { Button, MouseArea, type ButtonHit } from "../ui";
import type { ClickModifiers } from "../../lib/keys";
import { closeHistoryMenu, goBack, goForward, historyItems, toggleHistoryMenu } from "../../state/tabs/navigation";
import { openModeFor, openUrl } from "../../state/bookmarks/actions";
import type { ToolbarPalette } from "../ui/toolbarColors";
import { useShortcutHint, withShortcut } from "../../state/commands/commandShortcuts";
import { GLYPH } from "./tokens";
import { showReloadMenu } from "../../state/site/reloadMenu";

export const ReloadButton = memo(function ReloadButton({
  tab,
  loading,
  palette,
  style,
  hit,
  onFocus,
}: {
  tab: Pick<Tab, "id" | "url" | "windowId">;
  loading: boolean;
  palette: ToolbarPalette;
  style?: ViewStyle;
  hit?: ButtonHit;
  onFocus: () => void;
}) {
  const web = () => webviews.get(tab.id);
  const reloadHint = useShortcutHint("reload");
  return (
    <Button variant="icon" toolbar
      style={style}
      palette={palette}
      icon={loading ? "xmark" : "arrow.clockwise"}
      size={GLYPH}
      hit={hit}
      disabled={!tab.url}
      onPress={(m) => {
        onFocus();
        if (loading) return void web()?.stopLoading();
        if (m.metaKey) return void newTab(tab.windowId, { url: tab.url, background: true, openerId: tab.id });
        void withLivePage(tab.id, (page) => (m.shiftKey ? page.forceReload() : page.reload()));
      }}
      onContextMenu={() => {
        onFocus();
        void showReloadMenu(tab.id);
      }}
      tooltip={loading ? "Stop Loading This Page" : withShortcut("Refresh", reloadHint)}
    />
  );
});

export const HistoryButton = memo(function HistoryButton({
  tabId,
  windowId,
  direction,
  disabled,
  palette,
  style,
  hit,
  onFocus,
}: {
  tabId: string;
  windowId: string;
  direction: -1 | 1;
  disabled: boolean;
  palette: ToolbarPalette;
  style?: object;
  hit?: ButtonHit;
  onFocus: () => void;
}) {
  const historyHint = useShortcutHint(direction < 0 ? "back" : "forward");
  const openMenu = () => {
    onFocus();
    toggleHistoryMenu(tabId, direction);
  };
  const onPress = async (m: ClickModifiers & { middle?: boolean }) => {
    onFocus();
    closeHistoryMenu();
    const mode = openModeFor(m);
    if (mode === "current" || mode === "split") return direction < 0 ? goBack(tabId) : goForward(tabId);
    const [target] = await historyItems(tabId, direction, 1);
    if (target?.url) openUrl(target.url, windowId, mode);
  };
  return (
    <MouseArea style={style} onMiddleClick={(e) => !disabled && void onPress({ ...e, middle: true })}>
      <Button variant="icon" toolbar
        palette={palette}
        icon={direction < 0 ? "chevron.left" : "chevron.right"}
        size={GLYPH}
        hit={hit}
        disabled={disabled}
        onPress={onPress}
        onLongPress={openMenu}
        onContextMenu={openMenu}
        tooltip={withShortcut(direction < 0 ? "Go Back" : "Go Forward", historyHint)}
      />
    </MouseArea>
  );
});
