import { emitNativeEvent, emitWhenListened } from "../events";
import { engineAvailable, onEngineTopic } from "./host";

let watching = false;

export function watchRelaunches() {
  if (watching || !engineAvailable()) return;
  watching = true;
  onEngineTopic("relaunch", (launch) => {
    const urls = Array.isArray(launch.urls) ? launch.urls.filter((url): url is string => typeof url === "string" && url.length > 0) : [];
    if (urls.length) emitWhenListened("ArdiaShell", "onOpenURLs", { urls });
    else emitNativeEvent("ArdiaShell", "onAppEvent", { type: "reopen" });
  });
}
