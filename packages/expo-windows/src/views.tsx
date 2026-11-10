import { createElement, forwardRef, useEffect, type ComponentType } from "react";
import { Text, View, type TextStyle, type ViewProps } from "react-native";
import { noteFirstWindow, noteMissing } from "./missing";

type AnyProps = Record<string, unknown> & { children?: unknown };
type LabelProps = ViewProps & { text?: string; fontSize?: number; weight?: keyof typeof FONT_WEIGHT; color?: string };

const FONT_WEIGHT = { light: "300", regular: "400", medium: "500", semibold: "600", bold: "700" } as const satisfies Record<string, TextStyle["fontWeight"]>;

const Label = forwardRef<unknown, LabelProps>(function Label({ text, fontSize, weight, color, style, ...rest }, ref) {
  useEffect(noteFirstWindow, []);
  return createElement(
    View as ComponentType<AnyProps>,
    { ...rest, style, ref },
    createElement(Text, { numberOfLines: 1, style: { fontSize, color, fontWeight: weight ? FONT_WEIGHT[weight] : undefined } }, text),
  );
});

const drawnInJs: Record<string, ComponentType<AnyProps>> = {
  ArdiaFadeLabel: Label as unknown as ComponentType<AnyProps>,
};

const views = new Map<string, ComponentType<AnyProps>>();

export function viewOnWindows(name: string): ComponentType<AnyProps> {
  const cached = views.get(name);
  if (cached) return cached;
  const made =
    drawnInJs[name] ??
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
