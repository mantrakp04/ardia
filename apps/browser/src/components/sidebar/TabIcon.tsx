import { memo } from "react";
import { Text, View } from "react-native";
import { useIsSleeping } from "../../state/tabs/tabLifecycle";
import { Symbol } from "../ui";
import { useTheme } from "../ui/theme";
import { sidebarTokens } from "./tokens";
import { useTab } from "../../state/browser/hooks";
import { ENGINE_NAMES, ENGINE_SYMBOLS } from "../../state/engines/engines";
import { useEngineMark } from "../../state/engines/hooks";
import { useFadesUnloaded } from "../../state/pins/hooks";
import { NO_GROUP_ICON, SYMBOL_PREFIX } from "../../state/groups/groupIcons";
import { Favicon } from "../favicon/Favicon";

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
  const unloaded = useFadesUnloaded(tabId);
  const props = { url, favicon, icon, size, color, direct };
  return (
    <View style={{ opacity: sleeping || unloaded ? SLEEPING_OPACITY : 1 }}>
      {profile || !tabId ? <Icon {...props} profileId={profile} /> : <TabProfileIcon {...props} tabId={tabId} />}
      {tabId && size >= 14 ? <EngineMark tabId={tabId} size={size} /> : null}
    </View>
  );
});

function EngineMark({ tabId, size }: { tabId: string; size: number }) {
  const theme = useTheme();
  const mark = useEngineMark(tabId);
  if (!mark) return null;
  const box = Math.round(size * 0.6);
  return (
    <View
      pointerEvents="none"
      accessibilityLabel={`Opens in ${ENGINE_NAMES[mark]}`}
      style={{
        position: "absolute",
        right: -box / 3,
        bottom: -box / 3,
        width: box,
        height: box,
        borderRadius: box / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: sidebarTokens(theme).engineMarkPlate,
      }}
    >
      <Symbol name={ENGINE_SYMBOLS[mark]} size={box - 3} weight="semibold" color={theme.icon} style={{ width: box, height: box }} />
    </View>
  );
}

function TabProfileIcon({ tabId, ...props }: Omit<Parameters<typeof Icon>[0], "profileId"> & { tabId: string }) {
  const profileId = useTab(tabId, (t) => t?.profileId);
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
    const ink = icon === NO_GROUP_ICON ? sidebarTokens(theme).noGroupIcon : theme.icon;
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
