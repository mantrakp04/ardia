import { WebView } from "../ui";
import { type OpenWindowRequest, openFromPage } from "../../state/tabs/openFromPage";
import type { PageEngine } from "../../state/engines/engines";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { focus, switchToTab } from "../../state/browser/actions";
import { noteFavicon } from "../../state/favicons/favicons";
import { adoptIconPage, dropOutlivedFavicon, noteIconPage } from "../../state/favicons/iconPage";
import { restoredThemeColor } from "../../state/windows/launchLook";
import { noteTabReady } from "../../state/app/cliControl";
import { isQuitting } from "../../state/app/quit";
import { useProfileTheme } from "./ThemeScope";
import { opaqueCard } from "../ui/opaqueCard";
import { handOff, takeHandOff, wantsPage } from "../../state/tabs/tabPages";
import { noteDiscarded, noteGone, noteReady } from "../../state/tabs/tabLifecycle";
import { noteWebKitPage, offerWebKit, persistEngine } from "../../state/engines/actions";
import { webviewRef, webviews } from "../../state/tabs/webviewHandles";
import { noteIssued, takeStartedNavigation } from "../../state/tabs/earlyNavigate";
import { currentEngineProfile, currentTab, isTabSilenced } from "../../state/browser/current";
import { closeTabNow, updateLive, updateTab } from "../../state/tabs/actions";
import { setFind } from "../../state/windows/actions";
import { activateFocusedPane, currentTabEngine, downloadNavigated, useTabEngine } from "../../state/windows/card";
import { setPageProgress } from "../../state/tabs/pageProgress";
import { shallowEqual, useBrowserWhile, useProfilesValue, useTabValue } from "../../state/tabs/tabWatch";
import { isIncognitoProfile, navigationTo } from "../../state/browser/model";
import type { Tab } from "../../state/browser/types";
import { zoomChangedByUser } from "../../state/site/zoomBubble";
import { markTabReady, patchPage, pageOf, popoverOf, setPopover } from "../../state/tabs/pageState";
import { closeFolderPanelIn } from "../../state/sidebar/tileFolderUi";
import { popupBlocked, showAutofillPrompt, showPasswordPrompt } from "../../state/site/prompts";
import { leftPage } from "../../state/tabs/pageEvents";
import { copyLinkToSelection, searchSelection, setPageSelection } from "../../state/site/selection";
import { useAutoPictureInPicture } from "../../state/media/pip";
import { requestDisplayMedia } from "../../state/media/screenShare";
import { setNowPlaying, setPictureInPictureState } from "../../state/media/media";
import { noteScroll } from "../../state/windows/toolbarAutoHide";
import { closeWebNotification, showWebNotification } from "../../state/site/webNotifications";
import { closeLittleArdiaOnEscape } from "../../state/littleArdia/actions";
import { closePeekOnEscape } from "../../state/peek/actions";
import { withoutFragment } from "../../lib/url";
import { adoptOf, loadedPage, navigationOf } from "../../state/tabs/pageSession";

const webViewTab = (t: Tab | undefined) => ({ navigation: navigationOf(t), adoptId: adoptOf(t), profileId: t?.profileId ?? "", shownUrl: t?.url ?? "" });

const isBlank = (url: string) => !url || url === "about:blank";

type TabWebViewProps = { tabId: string; visible: boolean; warm: boolean; peekOf?: string };

export const TabWebView = memo(function TabWebView(props: TabWebViewProps) {
  const engine = useTabEngine(props.tabId);
  return <EngineWebView key={engine} engine={engine} {...props} />;
});

