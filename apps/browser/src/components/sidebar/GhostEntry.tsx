import { tabTitle } from "../../state/browser/model";
import { memo, useMemo } from "react";
import { Animated, Image, View } from "react-native";
import { useAnimatedStyle } from "./EntryMotion";
import { knownFaviconTheme, resolveFavicon } from "../../state/favicons/favicons";
import { Divider, FadeLabel, radius, Symbol, Text, withAlpha } from "../ui";
import { useTheme } from "../ui/theme";
import type { BrowserState } from "../../state/browser/store";
import type { GroupColor } from "../../state/browser/types";
import { groupLabel } from "../../state/pins/tabGrouping";
import { splitRowPanes } from "../../state/splits/splits";
import { isSilenced } from "../../state/tabs/mute";
import { groupEntries, keptEntries } from "../../state/sidebar/entries";
import { groupMembersPadBottom } from "./geometry";
import { useSidebarScale, type SidebarScale } from "./scale";
import { headGap } from "../../state/sidebar/geometry";
import { pointerOnGroup, pointerOnRow } from "../../state/sidebar/hover";
import { FaviconFallback, NewTabIcon } from "../favicon/Favicon";
import { TabIcon } from "./TabIcon";
import { iconSymbol } from "../../lib/customIcon";
import { groupBoxAtRest, groupSurface, TABULAR_NUMS, useSidebarTokens } from "./tokens";
import { SidebarRowLabel } from "./SidebarRow";
import { entryKey, parseEntry } from "../../state/sidebar/entryKey";

type TabShot = { kind: "tab"; key: string; title: string; url: string; favicon?: string | null; icon?: string | null; profileId: string; uri: string | null; template: boolean; sound: "muted" | "playing" | null; hovered: boolean };
type SplitShot = { kind: "split"; key: string; panes: TabShot[] };
type GroupShot = {
  kind: "group";
  key: string;
  label: string;
  color: GroupColor | null;
  icon: { url: string; favicon?: string | null; icon?: string | null; profileId?: string } | null;
  collapsed: boolean;
  hovered: boolean;
  members: (TabShot | SplitShot | GroupShot)[];
};
export type EntrySnapshot = TabShot | SplitShot | GroupShot;

function tabShot(s: BrowserState, tabId: string, hovered: boolean): TabShot | null {
  const tab = s.tabs[tabId];
  if (!tab) return null;
  const uri = tab.customIcon ? null : (resolveFavicon(tab.url, tab.favicon, tab.profileId)?.uri ?? null);
  const shape = uri ? knownFaviconTheme(uri) : null;
  return {
    uri,
    template: shape?.kind === "template" && !!shape.stroke,
    kind: "tab",
    key: entryKey("tab", tabId),
    title: tabTitle(tab),
    url: tab.url,
    favicon: tab.favicon,
    icon: tab.customIcon,
    profileId: tab.profileId,
    sound: isSilenced(s, tab) ? "muted" : s.live[tabId]?.playingAudio ? "playing" : null,
    hovered,
  };
}

function splitShot(s: BrowserState, splitId: string): SplitShot {
  const panes = splitRowPanes(s, s.splits[splitId]);
  return { kind: "split", key: entryKey("split", splitId), panes: panes.flatMap((id) => tabShot(s, id, false) ?? []) };
}

export function snapshotEntry(s: BrowserState, windowId: string, profileId: string, entry: string): EntrySnapshot | null {
  const { kind, id } = parseEntry(entry);
  if (kind === "split") return splitShot(s, id);
  if (kind !== "group") return tabShot(s, id, pointerOnRow(id));
  const group = s.groups[id];
  if (!group) return null;
  const members = group.collapsed ? keptEntries(s, windowId, profileId, id) : groupEntries(s, id);
  const first = s.tabs[group.tabIds[0] ?? ""];
  return {
    kind: "group",
    key: entry,
    label: groupLabel(s, group),
    color: group.color ?? null,
    icon: group.icon || first ? { url: first?.url ?? "", favicon: first?.favicon, icon: group.icon ?? first?.customIcon, profileId: first?.profileId } : null,
    collapsed: !!group.collapsed,
    hovered: pointerOnGroup(id),
    members: members.flatMap((e) => (parseEntry(e).kind === "tab" ? tabShot(s, parseEntry(e).id, false) : snapshotEntry(s, windowId, profileId, e)) ?? []),
  };
}

const GHOST_GLYPH = { icon: 13, sound: 12, soundWidth: 18, close: 10, chevron: 9, chevronBox: 10, splitDivider: 16, splitInset: 6 } as const;

function ghostEntry(snapshot: EntrySnapshot, theme: ReturnType<typeof useTheme>, top: number, m: SidebarScale) {
  if (snapshot.kind === "tab") return tabGhost(snapshot, theme, m, top);
  return <View style={{ marginTop: top }}>{snapshot.kind === "split" ? <SplitGhost shot={snapshot} /> : <GroupGhost shot={snapshot} />}</View>;
}

function ghostIcon(shot: TabShot, theme: ReturnType<typeof useTheme>, m: SidebarScale) {
  const symbol = iconSymbol(shot.icon);
  if (symbol) return <Symbol name={symbol} size={m.px(GHOST_GLYPH.icon)} weight="medium" color={theme.icon} style={{ width: m.icon, height: m.icon }} />;
  if (shot.icon) return <TabIcon url={shot.url} icon={shot.icon} profileId={shot.profileId} size={m.icon} />;
  if (shot.uri) return <Image source={{ uri: shot.uri }} style={{ width: m.icon, height: m.icon, borderRadius: radius.hair, tintColor: shot.template && !theme.dark ? theme.textPrimary : undefined }} />;
  return shot.url ? <FaviconFallback url={shot.url} size={m.icon} /> : <NewTabIcon size={m.icon} />;
}

