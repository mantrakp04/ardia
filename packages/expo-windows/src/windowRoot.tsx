import { createElement, type ReactNode } from "react";
import { AppRegistry } from "react-native";
import { WindowIdContext } from "./engine/windowId";
import { OutsidePressRoot } from "./views/index";
import { TitleBandDrag } from "./windowDragRegion";

type RootProps = { children?: ReactNode; initialProps?: { windowId?: unknown } | null };

function WindowRoot({ children, initialProps }: RootProps) {
  const windowId = typeof initialProps?.windowId === "string" ? initialProps.windowId : "";
  return createElement(WindowIdContext.Provider, { value: windowId }, createElement(OutsidePressRoot, null, createElement(TitleBandDrag, null, children)));
}

let installed = false;

export function installWindowRoot() {
  if (installed) return;
  installed = true;
  AppRegistry.setWrapperComponentProvider(() => WindowRoot);
}
