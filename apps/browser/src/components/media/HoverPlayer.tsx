import { devRegister } from "../dev/devRegister";
import { HoverCard } from "../ui";
import { layout } from "../ui/theme";
import { clickTab } from "../../state/sidebar/actions";
import { dismissHover } from "../../state/sidebar/hover";
import { cardHoverProps } from "../sidebar/hoverController";
import { hoverCardOrigin } from "../sidebar/hoverMotion";
import { measureRow, setSidebarUi, type Anchor } from "../../state/sidebar/sidebarUi";
import { useSidebarWidth } from "../../state/sidebar/hooks";
import { MINI_PLAYER_HEIGHT, MINI_PLAYER_WIDTH, MiniPlayer } from "./MiniPlayer";
import { useMedia, usePinnedWithMediaControls } from "../../state/media/media";

export function useShowsMiniPlayer(tabId: string | undefined): boolean {
  const pinned = usePinnedWithMediaControls(tabId);
  const hasSession = useMedia((s) => {
    const session = tabId ? s.sessions[tabId] : undefined;
    return !!session && session.controllable && session.playbackState !== "none" && !!(session.title || session.artwork);
  });
  return pinned && hasSession;
}

export function usePlayerEdge(windowId: string, anchor: Anchor | undefined): number {
  const sidebarWidth = useSidebarWidth(windowId);
  return anchor ? Math.max(anchor.x + anchor.width, sidebarWidth - layout.sidebarInset) : 0;
}

export function HoverPlayer({ tabId, windowId, anchor }: { tabId: string; windowId: string; anchor: Anchor }) {
  const edge = usePlayerEdge(windowId, anchor);
  return (
    <HoverCard {...cardHoverProps} width={MINI_PLAYER_WIDTH} pad="none" style={{ position: "absolute", ...hoverCardOrigin(anchor, edge), height: MINI_PLAYER_HEIGHT }}>
      <MiniPlayer
        tabId={tabId}
        onBackToTab={() => {
          dismissHover();
          clickTab(windowId, tabId);
        }}
      />
    </HoverCard>
  );
}

devRegister("acMediaHover", null, async (windowId: string, tabId: string | null) => {
  if (!tabId) return setSidebarUi({ hover: null });
  const anchor = await measureRow(windowId, tabId);
  if (anchor) setSidebarUi({ hover: { windowId, kind: "tab", id: tabId, anchor } });
  return anchor;
});
