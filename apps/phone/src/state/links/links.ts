import { addLinkListener, initialLink, type SystemLink } from "../../platform/links";
import { openPage, openSpaces, openTab, showDeck, useBrowse } from "../browse/store";
import { useOnboarding } from "../onboarding/store";
import { closePageMenu } from "../page/actions";
import { settled } from "../pages/store";
import { presentSearch } from "../search/store";
import { closeSettings, openSettings } from "../settings/nav";
import { applyInbox } from "../sync/actions";
import { syncData } from "../sync/store";
import { currentTabs, setIncognito, useTabs } from "../tabs/store";
import { findTab } from "../tabs/tabsState";
import { heldAfterOnboarding, linkAction, type IncomingLink } from "./linkRules";

let held: IncomingLink[] = [];
let started = false;

function prepare() {
  closeSettings();
  closePageMenu();
  useBrowse.setState({ sheet: null });
}

async function run(link: IncomingLink) {
  const action = linkAction(link, {
    onboarding: useOnboarding.getState().showing,
    syncEnabled: syncData().status.isEnabled,
    hasTab: (id) => Boolean(findTab(currentTabs(), id)),
  });
  switch (action.kind) {
    case "hold":
      held = [...held, link];
      return;
    case "openUrl":
      prepare();
      setIncognito(false);
      openPage(action.url, "link");
      return;
    case "tray": {
      prepare();
      const was = useTabs.getState().incognito;
      setIncognito(action.incognito);
      presentSearch(useBrowse.getState().surface === "start" ? "start" : "page", action.query, was);
      return;
    }
    case "switchTab":
      prepare();
      openTab(action.id);
      return;
    case "spaces":
      prepare();
      openSpaces();
      return;
    case "syncSettings":
      prepare();
      openSettings({ page: "sync" });
      return;
    case "inbox": {
      const opened = await applyInbox();
      if (opened > 0 && !useOnboarding.getState().showing) void showDeck();
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
    if (state.showing || !held.length) return;
    const waiting = heldAfterOnboarding(held);
    held = [];
    for (const link of waiting) void run(link);
  });
}
