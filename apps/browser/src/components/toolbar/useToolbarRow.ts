import { useSettings } from "../../state/browser/hooks";
import { currentSettings } from "../../state/browser/current";
import { toolbarRowOf, type ToolbarRow } from "../../lib/toolbarRow";

export const useToolbarRow = (): ToolbarRow => toolbarRowOf(useSettings((s) => s.compactToolbar));

export const currentToolbarRow = (): ToolbarRow => toolbarRowOf(currentSettings().compactToolbar);
