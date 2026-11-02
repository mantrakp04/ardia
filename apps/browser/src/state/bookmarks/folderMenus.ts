import { create } from "zustand";

export type MenuRect = { x: number; y: number; width: number; height: number };

export type FolderMenuPanel = {
  key: string;
  parentId: string;
  fromIndex: number;
  anchor: MenuRect;
  level: number;
  retained?: boolean;
};

type FolderMenus = {
  windowId: string | null;
  panels: FolderMenuPanel[];
  sprung: boolean;
  held: string | null;
};

const CLOSED: FolderMenus = { windowId: null, panels: [], sprung: false, held: null };

export const useFolderMenus = create<FolderMenus>()(() => CLOSED);

if (__DEV__) (globalThis as { acFolderMenus?: typeof useFolderMenus }).acFolderMenus = useFolderMenus;

const TOGGLE_CLOSE_MS = 300;
let lastClosed: { key: string; at: number } | null = null;

export const panelKey = (parentId: string, fromIndex = 0) => (fromIndex ? `${parentId}+${fromIndex}` : parentId);

export const folderMenuOpen = (windowId: string) => {
  const s = useFolderMenus.getState();
  return s.windowId === windowId && s.panels.some((p) => !p.retained);
};

export const openPanelKey = (windowId: string, level: number) => {
  const s = useFolderMenus.getState();
  return s.windowId === windowId ? (s.panels.find((p) => p.level === level && !p.retained)?.key ?? null) : null;
};

function keepHeld(s: FolderMenus, kept: FolderMenuPanel[]): FolderMenuPanel[] {
  if (!s.held || kept.some((p) => p.key === s.held)) return kept;
  const held = s.panels.find((p) => p.key === s.held);
  return held ? [{ ...held, retained: true }, ...kept] : kept;
}

export function openFolderMenu(windowId: string, panel: Omit<FolderMenuPanel, "key">, { sprung = false } = {}) {
  const key = panelKey(panel.parentId, panel.fromIndex);
  const s = useFolderMenus.getState();
  const same = s.windowId === windowId;
  const live = same ? s.panels.filter((p) => !p.retained) : [];
  if (live.some((p) => p.level === panel.level && p.key === key)) return;
  const kept = live.filter((p) => p.level < panel.level);
  const next = keepHeld(same ? s : { ...s, panels: [] }, [...kept, { ...panel, key }]);
  useFolderMenus.setState({ windowId, panels: next, sprung: panel.level === 0 ? sprung : s.sprung || sprung });
}

export function toggleFolderMenu(windowId: string, panel: Omit<FolderMenuPanel, "key" | "level">) {
  const key = panelKey(panel.parentId, panel.fromIndex);
  if (openPanelKey(windowId, 0) === key) return closeFolderMenus();
  if (lastClosed?.key === key && Date.now() - lastClosed.at < TOGGLE_CLOSE_MS) return;
  openFolderMenu(windowId, { ...panel, level: 0 });
}

export function closeMenusAbove(windowId: string, level: number) {
  const s = useFolderMenus.getState();
  if (s.windowId !== windowId || !s.panels.some((p) => p.level > level && !p.retained)) return;
  useFolderMenus.setState({ panels: keepHeld(s, s.panels.filter((p) => p.level <= level && !p.retained)) });
}

export function closeFolderMenus({ outside = false } = {}) {
  const s = useFolderMenus.getState();
  if (!s.panels.length) return;
  const root = s.panels.find((p) => p.level === 0 && !p.retained);
  if (outside && root) lastClosed = { key: root.key, at: Date.now() };
  const panels = keepHeld(s, []);
  useFolderMenus.setState(panels.length ? { panels, sprung: false } : CLOSED);
}

export function closeSprungMenus() {
  if (useFolderMenus.getState().sprung) closeFolderMenus();
}

export function holdMenuPanel(key: string | null) {
  const s = useFolderMenus.getState();
  if (key) return void useFolderMenus.setState({ held: key });
  const panels = s.panels.filter((p) => !p.retained);
  useFolderMenus.setState(panels.length ? { held: null, panels } : CLOSED);
}
