import { systemInfo } from "../../platform/app";
import { create } from "zustand";
import { openUrls } from "../browser/actions";
import { useBrowser } from "../browser/store";
import { activeTabId, resolveWindowId } from "../browser/model";
import { closeReleaseNotes } from "../releaseNotes/releaseNotes";
import { splitOf } from "../splits/splits";
import { useUrlAnchors } from "../windows/layout";

export type TourAnchor = "commandBar" | "page" | "tabs" | "sidebarButton";

type AnchorRect = { x: number; y: number; width: number; height: number };

let locateAnchor: (windowId: string, id: TourAnchor) => Promise<AnchorRect | null> = () => Promise.resolve(null);

export function setTourAnchorLocator(locate: typeof locateAnchor) {
  locateAnchor = locate;
}

export function tourWindowFacts(windowId: string) {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (!w) return null;
  const tabId = activeTabId(s, windowId);
  return { tabLayout: w.tabLayout ?? s.settings.tabLayout, sidebarOpen: w.sidebarOpen, tabId, inSplit: !!splitOf(s, tabId), url: useUrlAnchors.getState()[windowId] };
}

export type TourStop = {
  id: string;
  title: string;
  body: string;
  anchor?: TourAnchor;
  placement?: "below" | "right" | "inside";
  radius?: number;
  pad?: number;
};

const TOUR_STOPS: TourStop[] = [
  {
    id: "commandBar",
    title: "Search or go anywhere",
    body: "Type a question, an address or the name of an open tab. ⌘L brings the command bar up from any page, and ⌘T opens a new tab.",
    anchor: "commandBar",
    placement: "below",
    radius: 20,
    pad: 6,
  },
  {
    id: "tabs",
    title: "Your tabs live in the sidebar",
    body: "New tabs land here. Drag them to reorder or group them; right-click one to pin it, so it's always a click away.",
    anchor: "tabs",
    placement: "right",
    radius: 10,
    pad: 4,
  },
  {
    id: "sidebar",
    title: "Room to focus",
    body: "⌘S hides the sidebar. Move the pointer to the window's left edge to peek at your tabs while it's hidden.",
    anchor: "sidebarButton",
    placement: "below",
    radius: 9,
    pad: 3,
  },
  {
    id: "split",
    title: "Two pages, side by side",
    body: "Drag a tab onto the page to split the window, or press ⌃⇧=. ⌃⇧] and ⌃⇧[ move between the panes.",
    anchor: "page",
    placement: "inside",
    radius: 10,
    pad: -10,
  },
  {
    id: "done",
    title: "You're all set",
    body: "Everything else is in the menu bar and in Settings (⌘,). You can take this tour again from the Help menu.",
  },
];

type TourState = {
  windowId: string | null;
  stops: TourStop[];
  index: number;
  session: number;
};

export const useTour = create<TourState>()(() => ({ windowId: null, stops: [], index: 0, session: 0 }));

export async function startToolTour(windowId?: string | null) {
  const id = resolveWindowId(useBrowser.getState(), windowId);
  if (!id) return;
  const session = useTour.getState().session + 1;
  useTour.setState({ windowId: null, stops: [], index: 0, session });
  closeReleaseNotes();
  const found = await Promise.all(TOUR_STOPS.map((stop) => (stop.anchor ? locateAnchor(id, stop.anchor) : Promise.resolve(true))));
  if (useTour.getState().session !== session) return;
  useTour.setState({ windowId: id, stops: TOUR_STOPS.filter((_, i) => !!found[i]) });
}

export function endToolTour() {
  useTour.setState((s) => ({ windowId: null, stops: [], index: 0, session: s.session + 1 }));
}

export function stepToolTour(delta: number) {
  const { index, stops } = useTour.getState();
  const next = index + delta;
  if (next >= stops.length) return endToolTour();
  useTour.setState({ index: Math.max(0, next) });
}

export function videoTourUrl(): string | null {
  const url = systemInfo().videoTourURL;
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function openVideoTour(windowId?: string | null) {
  const url = videoTourUrl();
  if (url) openUrls([url], windowId);
}

if (__DEV__) (globalThis as { acTour?: unknown }).acTour = { store: useTour, start: startToolTour, step: stepToolTour, end: endToolTour };
