import { memo, useEffect, useMemo, useState, type RefObject } from "react";
import { Animated, Text, View } from "react-native";
import { radius, Symbol, weight } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { useSettings } from "../../state/browser/hooks";
import { isIncognitoProfile } from "../../state/browser/model";
import { newCapture } from "../../state/sidebar/listCapture";
import { useCanTidyPins, useCapturedSidebarEntries } from "../../state/sidebar/hooks";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { ClearDivider } from "./ClearDivider";
import { useDragController, useDragItem } from "./DragProvider";
import { type EntryMotion } from "./EntryMotion";
import { GroupBlock } from "./GroupBlock";
import { GhostSlot, ListMotionContext, useListMotion } from "./ListMotion";
import { LiveFolderBlock } from "./LiveFolderBlock";
import { PinnedGrid } from "./PinnedGrid";
import { LIVE, usePinnedSequence } from "../../state/sidebar/pinnedOrder";
import { SCROLL_EDGE } from "./ScrollEdge";
import { firstPaintEntriesNow, usePendingEntriesHeight } from "../../state/sidebar/geometry";
import { SplitRowItem, TabRowItem } from "./TabRow";
import { INCOGNITO_ICON } from "../ntp/IncognitoHeading";
import { ROW_PITCH, ROWS_PER_FRAME, type SidebarGeometry } from "./pageLayout";
import { NewTabRow } from "./NewTabRow";
import { CleanUpUpsell } from "./CleanUpUpsell";
import { SIDEBAR_TYPE, sidebarTokens } from "./tokens";

type PageRowsProps = {
  windowId: string;
  profileId: string;
  current: boolean;
  rows: number | undefined;
  lazy: boolean;
  offScreen: boolean;
  tiles: string[];
  innerWidth: number;
  inlineNewTab: boolean;
  controller: ReturnType<typeof useDragController>;
  geometry: RefObject<SidebarGeometry> | undefined;
  onListHeight: (height: number) => void;
};

