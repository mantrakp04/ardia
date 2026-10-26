import { briefColors, briefMotion } from "./tokens";
import { useCallback, useState } from "react";
import { BriefRail } from "../ui";
import { BriefBadge } from "./BriefBadge";
import { BriefSourceLink } from "./BriefSourceLink";
import { BriefFooterIcon } from "./BriefFooterIcon";
import { useWindowId } from "../../state/browser/hooks";
import { registerBriefView } from "./devDriver";
import { briefEventTime, briefSummary, focusDisplayLinks, type BriefContent } from "../../lib/briefContent";
export type { BriefContent } from "../../lib/briefContent";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { briefArtworkForDate, briefDate } from "./assets";
import { localBriefDate } from "../../lib/briefDates";

type Props = { date?: string; onConfigure?: () => void; content?: BriefContent | null; loading?: boolean; error?: string | null; onGenerate?: () => void };

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function DailyBriefPage({ date, onConfigure, content, loading = false, error, onGenerate }: Props) {
  const windowId = useWindowId();
  const registerScroll = useCallback((view: ScrollView | null) => { if (__DEV__) registerBriefView(windowId, view); }, [windowId]);
  const [width, setWidth] = useState(1100);
  const day = briefDate(date);
  const artwork = briefArtworkForDate(localBriefDate(day));
  const wide = width >= 720;
  const rails = width >= 380;
  const railGutter = Math.max(50, Math.min(100, width * 0.13));
  const contentWidth = Math.min(1040, width - (rails ? railGutter * 2 : wide ? 80 : 40));
  const heroHeight = contentWidth * 0.507;
  const artworkScale = Math.max(contentWidth / artwork.width, heroHeight / artwork.height);
  const artworkWidth = artwork.width * artworkScale;
  const artworkHeight = artwork.height * artworkScale;
  const gutter = (width - contentWidth) / 2;
  const railWidth = Math.min(65, gutter - 12);
  const railInset = (gutter - railWidth) / 2;
  const railFontSize = Math.min(45, heroHeight / 10.8);
  const weekday = day.toLocaleDateString("en-US", { weekday: "long" });
  const dateLabel = `${day.getDate()} ${day.toLocaleDateString("en-US", { month: "short" }).toUpperCase()} ${day.getFullYear()}`;
  const titleSize = contentWidth / (weekday.length > 8 ? 8.75 : weekday.length > 6 ? 8 : 7);
  const configure = () => onConfigure?.();
  const summary = content ? briefSummary(content.summary) : undefined;

  const updates = content?.updates ?? [];
  const events = content?.events.map((event) => ({ ...event, display: briefEventTime(event) })) ?? [];

  return (
    <ScrollView ref={registerScroll} style={styles.root} contentContainerStyle={styles.scroll} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} testID="daily-brief-page">
      <View style={{ width, alignSelf: "center" }}>
        <View style={[styles.masthead, { width: contentWidth, alignSelf: "center" }]}>
          <Image source={require("../../../assets/briefs/ardia-mark.png")} style={styles.mastheadLogo} resizeMode="contain" accessibilityLabel="Ardia" />
        </View>
        <View style={{ width, height: heroHeight, justifyContent: "center", alignItems: "center" }}>
          <View style={{ position: "absolute", top: 0, left: gutter, width: contentWidth, height: heroHeight, overflow: "hidden" }}><Image source={artwork.source} style={{ position: "absolute", top: (heroHeight - artworkHeight) / 2, left: (contentWidth - artworkWidth) / 2, width: artworkWidth, height: artworkHeight }} resizeMode="cover" accessibilityLabel={`${artwork.title} by ${artwork.artist}`} /></View>
          <View pointerEvents="none" style={{ position: "absolute", top: 0, left: gutter, width: contentWidth, height: heroHeight, backgroundColor: briefColors.artShade }} />
          <Text style={[styles.heroThe, { fontSize: contentWidth / 18, lineHeight: contentWidth / 15 }]}>The</Text>
          <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.heroTitle, { fontSize: titleSize, lineHeight: titleSize * 1.2, width: contentWidth * 0.98 }]}>{weekday} Brief</Text>
          {rails && <>
            <BriefRail text={dateLabel} fontSize={railFontSize} style={{ position: "absolute", top: 0, left: railInset, width: railWidth, height: heroHeight }} />
            <BriefRail text="A fresh perspective" clockwise fontSize={railFontSize} style={{ position: "absolute", top: 0, right: railInset, width: railWidth, height: heroHeight }} />
          </>}
        </View>
        <View style={{ width: contentWidth, alignSelf: "center" }}>
        <View style={styles.captionRow}>
          <Text style={styles.caption}>{summary ?? "A little perspective. A clearer day. A brief made for you."}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.artCredit, { width: Math.min(contentWidth * 0.55, `${artwork.title}, ${artwork.artist}, ${artwork.year}`.length * 4.9) }]}>{artwork.title}, {artwork.artist}, {artwork.year}</Text>
        </View>
        {onGenerate && <View style={styles.generateRow}><Pressable accessibilityRole="button" disabled={loading} onPress={onGenerate} style={({ pressed }) => [styles.generateButton, { opacity: loading || pressed ? 0.5 : 1 }]}><Text style={styles.setupButtonText}>{loading ? "Preparing your brief…" : content ? "Refresh brief →" : "Generate brief →"}</Text></Pressable></View>}
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <View style={styles.featureWrap}>
        <View style={[styles.feature, { flexDirection: wide ? "row" : "column" }]}>
          <View style={wide ? styles.leftColumn : { marginBottom: 22 }}>
            <SectionTitle>Push your work forward</SectionTitle>
          </View>
          <View style={styles.rightColumn}>
            <Text style={styles.itemTitle}>{content?.focus.title ?? "Your day, brought together"}</Text>
            <Text style={styles.body}>{content?.focus.body ?? "Choose a provider and connect the sources you want to include. Your brief will bring together the work that needs your attention, the updates worth knowing, and the shape of your day."}</Text>
            {!content && <Pressable accessibilityRole="button" onPress={configure} style={styles.setupButton}><Text style={styles.setupButtonText}>Set up daily briefs →</Text></Pressable>}
          </View>
        </View>
        <View style={{ position: "absolute", left: 21, bottom: -26, zIndex: 20 }}>
          <BriefBadge title={content ? "Let's\ndo it →" : "Make it\nyours →"} links={content ? focusDisplayLinks(content.focus) : undefined} maxWidth={Math.min(360, width - 24)} popupBounds={{ left: 12 - gutter - 21, right: width - 12 - gutter - 21 }} onPress={content ? undefined : configure} />
        </View>
        </View>
        <View style={[styles.section, { flexDirection: wide ? "row" : "column" }]}>
          <View style={wide ? styles.leftColumn : styles.stackedTitle}><SectionTitle>Top to-dos</SectionTitle></View>
          <View style={styles.rightColumn}>
            {content ? <TodoItems items={content.todos} /> : <><Text style={styles.itemTitle}>Room for what matters</Text><Text style={styles.body}>Action items from your connected sources will appear here. Nothing is read until you give permission.</Text></>}
          </View>
        </View>
        <View style={[styles.section, { marginTop: 62 }]}>
          <SectionTitle>New updates</SectionTitle>
          {updates.map((item, index) => <View key={index} style={{ flexDirection: "row", marginTop: index === 0 ? 28 : 34 }}>
            <View style={wide ? styles.leftColumn : { width: 35 }}><Text style={[styles.number, { marginTop: 2 }]}>{String(index + 1).padStart(2, "0")}</Text></View>
            <View style={styles.rightColumn}>
              <Text style={styles.itemTitle}>{item.title}{item.source?.project ? <Text style={styles.project}>  {item.source.project}</Text> : null}</Text>
              <Text style={styles.body}>{item.body}{item.source && <> <BriefSourceLink source={item.source} /></>}</Text>
            </View>
          </View>)}
          {content && !content.updates.length && <Text style={[styles.body, { marginTop: 28 }]}>Nothing new needs your attention.</Text>}
          {!content && <Text style={[styles.body, { marginTop: 28 }]}>The important updates from Gmail and GitHub will be gathered into one calm place.</Text>}
        </View>
        {!!events.length && <View style={[styles.section, { flexDirection: wide ? "row" : "column", marginTop: 65, minHeight: 240 }]}>
          <View style={wide ? styles.leftColumn : styles.stackedTitle}><SectionTitle>Your day</SectionTitle>{events.map((event, i) => <View key={i} style={styles.calendarEvent}><Text style={styles.eventTime}>{event.display.start}</Text><Text style={styles.eventName}>{event.title}</Text></View>)}</View>
          <View style={styles.rightColumn}>{events.map((event, i) => <View key={i} style={{ marginTop: i === 0 && wide ? 48 : 24 }}><Text style={styles.itemTitle}>{event.title} — {event.display.range}</Text><Text style={styles.body}>{event.display.body}</Text></View>)}</View>
        </View>}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Made for you by <Image source={require("../../../assets/briefs/ardia-mark.png")} style={{ width: 22, height: 22 }} resizeMode="contain" /><Text style={styles.footerName}> Ardia</Text> using <Text style={{ fontStyle: "italic" }}>your</Text> <BriefFooterIcon service="github" /><Text style={styles.footerName}>{"\u00a0"}GitHub</Text>, <BriefFooterIcon service="gmail" /><Text style={styles.footerName}>{"\u00a0"}Gmail</Text>, and <BriefFooterIcon service="calendar" /><Text style={styles.footerName}>{"\u00a0"}Google Calendar</Text>.</Text>
          <Text style={styles.footerSmall}>Your sources, with your permission.</Text>
        </View>
        </View>
      </View>
    </ScrollView>
  );
}

