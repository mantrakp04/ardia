import { useShallow } from "zustand/react/shallow";
import { useBrowser, type BrowserState } from "../browser/store";
import { engineProfile } from "../browser/model";
import { focusedWindowOf } from "./ui";

export const useWindowUiOf = <T>(windowId: string, select: (ui: BrowserState["windowUi"][string] | undefined) => T): T =>
  useBrowser((s) => select(s.windowUi[windowId]));


export const useNativeWindowProfile = (windowId: string) =>
  useBrowser(
    useShallow((s): [profile: string, neighbours: string, selection: string] => {
      const w = s.windows[windowId];
      if (!w) return ["", "[]", ""];
      const at = w.kind === "private" ? -1 : s.spaceOrder.indexOf(w.spaceId);
      const next = at < 0 ? [] : [s.spaceOrder[at - 1], s.spaceOrder[at + 1]].filter((p): p is string => !!p).map((id) => engineProfile(s, id));
      return [engineProfile(s, w.spaceId), JSON.stringify(next), w.spaceId];
    }),
  );

export const useSidebarDockState = (windowId: string) =>
  useBrowser(
    useShallow(
      (s) =>
        [
          s.windows[windowId]?.sidebarOpen ?? true,
          s.settings.sidebarWidth,
          s.settings.addressBar === "sidebar",
        ] as const,
    ),
  );

export const useSpaceNeighbours = (windowId: string) =>
  useBrowser(
    useShallow((s): [previous: boolean, next: boolean, multiple: boolean] => {
      const w = s.windows[windowId];
      const i = w && w.kind !== "private" ? s.spaceOrder.indexOf(w.spaceId) : -1;
      return i < 0 ? [false, false, false] : [i > 0, i < s.spaceOrder.length - 1, s.spaceOrder.length > 1];
    }),
  );

export const useIsFocusedWindow = (windowId: string): boolean => useBrowser((s) => focusedWindowOf(s) === windowId);

export const useDownload = (id: string) => useBrowser((s) => s.downloads.find((x) => x.id === id));
