import { memo, useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { faviconCandidates, monogram } from "../../lib/favicon";
import { Symbol } from "./Symbol";
import { faviconInk } from "./tokens";

const failedIcons = new Set<string>();

type Props = { iconUrl: string | null; pageUrl: string | null; size: number };

export const Favicon = memo(function Favicon({ iconUrl, pageUrl, size }: Props) {
  const candidates = useMemo(() => faviconCandidates(iconUrl, pageUrl), [iconUrl, pageUrl]);
  const [, setFailures] = useState(0);
  const shown = candidates.find((url) => !failedIcons.has(url)) ?? null;
  const corner = size * 0.26;
  if (!shown) return <MonogramTile pageUrl={pageUrl} size={size} corner={corner} />;
  return (
    <Image
      key={shown}
      source={{ uri: shown }}
      accessibilityElementsHidden
      importantForAccessibility="no"
      onError={() => {
        failedIcons.add(shown);
        setFailures((count) => count + 1);
      }}
      style={[styles.icon, { width: size, height: size, borderRadius: corner }]}
      resizeMode="contain"
    />
  );
});

function MonogramTile({ pageUrl, size, corner }: { pageUrl: string | null; size: number; corner: number }) {
  const tile = useMemo(() => monogram(pageUrl), [pageUrl]);
  const id = `monogram-${tile.colors[0].slice(1)}`;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.tile, { width: size, height: size, borderRadius: corner }]}>
      <Svg style={StyleSheet.absoluteFill} width={size} height={size}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={tile.colors[0]} />
            <Stop offset="1" stopColor={tile.colors[1]} />
          </LinearGradient>
        </Defs>
        <Rect width={size} height={size} rx={corner} fill={`url(#${id})`} />
      </Svg>
      {tile.letter ? (
        <Text allowFontScaling={false} style={[styles.letter, { fontSize: size * 0.56, lineHeight: size * 0.56 * 1.15 }]}>
          {tile.letter}
        </Text>
      ) : (
        <Symbol name="globe" size={size * 0.6} color={faviconInk.letter} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { overflow: "hidden" },
  tile: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
  letter: { color: faviconInk.letter, fontWeight: "600", textAlign: "center", includeFontPadding: false },
});
