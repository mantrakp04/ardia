import { Surface } from "@ardia/shell";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { clickTab } from "../sidebar/actions";
import { cardHoverProps, dismissHover } from "../sidebar/hover";
import { useSidebarSide } from "../layout/windowLayout";
import { hoverCardOrigin } from "../sidebar/hoverMotion";
import { measureRow, setSidebarUi, type Anchor } from "../sidebar/state";
import { useSidebarWidth } from "../sidebar/tokens";
import { MINI_PLAYER_HEIGHT, MINI_PLAYER_WIDTH, MiniPlayer } from "./MiniPlayer";
import { useMedia } from "./state";
import { useMediaTokens } from "./tokens";

export function useShowsMiniPlayer(tabId: string | undefined): boolean {
  const pinned = useBrowser((s) => !!tabId && !!s.tabs[tabId]?.pinned && s.settings.sidebarMediaControls);
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
  const theme = useTheme();
  const tokens = useMediaTokens();
  const side = useSidebarSide();
  const edge = usePlayerEdge(windowId, anchor, windowWidth);
  return (
    <Surface
      {...cardHoverProps}
      fill={tokens.background}
      cornerRadius={12}
      borderColor={hex(tokens.border)}
      borderWidth={0.5}
      shadowColor="#000000"
      shadowOpacity={theme.panelShadowOpacity * 0.8}
      shadowRadius={16}
      shadowOffset={[0, 6]}
      style={{ position: "absolute", ...hoverCardOrigin(anchor, MINI_PLAYER_WIDTH, side, edge), width: MINI_PLAYER_WIDTH, height: MINI_PLAYER_HEIGHT }}
    >
      <MiniPlayer
        tabId={tabId}
        onBackToTab={() => {
          dismissHover();
          clickTab(windowId, tabId);
        }}
      />
    </Surface>
  );
}

if (__DEV__) {
  (globalThis as { acMediaHover?: unknown }).acMediaHover = async (windowId: string, tabId: string | null) => {
    if (!tabId) return setSidebarUi({ hover: null });
    const anchor = await measureRow(windowId, tabId);
    if (anchor) setSidebarUi({ hover: { windowId, kind: "tab", id: tabId, anchor } });
    return anchor;
  };
}
