import { Symbol } from "@ardia/shell";
import { memo } from "react";
import { Text, View } from "react-native";
import { useIsSleeping } from "../../lib/tabLifecycle";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { Favicon } from "../primitives";

export const SYMBOL_PREFIX = "symbol:";
export const NO_GROUP_ICON = `${SYMBOL_PREFIX}square.stack.fill`;
export const NO_GROUP_ICON_INK = { light: "#00000040", dark: "#FFFFFF40" };
export const hasOwnGroupIcon = (icon: string | null | undefined): icon is string => !!icon && icon !== NO_GROUP_ICON;

export const TabIcon = memo(function TabIcon({
  tabId,
  url,
  favicon,
  icon,
  size = 16,
  color,
  profileId: profile,
  direct,
}: {
  tabId?: string;
  url: string;
  favicon?: string | null;
  icon?: string | null;
  size?: number;
  color?: string;
  profileId?: string;
  direct?: boolean;
}) {
  const sleeping = useIsSleeping(tabId ?? "");
  const props = { url, favicon, icon, size, color, direct };
  return (
    <View style={{ opacity: sleeping ? SLEEPING_OPACITY : 1 }}>
      {profile || !tabId ? <Icon {...props} profileId={profile} /> : <TabProfileIcon {...props} tabId={tabId} />}
    </View>
  );
});

function TabProfileIcon({ tabId, ...props }: Omit<Parameters<typeof Icon>[0], "profileId"> & { tabId: string }) {
  const profileId = useBrowser((s) => s.tabs[tabId]?.profileId);
  return <Icon {...props} profileId={profileId} />;
}

const SLEEPING_OPACITY = 0.45;

function Icon({
  url,
  favicon,
  icon,
  size = 16,
  color,
  profileId,
  direct,
}: {
  url: string;
  favicon?: string | null;
  icon?: string | null;
  size?: number;
  color?: string;
  profileId?: string;
  direct?: boolean;
}) {
  const theme = useTheme();
  if (icon?.startsWith(SYMBOL_PREFIX)) {
    const ink = icon === NO_GROUP_ICON ? (theme.dark ? NO_GROUP_ICON_INK.dark : NO_GROUP_ICON_INK.light) : theme.icon;
    return <Symbol name={icon.slice(SYMBOL_PREFIX.length)} size={size - 3} weight="medium" color={color ?? ink} style={{ width: size, height: size }} />;
  }
  if (icon) {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: size - 3, lineHeight: size }}>{icon}</Text>
      </View>
    );
  }
  return <Favicon url={url} favicon={favicon} size={size} profileId={profileId} direct={direct} />;
}
