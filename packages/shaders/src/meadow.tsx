import { requireNativeViewManager } from "expo-modules-core";
import type { ComponentType } from "react";
import type { ViewProps } from "react-native";
import type { MeadowProps, MeadowTone } from "./index";

type NativeMeadowProps = ViewProps & { night: boolean; onTone?: (event: { nativeEvent: MeadowTone }) => void };

let NativeMeadow: ComponentType<NativeMeadowProps> | null = null;

export function Meadow({ onTone, ...props }: MeadowProps) {
  NativeMeadow ??= requireNativeViewManager<NativeMeadowProps>("ArdiaMeadow");
  return <NativeMeadow pointerEvents="none" {...props} onTone={onTone ? (event) => onTone(event.nativeEvent) : undefined} />;
}
