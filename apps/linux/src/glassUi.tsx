import type { ComponentProps } from "react";
import { Surface as BrowserSurface } from "../../browser/src/components/ui";
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
