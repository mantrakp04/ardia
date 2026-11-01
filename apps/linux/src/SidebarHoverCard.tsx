import { PageOverlayRegion } from "./PageOverlayRegion";
import { GlassOptIn } from "./shellGlass";
import { HoverCard as BrowserHoverCard } from "../../browser/src/components/sidebar/HoverCard";

export function HoverCard(props: React.ComponentProps<typeof BrowserHoverCard>) {
  return (
    <PageOverlayRegion testID="ardia-sidebar-hover">
      <GlassOptIn.Provider value={true}>
        <BrowserHoverCard {...props} />
      </GlassOptIn.Provider>
    </PageOverlayRegion>
  );
}
