import type { InstalledExtension } from "../../state/extensions/store";
import { showMenu } from "../../state/app/system";
import { useRef } from "react";
import type { View } from "react-native";
import { activateExtension, openManageExtensions, openPinDialog, openWebStore, showExtensionMenu, useWindowExtensions, type Anchor } from "../../state/extensions/actions";
import { ExtensionTile, SectionTitle, TileGrid } from "./SiteControlsParts";

export function SiteExtensions({ windowId, tabId, columns, onClose }: { windowId: string; tabId: string; columns: number; onClose: () => void }) {
  const extensions = useWindowExtensions(windowId);
  return (
    <>
      <SectionTitle title="Extensions" />
      <TileGrid columns={columns}>
        {extensions.map((ext) => (
          <ExtensionGridTile key={ext.id} ext={ext} windowId={windowId} tabId={tabId} onClose={onClose} />
        ))}
        <ExtensionTile
          name="Add Extension"
          icon={null}
          symbol="plus"
          onPress={() => {
            onClose();
            openWebStore(windowId);
          }}
          onContextMenu={() => void addMenu(windowId, onClose)}
        />
      </TileGrid>
    </>
  );
}

function ExtensionGridTile({ ext, windowId, tabId, onClose }: { ext: InstalledExtension; windowId: string; tabId: string; onClose: () => void }) {
  const ref = useRef<View>(null);
  const anchor = () =>
    new Promise<Anchor>((resolve) => {
      if (!ref.current) return resolve({ x: 0, y: 0, width: 0, height: 0 });
      ref.current.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
    });
  return (
    <ExtensionTile
      ref={ref}
      name={ext.pinned ? `${ext.actionTitle || ext.name} (pinned)` : ext.actionTitle || ext.name}
      icon={ext.actionIcon || ext.icon || null}
      onPress={async () => {
        const at = await anchor();
        onClose();
        void activateExtension(windowId, ext, at, undefined, tabId);
      }}
      onContextMenu={() => void showExtensionMenu(windowId, ext)}
    />
  );
}

async function addMenu(windowId: string, onClose: () => void) {
  const choice = await showMenu([
    { id: "add", title: "Add Extension…", symbol: "plus" },
    { id: "pin", title: "Pin Extensions…", symbol: "pin" },
    { id: "manage", title: "Manage Extensions…", symbol: "puzzlepiece.extension" },
  ]);
  if (!choice) return;
  onClose();
  if (choice === "add") openWebStore(windowId);
  if (choice === "pin") openPinDialog(windowId);
  if (choice === "manage") openManageExtensions(windowId);
}
