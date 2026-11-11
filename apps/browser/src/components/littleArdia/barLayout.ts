import { captionRoom, WINDOW_CHROME, type WindowChrome } from "../../lib/windowChrome";
import { CARD_INSET } from "../../lib/windowLayout";
import { SMALL_BAR_HEIGHT, SMALL_LIGHTS_CENTER } from "../../state/windows/small";
import { NAV_CENTER_PAST_ZOOM, SMALL_BAR_BUTTON, SMALL_BAR_GAP, SMALL_FIELD_GAP, SMALL_FIELD_HEIGHT, TRAFFIC_LIGHT_PITCH } from "./tokens";

export type LittleArdiaBarLayout = {
  height: number;
  navLeft: number;
  navPitch: number;
  fieldLeft: number;
  fieldTop: number;
  buttonTop: number;
  trailingRoom: number;
  controlsRight: number;
};

export function littleArdiaBarLayout(chrome: WindowChrome = WINDOW_CHROME): LittleArdiaBarLayout {
  const height = Math.max(SMALL_BAR_HEIGHT, chrome.titleBarHeight);
  const navLeft = chrome.leadingWidth ? SMALL_LIGHTS_CENTER[0] + 2 * TRAFFIC_LIGHT_PITCH + NAV_CENTER_PAST_ZOOM - SMALL_BAR_BUTTON / 2 : CARD_INSET;
  const navPitch = SMALL_BAR_BUTTON + SMALL_BAR_GAP;
  const trailingRoom = captionRoom(0, 0, chrome);
  return {
    height,
    navLeft,
    navPitch,
    fieldLeft: navLeft + navPitch + SMALL_BAR_BUTTON + SMALL_FIELD_GAP,
    fieldTop: (height - SMALL_FIELD_HEIGHT) / 2,
    buttonTop: (height - SMALL_BAR_BUTTON) / 2,
    trailingRoom,
    controlsRight: CARD_INSET + trailingRoom,
  };
}
