import { memo } from "react";
import { View } from "react-native";
import { useIsSleeping } from "../../lib/tabLifecycle";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { IconGlyph } from "../icons/IconGlyph";
import { NO_GROUP_ICON, NO_GROUP_ICON_INK } from "../icons/classify";
import { Favicon } from "../primitives";

export { SYMBOL_PREFIX, NO_GROUP_ICON, NO_GROUP_ICON_INK, hasOwnGroupIcon } from "../icons/classify";

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
  if (icon) {
    const ink = icon === NO_GROUP_ICON ? (theme.dark ? NO_GROUP_ICON_INK.dark : NO_GROUP_ICON_INK.light) : theme.icon;
    return <IconGlyph icon={icon} size={size} color={color ?? ink} />;
  }
  return <Favicon url={url} favicon={favicon} size={size} profileId={profileId} direct={direct} />;
}
