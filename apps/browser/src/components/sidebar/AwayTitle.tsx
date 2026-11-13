import { useInterfaceMetrics, scaleInterfaceStyle } from "../ui/interfaceSize";
import { scaleMetrics } from "../../lib/interfaceMetrics";
import { RawText as Text } from "../ui/ScaledNative";
import { useMemo } from "react";
import { memo } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import type { AwayTitle } from "../../state/pins/organize";
import { FadeLabel } from "../ui";
import { withAlpha } from "../ui/tokens";
import { AWAY_TITLE } from "./tokens";

export const AwayTitleLabel = memo(function AwayTitleLabel({
  away,
  color,
  fontSize,
  weight,
  height,
  style,
}: {
  away: AwayTitle;
  color: string;
  fontSize: number;
  weight?: "medium" | "regular";
  height: number;
  style?: StyleProp<ViewStyle>;
}) {
  const interfaceScale = useInterfaceMetrics().factor;
  const { AWAY_TITLE } = useMemo(() => ({ AWAY_TITLE: scaleMetrics(BASE_INTERFACE_METRICS.AWAY_TITLE, interfaceScale) }), [interfaceScale]);
  const fontWeight = weight === "medium" ? "500" : undefined;
  return (
    <View accessible accessibilityLabel={`${away.pinned ?? "Pinned tab"}, now on ${away.page}`} style={[{ flexDirection: "row", alignItems: "center", height }, style]}>
      {away.pinned ? (
        <Text numberOfLines={1} style={{ fontSize, fontWeight, color, flexShrink: 1, maxWidth: AWAY_TITLE.pinnedMaxWidth }}>
          {away.pinned}
        </Text>
      ) : null}
      <Text style={{ fontSize, fontWeight, color: withAlpha(color, AWAY_TITLE.slashAlpha), marginLeft: away.pinned ? AWAY_TITLE.slashGap : 0, marginRight: AWAY_TITLE.slashGap }}>/</Text>
      <FadeLabel text={away.page} fontSize={fontSize} weight={weight} color={color} style={{ flex: 1, height }} />
    </View>
  );
});

const BASE_INTERFACE_METRICS = { AWAY_TITLE };
