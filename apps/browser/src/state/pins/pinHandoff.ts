import { create } from "zustand";
import { lastPicture } from "../tabs/tabPictures";
import { webviews } from "../../platform/webviews";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { holderOf, shareKeyOf } from "./pinShare";
import { setPinHandoff } from "../tabs/tabsSlice";

const CAPTURE_DEADLINE_MS = 250;
const PAINT_DEADLINE_MS = 120;

type Bridge = { copyId: string; uri: string };
type Frozen = { frames: Record<string, string>; bridges: Record<string, Bridge> };
export const useFrozenPages = create<Frozen>()(() => ({ frames: {}, bridges: {} }));

const pending = new Map<string, number>();
const latestIn = new Map<string, number>();
const interactions = new Map<string, number>();
const interactionIn = (windowId: string) => interactions.get(windowId) ?? 0;
const painted = new Map<string, () => void>();
export const notePainted = (windowId: string) => painted.get(windowId)?.();
let requests = 0;
let started = false;

const store = () => useBrowser.getState();
const later = (ms: number) => new Promise<null>((done) => setTimeout(() => done(null), ms));

async function frameOf(holderId: string, onScreen: boolean): Promise<string | null> {
  const live = onScreen ? webviews.get(holderId)?.capturePicture(1).catch(() => null) : undefined;
  const picture = (live && (await Promise.race([live, later(CAPTURE_DEADLINE_MS)]))) || lastPicture(holderId);
  return picture ? `data:image/jpeg;base64,${picture.data}` : null;
}

function bridge(windowId: string, value: Bridge | null) {
  useFrozenPages.setState((f) => {
    const bridges = { ...f.bridges };
    if (value) bridges[windowId] = value;
    else delete bridges[windowId];
    return { bridges };
  });
}

function paintedIn(windowId: string): Promise<void> {
  return new Promise((done) => {
    painted.set(windowId, done);
    setTimeout(done, PAINT_DEADLINE_MS);
  });
}

async function handOff(copyId: string, commit: () => void): Promise<boolean> {
  const s = store();
  const copy = s.tabs[copyId];
  const holder = holderOf(s, copyId);
  if (!copy || !holder) {
    commit();
    return false;
  }
  const key = shareKeyOf(copy);
  const token = ++requests;
  pending.set(key, token);
  const target = copy.windowId;
  latestIn.set(target, token);
  const before = activeTabId(s, target);
  const intent = interactionIn(target);
  const source = holder.windowId;
  const onScreen = activeTabId(s, source) === holder.id;
  const uri = await frameOf(holder.id, onScreen);
  const current = () => {
    const now = store();
    return (
      pending.get(key) === token &&
      latestIn.get(target) === token &&
      !!now.tabs[copyId] &&
      now.tabs[copyId]!.windowId === target &&
      activeTabId(now, target) === before &&
      interactionIn(target) === intent &&
      !!holderOf(now, copyId)
    );
  };
  const settle = () => {
    if (pending.get(key) === token) pending.delete(key);
    if (latestIn.get(target) === token) latestIn.delete(target);
  };
  if (!current()) {
    settle();
    return false;
  }
  if (uri) {
    useFrozenPages.setState((f) => ({ frames: { ...f.frames, [copyId]: uri } }));
    if (onScreen && store().tabs[holder.id]?.windowId === source) {
      bridge(source, { copyId, uri });
      await paintedIn(source);
      painted.delete(source);
    }
  }
  const still = current();
  settle();
  if (still) commit();
  if (useFrozenPages.getState().bridges[source]?.copyId === copyId) bridge(source, null);
  return still;
}

export const requestPinHandOff = (copyId: string) => handOff(copyId, () => store().handOffPin(copyId));

export function startPinHandoff() {
  if (started) return;
  started = true;
  setPinHandoff((copyId, commit) => void handOff(copyId, commit));
  useBrowser.subscribe((s, prev) => {
    if (s.windows !== prev.windows || s.windowUi !== prev.windowUi) {
      for (const [id, w] of Object.entries(s.windows)) {
        const was = prev.windows[id];
        if (was && was.activeTabIds === w.activeTabIds && prev.windowUi[id] === s.windowUi[id]) continue;
        interactions.set(id, interactionIn(id) + 1);
      }
    }
    if (s.tabs === prev.tabs) return;
    const { frames } = useFrozenPages.getState();
    const gone = Object.keys(frames).filter((id) => !s.tabs[id]?.pageIn && !Object.values(useFrozenPages.getState().bridges).some((b) => b.copyId === id));
    if (!gone.length) return;
    const next = { ...frames };
    for (const id of gone) delete next[id];
    useFrozenPages.setState({ frames: next });
  });
}
