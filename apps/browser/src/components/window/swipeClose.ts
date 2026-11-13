import { createContext, useContext } from "react";
import type { SwipeEvent } from "../ui";

export type SwipeClose = (event: SwipeEvent) => void;

export const SwipeCloseContext = createContext<SwipeClose | null>(null);

export const useSwipeClose = () => useContext(SwipeCloseContext);
