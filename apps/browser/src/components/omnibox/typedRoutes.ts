import { focus, openWindow } from "../../lib/actions";
import { destinationStillMaps, resolveTypedLink } from "../../lib/linkRoutes";
import { useBrowser } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { isEmptyCardTab } from "../../store/newTabBar";
import { isSmall, mainWindowFor } from "../../store/small";
import { openLittleArdia } from "../littleArdia/actions";
import type { Disposition } from "./open";

const store = () => useBrowser.getState();
const commands = new Map<string, number>();
let counter = 0;

type TypedSource = { windowId: string; tabId?: string; disposition: Disposition };

const ownerOf = (from: TypedSource) => {
  const s = store();
  const w = s.windows[from.windowId];
  const tab = from.tabId ? s.tabs[from.tabId] : undefined;
  if (!w || (from.tabId && tab?.windowId !== from.windowId)) return null;
  return { profileId: tab?.profileId ?? w.profileId, url: tab?.url, seq: tab?.navigation?.seq, incognito: !!w.incognito };
};

const sameOwner = (a: ReturnType<typeof ownerOf>, b: ReturnType<typeof ownerOf>) =>
  !!a && !!b && a.profileId === b.profileId && a.url === b.url && a.seq === b.seq;

export function routeTyped(url: string, from: TypedSource, open: () => void, routed: () => void) {
  const command = ++counter;
  commands.set(from.windowId, command);
  const owner = ownerOf(from);
  if (!owner || owner.incognito || !/^https?:\/\//i.test(url)) {
    commands.delete(from.windowId);
    return open();
  }
  void resolveTypedLink(url, owner.profileId).then((decision) => {
    if (commands.get(from.windowId) !== command) return;
    commands.delete(from.windowId);
    if (!sameOwner(owner, ownerOf(from))) return;
    if (!decision) return console.warn("Couldn't route a typed link");
    if (decision.action === "none") return open();
    if (!destinationStillMaps(decision.profileId, decision.engine)) return console.warn("A typed link's profile changed before it opened");
    if (decision.action === "same") return open();
    routed();
    if (decision.action === "little") return void openLittleArdia(url, decision.profileId);
    openTypedDestination(url, decision.profileId, from);
  });
}

function openTypedDestination(url: string, profileId: string, from: TypedSource) {
  const s = store();
  if (from.disposition === "newWindow") return void openWindow({ url, profileId });
  const target = isSmall(s, from.windowId) ? mainWindowFor(s, profileId) : from.windowId;
  if (!target) return void openWindow({ url, profileId });
  const blank = from.tabId ? s.tabs[from.tabId] : undefined;
  s.newTab(target, { url, profileId });
  if (blank && isEmptyCardTab(store(), blank) && activeTabId(store(), blank.windowId) !== blank.id) store().closeTab(blank.id);
  if (target !== from.windowId) focus(target);
}
