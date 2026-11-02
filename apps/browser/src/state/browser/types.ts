import type { TabGroupColor } from "@ardia/core";
import type { PageEngine } from "../../platform/tabs";
import type { ProfileColor, ProfileTheme } from "../../lib/profileLook";

export type { ProfileColor, ProfileTheme, ThemeColor, ThemeLook, ThemeStop } from "../../lib/profileLook";
export type { ThemeMode, ThemeTexture } from "@ardia/core";

export type Frame = [number, number, number, number];

export type Profile = {
  id: string;
  name: string;
  color: ProfileColor;
  icon: string | null;
  createdAt: number;
  dataId?: string;
  theme?: ProfileTheme | null;
  pinnedCollapsed?: boolean;
};

type WindowBase = {
  id: string;
  profileId: string;
  tabIds: string[];
  activeTabIds: Record<string, string>;
  sidebarOpen: boolean;
  tabLayout?: "sidebar" | "top";
  frame: Frame | null;
  fullScreen?: number;
  createdAt: number;
};

export type BrowserWindow =
  | (WindowBase & { kind: "main"; chromeWindow?: string })
  | (WindowBase & { kind: "private"; chromeWindow?: string })
  | (WindowBase & { kind: "small"; linkPointer?: [number, number] });

export type WindowKind = BrowserWindow["kind"];
export type MainWindow = Extract<BrowserWindow, { kind: "main" }>;

export type Tab = {
  id: string;
  windowId: string;
  profileId: string;
  url: string;
  title: string;
  favicon: string | null;
  pin: TabPin | null;
  muted: boolean;
  zoom: number;
  customTitle: string | null;
  customIcon: string | null;
  pinnedUrl: string | null;
  page: TabPage;
  openerId: string | null;
  liveItem?: { folderId: string; itemId: string };
  pinKey?: string;
  engine?: PageEngine;
  createdAt: number;
  lastActiveAt: number;
};

export type AdoptKind = "restore" | "clone" | "tab" | "ardiacore" | "webkit" | "link";
export type AdoptId = `${AdoptKind}:${string}`;

export type Navigation = { url: string; seq: number; userInitiated?: boolean };

export type TabPage =
  | { kind: "idle"; wake?: AdoptId }
  | { kind: "asleep"; wake?: AdoptId }
  | { kind: "frozen"; holderId: string; wake?: AdoptId }
  | { kind: "adopted"; adopt: AdoptId; nav: Navigation | null }
  | { kind: "loaded"; nav: Navigation };

export type TabPin = { as: "tile"; folder?: TileFolder } | { as: "row" };

export type TileFolder = { id: string; name: string; renamedAt?: number };

export type TabLive = {
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  playingAudio: boolean;
  themeColor: string | null;
};

export type GroupColor = TabGroupColor | "none";

export type ClosedGroupInfo = Pick<TabGroup, "id" | "name" | "icon" | "color"> & { pinned?: boolean };

export type TabGroup = {
  id: string;
  windowId: string;
  profileId: string;
  name: string;
  icon: string | null;
  color: GroupColor | null;
  collapsed: boolean;
  pinned: boolean;
  tabIds: string[];
  createdAt: number;
  autoUngroup?: boolean;
  pinnedOpenerId?: string;
  pinKey?: string;
  parentId?: string;
};

export type SplitSlot = { size: number; tabId: string } | { size: number; stack: [string, string]; stackSizes: [number, number] };

export type SplitView = {
  id: string;
  windowId: string;
  orientation: "horizontal" | "vertical";
  slots: SplitSlot[];
};

export type HistoryEntry = {
  url: string;
  title: string;
  favicon: string | null;
  visits: number;
  lastVisit: number;
  visitTimes?: number[];
};

export type BookmarkNode =
  | { kind: "url"; id: string; parentId: string; title: string; url: string; favicon: string | null; addedAt: number; syncKey?: string }
  | { kind: "folder"; id: string; parentId: string | null; title: string; children: string[]; addedAt: number; syncKey?: string };

export type BookmarkFolder = Extract<BookmarkNode, { kind: "folder" }>;

export type Bookmarks = {
  nodes: Record<string, BookmarkNode>;
};

export type TabSnapshot = Pick<
  Tab,
  "url" | "title" | "favicon" | "pin" | "muted" | "zoom" | "customTitle" | "customIcon" | "profileId"
> &
  Partial<Pick<Tab, "pinnedUrl" | "engine">>;

export type ClosedTab = {
  kind: "tab";
  id: string;
  tab: TabSnapshot;
  tabId?: string;
  restoreFrom?: string;
  windowId: string;
  index: number;
  group: ClosedGroupInfo | null;
  parents?: ClosedGroupInfo[];
  closedAt: number;
  pinnedTile?: boolean;
  small?: boolean;
};

export type ClosedWindow = {
  kind: "window";
  id: string;
  window: Pick<BrowserWindow, "profileId" | "sidebarOpen" | "frame">;
  tabs: (TabSnapshot & { active: boolean; tabId?: string })[];
  groups: (Omit<TabGroup, "tabIds" | "windowId"> & { tabIndexes: number[] })[];
  closedAt: number;
};

export type ParkedPins = {
  tabs: (TabSnapshot & { id: string; groupId: string | null; restoreFrom?: string })[];
  groups: (Pick<TabGroup, "id" | "name" | "icon" | "color" | "collapsed"> & { parentId?: string })[];
  splits?: Pick<SplitView, "orientation" | "slots">[];
};

export type NestedGroupSnapshot = Pick<TabGroup, "id" | "name" | "icon" | "color" | "collapsed"> & { parentId: string; tabIndexes: number[] };

export type ClosedGroup = {
  kind: "group";
  id: string;
  group: Pick<TabGroup, "id" | "name" | "icon" | "color" | "pinned"> & { parentId?: string };
  tabs: TabSnapshot[];
  tabIds?: string[];
  nested?: NestedGroupSnapshot[];
  windowId: string;
  index: number;
  closedAt: number;
};

export type FindState = {
  open: boolean;
  query: string;
  count: number | null;
  active: number;
  focusRequest?: number;
  replace?: boolean;
};

export type NewTabTarget = { kind: "list" } | { kind: "group"; groupId: string } | { kind: "into"; tabId: string };

export type PanelState = { open: boolean; initialText: string; newTab?: NewTabTarget };

export type WindowUi = { panel: PanelState; downloadsOpen: boolean };
