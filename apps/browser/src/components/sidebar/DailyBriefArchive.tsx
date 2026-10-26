import { briefArchiveColors } from "./tokens";
import { Symbol, GlassFill } from "../ui";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { briefArtworkForDate, briefTitleForDate } from "../briefs/assets";
import { localBriefDate, parseBriefDate } from "../../lib/briefDates";
import { listDailyBriefDates, openDailyBrief } from "../../state/briefs/dailyBriefs";
import { useTheme } from "../ui/theme";
import { useWindow } from "../../state/browser/hooks";
import { isIncognitoProfile } from "../../state/browser/model";
import { setSidebarUi, useSidebarUi } from "../../state/sidebar/sidebarUi";

export function DailyBriefArchive({ windowId, windowWidth, windowHeight }: { windowId: string; windowWidth: number; windowHeight: number }) {
  const open = useSidebarUi((s) => s.briefArchive === windowId);
  const available = useWindow(windowId, (window) => !!window && !window.incognito && window.kind !== "small" && !isIncognitoProfile(window.profileId));
  useEffect(() => {
    if (open && !available) setSidebarUi({ briefArchive: null });
  }, [open, available]);
  return open && available ? <ArchivePanel windowId={windowId} windowWidth={windowWidth} windowHeight={windowHeight} /> : null;
}

function ArchivePanel({ windowId, windowWidth, windowHeight }: { windowId: string; windowWidth: number; windowHeight: number }) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const profileId = useWindow(windowId, (w) => w?.profileId ?? "");
  const today = localBriefDate();
  const dates = useMemo(() => [today, ...listDailyBriefDates(profileId).filter((date) => date !== today)], [profileId, today]);
  const shown = dates.filter((date) => briefTitleForDate(date).toLowerCase().includes(query.trim().toLowerCase()));
  const close = () => setSidebarUi({ briefArchive: null });
  const choose = (date: string) => {
    close();
    openDailyBrief(windowId, date);
  };
  const width = Math.min(350, windowWidth - 24);
  const height = Math.min(500, Math.max(180, 78 + dates.length * 88), windowHeight - 24);
  const left = Math.max(12, Math.min(48, windowWidth - width - 12));
  return <>
    <Pressable onPress={close} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
    <View style={{ position: "absolute", left, bottom: 12, width, height, borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: theme.popoverBorder, backgroundColor: theme.popoverFill }}>
      <GlassFill radius={24} fill={theme.popoverFill} />
      <View style={{ height: 54, flexDirection: "row", alignItems: "center", paddingHorizontal: 18, gap: 11, borderBottomWidth: 1, borderBottomColor: theme.divider }}>
        <Symbol name="magnifyingglass" size={16} color={theme.textSecondary} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search briefs" placeholderTextColor={theme.textSecondary} selectionColor={theme.selection} enableFocusRing={false} style={{ flex: 1, color: theme.textPrimary, fontSize: 16 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Close brief archive" onPress={close}><Symbol name="xmark" size={16} color={theme.textSecondary} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 13, paddingTop: 10, paddingBottom: 14 }}>
        {shown.length ? shown.map((date) => <ArchiveRow key={date} date={date} onPress={() => choose(date)} />) : <View style={{ alignItems: "center", paddingVertical: 65, gap: 14 }}><Symbol name="doc.text" size={27} color={theme.textSecondary} /><Text style={{ color: theme.textSecondary, fontSize: 14 }}>No matching briefs</Text></View>}
      </ScrollView>
    </View>
  </>;
}

function ArchiveRow({ date, onPress }: { date: string; onPress(): void }) {
  const theme = useTheme();
  const day = parseBriefDate(date)!;
  const today = localBriefDate();
  const label = date === today ? "Today" : day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return <Pressable accessibilityRole="button" accessibilityLabel={briefTitleForDate(date)} onPress={onPress} style={({ pressed }) => ({ minHeight: 88, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: pressed ? theme.tabHover : undefined })}>
    <View style={{ width: 55, height: 64, borderRadius: 5, overflow: "hidden", backgroundColor: briefArchiveColors.paper }}><Image source={briefArtworkForDate(date).source} style={{ width: 55, height: 43 }} resizeMode="cover" /><Text numberOfLines={1} style={{ color: briefArchiveColors.title, fontFamily: "Georgia", fontWeight: "700", fontSize: 5, textAlign: "center", marginTop: 4 }}>{briefTitleForDate(date)}</Text></View>
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text numberOfLines={1} style={{ color: theme.textPrimary, fontSize: 15, fontWeight: "600" }}>{briefTitleForDate(date)}</Text><Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: 12 }}>{label}</Text></View>
  </Pressable>;
}
