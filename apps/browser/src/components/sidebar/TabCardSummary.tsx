import { useInterfaceMetrics, scaleInterfaceStyle } from "../ui/interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { useMemo } from "react";
import { View } from "react-native";
import { displayUrl } from "@ardia/core";
import type { Tab } from "../../state/browser/types";
import { tabTitle } from "../../state/browser/model";
import { awayTitle } from "../../state/pins/organize";
import { useIsSleeping } from "../../state/tabs/tabLifecycle";
import { FadeLabel, font, space, Symbol, Text } from "../ui";
import { lineHeight } from "../ui/tokens";
import { useTheme } from "../ui/theme";
import { AwayTitleLabel } from "./AwayTitle";
import { HOVER_CARD_HEADER } from "./hoverPlacement";
import { TabIcon } from "./TabIcon";
import { TAB_ROW } from "./tokens";

export function TabCardSummary({ tab }: { tab: Tab }) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { TAB_ROW, URL_LINE, space } = useMemo(() => ({ TAB_ROW: scaleMetrics(BASE_INTERFACE_METRICS.TAB_ROW, interfaceScale), URL_LINE: scaleMetrics(BASE_INTERFACE_METRICS.URL_LINE, interfaceScale), space: scaleMetrics(BASE_INTERFACE_METRICS.space, interfaceScale) }), [interfaceScale]);
  const theme = useTheme();
  const sleeping = useIsSleeping(tab.id);
  const away = awayTitle(tab);
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: TAB_ROW.titleGap, height: HOVER_CARD_HEADER }}>
        <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
        {away ? (
          <AwayTitleLabel away={away} color={theme.textPrimary} fontSize={font.body.fontSize} weight="medium" height={18} style={{ flex: 1 }} />
        ) : (
          <FadeLabel text={tabTitle(tab)} fontSize={font.body.fontSize} weight="medium" color={theme.textPrimary} style={{ flex: 1, height: 18 * interfaceScale }} />
        )}
      </View>
      {tab.url ? (
        <Text lines={2} size="caption" tone="textSecondary" style={URL_LINE}>
          {displayUrl(tab.url)}
        </Text>
      ) : null}
      {sleeping ? (
        <View accessible accessibilityLabel="Web content has been discarded" style={{ flexDirection: "row", alignItems: "center", gap: space.xs, marginTop: space.xs }}>
          <Symbol name="moon.zzz" size={10} color={theme.textTertiary} style={{ width: 14 * interfaceScale, height: 14 * interfaceScale }} />
          <Text size="caption" tone="textTertiary">
            This tab needs to reload
          </Text>
        </View>
      ) : null}
    </>
  );
}

const URL_LINE = { marginTop: space.xs, lineHeight: lineHeight.caption } as const;

const BASE_INTERFACE_METRICS = { TAB_ROW, URL_LINE, space };
