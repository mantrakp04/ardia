import {
  WindowBackdrop,
  Box,
  Button,
  curve,
  duration,
  hairline,
  hex,
  ink,
  radius as radii,
  space,
  spring,
  Surface,
  Symbol,
  Text,
  useHover,
  useTheme,
  VisualEffect,
} from "../ui";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { profileAccent } from "../ui/theme";
import { useWindowProfileValue } from "../../state/profiles/hooks";
import { useWindowId } from "../../state/browser/hooks";
import type { ReleaseNotes } from "../../state/releaseNotes/releaseNotes";
import { ntpType, postcard, useNtpColors } from "./tokens";

const ICON = require("../../../assets/app-icon.png");

const CARD = { width: 320, height: 200, overhangRight: 40, overhangTop: 30, tilt: 2, radius: radii.card };
const HOVER_SLOP = 24;
const TOOLTIP = { height: 28, gap: space.xs };
const PAGE_CLOSE = 26;
const PAGE_GUTTER = 116;
const PAGE_GAP = 22;

const cardFrame = (size: { width: number }) => ({
  x: size.width + CARD.overhangRight - CARD.width,
  y: -CARD.overhangTop,
  width: CARD.width,
  height: CARD.height,
});

function useArtworkColors(): [string, string] {
  const windowId = useWindowId();
  const swatch = useWindowProfileValue(windowId, profileAccent);
  return [mix(swatch, postcard.artworkLight, 0.45), mix(swatch, postcard.artworkDark, 0.5)];
}

