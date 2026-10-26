import { briefColors, briefMotion } from "./tokens";
import { useEffect, useRef, useState } from "react";
import { Symbol } from "../ui";
import { Animated, Image, Linking, Pressable, Text, View } from "react-native";
import { isSafeBriefSource, type BriefLink } from "../../lib/briefContent";

type Props = { title: string; onPress?: () => void; small?: boolean; links?: BriefLink[]; maxWidth?: number; popupBounds?: { left: number; right: number } };

const rotations = [0, 22.5, 45, 67.5];
const linkKind = (link: BriefLink) => link.kind ?? (link.url.startsWith("https://github.com/") ? "github" : "gmail");
const validLink = (link: BriefLink) => isSafeBriefSource({ kind: linkKind(link), url: link.url });

export function BriefBadge({ title, onPress, small = false, links = [], maxWidth = 330, popupBounds }: Props) {
  const size = small ? 84 : 108;
  const face = size * 0.76;
  const popupWidth = Math.min(330, maxWidth, popupBounds ? popupBounds.right - popupBounds.left : Infinity);
  const centeredPopupLeft = (size - popupWidth) / 2;
  const popupLeft = popupBounds ? Math.max(popupBounds.left, Math.min(centeredPopupLeft, popupBounds.right - popupWidth)) : centeredPopupLeft;
  const hasArrow = /→\s*$/.test(title);
  const labelLines = title.replace(/\s*→\s*$/, "").split("\n");
  const finalLine = labelLines.pop() ?? "";
  const labelStyle = { color: briefColors.background, fontFamily: "Georgia", fontStyle: "italic" as const, fontSize: small ? 15 : 22, textAlign: "center" as const, lineHeight: small ? 20 : 27 };
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const tilt = useRef(new Animated.Value(0)).current;
  const sheen = useRef(new Animated.Value(-size)).current;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const references = links.filter(validLink).slice(0, 5);
  const showPopup = !small && (references.length > 0 || !onPress) && !dismissed && (hovered || pinned);
  const press = () => {
    if (references.length > 0 || (!small && !onPress)) {
      setDismissed(pinned);
      setPinned(!pinned);
      return;
    }
    onPress?.();
  };
  const enter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setHovered(true);
    setDismissed(false);
  };
  const leave = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHovered(false), 150);
  };
  useEffect(() => {
    Animated.timing(tilt, { toValue: hovered ? 1 : 0, duration: briefMotion.tilt, useNativeDriver: true }).start();
    sheen.stopAnimation();
    sheen.setValue(-size);
    if (hovered) Animated.timing(sheen, { toValue: size, duration: briefMotion.sheen, useNativeDriver: true }).start();
  }, [hovered, sheen, size, tilt]);
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    tilt.stopAnimation();
    sheen.stopAnimation();
  }, [sheen, tilt]);
  return (
    <View style={{ width: size, height: size, zIndex: hovered || showPopup ? 30 : 1 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={title.replace("\n", " ")} onPress={press} onHoverIn={enter} onHoverOut={leave} style={({ pressed }) => ({ width: size, height: size, opacity: pressed ? 0.75 : 1 })}>
        <Animated.View pointerEvents="none" style={{ width: size, height: size, alignItems: "center", justifyContent: "center", transform: [{ rotate: tilt.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-8deg"] }) }] }}>
          {rotations.map((rotation) => <View key={rotation} style={{ position: "absolute", width: face, height: face, backgroundColor: briefColors.accent, transform: [{ rotate: `${rotation}deg` }] }} />)}
          {hovered && rotations.map((rotation) => <View key={rotation} style={{ position: "absolute", width: face, height: face, overflow: "hidden", transform: [{ rotate: `${rotation}deg` }] }}><View style={{ position: "absolute", width: size, height: size, left: (face - size) / 2, top: (face - size) / 2, transform: [{ rotate: `${-rotation}deg` }] }}><Animated.View style={{ position: "absolute", width: size * 0.25, height: size * 2, top: -size / 2, left: size / 2, backgroundColor: briefColors.sheen, transform: [{ translateX: sheen }, { rotate: "-22deg" }] }} /></View></View>)}
          <View style={{ alignItems: "center", transform: [{ rotate: "-9deg" }] }}>
            {labelLines.map((line, index) => <Text key={index} style={labelStyle}>{line}</Text>)}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Text style={labelStyle}>{finalLine}</Text>{hasArrow && <Symbol name="arrow.right" size={small ? 13 : 18} weight="medium" color={briefColors.background} style={{ width: small ? 15 : 21, height: small ? 20 : 27 }} />}</View>
          </View>
        </Animated.View>
      </Pressable>
      {showPopup && <Pressable onHoverIn={enter} onHoverOut={leave} style={{ position: "absolute", bottom: size + 12, left: popupLeft, width: popupWidth, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: briefColors.popoverBorder, backgroundColor: briefColors.popover, gap: 10 }}>
        <Text style={{ color: briefColors.foreground, fontFamily: "Georgia", fontSize: 16 }}>Sources for this recommendation</Text>
        <Text style={{ color: briefColors.popoverBody, fontSize: 13, lineHeight: 19 }}>{references.length ? "Open the sources behind this recommendation." : "Refresh this brief to load its source links."}</Text>
        {references.map((link) => {
          const kind = linkKind(link);
          const service = kind === "github" ? "GitHub" : "Gmail";
          return <Pressable key={link.url} accessibilityRole="link" accessibilityLabel={link.title} tooltip={`Open in ${service}`} onPress={(event) => { event.stopPropagation(); void Linking.openURL(link.url).catch(() => {}); }} style={({ pressed }) => ({ flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 5, opacity: pressed ? 0.75 : 1 })}><Image source={kind === "github" ? require("../../../assets/site-icons/github.png") : require("../../../assets/site-icons/gmail.png")} style={{ width: 17, height: kind === "gmail" ? 13 : 17, ...(kind === "github" ? { tintColor: briefColors.foreground } : {}) }} resizeMode="contain" /><Text style={{ flex: 1, color: briefColors.foreground, fontSize: 13, lineHeight: 19 }}>{link.title}</Text></Pressable>;
        })}
      </Pressable>}
    </View>
  );
}
