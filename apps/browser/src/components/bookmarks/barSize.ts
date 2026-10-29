import { useSettings } from "../../state/browser/hooks";
import { barSizes, type BarSize } from "./tokens";

export const useBarSize = (): BarSize => barSizes[useSettings((s) => s.bookmarksBarSize)] ?? barSizes.default;

export const useBookmarksBarHeight = (): number => useBarSize().height;
