import { memo } from "react";
import { Text, View } from "react-native";
import { isVectorIcon, parseCustomIcon } from "../../lib/iconCatalog";
import { useIsSleeping } from "../../lib/tabLifecycle";
import { useBrowser } from "../../store/browser";
import { CustomIcon } from "../icons/CustomIcon";
import { Favicon } from "../primitives";

export { SYMBOL_PREFIX } from "../../lib/iconCatalog";

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
  if (icon && parseCustomIcon(icon)) {
    return <CustomIcon value={icon} size={size} glyphSize={size - 3} weight="medium" color={color} />;
  }
  if (icon && !isVectorIcon(icon)) {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: size - 3, lineHeight: size }}>{icon}</Text>
      </View>
    );
  }
  return <Favicon url={url} favicon={favicon} size={size} profileId={profileId} direct={direct} />;
}
