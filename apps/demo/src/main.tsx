import "./styles.css";
import { createRoot } from "react-dom/client";
import { unstable_batchedUpdates } from "react-native";
import { emitCommand } from "@ardia/shell";
import { WindowRoot } from "../../browser/src/App";
import { startNativeSync } from "../../browser/src/state/app/nativeSync";
import { startTabPages } from "../../browser/src/state/tabs/tabPages";
import { setStoreBatching, useBrowser } from "../../browser/src/state/browser/store";
import { Customize } from "./Customize";
import { demoSettings } from "./customizeFlow";
import { startEmbed } from "./embed";
import { isFrameable } from "./frameable";
import { pageTitle } from "./pages";
import { installLocalSuggestions } from "./localSuggest";
import { demoSession } from "./seed";
import { warmFrame } from "./shims/web/framePool";
import { MenuHost } from "./shims/web/menus";
import "./shims/web/motion/shortcuts";
import { TrafficLights } from "./shims/web/windowChrome";

installLocalSuggestions();
setStoreBatching(unstable_batchedUpdates);
useBrowser.getState().hydrate({ ...demoSession(), settings: demoSettings() });
startTabPages();
startNativeSync();

const params = new URLSearchParams(location.search);
const embed = params.has("embed");
const bare = embed || params.has("bare");

Object.assign(globalThis, { ardiaDemo: { store: useBrowser, emitCommand } });

function warmOtherProfiles() {
  const s = useBrowser.getState();
  for (const window of Object.values(s.windows))
    for (const [profileId, tabId] of Object.entries(window.activeTabIds)) {
      const url = s.tabs[tabId]?.url;
      if (profileId !== window.profileId && url && isFrameable(url)) warmFrame(url, pageTitle(url));
    }
}

const idle = (run: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(run, { timeout: 1500 }) : setTimeout(run, 300));
if (!embed || params.has("warm")) idle(warmOtherProfiles);

function DemoWindow() {
  return (
    <div className={embed ? "ardia-desktop embed" : bare ? "ardia-desktop" : "ardia-desktop with-controls"}>
      <div className="ardia-window">
        <WindowRoot />
        <TrafficLights />
      </div>
      {bare ? null : <Customize />}
      <MenuHost />
    </div>
  );
}

createRoot(document.getElementById("root")!, { onUncaughtError: (error) => console.error("[ardia demo] crashed", error) }).render(<DemoWindow />);

if (embed) startEmbed();
