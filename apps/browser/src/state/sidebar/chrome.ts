import type { ChromePart, Place } from "../../lib/themeLook";
import { useSettings } from "../browser/hooks";
import { useThemeLook } from "../config/hooks";
import { useAddressBarInSidebar } from "../windows/layout";

export const useSidebarPart = (part: ChromePart): boolean => !useThemeLook().hidden.has(part);

export function useSidebarField(): Place | null {
  const look = useThemeLook();
  const inSidebar = useAddressBarInSidebar();
  return inSidebar && !look.hidden.has("addressField") ? look.addressField : null;
}

export function useNewTabAtTop(): boolean {
  const place = useThemeLook().newTab;
  const setting = useSettings((s) => s.newTabButtonPosition);
  return (place ?? setting) === "top";
}