function mix(a: string, b: string, t: number) {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, "0")).join("")}`;
}

export function ReleaseNotesPostcard({ notes, size, onOpen, onDismiss }: { notes: ReleaseNotes; size: { width: number; height: number }; onOpen: () => void; onDismiss: () => void }) {
  const { hovered, hoverProps } = useHover();
  const drop = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const tooltip = useRef(new Animated.Value(0)).current;
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) return drop.setValue(0), opacity.setValue(1);
      Animated.parallel([
        Animated.spring(drop, { toValue: 0, ...spring(postcard.dropSpring), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: duration.slow, easing: curve.outQuad, useNativeDriver: true }),
      ]).start();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    Animated.timing(scale, { toValue: hovered ? 1.05 : 1, duration: duration.toggle, easing: curve.outQuad, useNativeDriver: true }).start();
    Animated.timing(tooltip, { toValue: hovered ? 1 : 0, duration: hovered ? postcard.tooltipIn : duration.instant, easing: curve.outQuad, useNativeDriver: true }).start();
  }, [hovered]);

  const dismiss = () => {
    setLeaving(true);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: duration.fade, easing: curve.inQuad, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0.96, duration: duration.fade, easing: curve.inQuad, useNativeDriver: true }),
    ]).start(onDismiss);
  };
  if (size.height < 420 || size.width < 560) return null;

  const card = cardFrame(size);
  return (
    <Animated.View
      pointerEvents={leaving ? "none" : "box-none"}
      style={{
        position: "absolute",
        left: card.x - HOVER_SLOP,
        top: card.y - HOVER_SLOP,
        width: card.width + HOVER_SLOP * 2,
        height: card.height + HOVER_SLOP + TOOLTIP.gap + TOOLTIP.height,
        opacity,
        transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [0, -280] }) }],
      }}
    >
      <View {...hoverProps} style={StyleSheet.absoluteFill}>
        <Animated.View
          style={{
            position: "absolute",
            left: HOVER_SLOP,
            top: HOVER_SLOP,
            width: card.width,
            height: card.height,
            transform: [{ rotate: `${CARD.tilt}deg` }, { scale }],
          }}
        >
          <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel="What's new in Ardia" style={FILL}>
            <Surface
              style={StyleSheet.absoluteFill}
              cornerRadius={CARD.radius}
              fill={ink.clear}
              shadowColor={postcard.cardShadow.color}
              shadowOpacity={postcard.cardShadow.opacity}
              shadowRadius={postcard.cardShadow.radius}
              shadowOffset={postcard.cardShadow.offset}
            />
            <Artwork notes={notes} radius={CARD.radius} titleSize={40} hidden={{ top: CARD.overhangTop, right: CARD.overhangRight }} />
          </Pressable>
        </Animated.View>
        <Animated.View
          pointerEvents={hovered ? "box-none" : "none"}
          style={{ position: "absolute", left: 0, right: 0, top: HOVER_SLOP + card.height + TOOLTIP.gap, alignItems: "center", opacity: tooltip }}
        >
          <Tooltip text="Latest Release Notes" onOpen={onOpen} onClose={dismiss} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function Tooltip({ text, onOpen, onClose }: { text: string; onOpen: () => void; onClose: () => void }) {
  const colors = useNtpColors();
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={text}>
      <View style={TOOLTIP_PLATE}>
        <VisualEffect material="contentBackground" blendingMode="withinWindow" cornerRadius={radii.m} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.postcardTooltip }]} />
        <Text lines={1} size="small" weight="medium" style={TOOLTIP_TEXT}>
          {text}
        </Text>
        <Button variant="close" look="art" onPress={onClose} tooltip="Dismiss release notes" label="Dismiss release notes" box={22} radius={radii.l} />
      </View>
    </Pressable>
  );
}

const FILL = { flex: 1 } as const;
const TOOLTIP_PLATE = { height: TOOLTIP.height, borderRadius: radii.m, overflow: "hidden", flexDirection: "row", alignItems: "center", paddingLeft: space.m, paddingRight: 3 } as const;
const TOOLTIP_TEXT = { color: postcard.tooltipText, marginRight: 9 } as const;

function Artwork({ notes, radius, titleSize, hidden }: { notes: ReleaseNotes; radius: number; titleSize: number; hidden?: { top: number; right: number } }) {
  const colors = useArtworkColors();
  const k = titleSize / 44;
  const pad = 22 * k;
  return (
    <View style={{ flex: 1, borderRadius: radius, overflow: "hidden", backgroundColor: mix(colors[0], colors[1], 0.5) }}>
      <WindowBackdrop colors={colors} angle={150} grainOpacity={0.1} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, padding: pad, paddingTop: pad + (hidden?.top ?? 0), paddingRight: pad + (hidden?.right ?? 0), justifyContent: "space-between" }}>
        <Text style={{ ...ntpType.artworkVersion, fontSize: ntpType.artworkVersion.fontSize * k, letterSpacing: ntpType.artworkVersion.letterSpacing * k, color: postcard.artworkVersion }}>{`ARDIA ${notes.version}`}</Text>
        <Text style={{ ...ntpType.artworkTitle, fontSize: titleSize, letterSpacing: ntpType.artworkTitle.letterSpacing * k, color: postcard.artworkTitle }}>{"What's new"}</Text>
      </View>
    </View>
  );
}

export function ReleaseNotesPage({ notes, size, onClose }: { notes: ReleaseNotes; size: { width: number; height: number }; onClose: () => void }) {
  const colors = useNtpColors();
  const t = useRef(new Animated.Value(0)).current;
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    Animated.spring(t, { toValue: 1, ...postcard.pageSpring, useNativeDriver: true }).start();
    return onClose;
  }, []);
  const close = () => {
    setClosing(true);
    Animated.timing(t, { toValue: 0, duration: postcard.pageClose, easing: curve.inCubic, useNativeDriver: true }).start(onClose);
  };

  const width = Math.min(860, size.width - 64);
  const height = Math.min(520, size.height - 64, width * 0.62);
  const split = width >= 640;
  const card = cardFrame(size);
  const from = { x: card.x + card.width / 2 - size.width / 2, y: card.y + card.height / 2 - size.height / 2 };

  return (
    <Animated.View style={StyleSheet.absoluteFill} pointerEvents={closing ? "none" : "auto"}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }) }]}>
        <VisualEffect material="hudWindow" blendingMode="withinWindow" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.releaseNotesScrim }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close release notes" />
      </Animated.View>
      <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]} pointerEvents="box-none">
        <Animated.View
          style={{
            width,
            height,
            opacity: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1], extrapolate: "clamp" }),
            transform: [
              { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [from.x, 0] }) },
              { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [from.y, 0] }) },
              { scale: t.interpolate({ inputRange: [0, 1], outputRange: [CARD.width / width, 1] }) },
              { rotate: t.interpolate({ inputRange: [0, 1], outputRange: [`${CARD.tilt}deg`, "-1deg"] }) },
            ],
          }}
        >
          <Surface
            style={StyleSheet.absoluteFill}
            fill={postcard.paper}
            cornerRadius={radii.m}
            borderColor={postcard.paperBorder}
            borderWidth={hairline.panel}
            shadowColor={postcard.pageShadow.color}
            shadowOpacity={postcard.pageShadow.opacity}
            shadowRadius={postcard.pageShadow.radius}
            shadowOffset={postcard.pageShadow.offset}
          />
          <Box pad="xl" style={split ? PAGE_SPLIT : PAGE_STACK}>
            <View style={split ? ART_SPLIT : ART_STACK}>
              <Artwork notes={notes} radius={radii.s} titleSize={46} />
            </View>
            <View style={NOTES_COLUMN}>
              <Stamp />
              <Text style={DATE_TEXT}>{notes.date.toUpperCase()}</Text>
              <Text style={TITLE_TEXT}>{notes.title}</Text>
              <Text size="body" style={SUMMARY_TEXT}>
                {notes.summary}
              </Text>
              <ScrollView style={ITEMS} contentContainerStyle={ITEMS_CONTENT} showsVerticalScrollIndicator={false}>
                {notes.items.map((item) => (
                  <Box key={item.title} gap="xxs" style={ITEM}>
                    <Text size="body" weight="semibold" style={INK_TEXT}>
                      {item.title}
                    </Text>
                    <Text style={ITEM_BODY}>{item.body}</Text>
                  </Box>
                ))}
              </ScrollView>
            </View>
          </Box>
          <View style={PAGE_CLOSE_PLACE}>
            <PageCloseButton onPress={close} />
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const PAGE_SPLIT = { flex: 1, flexDirection: "row", gap: PAGE_GAP } as const;
const PAGE_STACK = { flex: 1, flexDirection: "column", gap: PAGE_GAP } as const;
const ART_SPLIT = { width: "46%" } as const;
const ART_STACK = { height: 150 } as const;
const NOTES_COLUMN = { flex: 1, paddingTop: space.ml, paddingRight: space.m } as const;
const DATE_TEXT = { ...ntpType.releaseDate, color: postcard.inkTertiary, marginRight: PAGE_GUTTER } as const;
const TITLE_TEXT = { ...ntpType.releaseTitle, color: postcard.ink, marginTop: space.s, marginRight: PAGE_GUTTER } as const;
const SUMMARY_TEXT = { lineHeight: 19, color: postcard.inkSecondary, marginTop: space.m, marginRight: PAGE_GUTTER } as const;
const ITEMS = { flex: 1, marginTop: space.lx } as const;
const ITEMS_CONTENT = { gap: space.l, paddingBottom: space.m } as const;
const ITEM = { paddingBottom: space.ml, borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: postcard.inkRule } as const;
const INK_TEXT = { color: postcard.ink } as const;
const ITEM_BODY = { ...ntpType.releaseItemBody, color: postcard.inkBody } as const;
const PAGE_CLOSE_PLACE = { position: "absolute", right: -PAGE_CLOSE / 2, top: -PAGE_CLOSE / 2 } as const;

function PageCloseButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const label = "Close release notes";
  return (
    <View {...hoverProps} tooltip={label}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
        {({ pressed }) => (
          <Surface
            fill={hex(theme.panel)}
            cornerRadius={PAGE_CLOSE / 2}
            borderColor={hex(theme.panelBorder)}
            borderWidth={hairline.panel}
            shadowColor={postcard.closeShadow.color}
            shadowOpacity={postcard.closeShadow.opacity}
            shadowRadius={postcard.closeShadow.radius}
            shadowOffset={postcard.closeShadow.offset}
            style={{ width: PAGE_CLOSE, height: PAGE_CLOSE, transform: [{ scale: pressed ? 0.94 : 1 }] }}
          >
            <Symbol name="xmark" size={10} weight="semibold" color={hovered ? theme.textPrimary : theme.textSecondary} style={PAGE_CLOSE_GLYPH} />
          </Surface>
        )}
      </Pressable>
    </View>
  );
}

const PAGE_CLOSE_GLYPH = { width: PAGE_CLOSE, height: PAGE_CLOSE } as const;

function Stamp() {
  return (
    <View style={STAMP} pointerEvents="none">
      <View style={STAMP_FRAME}>
        <Image source={ICON} style={STAMP_ICON} />
      </View>
      <View style={STAMP_RING}>
        <Text style={STAMP_TEXT}>{"WHAT'S NEW"}</Text>
      </View>
    </View>
  );
}

const STAMP = { position: "absolute", right: 0, top: 0, width: 110, height: 86 } as const;
const STAMP_FRAME = { position: "absolute", right: 0, top: 0, padding: space.xs, borderWidth: 1.5, borderStyle: "dashed", borderColor: postcard.inkStampBorder, borderRadius: radii.xs, backgroundColor: postcard.stampFill } as const;
const STAMP_ICON = { width: 54, height: 54 } as const;
const STAMP_RING = {
  position: "absolute",
  left: 0,
  top: 18,
  width: 58,
  height: 58,
  borderRadius: 29,
  borderWidth: 1.2,
  borderColor: postcard.inkStampRing,
  alignItems: "center",
  justifyContent: "center",
  transform: [{ rotate: "-14deg" }],
} as const;
const STAMP_TEXT = { ...ntpType.stamp, color: postcard.inkTertiary } as const;