export function PageRows({ windowId, profileId, current, rows, lazy, offScreen, tiles, innerWidth, inlineNewTab, controller, geometry, onListHeight }: PageRowsProps) {
  const [captured] = useState(newCapture);
  const { list: all } = useCapturedSidebarEntries(windowId, profileId, captured);
  const [mountedRows, setMountedRows] = useState(() => firstPaintEntriesNow(windowId, profileId, all, lazy));
  const [visited, setVisited] = useState(current);
  if (current && !visited) setVisited(true);
  const cap = offScreen ? 0 : visited ? undefined : rows;
  const growing = cap === undefined && mountedRows < all.length;
  useEffect(() => {
    if (!growing) return;
    const frame = requestAnimationFrame(() => setMountedRows((n) => (n + ROWS_PER_FRAME >= all.length ? Infinity : n + ROWS_PER_FRAME)));
    return () => cancelAnimationFrame(frame);
  }, [growing, mountedRows, all.length]);
  const limit = cap ?? (growing ? mountedRows : undefined);
  const list = limit === undefined ? all : all.slice(0, limit);
  const pending = usePendingEntriesHeight(windowId, profileId, all, mountedRows, growing);
  const showClear = useSettings((s) => s.showClearButton);
  const clearable = showClear && !offScreen && all.length > 0;
  const tidy = useCanTidyPins(windowId, profileId, offScreen);
  const divided = clearable || tidy;
  const pinned = usePinnedSequence(windowId, profileId, offScreen);
  const pinnedSection = pinned.length > 0;
  const newTabButtonAtTop = useSettings((s) => s.newTabButtonPosition === "top");
  const animated = current && !offScreen;
  const motion = useListMotion(windowId, profileId, all, captured, animated);
  const scope = useMemo(() => ({ enabled: animated, slideBelow: motion.slideBelow }), [animated, motion.slideBelow]);
  if (geometry) geometry.current.newTabAtTop = newTabButtonAtTop && inlineNewTab;
  return (
    <ListMotionContext.Provider value={scope}>
      <View
        onLayout={(e) => onListHeight(e.nativeEvent.layout.height + SCROLL_EDGE.inset - (inlineNewTab ? ROW_PITCH : 0))}
      >
        {isIncognitoProfile(profileId) ? <IncognitoBadge /> : null}
        {tiles.length ? <PinnedGrid tabs={tiles} innerWidth={innerWidth} flush /> : null}
        <View
          ref={(v) => {
            controller?.regions.set("pinnedGroups", v);
          }}
          onLayout={geometry ? (e) => void (geometry.current.regions.pinnedGroups = e.nativeEvent.layout.y) : undefined}
          style={{ marginTop: tiles.length ? 6 : 0, gap: layout.rowGap }}
        >
          {pinned.map((entry) => (
            <PinnedEntry key={entry} entry={entry} windowId={windowId} />
          ))}
          <Tail id="tail:pinnedGroups" section="pinnedGroups" />
        </View>
        {divided ? <ClearDivider windowId={windowId} profileId={profileId} spaced={pinnedSection} clear={clearable} tidy={tidy} /> : null}
        <View
          ref={(v) => {
            controller?.regions.set("list", v);
          }}
          onLayout={geometry ? (e) => void (geometry.current.regions.list = e.nativeEvent.layout.y) : undefined}
          style={{ marginTop: pinnedSection && !divided ? 7 : 0, gap: layout.rowGap }}
        >
          {newTabButtonAtTop && inlineNewTab ? <NewTabRow windowId={windowId} /> : null}
          {motion.fading
            ? motion.slots(list).map((slot) =>
                "ghost" in slot ? (
                  <GhostSlot key={slot.ghost.key} snapshot={slot.ghost.snapshot} top={slot.top} opacity={slot.ghost.opacity} />
                ) : (
                  <ListEntry key={slot.entry} entry={slot.entry} motion={motion.motion(slot.entry)} />
                ),
              )
            : list.map((entry) => <ListEntry key={entry} entry={entry} motion={motion.motion(entry)} />)}
          {pending ? <View style={{ height: pending }} /> : null}
          <Tail id="tail:list" section="list" />
          {!newTabButtonAtTop && inlineNewTab ? <NewTabRow windowId={windowId} shift={motion.tail} clip={motion.tailClip} /> : null}
        </View>
        {current ? <CleanUpUpsell windowId={windowId} shift={motion.tail} /> : null}
      </View>
    </ListMotionContext.Provider>
  );
}

const PinnedEntry = memo(function PinnedEntry({ entry, windowId }: { entry: string; windowId: string }) {
  const id = entry.slice(entry.indexOf(":") + 1);
  if (entry.startsWith(LIVE)) return <LiveFolderBlock folderId={id} windowId={windowId} />;
  if (entry.startsWith("g:")) return <GroupBlock groupId={id} section="pinnedGroups" />;
  if (entry.startsWith("s:")) return <SplitRowItem splitId={id} section="pinnedRows" />;
  return <TabRowItem tabId={id} section="pinnedRows" />;
});

const ListEntry = memo(function ListEntry({ entry, motion }: { entry: string; motion: EntryMotion | null }) {
  const id = entry.slice(2);
  if (entry.startsWith("g:")) return <GroupBlock groupId={id} section="list" motion={motion} />;
  if (entry.startsWith("s:")) return <SplitRowItem splitId={id} section="list" motion={motion} />;
  return <TabRowItem tabId={id} section="list" motion={motion} />;
});

const Tail = memo(function Tail({ id, section }: { id: string; section: "list" | "pinnedRows" | "pinnedGroups" }) {
  const { wrapper } = useDragItem(id, { kind: "tail", tabIds: [], section });
  return <Animated.View ref={wrapper.ref} style={wrapper.style} />;
});

function IncognitoBadge() {
  const theme = useTheme();
  if (!useAddressBarInSidebar()) return null;
  return (
    <View style={{ height: 30, marginBottom: 4, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: radius.l, backgroundColor: sidebarTokens(theme).incognitoBadge }}>
      <Symbol name={INCOGNITO_ICON} size={13} weight="semibold" color={theme.textPrimary} style={{ width: 18, height: 16 }} />
      <Text style={{ fontSize: SIDEBAR_TYPE.compact, fontWeight: weight.semibold, color: theme.textPrimary }}>Incognito</Text>
    </View>
  );
}
