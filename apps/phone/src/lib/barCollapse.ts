export type ScrollDirection = "up" | "down";

export type BarCollapse = { tabId: string | null; page: string | null; direction: ScrollDirection; hidden: boolean };

export const BAR_SHOWN: BarCollapse = { tabId: null, page: null, direction: "up", hidden: false };

export function followScroll(state: BarCollapse, tabId: string | null, page: string | null, direction: ScrollDirection, collapses: boolean): BarCollapse {
  if (!collapses || tabId !== state.tabId || page !== state.page) {
    const unchanged = state.tabId === tabId && state.page === page && state.direction === direction && !state.hidden;
    return unchanged ? state : { tabId, page, direction, hidden: false };
  }
  if (direction === state.direction) return state;
  return { tabId, page, direction, hidden: direction === "down" };
}

export const barShown = (state: BarCollapse): BarCollapse => (state.hidden ? { ...state, hidden: false } : state);

export type PageInsets = { pageBottom: number; toneBottom: number };

export function pageInsets(collapses: boolean, barHeight: number, overlap: number): PageInsets {
  return collapses ? { pageBottom: 0, toneBottom: barHeight } : { pageBottom: barHeight - overlap, toneBottom: overlap };
}
