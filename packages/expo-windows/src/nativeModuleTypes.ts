import type { AppNative, DialogsNative, FileDropNative, MenusNative, NotificationsNative, SystemNative, SystemSignalsNative, WindowControlsNative, WindowsNative } from "@ardia/shell";
import type { TurboModule } from "react-native";
import type { PowerReading } from "./engine/domains/calling";
import type { EventSubscription } from "./events";
import type { ImportHost } from "./import/host";
import type { LaunchArguments } from "./launchLinks/addresses";
import type { DropAreaFrame } from "./views/fileDropAreas";

export type WindowFade = {
  animates: boolean;
  exists: boolean;
  visible?: boolean;
  layered?: boolean;
  phase?: "none" | "revealing" | "entering" | "leaving" | "lingering";
  opacity?: number;
  closing?: boolean;
  pageWindows?: number;
};

export type DragRegions = { rootTag: number; scale: number; nonClient: boolean; kind: string; titleBand: string; maximized: boolean; titleBarHeight: number; caption: number[][]; passthrough: number[][] };

export type SidebarEdgeWatch = { running: boolean; windows: string[] };

export type AppWindowsOnWindows = {
  quit(): Promise<void>;
  setPageFullScreen(windowId: string, on: boolean): Promise<unknown>;
  beginWindowDrag(rootTag: number): Promise<void>;
  pressDragArea(rootTag: number): Promise<void>;
  toggleMaximize(rootTag: number): Promise<void>;
  addListener(event: "onCaptionPress", listener: (payload: unknown) => void): EventSubscription;
  debugDragRegions(id: string): Promise<DragRegions | null>;
  debugSidebarEdgeWatch(): Promise<SidebarEdgeWatch | null>;
  debugWindowFade(id: string): Promise<WindowFade | null>;
};

export type AppWindowsModule = WindowsNative & WindowControlsNative & AppWindowsOnWindows;

export type DropTargetReport = { ole: boolean; registered: boolean; windows: number; replaced: number; areas: number; childClasses: string[] };

export type FileDropOnWindows = {
  setDropArea(frame: DropAreaFrame): void;
  removeDropArea(windowId: string, area: string): void;
  addListener(event: "onWindowDrop" | "onWindowDrag", listener: (payload: unknown) => void): EventSubscription;
  devDropTarget(windowId: string): Promise<DropTargetReport | null>;
  devWriteDropFixture(name: string, contents: string): Promise<string>;
};

export type FileDropModule = FileDropNative & FileDropOnWindows;

export type MenusModule = MenusNative & { activeShortcuts(): Promise<Record<string, string[][]>>; recentMenuLog(): Promise<string[]> };

export type NotificationsModule = NotificationsNative & { notificationCenterPath(): string };

export type DefaultBrowserState = { progId: string; command: string | null; registeredHere: boolean; http: string | null; https: string | null; page: string; isDefault: boolean };

export type SystemModule = SystemNative & { defaultBrowserState(): DefaultBrowserState };

export type AppModule = AppNative & { windowsApiVersion?: number };

export type WindowsHostModule = {
  getConstants(): { selfCheck?: boolean };
  secureRandomHex(byteCount: number): string;
  pointerState(): number;
  launchArguments(): LaunchArguments;
};

export type WindowsUpdateConstants = { cpu?: unknown; installed?: unknown; buildFile?: unknown; feedOverride?: unknown };

export type WindowsUpdateModule = {
  getConstants(): WindowsUpdateConstants;
  fetchText(url: string): Promise<string>;
  download(url: string, sha256: string, bytes: number): Promise<string>;
  install(path: string, sha256: string): Promise<boolean>;
};

export type EngineHostModule = TurboModule & {
  available(): boolean;
  hostCall(verb: string, argsJson: string, windowId: string): Promise<string>;
  engineCall(name: string, profile: string, argsJson: string): Promise<string>;
  profileDataFolder(): string;
  removeProfileFolder(folder: string): Promise<string>;
};

type ImportAnswersAsJson = "list" | "query" | "openSnapshot" | "querySnapshot" | "unlock" | "logins" | "cookies" | "firefoxLogins" | "firefoxCookies" | "writeCookies";

export type WindowsImportModule = Pick<ImportHost, "readText" | "readBase64" | "readTextWithin" | "readBase64Within" | "closeSnapshot" | "discard" | "forget"> & {
  [Method in ImportAnswersAsJson]: (...args: Parameters<ImportHost[Method]>) => Promise<string>;
} & { getConstants(): { localAppData?: unknown; roamingAppData?: unknown } };

export type DialogsModule = DialogsNative & { saveFile(name: string, extension: string, kind: string, message: string): Promise<string | null> };

export type SystemSignalsModule = SystemSignalsNative & { powerState(): PowerReading };
