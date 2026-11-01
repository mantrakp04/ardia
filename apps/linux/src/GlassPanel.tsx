import { Panel as BrowserPanel, type PanelProps } from "../../browser/src/components/ui/Panel";
import { GlassOptIn } from "./shellGlass";

export type { PanelProps };

export function Panel(props: PanelProps) {
  return (
    <GlassOptIn.Provider value={true}>
      <BrowserPanel {...props} />
    </GlassOptIn.Provider>
  );
}
