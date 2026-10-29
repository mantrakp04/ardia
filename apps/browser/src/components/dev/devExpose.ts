import { devRegister } from "./devRegister";
import * as permissions from "../../state/site/permissions";
import { usePages } from "../../state/tabs/pageState";
import * as splitActions from "../../state/splits/actions";
import { useToasts } from "../../state/app/toasts";
import * as tabDrag from "../../state/drag/tabDrag";
import { devPeeks, useDockMotion } from "../../state/windows/dockMotion";
import { useUrlAnchors } from "../../state/windows/layout";

devRegister("acLayout", null, { pages: usePages, anchors: useUrlAnchors, toasts: useToasts, splitActions, tabDrag, permissions, peek: devPeeks, dockMotion: useDockMotion });
