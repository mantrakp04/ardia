import { useEffect } from "react";
import { Image, StyleSheet, type ImageSourcePropType } from "react-native";
import { DockSelection, radius, useGlass, useTheme } from "../ui";
import { bundledSiteIcon } from "../favicon/siteIcons";
import { useFavicon } from "../../state/favicons/favicons";
import { useIconRing, warmIconRing } from "../../state/favicons/iconRing";
import type { TileTheme } from "../../state/favicons/tileTheme";

export const RING_WIDTH = 2;
const RING_WARM_DELAY_MS = 500;

export function IconRing({ ring }: { ring: TileTheme }) {
  const theme = useTheme();
  return (
    <DockSelection
      image={ring.image}
      emoji={ring.emoji}
      theme={ring.theme.kind}
      fill={ring.theme.kind === "template" ? ring.theme.fill : undefined}
      stroke={ring.theme.kind === "template" ? ring.theme.stroke : undefined}
      cornerRadius={radius.panel}
      strokeWidth={RING_WIDTH}
      dark={theme.dark}
      glass
      colorRing
      style={StyleSheet.absoluteFill}
    />
  );
}

const sourceUri = (source: ImageSourcePropType | null | undefined): string | null => {
  if (source == null) return null;
  if (typeof source === "number") return Image.resolveAssetSource(source)?.uri ?? null;
  if (Array.isArray(source)) return source[0]?.uri ?? null;
  return (source as { uri?: string }).uri ?? null;
};

function useWarmRing(uri: string | null, shown: boolean) {
  const usable = useGlass() ? uri : null;
  useEffect(() => {
    if (!usable) return;
    const timer = setTimeout(() => warmIconRing(usable), RING_WARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [usable]);
  return useIconRing(shown ? usable : null);
}

export const useImageRing = (source: ImageSourcePropType | null | undefined, shown: boolean) => useWarmRing(sourceUri(source), shown);

export function useSiteRing(url: string, shown: boolean) {
  const theme = useTheme();
  const cached = useFavicon(url);
  const bundled = bundledSiteIcon(url, theme.dark);
  return useWarmRing(sourceUri(bundled) ?? cached?.uri ?? null, shown);
}
