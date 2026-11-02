import { lastTabClosesWindow } from "../../platform/tabs";
import { onDownload } from "../../platform/downloads";
import { releaseProfile } from "../../platform/profiles";
import { closeWindow, onWindowEvent, openWindow, restoreFullScreen, setTrafficLightsCenter, setWindowTitle, windowIds } from "../../platform/windows";
import { isDarkAppearance, onAppEvent, onOpenURLs, replyToTerminate } from "../../platform/app";
import { startNativeSettings } from "../settings/nativeSettings";
import { menuShortcuts, onCommand, setMenuStateParts } from "../../platform/commands";
import { Appearance } from "react-native";
import { useBrowser } from "../browser/store";
import { setLastTabKeepsWindow } from "../omnibox/newTabBarPolicy";
import { isUtilityWindowId } from "../settings/settingsWindows";
import { openingLightsCenter } from "../windows/layout";
import { openWindow as createWindow } from "../browser/actions";
import { createWindowSync, type WindowPort } from "../windows/windowSync";
import { openExternalUrls } from "../littleArdia/actions";
import { SMALL_LIGHTS_CENTER } from "../windows/small";
import { runCommand } from "../commands/commands";
import { setMenuBarShortcuts } from "../commands/commandShortcuts";
import { finishAnimatedCloses } from "../windows/closeAnimated";
import { cancelAbandonedFocusMoves, settlingCommandFocus } from "../focus/focusHandoff";
import { flushPersistence, resumePersistence } from "../session/persist";
import { startWindowCloseGuard } from "../windows/windowClose";
import { startExtensionsBridge } from "../extensions/bridge";
import { useExtensions } from "../extensions/actions";
import { answerQuitAfterSaves, isQuitting, setQuitting } from "./quit";
import { menuState } from "../commands/menuState";

const QUIT_SAVES_WAIT_MS = 3_000;


export const shellWindowPort: WindowPort = {
  open(id, options, lightsCenter) {
    void setTrafficLightsCenter(id, lightsCenter);
    void openWindow(id, options);
  },
  close: (id) => void closeWindow(id),
  setTitle: (id, title) => void setWindowTitle(id, title),
  windowIds,
  restoreFullScreen: (ids, focus) => void restoreFullScreen(ids, focus),
  onEvent: (listener) => void onWindowEvent(listener),
  releaseProfile: (profile) => void releaseProfile(profile) };

export function startNativeSync() {
  const store = useBrowser;
  if (!store.getState().windowOrder.length) store.getState().createWindow();

  cancelAbandonedFocusMoves();
  onCommand((e) => settlingCommandFocus(e, runCommand));
  startWindowCloseGuard();
  startExtensionsBridge();
  onOpenURLs((urls, pointer) => openExternalUrls(urls, pointer));
  void lastTabClosesWindow()
    .catch(() => true)
    .then((closes) => setLastTabKeepsWindow(!closes));
  onDownload((d) => store.getState().upsertDownload(d));

  store.getState().setAppDark(Appearance.getColorScheme() === "dark");
  startNativeSettings();
  void isDarkAppearance().then((dark) => store.getState().setAppDark(dark));

  onAppEvent((e) => {
    const s = store.getState();
    if (e.type === "appearance") s.setAppDark(e.dark);
    if (e.type === "reopen") createWindow();
    if (e.type === "quitWarningSuppressed") s.updateSettings({ warnBeforeQuitting: false });
    if (e.type === "willQuit") {
      setQuitting(true);
      finishAnimatedCloses();
      flushPersistence({ final: true });
      void answerQuitAfterSaves(QUIT_SAVES_WAIT_MS, () => replyToTerminate(true));
    }
    if (e.type === "quitCancelled") {
      setQuitting(false);
      resumePersistence();
    }
  });

  const windows = createWindowSync({
    port: shellWindowPort,
    getState: store.getState,
    isQuitting,
    lightsCenter: (s, id) => (s.windows[id]?.kind === "small" ? SMALL_LIGHTS_CENTER : openingLightsCenter(s, id)),
    isUtilityWindow: isUtilityWindowId });
  windows.listen();

  let lastMenu = "";
  let lastMenuItems = "";
  let lastBookmarkMenus: unknown[] = [];
  let menuTimer: ReturnType<typeof setTimeout> | undefined;
  const syncMenu = () => {
    menuTimer = undefined;
    const state = menuState(store.getState());
    const { bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks, ...rest } = state;
    const bookmarkMenus = [bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks];
    const json = JSON.stringify(rest);
    const bookmarksChanged = !bookmarkMenus.every((menu, i) => menu === lastBookmarkMenus[i]);
    if (json === lastMenu && !bookmarksChanged) return;
    lastMenu = json;
    lastBookmarkMenus = bookmarkMenus;
    const sent = setMenuStateParts(state, bookmarksChanged);
    const menuItems = JSON.stringify([state.profiles.map((p) => p.id), (state.extensions ?? []).map((e) => e.id)]);
    if (menuItems === lastMenuItems) return void sent;
    lastMenuItems = menuItems;
    void sent.then(menuShortcuts).then((items) => {
      setMenuBarShortcuts(items);
      menuTimer ??= setTimeout(syncMenu, 120);
    }, () => {});
  };

  windows.sync(store.getState());
  syncMenu();
  windows.restoreFullScreen(store.getState());
  store.subscribe((s, prev) => {
    windows.sync(s, prev);
    menuTimer ??= setTimeout(syncMenu, 120);
  });
  useExtensions.subscribe((e, prev) => {
    if (e.lists !== prev.lists) menuTimer ??= setTimeout(syncMenu, 120);
  });
  void windows.sweep();
}
