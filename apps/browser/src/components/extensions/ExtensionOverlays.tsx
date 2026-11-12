import { useEffect } from "react";
import { useExtensions } from "../../state/extensions/actions";
import { useWindowId } from "../../state/browser/hooks";
import { ActionPopup } from "./ActionPopup";
import { InstallDialog, PinDialog } from "./InstallDialog";

export function ExtensionOverlays() {
  const windowId = useWindowId();
  const popup = useExtensions((e) => (e.popup?.windowId === windowId ? e.popup : null));
  const install = useExtensions((e) => (e.install?.windowId === windowId ? e.install : null));
  const pin = useExtensions((e) => e.pinDialog?.windowId === windowId);
  return (
    <>
      {popup && <ActionPopup key={`${popup.extensionId}|${popup.url}|${popup.opened ?? 0}`} {...popup} />}
      {install && <InstallDialog request={install} />}
      {pin && <PinDialog windowId={windowId} />}
    </>
  );
}

export function InstallDialogHost({ windowId, onClosed }: { windowId: string; onClosed: () => void }) {
  const install = useExtensions((e) => (e.install?.windowId === windowId ? e.install : null));
  useEffect(() => {
    if (!install) onClosed();
  }, [!install]);
  return install ? <InstallDialog request={install} /> : null;
}
