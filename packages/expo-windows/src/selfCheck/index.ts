import type { Check } from "./check";
import { checks as appSystemChecks } from "./appSystem";
import { checks as engineHostChecks } from "./engineHost";
import { checks as externalAppChecks } from "./externalApps";
import { checks as fileDropChecks } from "./fileDrop";
import { checks as heldDialogChecks } from "./heldDialogs";
import { checks as desktopCallChecks } from "./desktopCalls";
import { checks as focusChecks } from "./focus";
import { checks as idleTimeChecks } from "./idleTime";
import { checks as importChecks } from "./importFiles";
import { checks as introMusicChecks } from "./introMusic";
import { checks as importFirefoxChecks } from "./importFirefox";
import { checks as launchLinkChecks } from "./launchLinks";
import { checks as materialChecks } from "./materials";
import { checks as menuChecks } from "./menus";
import { checks as motionChecks } from "./motion";
import { checks as pagePictureChecks } from "./pagePicture";
import { checks as pagerChecks } from "./pager";
import { checks as shellChecks } from "./shell";
import { checks as storageChecks } from "./storage";
import { checks as symbolChecks } from "./symbol";
import { checks as syncChecks } from "./sync";
import { checks as textFocusChecks } from "./textFocus";
import { checks as viewChecks } from "./views";
import { checks as windowDragChecks } from "./windowDrag";
import { checks as windowChecks } from "./windows";

const areas: Check[][] = [windowChecks, appSystemChecks, shellChecks, storageChecks, viewChecks, menuChecks, symbolChecks, motionChecks, pagerChecks, pagePictureChecks, materialChecks, windowDragChecks, fileDropChecks, focusChecks, idleTimeChecks, textFocusChecks, launchLinkChecks, engineHostChecks, importChecks, importFirefoxChecks, introMusicChecks, desktopCallChecks, externalAppChecks, syncChecks, heldDialogChecks];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runSelfCheck() {
  let passed = 0;
  let failed = 0;
  for (const check of areas.flat()) {
    try {
      await check.run();
      passed += 1;
      console.info(`[ardia windows] self-check pass: ${check.name}`);
    } catch (error) {
      failed += 1;
      console.info(`[ardia windows] self-check FAIL: ${check.name}: ${message(error)}`);
    }
  }
  console.info(`[ardia windows] self-check done: ${passed} passed, ${failed} failed`);
}
