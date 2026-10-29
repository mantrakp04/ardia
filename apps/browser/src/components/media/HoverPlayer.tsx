import { devRegister } from "../dev/devRegister";
import { Panel } from "../ui";
import { layout } from "../ui/theme";
import { clickTab } from "../../state/sidebar/actions";
import { dismissHover } from "../../state/sidebar/hover";
import { cardHoverProps } from "../sidebar/hoverController";
import { hoverCardOrigin } from "../sidebar/hoverMotion";
import { useSidebarSide } from "../../state/windows/layout";
import { measureRow, setSidebarUi, type Anchor } from "../../state/sidebar/sidebarUi";
import { useSidebarWidth } from "../../state/sidebar/hooks";
import { MINI_PLAYER_HEIGHT, MINI_PLAYER_WIDTH, MiniPlayer } from "./MiniPlayer";
import { useMedia, usePinnedWithMediaControls } from "../../state/media/media";
import { HOVER_CARD, useMediaTokens } from "./tokens";

export function useShowsMiniPlayer(tabId: string | undefined): boolean {
  const pinned = usePinnedWithMediaControls(tabId);
  const hasSession = useMedia((s) => {
    const session = tabId ? s.sessions[tabId] : undefined;
    return !!session && session.controllable && session.playbackState !== "none" && !!(session.title || session.artwork);
  });
  return pinned && hasSession;
}

export function usePlayerEdge(windowId: string, anchor: Anchor | undefined, windowWidth: number): number {
  const sidebarWidth = useSidebarWidth(windowId);
  const side = useSidebarSide();
  if (!anchor) return 0;
  return side === "right"
    ? Math.min(anchor.x, windowWidth - sidebarWidth + layout.sidebarInset)
    : Math.max(anchor.x + anchor.width, sidebarWidth - layout.sidebarInset);
}

export function HoverPlayer({ tabId, windowId, anchor, windowWidth }: { tabId: string; windowId: string; anchor: Anchor; windowWidth: number }) {
  const tokens = useMediaTokens();
  const side = useSidebarSide();
  const edge = usePlayerEdge(windowId, anchor, windowWidth);
  return (
    <Panel
      {...cardHoverProps}
      fill={tokens.background}
      radius={HOVER_CARD.radius}
      border={tokens.border}
      shadow={HOVER_CARD.shadow}
      style={{ position: "absolute", ...hoverCardOrigin(anchor, MINI_PLAYER_WIDTH, side, edge), width: MINI_PLAYER_WIDTH, height: MINI_PLAYER_HEIGHT }}
    >
      <MiniPlayer
        tabId={tabId}
        onBackToTab={() => {
          dismissHover();
          clickTab(windowId, tabId);
        }}
      />
    </Panel>
  );
}

devRegister("acMediaHover", null, async (windowId: string, tabId: string | null) => {
  if (!tabId) return setSidebarUi({ hover: null });
  const anchor = await measureRow(windowId, tabId);
  if (anchor) setSidebarUi({ hover: { windowId, kind: "tab", id: tabId, anchor } });
  return anchor;
});
