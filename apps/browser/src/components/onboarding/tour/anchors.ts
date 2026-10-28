import type { View } from "react-native";
import { currentToolbarRow } from "../../toolbar/useToolbarRow";
import { toolbarGeometry, type Rect } from "../../window/geometry";
import { setTourAnchorLocator, tourWindowFacts, type TourAnchor } from "../../../state/onboarding/tour";
import { measureRow } from "../../../state/sidebar/sidebarUi";

const registered = new Map<string, View>();
const key = (windowId: string, id: TourAnchor) => `${windowId}\n${id}`;

export const tourAnchorRef = (windowId: string, id: TourAnchor) => (view: View | null) => {
  if (view) registered.set(key(windowId, id), view);
  else registered.delete(key(windowId, id));
};

function measure(view: View | undefined): Promise<Rect | null> {
  if (!view) return Promise.resolve(null);
  return new Promise((resolve) => view.measureInWindow((x, y, width, height) => resolve(width && height ? { x, y, width, height } : null)));
}

export async function locateAnchor(windowId: string, id: TourAnchor): Promise<Rect | null> {
  const w = tourWindowFacts(windowId);
  if (!w) return null;
  const { tabLayout } = w;
  switch (id) {
    case "commandBar":
    case "page":
      return measure(registered.get(key(windowId, id)));
    case "tabs": {
      return w.sidebarOpen && tabLayout === "sidebar" && w.tabId ? measureRow(windowId, w.tabId) : null;
    }
    case "sidebarButton": {
      const { url } = w;
      if (!url || url.sidebar || tabLayout !== "sidebar" || w.inSplit) return null;
      const g = toolbarGeometry({ sidebarButton: true });
      if (g.sidebarButton === null) return null;
      const row = currentToolbarRow();
      const size = row.button;
      return { x: url.left - g.urlLeft + g.sidebarButton - size / 2, y: url.top + row.center - size / 2, width: size, height: size };
    }
  }
}

setTourAnchorLocator(locateAnchor);
