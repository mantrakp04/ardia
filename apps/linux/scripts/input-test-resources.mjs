import { create as createStore } from "zustand";

export * from "zustand";
export let resourceCache;
export const create = () => (initializer) => {
  resourceCache = createStore()(initializer);
  return resourceCache;
};
