import { call, on, type ContentBlockerState, type ContentBlockerStats, type CustomFilterList, type FilterList, type FilterListCategory } from "@ardia/ardiacore";

export type { ContentBlockerState, CustomFilterList, FilterList, FilterListCategory };

export const getContentBlocker = () => call("contentBlocker.state");
export const setContentBlockerEnabled = (enabled: boolean) => call("contentBlocker.setEnabled", { enabled });
export const setFilterListEnabled = (id: string, enabled: boolean) => call("contentBlocker.setListEnabled", { id, enabled });
export const addFilterList = (url: string) => call("contentBlocker.addList", { url });
export const removeFilterList = (id: string) => call("contentBlocker.removeList", { id });
export const updateFilterList = (id: string) => call("contentBlocker.updateList", { id });
export const getUserFilters = () => call("contentBlocker.userFilters");
export const setUserFilters = (text: string) => call("contentBlocker.setUserFilters", { text });
export const isContentBlockerAllowed = (host: string) => call("contentBlocker.isAllowed", { host });
export const setContentBlockerAllowed = (host: string, allowed: boolean) => call("contentBlocker.setAllowed", { host, allowed });
export const onContentBlockerChange = (listener: (stats: ContentBlockerStats) => void) => on("contentBlocker.changed", listener);
