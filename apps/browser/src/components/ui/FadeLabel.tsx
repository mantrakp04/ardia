import { useContext } from "react";
import { FadeLabel as NativeFadeLabel, type FadeLabelProps } from "@ardia/shell";
import { activeLook } from "../../lib/activeLook";
import type { FontWeight } from "../../lib/themeLook";
import { ThemeContext } from "./theme";

type NativeWeight = NonNullable<FadeLabelProps["weight"]>;

const NAMED: Record<FontWeight, NativeWeight> = {
  "100": "ultraLight",
  "200": "thin",
  "300": "light",
  "400": "regular",
  "500": "medium",
  "600": "semibold",
  "700": "bold",
  "800": "heavy",
  "900": "black",
};

const WEIGHT_NAMES: Partial<Record<NativeWeight, "regular" | "medium" | "semibold" | "bold">> = { regular: "regular", medium: "medium", semibold: "semibold", bold: "bold" };

export function FadeLabel({ weight, ...props }: FadeLabelProps) {
  useContext(ThemeContext);
  const look = activeLook();
  const name = WEIGHT_NAMES[weight ?? "regular"];
  const drawn = name ? NAMED[look.weights[name]] : weight;
  return <NativeFadeLabel {...props} weight={drawn ?? "regular"} fontFamily={look.family ?? ""} />;
}
