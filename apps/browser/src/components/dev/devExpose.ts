import * as permissions from "../../state/site/permissions";
import { usePages } from "../../state/tabs/pageState";
import * as splitActions from "../../state/splits/actions";
import * as tabDrag from "../../state/drag/tabDrag";
import { devPeeks, useDockMotion } from "../../state/windows/dockMotion";
import { useUrlAnchors } from "../../state/windows/layout";

if (__DEV__) {
  (globalThis as { acLayout?: unknown }).acLayout = { pages: usePages, anchors: useUrlAnchors, toasts: splitActions.useToasts, splitActions, tabDrag, permissions, peek: devPeeks, dockMotion: useDockMotion };
}
