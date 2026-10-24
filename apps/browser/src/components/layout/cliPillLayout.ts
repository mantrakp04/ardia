import { createStore } from "zustand/vanilla";

export const CLI_PILL_BOTTOM = 12;
export const CLI_PILL_HEIGHT = 32;
export const CLI_PILL_INSET = 12;
export const CLI_PILL_CLEARANCE = CLI_PILL_BOTTOM + CLI_PILL_HEIGHT + 10;

const STATUS_BUBBLE_INSET = 6;
const STATUS_BUBBLE_GAP = 8;
const STATUS_BUBBLE_MIN_WIDTH = 120;

export const statusBubbleWidth = (paneWidth: number) => Math.max(160, paneWidth / 2);

export function statusBubblePlacement(paneWidth: number, pillWidth: number): { maxWidth: number; bottom: number } {
  const maxWidth = statusBubbleWidth(paneWidth);
  if (pillWidth <= 0) return { maxWidth, bottom: STATUS_BUBBLE_INSET };
  const room = (paneWidth - pillWidth) / 2 - STATUS_BUBBLE_INSET - STATUS_BUBBLE_GAP;
  if (room >= STATUS_BUBBLE_MIN_WIDTH) return { maxWidth: Math.min(maxWidth, room), bottom: STATUS_BUBBLE_INSET };
  return { maxWidth, bottom: CLI_PILL_BOTTOM + CLI_PILL_HEIGHT + STATUS_BUBBLE_GAP };
}

export function cliPillHost({ activeId, fullscreenTab, peekId }: { activeId?: string; fullscreenTab?: string | null; peekId?: string }): string | undefined {
  return peekId ?? fullscreenTab ?? activeId;
}

export type CliPillPlacement = { tabId: string; width: number };
export type CliPillPlacements = Record<string, CliPillPlacement>;

export const cliPillPlacements = createStore<CliPillPlacements>(() => ({}));

export function placeCliPill(windowId: string, tabId: string, width: number) {
  const current = cliPillPlacements.getState()[windowId];
  if (current?.tabId === tabId && current.width === width) return;
  cliPillPlacements.setState({ [windowId]: { tabId, width } });
}

export function withdrawCliPill(windowId: string, tabId: string) {
  const placements = cliPillPlacements.getState();
  if (placements[windowId]?.tabId !== tabId) return;
  const rest = { ...placements };
  delete rest[windowId];
  cliPillPlacements.setState(rest, true);
}

export const cliPillWidthIn = (placements: CliPillPlacements, windowId: string, tabId: string): number =>
  placements[windowId]?.tabId === tabId ? (placements[windowId]?.width ?? 0) : 0;

export const pageToastLift = (placements: CliPillPlacements, windowId: string, tabId: string, toastBottom: number): number =>
  cliPillWidthIn(placements, windowId, tabId) > 0 ? Math.max(0, CLI_PILL_CLEARANCE - toastBottom) : 0;

type Span = { x: number; width: number };

export function windowToastLift(
  placements: CliPillPlacements,
  windowId: string,
  panes: Record<string, Span | undefined>,
  toast: { width: number; containerWidth: number; bottom: number },
): number {
  const placement = placements[windowId];
  const pane = placement ? panes[placement.tabId] : undefined;
  if (!placement || !pane || placement.width <= 0) return 0;
  const pillLeft = pane.x + (pane.width - placement.width) / 2;
  const toastLeft = (toast.containerWidth - toast.width) / 2;
  const overlaps = pillLeft < toastLeft + toast.width && toastLeft < pillLeft + placement.width;
  return overlaps ? Math.max(0, CLI_PILL_CLEARANCE - toast.bottom) : 0;
}

type PillTheme = { dark: boolean; panel: string; panelBorder: string; textPrimary: string };

export function cliPillColors(theme: PillTheme) {
  return {
    fill: theme.panel,
    border: theme.panelBorder,
    title: theme.textPrimary,
    detail: theme.dark ? "#FFFFFFB3" : "#000000B3",
    glyphFill: theme.textPrimary,
    glyph: theme.dark ? "#000000" : "#FFFFFF",
    stopText: theme.textPrimary,
    stopFill: (state: "rest" | "hovered" | "pressed") =>
      theme.dark ? `rgba(255,255,255,${state === "pressed" ? 0.18 : state === "hovered" ? 0.14 : 0.1})` : `rgba(0,0,0,${state === "pressed" ? 0.12 : state === "hovered" ? 0.09 : 0.06})`,
  };
}
