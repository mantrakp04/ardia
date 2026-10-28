import { setCommandScrollZoom } from "../../platform/siteSettings";
import { useBrowser } from "../browser/store";

export function startCommandScrollZoom() {
  let sent: boolean | null = null;
  const sync = () => {
    const on = useBrowser.getState().settings.commandScrollZoom ?? true;
    if (on !== sent) void setCommandScrollZoom((sent = on));
  };
  sync();
  return useBrowser.subscribe(sync);
}
