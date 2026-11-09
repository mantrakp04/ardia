import type { ReactNode } from "react";
import { openDroppedInTab } from "../../state/drag/windowDrop";
import { FileDropArea, type DropUpdate } from "../ui";

export function NewTabDropArea({ tabId, accepting, children }: { tabId: string; accepting: boolean; children: ReactNode }) {
  const onDropUpdate = (e: DropUpdate) => {
    if (e.phase === "drop") openDroppedInTab(tabId, e.items);
  };
  return (
    <FileDropArea style={{ flex: 1 }} accepts="linksAndText" enabled={accepting} onDropUpdate={onDropUpdate}>
      {children}
    </FileDropArea>
  );
}
