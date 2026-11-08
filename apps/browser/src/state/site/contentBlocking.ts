import { create } from "zustand";
import { getContentBlocker, setContentBlockerEnabled, setFilterListEnabled, type ContentBlockerState, type FilterListCategory } from "../../platform/contentBlocker";
import { errorText } from "../../lib/errors";

export type ContentBlockerRead = { state: ContentBlockerState; problem: null } | { state: null; problem: string };

export async function readContentBlocker(): Promise<ContentBlockerRead> {
  const read = await getContentBlocker().then(
    (state): ContentBlockerRead => (state.stats.ready ? { state, problem: null } : { state: null, problem: state.stats.error ?? "The ad blocker isn't available right now." }),
    (error): ContentBlockerRead => ({ state: null, problem: errorText(error) }),
  );
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
let latestChange = 0;

export function clearBlockingFailure() {
  latestChange++;
  useBlockingFailure.setState({ message: null });
}

async function reportingFailure(change: () => Promise<void>) {
  const mine = ++latestChange;
  useBlockingFailure.setState({ message: null });
  try {
    await change();
  } catch (error) {
    console.error(error);
    if (mine === latestChange) useBlockingFailure.setState({ message: `Couldn't change content blocking. ${errorText(error)}` });
  }
}

export const changeBlockingCategory = (s: ContentBlockerState, category: FilterListCategory, on: boolean) => reportingFailure(() => setBlockingCategory(s, category, on));

export const changeFilterList = (s: ContentBlockerState, id: string, on: boolean) => reportingFailure(() => setFilterList(s, id, on));
