import type { PreviewId } from "../../../state/onboarding/previewIds";
import type { Scene } from "./scene";
import { block } from "./scenes/BlockingScenes";
import { CmdlCentred, CmdlField, NewTabOpensBar, NewTabOpensPage, newTabAt, typed } from "./scenes/CommandBarScenes";
import { quit, tidy, windows } from "./scenes/LifecycleScenes";
import { links } from "./scenes/LinkScenes";
import { appearance, siteColor } from "./scenes/LookScenes";
import { interfaceStyle } from "./scenes/StyleScenes";
import { switcher } from "./scenes/SwitcherScenes";
import { addressMove, TabsSidebar, TabsTop } from "./scenes/TabScenes";
import { sceneMs } from "./tokens";

export const DEMOS: Record<PreviewId, { duration: number; Scene: Scene }> = {
  "tabs-sidebar": { duration: sceneMs.tabs, Scene: TabsSidebar },
  "tabs-top": { duration: sceneMs.tabs, Scene: TabsTop },
  "address-toolbar": { duration: sceneMs.address, Scene: addressMove(false) },
  "address-sidebar": { duration: sceneMs.address, Scene: addressMove(true) },
  "cmdl-field": { duration: sceneMs.commandBar, Scene: CmdlField },
  "cmdl-centred": { duration: sceneMs.commandBar, Scene: CmdlCentred },
  "newtab-page": { duration: sceneMs.newTab, Scene: NewTabOpensPage },
  "newtab-commandbar": { duration: sceneMs.newTab, Scene: NewTabOpensBar },
  "newtabpos-bottom": { duration: sceneMs.newTabPosition, Scene: newTabAt("bottom") },
  "newtabpos-top": { duration: sceneMs.newTabPosition, Scene: newTabAt("top") },
  "newtabpos-next": { duration: sceneMs.newTabPosition, Scene: newTabAt("next") },
  "tidy-keep": { duration: sceneMs.tidy, Scene: tidy(false) },
  "tidy-auto": { duration: sceneMs.tidy, Scene: tidy(true) },
  "quit-restore": { duration: sceneMs.quit, Scene: quit(false) },
  "quit-fresh": { duration: sceneMs.quit, Scene: quit(true) },
  "windows-separate": { duration: sceneMs.windows, Scene: windows(false) },
  "windows-shared": { duration: sceneMs.windows, Scene: windows(true) },
  "appearance-auto": { duration: sceneMs.appearance, Scene: appearance("auto") },
  "appearance-light": { duration: sceneMs.appearance, Scene: appearance("light") },
  "appearance-dark": { duration: sceneMs.appearance, Scene: appearance("dark") },
  "style-glass": { duration: sceneMs.style, Scene: interfaceStyle(true) },
  "style-classic": { duration: sceneMs.style, Scene: interfaceStyle(false) },
  "sitecolor-on": { duration: sceneMs.siteColor, Scene: siteColor(true) },
  "sitecolor-off": { duration: sceneMs.siteColor, Scene: siteColor(false) },
  "switcher-dots": { duration: sceneMs.switcher, Scene: switcher(false) },
  "switcher-icons": { duration: sceneMs.switcher, Scene: switcher(true) },
  "typed-website": { duration: sceneMs.typed, Scene: typed(false) },
  "typed-search": { duration: sceneMs.typed, Scene: typed(true) },
  "block-on": { duration: sceneMs.block, Scene: block(true) },
  "block-off": { duration: sceneMs.block, Scene: block(false) },
  "links-little": { duration: sceneMs.links, Scene: links(true) },
  "links-tab": { duration: sceneMs.links, Scene: links(false) },
};
