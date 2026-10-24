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

export type CliPillLabel = { detail: string; glyph: boolean };

export const CLI_PILL_LABELS: readonly (CliPillLabel & { width: number })[] = [
  { detail: " is controlling Ardia", glyph: true, width: 236 },
  { detail: " is in control", glyph: true, width: 196 },
  { detail: " is in control", glyph: false, width: 172 },
  { detail: "", glyph: true, width: 128 },
  { detail: "", glyph: false, width: 104 },
];

export function cliPillLabel(paneWidth: number): CliPillLabel {
  const room = paneWidth - 2 * CLI_PILL_INSET;
  const label = CLI_PILL_LABELS.find((l) => l.width <= room) ?? CLI_PILL_LABELS[CLI_PILL_LABELS.length - 1]!;
  return { detail: label.detail, glyph: label.glyph };
}

export function cliPillHost({ activeId, fullscreenTab, peekId }: { activeId?: string; fullscreenTab?: string | null; peekId?: string }): string | undefined {
  return peekId ?? fullscreenTab ?? activeId;
}

export type CliPillPlacement = { tabId: string; width: number };
export type CliPillPlacements = Record<string, CliPillPlacement>;

export const cliPillPlacements = createStore<CliPillPlacements>(() => ({}));

const cliPillOwners = new Map<string, Map<object, CliPillPlacement>>();

function publishCliPill(windowId: string) {
  const owners = cliPillOwners.get(windowId);
  const latest = owners ? [...owners.values()].at(-1) : undefined;
  const placements = cliPillPlacements.getState();
  const current = placements[windowId];
  if (latest && current?.tabId === latest.tabId && current.width === latest.width) return;
  if (!latest && !current) return;
  const next = { ...placements };
  if (latest) next[windowId] = latest;
  else delete next[windowId];
  cliPillPlacements.setState(next, true);
}

export function placeCliPill(windowId: string, owner: object, tabId: string, width: number) {
  const owners = cliPillOwners.get(windowId) ?? new Map<object, CliPillPlacement>();
  cliPillOwners.set(windowId, owners);
  owners.delete(owner);
  owners.set(owner, { tabId, width });
  publishCliPill(windowId);
}

export const cliPillWidthSeed = (windowId: string, shown: boolean): number => (shown ? (cliPillPlacements.getState()[windowId]?.width ?? 0) : 0);

export function withdrawCliPill(windowId: string, owner: object) {
  const owners = cliPillOwners.get(windowId);
  if (!owners?.delete(owner)) return;
  if (!owners.size) cliPillOwners.delete(windowId);
  publishCliPill(windowId);
}

export function resetCliPillPlacements() {
  cliPillOwners.clear();
  cliPillPlacements.setState({}, true);
}

export const cliPillWidthIn = (placements: CliPillPlacements, windowId: string, tabId: string): number =>
  placements[windowId]?.tabId === tabId ? (placements[windowId]?.width ?? 0) : 0;

export const cliPillClearance = (pillShown: boolean, base = 0): number => (pillShown ? Math.max(base, CLI_PILL_CLEARANCE) : base);

export const pageToastLift = (placements: CliPillPlacements, windowId: string, tabId: string, toastBottom: number): number =>
  cliPillWidthIn(placements, windowId, tabId) > 0 ? Math.max(0, CLI_PILL_CLEARANCE - toastBottom) : 0;

type PaneRect = { x: number; y: number; width: number; height: number };

export const windowPillWidth = (placements: CliPillPlacements, windowId: string): number => placements[windowId]?.width ?? 0;

export function windowToastLift(
  placements: CliPillPlacements,
  windowId: string,
  pill: { hostTab: string | undefined; panes: Record<string, PaneRect | undefined> },
  toast: { width: number; height: number; containerWidth: number; containerHeight: number; bottom: number },
): number {
  const pillWidth = windowPillWidth(placements, windowId);
  const pane = pill.hostTab ? pill.panes[pill.hostTab] : undefined;
  if (!pane || pillWidth <= 0) return 0;
  const pillLeft = pane.x + (pane.width - pillWidth) / 2;
  const toastLeft = (toast.containerWidth - toast.width) / 2;
  const pillBottom = Math.max(0, toast.containerHeight - (pane.y + pane.height)) + CLI_PILL_BOTTOM;
  const acrossOverlap = pillLeft < toastLeft + toast.width && toastLeft < pillLeft + pillWidth;
  const upOverlap = toast.bottom < pillBottom + CLI_PILL_HEIGHT && pillBottom < toast.bottom + toast.height;
  return acrossOverlap && upOverlap ? Math.max(0, pillBottom - CLI_PILL_BOTTOM + CLI_PILL_CLEARANCE - toast.bottom) : 0;
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
