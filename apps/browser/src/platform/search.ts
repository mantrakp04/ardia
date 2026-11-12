import { call } from "@ardia/ardiacore";

export const fetchSearchSuggestions = (profile: string, url: string, id: number) => call("search.suggest", { profile, url, id });
export const stopSearchSuggestions = (profile: string, id: number) => call("search.stopSuggest", { profile, id });
