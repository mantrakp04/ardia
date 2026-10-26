import type { Adapter, Extraction } from "../../platform/sync";
import { useBrowser, type BrowserState } from "../browser/store";
import { syncGroupOrder } from "../groups/groups";
import { orderChoiceKey } from "../pins/organize";
import { arrangeParked, arrangePinnedArea, parkedAnchors, parkedAreaKeys, pinnedAnchors, pinnedAreaKeys } from "../pins/pinnedArea";
import { fromSync } from "../pins/pinOrderChoices";
import { anchorIn, PIN_ORDER, PIN_ROW, ROW, type PinOrderValue, type PinValue } from "./pinRecords";
import { homeWindow, openWindows, settleChoices, store } from "./pinnedSyncState";

export function pinnedOrderAdapter(profileId: string): Adapter {
  const shownIn = (s: BrowserState) => openWindows(s).filter((w) => w.tabIds.some((id) => s.tabs[id]?.profileId === profileId));
  return {
    prefix: PIN_ORDER,
    extract: (base, queued, _now, _known, remote, stamp) => {
      const s = store();
      const home = homeWindow(s, profileId);
      const shown = !!home && shownIn(s).includes(home);
      const gone = (key: string) => remote(key) === null;
      const ignore = (k: string) => !gone(`pin:g:${k.slice(PIN_ORDER.length)}`);
      if (!shown && !s.parkedPins[profileId]) return { values: new Map(), ignore } satisfies Extraction;
      const anchors = shown ? pinnedAnchors(s, home!, profileId) : parkedAnchors(s, profileId);
      const chosen = s.pinChoices[profileId] ?? {};
      const choiceOf = (k: string) => orderChoiceKey(k.slice(PIN_ORDER.length));
      const rows = new Set((shown ? pinnedAreaKeys(s, home!, profileId) : parkedAreaKeys(s, profileId)).filter((k) => k.startsWith("t:")).map((k) => k.slice(2)));
      const values = new Map<string, unknown>();
      for (const [group, a] of anchors) {
        const was = base(`${PIN_ORDER}${group}`) as PinOrderValue | undefined;
        const since = stamp(`${PIN_ORDER}${group}`);
        const changedSince = (key: string) => since !== undefined && (stamp(key) ?? "") > since;
        const pin = was?.a ? (remote(`pin:t:${was.a}`) as PinValue | null | undefined) : undefined;
        const leftRows = !!was?.a && changedSince(`pin:t:${was.a}`) && (pin === null || (!!pin && pin.g !== null));
        const madeTile = !!was?.a && changedSince(`${PIN_ROW}${was.a}`) && remote(`${PIN_ROW}${was.a}`) !== ROW;
        const settled = leftRows || madeTile;
        const waiting = !(orderChoiceKey(group) in chosen) && !!was?.a && was.a !== a && !rows.has(was.a) && !settled;
        values.set(`${PIN_ORDER}${group}`, waiting ? was! : ({ a } satisfies PinOrderValue));
      }
      return {
        values,
        ignore,
        republish: (k) => choiceOf(k) in chosen && !queued(k),
        published: (published) => settleChoices(profileId, Object.fromEntries([...published].map(choiceOf).filter((c) => c in chosen).map((c) => [c, chosen[c]!]))),
      } satisfies Extraction;
    },
    apply: (visible) => {
      const s = store();
      const anchorOf = (group: string) => anchorIn(visible.get(`${PIN_ORDER}${group}`));
      let windows = s.windows;
      let groups = s.groups;
      for (const w of shownIn(s)) {
        const tabIds = arrangePinnedArea(s, w, profileId, anchorOf);
        if (tabIds === w.tabIds) continue;
        const window = { ...w, tabIds };
        windows = { ...windows, [w.id]: window };
        groups = syncGroupOrder(groups, window);
      }
      const park = s.parkedPins[profileId];
      const parked = park && arrangeParked(park, anchorOf);
      if (windows === s.windows && parked === park) return true;
      fromSync(() => useBrowser.setState({ windows, groups, ...(park && parked !== park ? { parkedPins: { ...s.parkedPins, [profileId]: parked! } } : {}) }));
      return true;
    },
  };
}
