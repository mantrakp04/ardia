import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { useIsIncognito, useWindowId } from "../../state/browser/hooks";
import { installDroppedCrx } from "../../state/extensions/crxDrop";
import { FileDropArea, type DropUpdate } from "../ui";

export function CrxDropArea({ children, ...props }: ViewProps & { children?: ReactNode }) {
  const windowId = useWindowId();
  if (useIsIncognito()) return <View {...props}>{children}</View>;
  const onDropUpdate = (e: DropUpdate) => {
    if (e.phase !== "drop") return;
    installDroppedCrx(windowId, e.items.flatMap((item) => (item.kind === "file" ? [item.url] : [])));
  };
  return (
    <FileDropArea {...props} accepts="extensionPackages" onDropUpdate={onDropUpdate}>
      {children}
    </FileDropArea>
  );
}
