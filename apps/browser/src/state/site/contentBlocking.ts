import { create } from "zustand";
import { getContentBlocker, setContentBlockerEnabled, setFilterListEnabled, type ContentBlockerState, type FilterListCategory } from "../../platform/contentBlocker";
import { errorText } from "../../lib/errors";

export type ContentBlockerRead = { state: ContentBlockerState; problem: null } | { state: null; problem: string };

const attemptRead = () =>
  getContentBlocker().then(
    (state): ContentBlockerRead => (state.stats.ready ? { state, problem: null } : { state: null, problem: state.stats.error ?? "The ad blocker isn't available right now." }),
    (error): ContentBlockerRead => ({ state: null, problem: errorText(error) }),
  );

export async function readContentBlocker(): Promise<ContentBlockerRead> {
  const read = await attemptRead();
  if (read.problem !== null) console.warn(`[engine] ad blocker unavailable: ${read.problem}`);
  return read;
}

export const categoryOn = (s: ContentBlockerState, category: FilterListCategory) => s.enabled && s.lists.some((l) => l.category === category && l.enabled);

async function setLists(s: ContentBlockerState, ids: string[], on: boolean) {
  for (const id of ids) await setFilterListEnabled(id, on);
  const anyOn = s.lists.some((l) => (ids.includes(l.id) ? on : s.enabled && l.enabled));
  if (anyOn !== s.enabled) await setContentBlockerEnabled(anyOn);
}

export async function setBlockingCategory(s: ContentBlockerState, category: FilterListCategory, on: boolean) {
  const lists = s.lists.filter((l) => l.category === category);
  if (on && !lists.length) throw new Error(`The ad blocker has no ${category} filter list to turn on.`);
  const usual = lists.filter((l) => l.defaultOn || l.enabled);
  const starters = usual.length ? usual : lists.filter((l) => /easylist|fanboy/.test(l.id));
  const changed = on ? (starters.length ? starters : lists) : lists.filter((l) => l.enabled);
  return setLists(s, changed.map((l) => l.id), on);
}

export const setFilterList = (s: ContentBlockerState, id: string, on: boolean) => setLists(s, [id], on);

export const useBlockingFailure = create<{ message: string | null }>()(() => ({ message: null }));
let visit = 0;
let unsettled = 0;
let queue: Promise<void> = Promise.resolve();

export function clearBlockingFailure() {
  visit++;
  useBlockingFailure.setState({ message: null });
}

function reportingFailure(change: (s: ContentBlockerState) => Promise<void>) {
  const mine = visit;
  if (!unsettled) useBlockingFailure.setState({ message: null });
  unsettled++;
  const settled = queue.then(async () => {
    try {
      const read = await attemptRead();
      if (read.state === null) throw new Error(read.problem);
      await change(read.state);
    } catch (error) {
      console.error(error);
      if (mine === visit) useBlockingFailure.setState({ message: `Couldn't change content blocking. ${errorText(error)}` });
    } finally {
      unsettled--;
    }
  });
  queue = settled;
  return settled;
}

export const changeBlockingCategory = (category: FilterListCategory, on: boolean) => reportingFailure((s) => setBlockingCategory(s, category, on));

export const changeFilterList = (id: string, on: boolean) => reportingFailure((s) => setFilterList(s, id, on));
