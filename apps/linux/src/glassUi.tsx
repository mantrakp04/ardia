import type { ComponentProps } from "react";
import { Surface as BrowserSurface, WindowBackdrop as BrowserWindowBackdrop } from "../../browser/src/components/ui";
import { AbovePages } from "./shellAbove";
import { GlassOptIn } from "./shellGlass";

export * from "../../browser/src/components/ui";
export { Panel } from "./GlassPanel";

export function Surface(props: ComponentProps<typeof BrowserSurface>) {
  return (
    <GlassOptIn.Provider value={true}>
      <BrowserSurface {...props} />
    </GlassOptIn.Provider>
  );
}

export function WindowBackdrop(props: ComponentProps<typeof BrowserWindowBackdrop>) {
  return (
    <AbovePages.Provider value={true}>
      <BrowserWindowBackdrop {...props} />
    </AbovePages.Provider>
  );
}
