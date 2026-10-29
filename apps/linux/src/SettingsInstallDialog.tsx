import { useEffect, useState } from "react";
import { InstallDialogHost as SharedInstallDialogHost } from "../../browser/src/components/extensions/ExtensionOverlays";
import { useExtensions } from "./extensionsStore";
import { followInstallRequest, leftoverInstallRequest, ownsInstallRequest } from "./installRequestSheet";

export * from "../../browser/src/components/extensions/ExtensionOverlays";

const keepSheet = () => {};

export function InstallDialogHost({ windowId, onClosed }: { windowId: string; onClosed: () => void }) {
  const [leftover] = useState(() => leftoverInstallRequest(useExtensions.getState().install));
  const requested = useExtensions((e) => ownsInstallRequest(e.install, windowId, leftover));
  useEffect(() => followInstallRequest(useExtensions, windowId, onClosed, leftover), [windowId, onClosed, leftover]);
  return requested ? <SharedInstallDialogHost windowId={windowId} onClosed={keepSheet} /> : null;
}
