import { Pressable, View } from "react-native";
import { BOOST_CASES, BOOST_FONTS, BOOST_SIZES, type Boost, type BoostCase, type BoostSize } from "../../state/boosts/types";
import { Box, hairline, Symbol, Text, useHover, useTheme } from "../ui";
import { tileFill } from "../site/SiteControlsParts";
import { useSiteTokens } from "../site/tokens";
import { BOOST_PANEL, CASE_LABELS } from "./tokens";

const next = <T,>(list: readonly T[], current: T) => list[(list.indexOf(current) + 1) % list.length]!;

function FontTile({ family, selected, onPress }: { family: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={family} style={{ width: BOOST_PANEL.fontTile, height: BOOST_PANEL.fontTile }}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={family} accessibilityState={{ selected }}>
        {({ pressed }) => (
          <View
            style={{
              width: BOOST_PANEL.fontTile,
              height: BOOST_PANEL.fontTile,
              borderRadius: 8,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: selected ? 1.5 : hairline.ring,
              borderColor: selected ? theme.accent : theme.groupBorder,
              backgroundColor: pressed ? theme.controlPressed : hovered ? theme.controlHover : theme.groupFill,
            }}
          >
            <Text size="title" style={{ fontFamily: family }}>
              Aa
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function BoostFonts({ font, onChange }: { font: Boost["font"]; onChange: (font: Boost["font"]) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: BOOST_PANEL.fontGap }}>
      {BOOST_FONTS.map((family) => (
        <FontTile key={family} family={family} selected={font === family} onPress={() => onChange(font === family ? null : family)} />
      ))}
    </View>
  );
}

function ToolButton({ icon, title, tooltip, active, onPress }: { icon: string; title: string; tooltip: string; active?: boolean; onPress: () => void }) {
  const theme = useTheme();
  const site = useSiteTokens();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} tooltip={tooltip} style={{ flex: 1 }}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={tooltip}>
        {({ pressed }) => (
          <View
            style={{
              height: 32,
              borderRadius: 8,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              borderWidth: hairline.ring,
              borderColor: site.tileStroke,
              backgroundColor: tileFill(site, pressed || !!active, hovered),
            }}
          >
            <Symbol name={icon} size={12} weight="medium" color={active ? theme.accent : theme.icon} style={{ width: 16, height: 16 }} />
            <Text size="small" weight="medium" lines={1} tone={active ? "accent" : "textPrimary"}>
              {title}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function BoostTextControls({
  size,
  textCase,
  zapping,
  onSize,
  onCase,
  onZap,
}: {
  size: BoostSize;
  textCase: BoostCase;
  zapping: boolean;
  onSize: (size: BoostSize) => void;
  onCase: (textCase: BoostCase) => void;
  onZap: () => void;
}) {
  return (
    <Box row gap="s">
      <ToolButton icon="textformat.size" title={`${size}%`} tooltip="Change page zoom" onPress={() => onSize(next(BOOST_SIZES, size))} />
      <ToolButton icon="textformat" title={CASE_LABELS[textCase]} tooltip="Change text case" onPress={() => onCase(next(BOOST_CASES, textCase))} />
      <ToolButton icon="bolt.fill" title="Zap" tooltip={zapping ? "Stop Zapping" : "Hide elements on the page"} active={zapping} onPress={onZap} />
    </Box>
  );
}
