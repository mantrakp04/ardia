import { createContext, useContext } from "react";

export const SiteGroundContext = createContext<string | null>(null);

export const useSiteGround = () => useContext(SiteGroundContext);
