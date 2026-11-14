import { favicons } from "@ardia/phone-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { memo, useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { FAVICON_USER_AGENT, faviconCandidates, firstUsable, monogram, type FaviconBacking, type FaviconLookResult } from "../../lib/favicon";
import { linearGradientCss } from "../../lib/gradient";
import { Symbol } from "./Symbol";
import { useTheme } from "./theme";
import { faviconInk } from "./tokens";

const failedIcons = new Set<string>();
const looks = new Map<string, Promise<FaviconLookResult>>();
const readsLooks = requireOptionalNativeModule("ArdiaPhoneFavicons") !== null;

function lookOf(url: string, dark: boolean): Promise<FaviconLookResult> {
  const key = `${dark ? "d" : "l"}|${url}`;
  let found = looks.get(key);
  if (!found) {
    found = favicons.look(url, dark).catch(() => null);
    looks.set(key, found);
  }
  return found;
}

type Props = { iconUrl: string | null; pageUrl: string | null; size: number };

type Chosen = { url: string; backing: FaviconBacking } | "none" | null;

export const Favicon = memo(function Favicon({ iconUrl, pageUrl, size }: Props) {
  const dark = useTheme().dark;
  const [failures, setFailures] = useState(0);
  const candidates = useMemo(() => faviconCandidates(iconUrl, pageUrl).filter((url) => !failedIcons.has(url)), [iconUrl, pageUrl, failures]);
  const [chosen, setChosen] = useState<Chosen>(null);
  useEffect(() => {
    if (!readsLooks) {
      setChosen(candidates[0] ? { url: candidates[0], backing: null } : "none");
      return;
    }
    let live = true;
    void firstUsable(candidates, (url) => lookOf(url, dark)).then((found) => {
      if (live) setChosen(found ?? "none");
    });
    return () => {
      live = false;
    };
  }, [candidates, dark]);
  const corner = size * 0.26;
  if (!chosen || chosen === "none") return <MonogramTile pageUrl={pageUrl} size={size} corner={corner} />;
  const plate = chosen.backing ? (chosen.backing === "light" ? faviconInk.lightPlate : faviconInk.darkPlate) : null;
  const inset = plate ? size * 0.14 : 0;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.icon, { width: size, height: size, borderRadius: corner, backgroundColor: plate ?? undefined, padding: inset }]}
    >
      <Image
        key={chosen.url}
        source={{ uri: chosen.url, headers: { "User-Agent": FAVICON_USER_AGENT, Accept: "image/*" } }}
        onError={() => {
          failedIcons.add(chosen.url);
          setFailures((count) => count + 1);
        }}
        style={styles.fill}
        resizeMode="contain"
        resizeMethod="resize"
      />
    </View>
  );
});

function MonogramTile({ pageUrl, size, corner }: { pageUrl: string | null; size: number; corner: number }) {
  const tile = useMemo(() => monogram(pageUrl), [pageUrl]);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { width: size, height: size, borderRadius: corner, experimental_backgroundImage: linearGradientCss(tile.colors, false, size, size) }]}
    >
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
  fill: { flex: 1 },
  tile: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
  letter: { color: faviconInk.letter, fontWeight: "600", textAlign: "center", includeFontPadding: false },
});
