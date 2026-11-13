import { createElement, type ReactNode } from "react";
import { AppRegistry, TurboModuleRegistry } from "react-native";
import type { WindowsHostModule } from "./nativeModuleTypes";
import { WindowIdContext } from "./engine/windowId";
import { SelfCheckStage } from "./selfCheck/stage";
import { OutsidePressRoot } from "./views/index";
import { TitleBandDrag } from "./windowDragRegion";

type RootProps = { children?: ReactNode; initialProps?: { windowId?: unknown } | null };

const selfChecking = () => !!TurboModuleRegistry.get<WindowsHostModule>("ArdiaWindowsHost")?.getConstants?.()?.selfCheck;

function WindowRoot({ children, initialProps }: RootProps) {
  const windowId = typeof initialProps?.windowId === "string" ? initialProps.windowId : "";
  const stage = stagesSelfChecks ? createElement(SelfCheckStage) : null;
  return createElement(WindowIdContext.Provider, { value: windowId }, createElement(OutsidePressRoot, null, createElement(TitleBandDrag, null, children), stage));
}

let installed = false;
let stagesSelfChecks = false;

export function installWindowRoot() {
  if (installed) return;
  installed = true;
  stagesSelfChecks = selfChecking();
  AppRegistry.setWrapperComponentProvider(() => WindowRoot);
}
