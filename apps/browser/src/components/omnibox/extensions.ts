import { type InstalledExtension, useWindowExtensions } from "../../state/extensions/store";
import type { ExtensionCandidate } from "@ardia/core";
import { useMemo } from "react";

const candidateOf = (x: InstalledExtension): ExtensionCandidate => ({
  id: x.id,
  title: x.name,
  icon: x.actionIcon || x.icon || null,
  action: x.hasAction !== false,
  options: !!x.optionsUrl,
});

export function useBarExtensions(windowId: string): ExtensionCandidate[] {
  const list = useWindowExtensions(windowId);
  return useMemo(() => list.map(candidateOf).filter((x) => x.action || x.options), [list]);
}
