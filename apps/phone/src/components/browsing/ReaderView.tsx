import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSystemBars } from "../../state/app/systemBars";
import { closeReader, readableContent, setReaderSerif, setReaderStep, setReaderTheme, type ReadableContent } from "../../state/page/actions";
import { useReaderSettings } from "../../state/page/hooks";
import {
  clampReaderStep,
  readerBodySize,
  readerSource,
  readerTheme,
  readingMinutes,
  type ReaderTheme,
} from "../../state/page/pagePrompts";
import { copy } from "../../lib/platformCopy";
import { font, Menu, readerInk, readerLayout, space, Symbol, tabsMotion, useTheme, type MenuItem } from "../ui";


const rise = SlideInDown.springify().stiffness(tabsMotion.sheetIn.stiffness).damping(tabsMotion.sheetIn.damping);
const fall = SlideOutDown.springify().stiffness(tabsMotion.sheetOut.stiffness).damping(tabsMotion.sheetOut.damping);

type Load = { kind: "loading" } | { kind: "failed" } | { kind: "loaded"; content: ReadableContent };

export function ReaderView({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === "dark";
  const settings = useReaderSettings();
  const shown = readerTheme(settings.theme, dark);
  const ink = readerInk[shown];
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [menu, setMenu] = useState(false);
  useSystemBars(shown === "dark");
  useEffect(() => {
    let live = true;
    void readableContent(tabId).then((content) => {
      if (live) setLoad(content && content.paragraphs.length ? { kind: "loaded", content } : { kind: "failed" });
    });
    return () => {
      live = false;
    };
  }, [tabId]);
  const size = readerBodySize(settings.step);
  const family = settings.serif ? copy().readerSerif.family : copy().readerSans.family;
  const items: MenuItem[] = [
    { label: "Smaller Text", onPress: () => setReaderStep(clampReaderStep(settings.step - 1)) },
    { label: "Larger Text", onPress: () => setReaderStep(clampReaderStep(settings.step + 1)) },
    "divider",
    { heading: "Font" },
    { label: copy().readerSerif.label, checked: settings.serif, onPress: () => setReaderSerif(true) },
    { label: copy().readerSans.label, checked: !settings.serif, onPress: () => setReaderSerif(false) },
    "divider",
    { heading: "Theme" },
    ...(["light", "sepia", "dark"] as ReaderTheme[]).map((option) => ({
      label: option === "light" ? "Light" : option === "sepia" ? "Sepia" : "Dark",
      checked: option === shown,
      onPress: () => setReaderTheme(option),
    })),
  ];
  return (
    <Animated.View entering={rise} exiting={fall} style={[StyleSheet.absoluteFill, { backgroundColor: ink.background, paddingTop: insets.top }]}>
      <View style={styles.top}>
        {load.kind === "loaded" ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Text Appearance" onPress={() => setMenu(true)} style={styles.topButton}>
            <Symbol name="textformatSize" size={22} color={theme.formAccent} />
          </Pressable>
        ) : null}
        <View style={styles.fill} />
        <Pressable accessibilityRole="button" onPress={closeReader} style={styles.topButton}>
          <Text style={[font.body, styles.bold, { color: theme.formAccent }]}>Done</Text>
        </Pressable>
      </View>
      {load.kind === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator accessibilityLabel="Loading Article" color={ink.secondary} />
        </View>
      ) : load.kind === "failed" ? (
        <View style={[styles.center, styles.gap]}>
          <Symbol name="docPlaintext" size={44} color={ink.secondary} />
          <Text style={[font.title3, styles.bold, { color: ink.ink }]}>No Article Found</Text>
        </View>
      ) : (
        <FlatList
          data={load.content.paragraphs}
          keyExtractor={(_, index) => String(index)}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.huge }}
          ListHeaderComponent={<Header content={load.content} family={family} size={size} ink={ink} />}
          renderItem={({ item }) => (
            <Text style={[styles.paragraph, { fontFamily: family, fontSize: size, lineHeight: size * readerLayout.lineHeight, marginBottom: size * readerLayout.paragraphGap, color: ink.ink }]}>
              {item}
            </Text>
          )}
        />
      )}
      <View style={[styles.navigationBand, { height: insets.bottom, backgroundColor: ink.background }]} pointerEvents="none" />
      {menu ? <Menu items={items} place={{ top: insets.top + readerLayout.topBar, left: space.s }} onDismiss={() => setMenu(false)} /> : null}
    </Animated.View>
  );
}

type Ink = (typeof readerInk)[ReaderTheme];

function Header({ content, family, size, ink }: { content: ReadableContent; family: string; size: number; ink: Ink }) {
  const source = readerSource(content.siteName, content.byline);
  const title = size * readerLayout.titleScale;
  return (
    <View style={[styles.header, { marginBottom: size * readerLayout.headerGap }]}>
      {source ? (
        <Text style={[font.subheadline, styles.medium, { color: ink.secondary }]} numberOfLines={2}>
          {source}
        </Text>
      ) : null}
      <Text accessibilityRole="header" style={{ fontFamily: family, fontWeight: "700", fontSize: title, lineHeight: title * readerLayout.titleLine, color: ink.ink }}>
        {content.title}
      </Text>
      <Text style={[font.subheadline, { color: ink.secondary }]}>{`${readingMinutes(content.wordCount)} min read`}</Text>
      {content.leadImage ? <LeadImage uri={content.leadImage} /> : null}
    </View>
  );
}

function LeadImage({ uri }: { uri: string }) {
  const [aspect, setAspect] = useState<number | null>(null);
  return (
    <Image
      source={{ uri }}
      accessibilityIgnoresInvertColors
      resizeMode="cover"
      onLoad={(event) => {
        const { width, height } = event.nativeEvent.source;
        if (width > 1 && height > 1) setAspect(Math.max(width / height, readerLayout.minLeadAspect));
      }}
      onError={() => setAspect(null)}
      style={aspect ? [styles.lead, { aspectRatio: aspect }] : styles.leadPending}
    />
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", minHeight: readerLayout.topBar, paddingHorizontal: space.s },
  topButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: space.s },
  fill: { flex: 1 },
  bold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  gap: { gap: space.m },
  header: { gap: space.s, paddingHorizontal: space.xl, paddingTop: space.s, maxWidth: readerLayout.maxWidth, alignSelf: "center", width: "100%" },
  paragraph: { paddingHorizontal: space.xl, maxWidth: readerLayout.maxWidth, alignSelf: "center", width: "100%" },
  lead: { width: "100%", marginTop: space.s },
  leadPending: { width: 1, height: 1, opacity: 0 },
  navigationBand: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
