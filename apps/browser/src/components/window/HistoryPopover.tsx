import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { useTab } from "../../state/browser/hooks";
import { openModeFor, openUrl } from "../../state/bookmarks/actions";
import { openInternalPage } from "../../state/pages/urls";
import { MenuRow, MenuSeparator, MouseArea, PANEL, Popover, POPOVER_MARGIN } from "../ui";
import { Favicon, NewTabIcon } from "../favicon/Favicon";
import { modifiersOf } from "../../lib/keys";
import { closeHistoryMenu, closeHistoryMenuOf, goToHistoryItem, historyFavicons, useHistoryMenu, type HistoryItem } from "../../state/tabs/navigation";

const FAVICON_X = PANEL.inset + (PANEL.iconSlot - 16) / 2;

export function HistoryPopover({ tabId, windowId, anchors }: { tabId: string; windowId: string; anchors: { back: number; forward: number } }) {
  const menu = useHistoryMenu((s) => (s.menu?.tabId === tabId ? s.menu : null));
  const profileId = useTab(tabId, (t) => t?.profileId ?? "");
  const favicons = useMemo(() => {
    if (!menu) return new Map<string, string | null>();
    return historyFavicons(profileId, menu.items);
  }, [menu, profileId]);
  useEffect(() => () => closeHistoryMenuOf(tabId), [tabId]);
  if (!menu) return null;

  const open = (item: HistoryItem, e: { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; middle?: boolean }) => {
    const mode = openModeFor(e);
    if (mode === "current" || mode === "split" || !item.url) {
      closeHistoryMenu();
      return void goToHistoryItem(tabId, item);
    }
    if (mode !== "background") closeHistoryMenu();
    openUrl(item.url, windowId, mode);
  };

  return (
    <Popover width="s" top={POPOVER_MARGIN} left={Math.max(POPOVER_MARGIN, (menu.direction < 0 ? anchors.back : anchors.forward) - FAVICON_X - 2)} onDismiss={closeHistoryMenu}>
      <View style={{ paddingVertical: PANEL.listPadding }}>
        {menu.items.map((item) => (
          <Row key={item.key} item={item} favicon={favicons.get(item.url) ?? null} onOpen={(e) => open(item, e)} />
        ))}
        <MenuSeparator />
        <MenuRow
          icon="clock"
          title="Show Full History"
          onPress={() => {
            closeHistoryMenu();
            openInternalPage("history", windowId);
          }}
        />
      </View>
    </Popover>
  );
}

function Row({
  item,
  favicon,
  onOpen,
}: {
  item: HistoryItem;
  favicon: string | null;
  onOpen: (e: { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; middle?: boolean }) => void;
}) {
  return (
    <MouseArea onMiddleClick={(e) => onOpen({ ...e, middle: true })}>
      <MenuRow
        leading={item.offset === "newTab" ? <NewTabIcon /> : <Favicon url={item.url} favicon={favicon} />}
        title={item.title}
        tooltip={item.url || undefined}
        onPress={(e) => onOpen(modifiersOf(e))}
      />
    </MouseArea>
  );
}
