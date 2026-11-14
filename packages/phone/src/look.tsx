import { createElement, type ComponentType, type ReactNode } from "react";
import { requireNativeViewManager, requireOptionalNativeModule } from "expo-modules-core";
import { View, type ViewProps } from "react-native";

export const INCOGNITO_LOOK = "incognito";

export type LookColors = { color?: string | null; themeColors?: string[]; darkThemeColors?: string[] | null };

export type DeckBackdropProps = ViewProps & LookColors & { dark?: boolean; reduceMotion?: boolean; reduceTransparency?: boolean };

export type ProfileBackdropProps = ViewProps & LookColors & { dark?: boolean; themed?: boolean; softened?: boolean; fadesOut?: boolean };

export type FilmGrainProps = ViewProps & { opacity?: number; children?: ReactNode };

export type FrostSourceProps = ViewProps & { name: string; children?: ReactNode };

export type FrostVariant = "bar" | "sheet" | "glass" | "thin";

export type FrostProps = ViewProps &
  LookColors & { source: string; variant?: FrostVariant; cornerRadius?: number; dark?: boolean; reduceTransparency?: boolean; children?: ReactNode };

type LookNative = { setPageFrost?: (mode: "live" | "solid") => string; probeFrosts?: () => void };

const lookNative = requireOptionalNativeModule<LookNative>("ArdiaPhoneLook");

const hasNativeLook = lookNative !== null;

export const lookLab = {
  setPageFrost: (mode: "live" | "solid"): string | null => lookNative?.setPageFrost?.(mode) ?? null,
  probeFrosts: () => lookNative?.probeFrosts?.(),
};

const views = new Map<string, ComponentType<object>>();

function look<P extends ViewProps>(name: string) {
  return function LookView(props: P) {
    if (!hasNativeLook) {
      const { style, children, testID, pointerEvents } = props as ViewProps & { children?: ReactNode };
      return createElement(View, { style, testID, pointerEvents }, children);
    }
    let native = views.get(name);
    if (!native) {
      native = requireNativeViewManager<object>("ArdiaPhoneLook", name);
      views.set(name, native);
    }
    return createElement(native, props);
  };
}

export const lookIsNative = () => hasNativeLook;

export const DeckBackdrop = look<DeckBackdropProps>("DeckBackdrop");

export const ProfileBackdrop = look<ProfileBackdropProps>("ProfileBackdrop");

export const FilmGrain = look<FilmGrainProps>("FilmGrain");

export const FrostSource = look<FrostSourceProps>("FrostSource");

export const Frost = look<FrostProps>("Frost");
