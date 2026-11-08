import type { ReactNode } from "react";
import { openDroppedInTab } from "../../state/drag/windowDrop";
import { FileDropArea, type DropUpdate } from "../ui";

export function NewTabDropArea({ tabId, children }: { tabId: string; children: ReactNode }) {
  const onDropUpdate = (e: DropUpdate) => {
    if (e.phase === "drop") openDroppedInTab(tabId, e.items);
  };
  return (
    <FileDropArea style={{ flex: 1 }} accepts="linksAndText" onDropUpdate={onDropUpdate}>
      {children}
    </FileDropArea>
  );
}
