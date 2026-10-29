export type CardChrome = { kind: "none" } | { kind: "pane" | "window"; autoHide: boolean };

export type PaneBar =
  | { kind: "none" }
  | { kind: "toolbar" }
  | { kind: "backdrop" }
  | { kind: "spacer" }
  | { kind: "autoHide"; bar: "pane" | "window" | "backdrop" | null };

export function cardChrome(o: { addressInSidebar: boolean; small: boolean; split: boolean; fullscreen: boolean; hideWhileScrolling: boolean }): CardChrome {
  if (o.addressInSidebar || o.small) return { kind: "none" };
  return { kind: o.split || o.fullscreen ? "pane" : "window", autoHide: o.hideWhileScrolling };
}

export function paneBar(chrome: CardChrome, pane: { visible: boolean; fullscreen: boolean; lingering: boolean }): PaneBar {
  if (chrome.kind === "none" || pane.fullscreen) return { kind: "none" };
  if (chrome.autoHide) {
    if (!pane.visible) return { kind: "autoHide", bar: null };
    if (chrome.kind === "pane") return { kind: "autoHide", bar: "pane" };
    return { kind: "autoHide", bar: pane.lingering ? "backdrop" : "window" };
  }
  if (!pane.visible) return { kind: "spacer" };
  return { kind: chrome.kind === "pane" ? "toolbar" : "backdrop" };
}
