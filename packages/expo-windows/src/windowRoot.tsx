import { createElement, type ReactNode } from "react";
import { AppRegistry } from "react-native";
import { OutsidePressRoot } from "./views/index";
import { TitleBandDrag } from "./windowDragRegion";

function WindowRoot({ children }: { children?: ReactNode }) {
  return createElement(OutsidePressRoot, null, createElement(TitleBandDrag, null, children));
}

let installed = false;

export function installWindowRoot() {
  if (installed) return;
  installed = true;
  AppRegistry.setWrapperComponentProvider(() => WindowRoot);
}
