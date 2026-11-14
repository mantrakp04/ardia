import { forwardRef, useEffect, type ComponentType } from "react";
import { View, type ViewProps } from "react-native";
import { EngineWebView } from "../engine/EngineWebView";
import { engineAvailable } from "../engine/host";
import { noteFirstWindow, noteMissing } from "../missing";
import { Symbol } from "../symbol/Symbol";
import { WindowDragRegion } from "../windowDragRegion";
import { viewsDrawnInJs } from "./index";
import type { ViewByName } from "./shared";

const known = new Map<string, ViewByName>([...viewsDrawnInJs, ["ArdiaAppWindows", WindowDragRegion], ["ArdiaSymbol", Symbol]]);

const withEngine = new Map<string, ViewByName>([["ArdiaWebView", EngineWebView]]);

const views = new Map<string, ViewByName>();

export function registerView(name: string, view: ViewByName) {
  known.set(name, view);
  views.delete(name);
}

function placeholderFor(name: string): ViewByName {
  return forwardRef<View, ViewProps>(function Placeholder(props, ref) {
    useEffect(() => {
      noteFirstWindow();
      noteMissing(`<${name}>`);
    }, []);
    return <View {...props} pointerEvents={props.pointerEvents ?? "box-none"} ref={ref} />;
  });
}

export function viewOnWindows(name: string): ViewByName {
  const cached = views.get(name);
  if (cached) return cached;
  const made = known.get(name) ?? (engineAvailable() ? withEngine.get(name) : undefined) ?? placeholderFor(name);
  made.displayName = name;
  views.set(name, made);
  return made;
}

export function viewNamed<Props>(name: string): ComponentType<Props> {
  return viewOnWindows(name) as ComponentType<Props>;
}