function tabGhost(shot: TabShot, theme: ReturnType<typeof useTheme>, m: SidebarScale, top = 0) {
  return (
    <View
      key={shot.key}
      style={{
        marginTop: top,
        height: m.rowHeight,
        borderRadius: m.radius.chrome,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: m.tabRow.contentLeft,
        paddingRight: shot.hovered ? m.tabRow.trailing : m.tabRow.trailing + m.tabRow.closeSlot,
        backgroundColor: shot.hovered ? theme.tabHover : undefined,
      }}
    >
      {ghostIcon(shot, theme, m)}
      {shot.sound ? (
        <Symbol name={shot.sound === "muted" ? "speaker.slash" : "speaker.wave.2"} size={m.px(GHOST_GLYPH.sound)} color={theme.textTab} style={{ width: m.px(GHOST_GLYPH.soundWidth), height: m.icon, marginLeft: m.space.s }} />
      ) : null}
      <SidebarRowLabel text={shot.title} color={theme.textTab} />
      {shot.hovered ? <Symbol name="xmark" size={m.px(GHOST_GLYPH.close)} weight="semibold" color={theme.icon} style={{ width: m.tabRow.closeSlot, height: m.tabRow.closeSlot }} /> : null}
    </View>
  );
}

function SplitGhost({ shot }: { shot: SplitShot }) {
  const theme = useTheme();
  const m = useSidebarScale();
  return (
    <View style={{ height: m.rowHeight, borderRadius: m.radius.chrome, flexDirection: "row", alignItems: "center", paddingHorizontal: m.space.xs }}>
      {shot.panes.map((pane, i) => (
        <View key={pane.key} style={{ flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0, gap: m.space.xxs }}>
          {i > 0 && <Divider vertical thick length={m.px(GHOST_GLYPH.splitDivider)} />}
          <View style={{ flex: 1, minWidth: 0, height: m.rowHeight - m.px(GHOST_GLYPH.splitInset), flexDirection: "row", alignItems: "center", paddingLeft: m.space.s }}>
            <TabIcon url={pane.url} favicon={pane.favicon} icon={pane.icon} profileId={pane.profileId} size={m.compactIcon} />
            <FadeLabel text={pane.title} fontSize={m.font.small} color={theme.textTab} style={{ flex: 1, height: m.icon, marginLeft: m.space.xs }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const MEASURE_LABEL = { opacity: 0, fontVariant: TABULAR_NUMS } as const;

function GroupGhost({ shot }: { shot: GroupShot }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const m = useSidebarScale();
  const { fill, stroke } = groupSurface(shot.color, tokens);
  const chevron = m.px(GHOST_GLYPH.chevronBox);
  return (
    <View style={{ paddingVertical: m.group.border }}>
      {shot.hovered || groupBoxAtRest(shot.color) ? (
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: m.group.radius, backgroundColor: fill, borderWidth: m.group.border, borderColor: stroke }} />
      ) : null}
      <View style={{ height: m.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: m.tabRow.contentLeft, paddingRight: m.tabRow.trailing }}>
        {shot.icon ? <TabIcon url={shot.icon.url} favicon={shot.icon.favicon} icon={shot.icon.icon} profileId={shot.icon.profileId} size={m.icon} /> : <View style={{ width: m.icon }} />}
        <View style={{ flexShrink: 1, height: m.tabRow.titleHeight, marginLeft: m.tabRow.titleGap, paddingRight: m.space.m, justifyContent: "center" }}>
          <Text lines={1} weight="medium" style={[MEASURE_LABEL, { fontSize: m.font.body }]}>
            {shot.label}
          </Text>
          <FadeLabel text={shot.label} fontSize={m.font.body} weight="medium" color={tokens.groupTitle} style={{ position: "absolute", left: 0, right: 0, top: 0, height: m.tabRow.titleHeight }} />
        </View>
        <View style={{ width: chevron, height: chevron, transform: [{ rotate: shot.collapsed ? "-90deg" : "0deg" }] }}>
          <Symbol name="chevron.down" size={m.px(GHOST_GLYPH.chevron)} weight="semibold" color={withAlpha(tokens.groupTitle, 0.5)} style={{ width: chevron, height: chevron }} />
        </View>
      </View>
      <View
        style={{
          gap: m.rowGap,
          paddingTop: headGap(shot.members[0]?.key, m.rowGap),
          paddingBottom: groupMembersPadBottom(shot.members.length, m.group.membersPadBottom),
          paddingLeft: m.group.indent,
          paddingRight: m.group.inset,
        }}
      >
        {shot.members.map((member) => (member.kind === "split" ? <SplitGhost key={member.key} shot={member} /> : member.kind === "group" ? <GroupGhost key={member.key} shot={member} /> : tabGhost(member, theme, m)))}
      </View>
    </View>
  );
}

export const GhostSlot = memo(function GhostSlot({ snapshot, top, opacity }: { snapshot: EntrySnapshot; top: number; opacity: Animated.Value }) {
  const style = useMemo(() => ({ opacity }), [opacity]);
  const [fade, ref] = useAnimatedStyle(style);
  const theme = useTheme();
  const m = useSidebarScale();
  return (
    <View pointerEvents="none" {...fade} ref={ref} style={[{ height: 0, marginBottom: -m.rowGap }, fade.style as object]}>
      {ghostEntry(snapshot, theme, top, m)}
    </View>
  );
});
