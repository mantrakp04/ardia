import type { ReactNode } from "react";
import { Image, View, type StyleProp, type ViewStyle } from "react-native";
import { Panel, Text } from "../ui";
import { capsule, font, hairline, radius, space, tracking, type ShadowLevel } from "../ui/tokens";
import { postageStamp } from "./tokens";

const ICON = require("../../../assets/app-icon.png");

export type StampInk = { frame: string; ring: string; label: string; paper?: string };

export function PostageStamp({
  icon,
  ring,
  label,
  tilt,
  ink,
  ringAt,
}: {
  icon: number;
  ring: number;
  label: string;
  tilt: number;
  ink: StampInk;
  ringAt: { right: number; top: number };
}) {
  const scale = ring / postageStamp.drawnRing;
  return (
    <View pointerEvents="none">
      <View
        style={{
          padding: space.xs,
          borderWidth: postageStamp.frameStroke,
          borderStyle: "dashed",
          borderColor: ink.frame,
          borderRadius: radius.control,
          backgroundColor: ink.paper,
        }}
      >
        <Image source={ICON} style={{ width: icon, height: icon }} />
      </View>
      <View
        style={{
          position: "absolute",
          right: ringAt.right,
          top: ringAt.top,
          width: ring,
          height: ring,
          borderRadius: capsule(ring),
          borderWidth: postageStamp.drawnStroke * scale,
          borderColor: ink.ring,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ rotate: `${tilt}deg` }],
        }}
      >
        <Text lines={1} size="badge" weight="bold" color={ink.label} style={{ fontSize: font.badge.fontSize * scale, letterSpacing: tracking.caps * scale }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

export function PostcardPaper({
  fill,
  border,
  borderWidth = hairline.panel,
  shadow,
  style,
  children,
}: {
  fill: string;
  border: string;
  borderWidth?: number;
  shadow?: Omit<ShadowLevel, "opacity"> & { opacity: number };
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  return (
    <Panel fill={fill} radius={radius.tile} border={border} borderWidth={borderWidth} shadow={shadow} style={style}>
      {children}
    </Panel>
  );
}
