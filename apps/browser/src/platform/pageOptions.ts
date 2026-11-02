import { call } from "@ardia/ardiacore";

export const setPeekModifier = (modifier: "alt" | "shift" | "off") => call("webView.setPeekModifier", { modifier });
export const setSplitLinkModifier = (modifier: "alt" | "altShift") => call("webView.setSplitLinkModifier", { modifier });
export const setPeekOtherSiteTabs = (tabIds: string[]) => call("webView.setPeekOtherSiteTabs", { tabIds });
export const setSelectionPopover = (enabled: boolean) => call("webView.setSelectionPopover", { enabled });
export const setSearchEngineName = (name: string) => call("search.setEngineName", { name });
