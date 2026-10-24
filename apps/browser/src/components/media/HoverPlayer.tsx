import { Surface } from "@ardia/shell";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { clickTab } from "../sidebar/actions";
import { cardHoverProps, dismissHover } from "../sidebar/hover";
import { useSidebarOnRight } from "../layout/windowLayout";
import { hoverCardOrigin } from "../sidebar/hoverMotion";
import { measureForHover, setSidebarUi, type Anchor } from "../sidebar/state";
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

export function HoverPlayer({ tabId, windowId, anchor, edge }: { tabId: string; windowId: string; anchor: Anchor; edge: number }) {
  const theme = useTheme();
  const tokens = useMediaTokens();
  const right = useSidebarOnRight();
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
      style={{ position: "absolute", ...hoverCardOrigin(anchor, right, MINI_PLAYER_WIDTH, edge), width: MINI_PLAYER_WIDTH, height: MINI_PLAYER_HEIGHT }}
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
    const measured = await measureForHover(windowId, tabId);
    if (measured) setSidebarUi({ hover: { windowId, kind: "tab", id: tabId, ...measured } });
    return measured?.anchor ?? null;
  };
}
