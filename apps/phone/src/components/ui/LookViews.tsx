import { DeckBackdrop, Frost, INCOGNITO_LOOK, lookIsNative, ProfileBackdrop, type FrostVariant } from "@ardia/phone-native";
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { nativeLookColors, windowTintStops, type NativeLookColors, type ProfileLook } from "../../lib/profileLook";
import { Backdrop } from "./Backdrop";
import { useReduceTransparency } from "./contrast";
import { useProfileLook, useTheme } from "./theme";
import { tabsInk } from "./tokens";

export const SURFACES_FROST = "surfaces";

const INCOGNITO_COLORS: NativeLookColors = { color: INCOGNITO_LOOK, themeColors: [], darkThemeColors: null };

const lookColors = (look: ProfileLook, incognito: boolean): NativeLookColors => (incognito ? INCOGNITO_COLORS : nativeLookColors(look));

type BackdropProps = { themed?: boolean; softened?: boolean; fadesOut?: boolean; incognito?: boolean; dark?: boolean };

export function LookBackdrop({ themed = false, softened = false, fadesOut = false, incognito = false, dark }: BackdropProps) {
  const look = useProfileLook();
  const theme = useTheme();
  const shade = incognito || (dark ?? theme.dark);
  if (!lookIsNative()) {
    if (incognito) return <Backdrop colors={tabsInk.incognitoBackdrop} />;
    if (themed) return <Backdrop colors={theme.start.colors} diagonal={theme.start.diagonal} />;
    return <Backdrop colors={dark === undefined ? theme.backdrop : windowTintStops(look, shade)} />;
  }
  return (
    <ProfileBackdrop
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      {...lookColors(look, incognito)}
      dark={shade}
      themed={themed}
      softened={softened}
      fadesOut={fadesOut}
    />
  );
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

type FrostProps = {
  source: string;
  variant: FrostVariant;
  cornerRadius: number;
  fill: string;
  dark?: boolean;
  incognito?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export function LookFrost({ source, variant, cornerRadius, fill, dark, incognito = false, style, children }: FrostProps) {
  const look = useProfileLook();
  const theme = useTheme();
  const reduceTransparency = useReduceTransparency();
  if (!lookIsNative()) return <View style={[style, { backgroundColor: fill, borderRadius: cornerRadius }]}>{children}</View>;
  return (
    <Frost
      source={source}
      variant={variant}
      cornerRadius={cornerRadius}
      {...lookColors(look, incognito)}
      dark={incognito || (dark ?? theme.dark)}
      reduceTransparency={reduceTransparency}
      style={[style, { borderRadius: cornerRadius }]}
    >
      {children}
    </Frost>
  );
}
