import { createElement, forwardRef, useEffect, type ComponentType } from "react";
import { View } from "react-native";
import { noteFirstWindow, noteMissing } from "../missing";
import { WindowDragRegion } from "../windowDragRegion";
import { viewsDrawnInJs } from "./index";

type AnyProps = Record<string, unknown> & { children?: unknown };

const known = new Map<string, ComponentType<AnyProps>>([
  ...(viewsDrawnInJs as Map<string, ComponentType<AnyProps>>),
  ["ArdiaAppWindows", WindowDragRegion as unknown as ComponentType<AnyProps>],
]);

const views = new Map<string, ComponentType<AnyProps>>();

export function registerView(name: string, view: ComponentType<AnyProps>) {
  known.set(name, view);
  views.delete(name);
}

export function viewOnWindows(name: string): ComponentType<AnyProps> {
  const cached = views.get(name);
  if (cached) return cached;
  const made =
    known.get(name) ??
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
