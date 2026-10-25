import type { InstalledExtension } from "@ardia/ardiacore";
import type { ExtensionCandidate, Suggestion } from "@ardia/core";
import { useMemo } from "react";
import { openExtensionFromMenu } from "../extensions/bridge";
import { openOptions, shownIn, useWindowExtensions } from "../extensions/state";

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

export function runBarExtension(s: Extract<Suggestion, { kind: "extension" }>, windowId: string) {
  if (s.open === "action") return openExtensionFromMenu(windowId, s.id);
  const ext = shownIn(windowId, s.id);
  if (ext) openOptions(windowId, ext);
}