function EngineWebView({ tabId, visible, warm, peekOf, engine }: TabWebViewProps & { engine: PageEngine }) {
  const { navigation, adoptId, profileId, shownUrl } = useTabValue(tabId, webViewTab, shallowEqual);
  const neighbour = useBrowserWhile(warm, (s) => warm && s.windows[s.tabs[tabId]?.windowId ?? ""]?.profileId !== profileId);
  const tab = () => currentTab(tabId);
  const ref = useMemo(() => webviewRef(tabId), [tabId]);
  const autoPictureInPicture = useAutoPictureInPicture(tabId, visible);
  const pageColor = useProfilesValue(profileId, (profiles) => (isIncognitoProfile(profileId) ? "incognito" : (profiles[profileId]?.color ?? "plum")));
  const theme = useProfileTheme(profileId);
  const backdrop = useMemo(() => opaqueCard(theme), [theme.card, theme.windowTint[0], theme.windowTint[1]]);

  const lastPage = useRef<string | null>(null);
  const pending = useRef<string | null>(navigation?.url ?? (adoptId ? (tab()?.url ?? null) : null));

  const seq = navigation?.seq;
  const adopted = useRef<string | null>(null);
  const [handoff] = useState(() => takeHandOff(tabId, engine));
  const arrived = useRef(!!handoff && handoff.seq === navigation?.seq);
  const loadsOnCreate = useRef(engine === "webkit" && !handoff ? navigation?.seq : undefined);
  useEffect(() => {
    if (!navigation) return;
    noteIssued(tabId, navigation.seq);
    if (arrived.current) {
      arrived.current = false;
      return;
    }
    if (navigation.url === adopted.current) {
      adopted.current = null;
      return;
    }
    pending.current = navigation.url;
    if (pageOf(tabId).newTabShown) patchPage(tabId, { newTabShown: null });
    if (loadsOnCreate.current === navigation.seq) {
      loadsOnCreate.current = undefined;
      return;
    }
    if (takeStartedNavigation(tabId, navigation.seq)) return;
    void webviews.get(tabId)?.loadUrl(navigation.url, { userInitiated: !!navigation.userInitiated });
  }, [seq]);
  const fromNewTab = useRef(pageOf(tabId).wasNewTab && !adoptId);
  useEffect(() => {
    persistEngine(tabId, engine);
    return () => noteGone(tabId);
  }, []);
  const mountedProfile = useRef(profileId);
  useLayoutEffect(
    () => () => {
      const t = tab();
      const sameEngine = currentTabEngine(tabId) === engine;
      if (wantsPage(t) && sameEngine && currentEngineProfile(t.profileId) === currentEngineProfile(mountedProfile.current) && !isQuitting()) handOff(tabId, currentEngineProfile(t.profileId), engine);
      else setPageProgress(tabId, 0);
    },
    [],
  );

  const prewarmOnly = () => !navigationOf(tab()) && !adoptId;

  const onOpenWindow = (request: OpenWindowRequest) => {
    const t = tab();
    if (t) openFromPage(request, { windowId: t.windowId, profileId: t.profileId, tabId });
  };

  return (
    <WebView
      ref={ref}
      engine={engine}
      style={StyleSheet.absoluteFill}
      url={navigation?.url ?? (adoptId ? tab()?.url : undefined)}
      profile={currentEngineProfile(profileId)}
      adoptId={adoptId}
      tabId={tabId}
      temporary={peekOf !== undefined}
      temporarySource={peekOf}
      visible={visible}
      warm={warm}
      neighbour={neighbour}
      autoPictureInPicture={autoPictureInPicture}
      pageColor={pageColor}
      contentsBackgroundColor={backdrop}
      shownUrl={shownUrl}
      onReady={() => {
        markTabReady(tabId);
        noteTabReady(tabId);
        noteReady(tabId);
        void webviews.get(tabId)?.setMuted(isTabSilenced(tabId));
      }}
      onNavigationChange={({ url: reported, title, canGoBack, canGoForward, isLoading, themeColor, themeColorSource, initialDocumentAccessed, committedInitial, committedUrl }) => {
        adoptIconPage(tabId);
        const url = initialDocumentAccessed && committedInitial ? "about:blank" : reported;
        const untouched = committedInitial === undefined ? reported === "" && !(tab()?.openerId && adoptId) : committedInitial && !initialDocumentAccessed;
        const target = pending.current ?? (lastPage.current === null ? (navigationOf(tab())?.url ?? null) : null);
        if (target === null && prewarmOnly()) {
          if (isBlank(url)) return;
          adopted.current = url;
          updateTab(tabId, { page: loadedPage(navigationTo(url)) });
        }
        if (target !== null && isBlank(url) && !target.startsWith("about:") && untouched) {
          updateLive(tabId, { isLoading: true });
          return;
        }
        const shownTheme = restoredThemeColor(tabId, url, themeColor, isLoading);
        pending.current = null;
        const kept = pageOf(tabId).newTabShown;
        if (kept) {
          if (url === kept.url) {
            patchPage(tabId, { newTabShown: { ...kept, title } });
            updateLive(tabId, { isLoading, canGoBack, canGoForward, themeColor: shownTheme });
            return;
          }
          patchPage(tabId, { newTabShown: null });
        }
        if (fromNewTab.current && url && !isBlank(url)) patchPage(tabId, { backToNewTab: true });
        updateTab(tabId, { url, title }, { isLoading, canGoBack, canGoForward, themeColor: shownTheme });
        dropOutlivedFavicon(tabId, url, isLoading);
        if (engine === "webkit") noteWebKitPage(tabId, { url, title, isLoading, committedUrl: committedUrl ?? "" });
        if (lastPage.current !== null && withoutFragment(url) !== lastPage.current) leftPage(tabId, url, lastPage.current, engine, peekOf !== undefined);
        lastPage.current = withoutFragment(url);
        patchPage(tabId, { themeColorSource: themeColorSource ?? null });
      }}
      onLoadError={() => {
        pending.current = null;
      }}
      onDownloadNavigation={({ committedUrl, skipped }) => {
        pending.current = null;
        downloadNavigated(tabId, committedUrl, skipped);
      }}
      onProgress={(progress) => !prewarmOnly() && setPageProgress(tabId, progress)}
      onZoom={({ zoom, user }) => {
        updateTab(tabId, { zoom });
        if (user) zoomChangedByUser(tabId);
      }}
      onFindResult={({ count, active }) => setFind(tabId, { count, active })}
      onFavicon={(favicon) => {
        if (!favicon || !tab()) return;
        noteIconPage(tabId);
        updateTab(tabId, { favicon });
        noteFavicon(tabId, favicon);
      }}
      onMedia={({ playing, muted }) => {
        updateLive(tabId, { playingAudio: playing });
        if (!muted && isTabSilenced(tabId)) void webviews.get(tabId)?.setMuted(true);
      }}
      onNowPlaying={(state) => setNowPlaying(tabId, state)}
      onPictureInPicture={(state) => setPictureInPictureState(tabId, state)}
      onDisplayMediaRequest={(request) => requestDisplayMedia(tabId, request)}
      onOpenWindow={onOpenWindow}
      onStatus={(status) => patchPage(tabId, { status })}
      onCrashed={(crashed) => {
        if (!isQuitting()) patchPage(tabId, { crashed, unresponsive: false, fullscreen: false, status: "" });
      }}
      onUnresponsive={() => patchPage(tabId, { unresponsive: true })}
      onResponsive={() => patchPage(tabId, { unresponsive: false })}
      onFullscreen={(fullscreen) => patchPage(tabId, { fullscreen })}
      onMediaAccess={(mediaAccess) => patchPage(tabId, { mediaAccess: mediaAccess.camera || mediaAccess.microphone || mediaAccess.screen ? mediaAccess : null })}
      onSecurity={(security) => !prewarmOnly() && patchPage(tabId, { security })}
      onContentBlocked={({ count }) => patchPage(tabId, { blocked: count })}
      onPopupBlocked={(popup) => popupBlocked(tabId, popup)}
      onPasswordPrompt={(prompt) => showPasswordPrompt(tabId, prompt)}
      onAutofillPrompt={(prompt, id) => showAutofillPrompt(tabId, prompt, id)}
      onExternalApp={(externalApp) => patchPage(tabId, { externalApp })}
      onPageFocus={() => activateFocusedPane(tabId)}
      onPagePress={() => activateFocusedPane(tabId)}
      onWindowClose={() => !isQuitting() && closeTabNow(tabId)}
      onNotification={(notification) => showWebNotification(tabId, notification)}
      onCommand={({ command, text, modifiers }) => {
        if (command === "search") searchSelection(tabId, text, modifiers);
        else if (command === "copyLinkToHighlight") void copyLinkToSelection(tabId);
        else if (command === "escape" && popoverOf(tabId)) setPopover(tabId, null);
        else if (command === "escape" && !closeFolderPanelIn(tab()?.windowId) && !closePeekOnEscape(tabId)) closeLittleArdiaOnEscape(tabId);
      }}
      onSelection={(selection) => setPageSelection(tabId, selection)}
      onScroll={(state) => noteScroll(tabId, state)}
      onProtectedMedia={(request) => offerWebKit(tabId, request)}
      onNotificationClose={closeWebNotification}
      onDiscarded={(url) => {
        pending.current = url;
        fromNewTab.current = false;
        patchPage(tabId, { backToNewTab: false, status: "" });
        updateLive(tabId, { isLoading: false, canGoBack: false, canGoForward: false, playingAudio: false });
        setPageProgress(tabId, 0);
        noteDiscarded(tabId);
      }}
      onActivateRequest={() => {
        const t = tab();
        if (!t) return;
        switchToTab(tabId);
        focus(t.windowId);
      }}
    />
  );
}
