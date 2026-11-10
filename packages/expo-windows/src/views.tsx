import { createElement, forwardRef, useEffect, type ComponentType } from "react";
import type { FadeLabelProps } from "@ardia/shell";
import { Text, View, type TextStyle } from "react-native";
import { noteFirstWindow, noteMissing } from "./missing";
import { WindowDragRegion } from "./windowDragRegion";

type AnyProps = Record<string, unknown> & { children?: unknown };

const FONT_WEIGHT: Record<NonNullable<FadeLabelProps["weight"]>, TextStyle["fontWeight"]> = { light: "300", regular: "400", medium: "500", semibold: "600", bold: "700" };

const Label = forwardRef<unknown, FadeLabelProps>(function Label({ text, fontSize, weight, color, fadeWidth: _fadeWidth, style, ...rest }, ref) {
  useEffect(noteFirstWindow, []);
  return createElement(
    View as ComponentType<AnyProps>,
    { ...rest, style, ref },
    createElement(Text, { numberOfLines: 1, style: { fontSize, color, fontWeight: weight ? FONT_WEIGHT[weight] : undefined } }, text),
  );
});

const drawnInJs = new Map<string, ComponentType<AnyProps>>([
  ["ArdiaFadeLabel", Label as unknown as ComponentType<AnyProps>],
  ["ArdiaAppWindows", WindowDragRegion as unknown as ComponentType<AnyProps>],
]);

const views = new Map<string, ComponentType<AnyProps>>();

export function viewOnWindows(name: string): ComponentType<AnyProps> {
  const cached = views.get(name);
  if (cached) return cached;
  const made =
    drawnInJs.get(name) ??
    (forwardRef<unknown, AnyProps>(function Placeholder(props, ref) {
      useEffect(() => {
        noteFirstWindow();
        noteMissing(`<${name}>`);
      }, []);
      return createElement(View as ComponentType<AnyProps>, { ...props, ref });
    }) as ComponentType<AnyProps>);
  made.displayName = name;
  views.set(name, made);
  return made;
}