function TodoItems({ items }: { items: BriefContent["todos"] }) {
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  if (!items.length) return <Text style={styles.body}>Nothing urgent. Make room for your own priorities.</Text>;
  return <>{items.map((item) => {
    const identity = JSON.stringify([item.title, item.body, item.source?.url]);
    return <View key={identity} style={{ flexDirection: "row", gap: 14, marginBottom: 22 }}>
    <Pressable accessibilityRole="checkbox" accessibilityLabel={item.title} accessibilityState={{ checked: completed.has(identity) }} onPress={() => setCompleted((previous) => { const next = new Set(previous); if (next.has(identity)) next.delete(identity); else next.add(identity); return next; })} style={{ width: 17, height: 17, borderRadius: 9, borderWidth: 1, borderColor: completed.has(identity) ? briefColors.accent : briefColors.checkboxBorder, backgroundColor: completed.has(identity) ? briefColors.accent : "transparent", marginTop: 3, justifyContent: "center", alignItems: "center" }}>{completed.has(identity) && <Text style={styles.checkmark}>✓</Text>}</Pressable>
    <View style={{ flex: 1 }}><Text style={[styles.itemTitle, completed.has(identity) && { textDecorationLine: "line-through", color: briefColors.completed }]}>{item.title}</Text><Text style={styles.body}>{item.body}{item.source && <> <BriefSourceLink source={item.source} /></>}</Text></View>
  </View>;
  })}</>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: briefColors.background },
  scroll: { paddingTop: 20, paddingBottom: 50 },
  masthead: { height: 37, alignItems: "center", justifyContent: "flex-start" },
  mastheadLogo: { width: 26, height: 26 },
  heroThe: { color: briefColors.accent, fontFamily: "Georgia", fontStyle: "italic", fontWeight: "700", marginBottom: -4, transform: [{ translateY: 7 }] },
  heroTitle: { color: briefColors.accent, fontFamily: "Georgia", fontWeight: "700", textAlign: "center", letterSpacing: -4 },
  captionRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 10, gap: 20 },
  caption: { color: briefColors.caption, fontFamily: "Georgia", fontStyle: "italic", fontSize: 13, flex: 1 },
  artCredit: { color: briefColors.credit, fontFamily: "Menlo", fontSize: 8, textAlign: "right", flexShrink: 0 },
  featureWrap: { position: "relative", zIndex: 10, marginTop: 43, marginBottom: 20 },
  feature: { backgroundColor: briefColors.card, borderRadius: 11, paddingHorizontal: 28, paddingTop: 30, paddingBottom: 66, minHeight: 224 },
  leftColumn: { width: "42%", paddingRight: 28 },
  rightColumn: { flex: 1 },
  sectionTitle: { color: briefColors.heading, fontFamily: "Georgia", fontStyle: "italic", fontSize: 23, lineHeight: 31 },
  itemTitle: { color: briefColors.title, fontSize: 16, fontWeight: "600", lineHeight: 24 },
  body: { color: briefColors.body, fontSize: 15, lineHeight: 28, marginTop: 7 },
  section: { marginHorizontal: 22, marginTop: 64 },
  stackedTitle: { marginBottom: 20 },
  checkmark: { fontSize: 12, color: briefColors.background },
  number: { color: briefColors.number, fontFamily: "Georgia", fontSize: 13, marginTop: 24 },
  project: { color: briefColors.project, fontFamily: "Georgia", fontStyle: "italic", fontWeight: "400", fontSize: 14 },
  calendarEvent: { marginTop: 20, marginLeft: -7, marginRight: -14, backgroundColor: briefColors.event, borderRadius: 5, paddingHorizontal: 9, paddingVertical: 10, flexDirection: "row", alignItems: "baseline", gap: 12 },
  eventTime: { width: 56, flexShrink: 0, fontFamily: "Menlo", fontSize: 11.5, lineHeight: 22, color: briefColors.body },
  eventName: { flex: 1, minWidth: 0, color: briefColors.title, fontSize: 15, lineHeight: 22, fontWeight: "600" },
  footer: { marginTop: 70, alignItems: "center", gap: 20, paddingHorizontal: 10 },
  footerText: { color: briefColors.footer, fontFamily: "Georgia", fontSize: 20, textAlign: "center", lineHeight: 30 },
  footerName: { color: briefColors.foreground },
  footerSmall: { color: briefColors.footerSmall, fontFamily: "Georgia", fontSize: 13 },
  setupButton: { alignSelf: "flex-start", marginTop: 20, borderBottomWidth: 1, borderBottomColor: briefColors.accent, paddingBottom: 3 },
  setupButtonText: { color: briefColors.accent, fontSize: 14 },
  generateRow: { alignItems: "flex-end", marginTop: 18, marginBottom: -22 },
  generateButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: briefColors.buttonBorder },
  error: { color: briefColors.error, fontSize: 13, lineHeight: 21, marginTop: 30 },
});
