import { addLinkListener, initialLink, type SystemLink } from "../../platform/links";
import { openPage, openSpaces, openTab, showDeck, useBrowse } from "../browse/store";
import { useOnboarding } from "../onboarding/store";
import { closeFind, closePageMenu, closeReader } from "../page/actions";
import { settled } from "../pages/store";
import { dismissSearch, presentSearch } from "../search/store";
import { closeSettings, openSettings } from "../settings/nav";
import { applyInbox } from "../sync/actions";
import { syncData } from "../sync/store";
import { canSearchByVoice, closeVoiceSearch, presentVoiceSearch } from "../voice/store";
import { currentTabs, setIncognito, useTabs } from "../tabs/store";
import { findTab } from "../tabs/tabsState";
import { heldLinks, holdLink, takeHeldLinks } from "./heldLinks";
import { ALL_COVERS, coversToClose, heldAfterOnboarding, linkAction, type Cover, type IncomingLink } from "./linkRules";

let started = false;

const CLOSE: Record<Cover, () => void> = {
  tray: dismissSearch,
  voice: closeVoiceSearch,
  sheet: () => useBrowse.setState({ sheet: null }),
  settings: closeSettings,
  pageMenu: closePageMenu,
  reader: closeReader,
  find: closeFind,
};

function close(covers: readonly Cover[]) {
  for (const cover of covers) CLOSE[cover]();
}

async function run(link: IncomingLink) {
  const action = linkAction(link, {
    onboarding: useOnboarding.getState().showing,
    syncEnabled: syncData().status.isEnabled,
    canSearchByVoice: canSearchByVoice(),
    hasTab: (id) => Boolean(findTab(currentTabs(), id)),
  });
  close(coversToClose(action));
  switch (action.kind) {
    case "hold":
      holdLink(link);
      return;
    case "openUrl":
      setIncognito(false);
      openPage(action.url, "link");
      return;
    case "tray": {
      const was = useTabs.getState().incognito;
      setIncognito(action.incognito);
      presentSearch(useBrowse.getState().surface === "start" ? "start" : "page", action.query, was);
      return;
    }
    case "voice":
      setIncognito(false);
      presentVoiceSearch();
      return;
    case "switchTab":
      openTab(action.id);
      return;
    case "spaces":
      openSpaces();
      return;
    case "syncSettings":
      openSettings({ page: "sync" });
      return;
    case "inbox": {
      const opened = await applyInbox();
      if (opened <= 0 || useOnboarding.getState().showing) return;
      close(ALL_COVERS);
      void showDeck();
      return;
    }
    case "none":
      return;
  }
}

const take = (link: SystemLink) => void run(link);

export function startLinks() {
  if (started) return;
  started = true;
  addLinkListener(take);
  void settled(() => initialLink(), null).then((link) => {
    if (link) take(link);
  });
  useOnboarding.subscribe((state) => {
    if (state.showing || !heldLinks().length) return;
    for (const link of heldAfterOnboarding(takeHeldLinks())) void run(link);
  });
}
