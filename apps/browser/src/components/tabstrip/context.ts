import { createContext } from "react";
import type { Strip } from "./model";

export const FloatingStrip = createContext(false);
export const DockContext = createContext<Strip | null>(null);
