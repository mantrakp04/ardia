import { openModeFor as sharedOpenModeFor } from "../../browser/src/state/bookmarks/actions";
import { primaryModifiers, type PointerModifiers } from "./clickModifiers";

export * from "../../browser/src/state/bookmarks/actions";

export const openModeFor = (event: PointerModifiers) => sharedOpenModeFor({ ...primaryModifiers(event), middle: event.middle });
