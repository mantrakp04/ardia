export type IncomingLink =
  | { kind: "open"; url: string }
  | { kind: "search"; query: string | null }
  | { kind: "voiceSearch" }
  | { kind: "incognito" }
  | { kind: "tab"; id: string }
  | { kind: "macTabs" }
  | { kind: "inbox" };

export type LinkState = { onboarding: boolean; syncEnabled: boolean; canSearchByVoice: boolean; hasTab: (id: string) => boolean };

export type LinkAction =
  | { kind: "hold" }
  | { kind: "openUrl"; url: string }
  | { kind: "tray"; query: string; incognito: boolean }
  | { kind: "voice" }
  | { kind: "switchTab"; id: string }
  | { kind: "spaces" }
  | { kind: "syncSettings" }
  | { kind: "inbox" }
  | { kind: "none" };

const WEB = /^https?:\/\//i;

export function linkAction(link: IncomingLink, state: LinkState): LinkAction {
  if (state.onboarding && link.kind !== "inbox") return { kind: "hold" };
  switch (link.kind) {
    case "open":
      return WEB.test(link.url.trim()) ? { kind: "openUrl", url: link.url.trim() } : { kind: "none" };
    case "search":
      return { kind: "tray", query: link.query?.trim() ?? "", incognito: false };
    case "voiceSearch":
      return state.canSearchByVoice ? { kind: "voice" } : { kind: "tray", query: "", incognito: false };
    case "incognito":
      return { kind: "tray", query: "", incognito: true };
    case "tab":
      return state.hasTab(link.id) ? { kind: "switchTab", id: link.id } : { kind: "none" };
    case "macTabs":
      return state.syncEnabled ? { kind: "spaces" } : { kind: "syncSettings" };
    case "inbox":
      return { kind: "inbox" };
  }
}

export function heldAfterOnboarding(held: readonly IncomingLink[]): IncomingLink[] {
  const last = held.filter((link) => link.kind !== "inbox").at(-1);
  return last ? [last] : [];
}

export const opensLaunchTray = (autoOpensKeyboard: boolean, held: readonly IncomingLink[]) => autoOpensKeyboard && heldAfterOnboarding(held).length === 0;
