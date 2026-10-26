import type { CommandEvent } from "./commands";
import type { ConfirmOptions, PromptOptions } from "./dialogs";
import type { BangListReply } from "./documents";
import type { AppEvent } from "./lifecycle";
import type { MenuItem, MenuState } from "./menus";
import { nativeModule } from "./nativeModules";
import type { EventSubscription } from "expo-modules-core";
import type { DragPreviewShape, OpenWindowOptions, WindowEvent } from "./windows";

type ShellEvents = {
  onCommand: (e: CommandEvent) => void;
  onOpenURLs: (e: { urls: string[]; pointer?: [number, number] }) => void;
  onWindowEvent: (e: WindowEvent) => void;
  onAppEvent: (e: AppEvent) => void;
};

export type Rect4 = [number, number, number, number];

export type MenuBookmarkKey = "bookmarkFolders" | "recentBookmarks" | "bookmarksBar" | "otherBookmarks";

export type ShellNative = {
  addListener<K extends keyof ShellEvents>(name: K, listener: ShellEvents[K]): EventSubscription;
  showMenu(items: MenuItem[]): Promise<string | null>;
  copyText(text: string): void;
  setSwitcherCapture(active: boolean): Promise<void>;
  setDragEscapeCapture(active: boolean): Promise<void>;
  cancelFocusMove(generation: number, restoringSource: boolean): Promise<void>;
  claimFocus(generation: number, tag: number): Promise<void>;
  saveKeyResponder(windowId: string): Promise<number>;
  restoreKeyResponder(token: number): Promise<boolean>;
  discardKeyResponder(token: number): Promise<void>;
  switcherPointerMoved(): boolean;
  startDictation(): void;
  pickFiles(): Promise<string[]>;
  pickFolder(current: string | null, prompt: string | null): Promise<string | null>;
  readDocument(name: string): string | null;
  writeDocument(name: string, contents: string): void;
  saveDocument(name: string, contents: string): Promise<void>;
  removeDocument(name: string): void;
  fetchBangList(etag: string | null): Promise<BangListReply>;
  openWindow(id: string, options: OpenWindowOptions): Promise<void>;
  closeWindow(id: string): Promise<void>;
  animateWindowClose(id: string, after: string | null): Promise<void>;
  focusWindow(id: string): Promise<void>;
  restoreFullScreen(ids: string[], focus: string | null): Promise<void>;
  setTrafficLightsCenter(id: string, center: [number, number] | null): Promise<void>;
  watchLeftEdge(id: string, on: boolean, hold: number): Promise<void>;
  dragPreviewBegin(windowId: string, chip: Rect4, grab: [number, number]): Promise<void>;
  dragPreviewPage(base64: string, frame: Rect4): Promise<void>;
  dragPreviewUpdate(shape: DragPreviewShape, point: [number, number]): Promise<void>;
  dragPreviewCancel(): Promise<void>;
  raiseView(tag: number, levels: number, raised: boolean): Promise<void>;
  dragPreviewPlaceholder(title: string, favicon: string | null): Promise<void>;
  windowFrame(id: string): Promise<Rect4 | null>;
  dragPreviewEnd(windowId: string | null, frame: Rect4 | null): Promise<void>;
  setWindowTitle(id: string, title: string): Promise<void>;
  windowIds(): Promise<string[]>;
  setAppearance(mode: "auto" | "light" | "dark"): Promise<void>;
  isDarkAppearance(): Promise<boolean>;
  setMenuState(state: Omit<MenuState, MenuBookmarkKey>): Promise<void>;
  setMenuBookmarks(bookmarks: Pick<MenuState, MenuBookmarkKey>): Promise<void>;
  replyToTerminate(ok: boolean): Promise<void>;
  confirm(options: ConfirmOptions): Promise<{ confirmed: boolean; suppressed: boolean }>;
  prompt(options: PromptOptions): Promise<string | null>;
};

export const Shell = nativeModule("ArdiaShell");
