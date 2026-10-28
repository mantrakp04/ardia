import { Animated, View, type ViewStyle } from "react-native";
import { switcherCellWidth, SwitcherMark } from "../../profiles/ProfileIcons";
import { profileSwitcher } from "../../profiles/tokens";
import { at, SIDEBAR_W, type Geo } from "./geometry";
import type { Styles } from "./Kit";
import type { Look } from "./look";

export const MOCK_SPACES: readonly (string | null)[] = ["symbol:globe.americas.fill", "🔥", null];

export type SwitcherLevel = number | Animated.AnimatedInterpolation<number>;

export const switcherLevels = (icon: string | null) => (icon ? profileSwitcher.icons : profileSwitcher.dots);

const restingLevel = (i: number, icon: string | null) => (i === 0 ? switcherLevels(icon).selected : switcherLevels(icon).idle);

export function MockSwitcher({
  g,
  look,
  icons,
  level = restingLevel,
  style,
}: {
  g: Geo;
  look: Look;
  icons: boolean;
  level?: (i: number, icon: string | null) => SwitcherLevel;
  style?: Styles;
}) {
  const { height, band } = profileSwitcher;
  const marks = MOCK_SPACES.map((icon) => (icons ? icon : null));
  const width = marks.reduce((sum, icon) => sum + switcherCellWidth(icon), 0);
  return (
    <Animated.View pointerEvents="none" style={[at(g, (SIDEBAR_W - width) / 2, g.H - height + (height - 3 - band) / 2, width, band), { flexDirection: "row" }, style as ViewStyle]}>
      {marks.map((icon, i) => (
        <View key={i} style={{ width: switcherCellWidth(icon) * g.s, height: band * g.s, alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={{ opacity: level(i, icon) }}>
            <SwitcherMark icon={icon} color={look.t.mark} scale={g.s} />
          </Animated.View>
        </View>
      ))}
    </Animated.View>
  );
}
