import { displayHost, hostOf } from "@ardia/core";
import { memo, useState } from "react";
import { Image, Text, View } from "react-native";
import { faviconFailed, useAppearanceDark, useFavicon, useFaviconTheme } from "../../state/favicons/favicons";
import { radius, Symbol, useTheme, weight } from "../ui";
import { bundledSiteIcon } from "./siteIcons";

export const Favicon = memo(function Favicon({
  url,
  favicon,
  size = 16,
  profileId,
  direct,
}: {
  url: string;
  favicon?: string | null;
  size?: number;
  profileId?: string;
  direct?: boolean;
}) {
  const theme = useTheme();
  useAppearanceDark();
  const cached = useFavicon(url, direct ? null : favicon, profileId);
  const resolved = direct && favicon ? { uri: favicon, profileId: "" } : cached;
  const shape = useFaviconTheme(theme.dark || direct ? "" : url, favicon, profileId);
  const white = shape?.kind === "template" && !!shape.stroke;
  const [broken, setBroken] = useState<string | null>(null);
  if (!url && !resolved) return <NewTabIcon size={size} />;
  if (!resolved || broken === resolved.uri) return <FaviconFallback url={url} size={size} />;
  return (
    <Image
      key={white ? `${resolved.uri} tinted` : resolved.uri}
      source={{ uri: resolved.uri }}
      onError={() => {
        setBroken(resolved.uri);
        if (resolved.profileId) faviconFailed(resolved.profileId, resolved.uri);
      }}
      style={{ width: size, height: size, borderRadius: size > 18 ? radius.s : radius.xs, tintColor: white ? theme.textPrimary : undefined }}
    />
  );
});

export const FaviconFallback = memo(function FaviconFallback({ url, size = 16 }: { url: string; size?: number }) {
  const theme = useTheme();
  const bundled = bundledSiteIcon(url, theme.dark);
  if (bundled !== undefined) return <Image source={bundled} style={{ width: size, height: size, borderRadius: size > 18 ? radius.s : radius.xs }} />;
  const initial = hostInitial(url);
  if (!initial) return <Symbol name="globe" size={size - 3} color={theme.textSecondary} style={{ width: size, height: size }} />;
  const tile = Math.round((size * 14) / 16);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: tile,
          height: tile,
          borderRadius: tile * 0.32,
          borderCurve: "continuous",
          backgroundColor: theme.faviconTile,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: Math.round(tile * 0.64), lineHeight: tile, fontWeight: weight.semibold, color: theme.textSecondary }}>{initial}</Text>
      </View>
    </View>
  );
});

function hostInitial(url: string): string {
  const host = /^(?:https?|ftp):/i.test(url) ? hostOf(url) : "";
  if (!host || /^[\d.]+$|^\[/.test(host)) return "";
  return Array.from(displayHost(host))[0]?.toLocaleUpperCase() ?? "";
}

const NEW_TAB_MARK = require("../../../assets/new-tab-mark.png");

export function NewTabIcon({ size = 16 }: { size?: number }) {
  const theme = useTheme();
  return (
    <Image
      key={theme.dark ? "dark" : "light"}
      source={NEW_TAB_MARK}
      style={{ width: size, height: size, tintColor: theme.mark, opacity: theme.dark ? 0.28 : 0.3 }}
    />
  );
}
