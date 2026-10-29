import { useEffect, useRef, useState } from "react";
import { fileExists } from "../../state/app/system";
import type { Download } from "../../state/downloads/actions";
import { awaitsKeep } from "../../state/downloads/downloadMenu";
import { onDownloadsChanged } from "../../state/windows/downloadWatch";

export function useDownloadView(d: Download) {
  const exists = d.state !== "finished" || fileExists(d.path);
  const shown = useRef(exists);
  shown.current = exists;
  const [, recheck] = useState(0);
  const finishedPath = d.state === "finished" ? d.path : null;
  useEffect(() => {
    if (finishedPath === null) return;
    const check = () => {
      if (fileExists(finishedPath) !== shown.current) recheck((n) => n + 1);
    };
    check();
    return onDownloadsChanged(check);
  }, [finishedPath]);
  return {
    exists,
    done: d.state === "finished" && exists,
    progress: d.total > 0 ? d.received / d.total : 0,
    blocked: awaitsKeep(d),
  };
}
