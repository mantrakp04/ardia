import { createElement, forwardRef, useEffect, type ComponentType } from "react";
import type { SymbolProps } from "@ardia/shell";
import { processColor, View, type ViewProps } from "react-native";
import { useAppDark } from "../views/appearance";
import * as NativeComponentRegistry from "react-native/Libraries/NativeComponent/NativeComponentRegistry";
import { noteMissing } from "../missing";
import { NATIVE_DEFAULT_POINT_SIZE, vectorIcon, type VectorLayer } from "./layers";

type NativeVectorIconProps = ViewProps & { symbolKey: string; layers: VectorLayer[]; color?: string };

const NativeVectorIcon = NativeComponentRegistry.get<NativeVectorIconProps>("ArdiaVectorIcon", () => ({
  uiViewClassName: "ArdiaVectorIcon",
  validAttributes: {
    symbolKey: true,
    layers: true,
    color: { process: processColor as (value: never) => unknown },
  },
}));

const LABEL_COLOR = { light: "rgba(0, 0, 0, 0.85)", dark: "rgba(255, 255, 255, 0.85)" };

export const Symbol = forwardRef<unknown, SymbolProps>(function Symbol({ name, size = NATIVE_DEFAULT_POINT_SIZE, weight = "regular", color, ...props }, ref) {
  const scheme = useAppDark(undefined) ? "dark" : "light";
  const icon = vectorIcon(name, size, weight);
  useEffect(() => {
    if (!icon) noteMissing(`symbol ${name}`);
  }, [icon, name]);
  if (!icon) return createElement(View as ComponentType<ViewProps & { ref?: unknown }>, { pointerEvents: "none", ...props, ref });
  return createElement(NativeVectorIcon as unknown as ComponentType<NativeVectorIconProps & { ref?: unknown }>, {
    pointerEvents: "none",
    ...props,
    ref,
    symbolKey: icon.key,
    layers: icon.layers,
    color: color ?? (scheme === "dark" ? LABEL_COLOR.dark : LABEL_COLOR.light),
  });
});

Symbol.displayName = "ArdiaSymbol";
