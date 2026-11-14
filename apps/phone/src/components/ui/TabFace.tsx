import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { isDarkColor } from "../../lib/color";
import { Favicon } from "./Favicon";
import { Symbol } from "./Symbol";
import { font, space, tabsInk, type ColorRoles } from "./tokens";

export type TabFaceTab = { url: string; title: string; isPrivate: boolean; snapshotFileName: string | null; themeColorHex: string | null; faviconUrl: string | null };

export function placeholderTint(url: string, roles: ColorRoles): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) hash = (hash * 31 + url.charCodeAt(i)) | 0;
  return roles.placeholderTints[Math.abs(hash) % roles.placeholderTints.length]!;
}

export function tabFill(tab: TabFaceTab, tone: string | null, roles: ColorRoles): string {
  if (tab.isPrivate) return tabsInk.incognitoCard;
  return tab.themeColorHex ?? tone ?? placeholderTint(tab.url, roles);
}

type Props = { tab: TabFaceTab; title: string; host: string; tone: string | null; roles: ColorRoles; compact?: boolean };

export function TabFace({ tab, title, host, tone, roles, compact }: Props) {
  const fill = tabFill(tab, tone, roles);
  if (tab.snapshotFileName) return <Snapshot uri={tab.snapshotFileName} fill={fill} />;
  if (tab.isPrivate) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.private, { backgroundColor: fill }]}>
        <Symbol name="eyes" size={compact ? 12 : 44} color={tabsInk.onDark} />
        {compact ? null : (
          <>
            <Text style={[font.footnote, styles.privateTitle]}>Incognito Tab</Text>
            <Text style={[font.caption, styles.privateCaption]} numberOfLines={2}>
              {title}
            </Text>
          </>
        )}
      </View>
    );
  }
  const dark = isDarkColor(fill);
  const ink = dark ? tabsInk.onDark : roles.label;
  const soft = dark ? tabsInk.onDarkSoft : roles.foregroundSecondary;
  return (
    <View style={[StyleSheet.absoluteFill, compact ? styles.compact : styles.page, { backgroundColor: fill }]}>
      <Favicon iconUrl={tab.faviconUrl} pageUrl={tab.url} size={compact ? 12 : 32} />
      {compact ? null : (
        <>
          <Text style={[font.body, styles.title, { color: ink }]} numberOfLines={4}>
            {title}
          </Text>
          <Text style={[font.subheadline, { color: soft }]} numberOfLines={1}>
            {host}
          </Text>
        </>
      )}
    </View>
  );
}

function Snapshot({ uri, fill }: { uri: string; fill: string }) {
  const [aspect, setAspect] = useState<number | null>(null);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]}>
      <Image
        source={{ uri }}
        onLoad={(event) => {
          const { width, height } = event.nativeEvent.source;
          if (width > 0 && height > 0) setAspect(width / height);
        }}
        style={aspect ? [styles.snapshot, { aspectRatio: aspect }] : StyleSheet.absoluteFill}
        resizeMode="cover"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  snapshot: { width: "100%" },
  page: { padding: space.l, paddingTop: space.huge + space.l, gap: space.m },
  compact: { alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "600" },
  private: { alignItems: "center", justifyContent: "center", gap: space.m, paddingHorizontal: space.m },
  privateTitle: { color: tabsInk.onDark, fontWeight: "600" },
  privateCaption: { color: tabsInk.onDarkSoft, textAlign: "center" },
});
