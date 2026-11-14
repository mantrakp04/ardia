import { DeckBackdrop, FilmGrain, Frost, lookIsNative, ProfileBackdrop, type FrostVariant } from "@ardia/phone-native";
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { nativeLookColors, windowTintStops } from "../../lib/profileLook";
import { Backdrop } from "./Backdrop";
import { useReduceTransparency } from "./contrast";
import { useProfileLook, useTheme } from "./theme";
import { grainInk } from "./tokens";

export const SURFACES_FROST = "surfaces";

export function LookBackdrop({ themed = false, softened = false, dark }: { themed?: boolean; softened?: boolean; dark?: boolean }) {
  const look = useProfileLook();
  const theme = useTheme();
  const shade = dark ?? theme.dark;
  if (!lookIsNative()) {
    if (themed) return <Backdrop colors={theme.start.colors} diagonal={theme.start.diagonal} />;
    return <Backdrop colors={dark === undefined ? theme.backdrop : windowTintStops(look, shade)} />;
  }
  return <ProfileBackdrop pointerEvents="none" style={StyleSheet.absoluteFill} {...nativeLookColors(look)} dark={shade} themed={themed} softened={softened} />;
}

export function DeckLookBackdrop() {
  const look = useProfileLook();
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const reduceTransparency = useReduceTransparency();
  if (!lookIsNative()) return <Backdrop colors={theme.backdrop} />;
  return (
    <DeckBackdrop
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      {...nativeLookColors(look)}
      dark={theme.dark}
      reduceMotion={reduceMotion}
      reduceTransparency={reduceTransparency}
    />
  );
}

export function GrainOver({ dark }: { dark: boolean }) {
  if (!lookIsNative()) return null;
  return <FilmGrain pointerEvents="none" style={StyleSheet.absoluteFill} opacity={dark ? grainInk.dark : grainInk.light} />;
}

type FrostProps = {
  source: string;
  variant: FrostVariant;
  cornerRadius: number;
  fill: string;
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export function LookFrost({ source, variant, cornerRadius, fill, dark, style, children }: FrostProps) {
  const look = useProfileLook();
  const theme = useTheme();
  const reduceTransparency = useReduceTransparency();
  if (!lookIsNative()) return <View style={[style, { backgroundColor: fill, borderRadius: cornerRadius }]}>{children}</View>;
  return (
    <Frost
      source={source}
      variant={variant}
      cornerRadius={cornerRadius}
      {...nativeLookColors(look)}
      dark={dark ?? theme.dark}
      reduceTransparency={reduceTransparency}
      style={[style, { borderRadius: cornerRadius }]}
    >
      {children}
    </Frost>
  );
}
