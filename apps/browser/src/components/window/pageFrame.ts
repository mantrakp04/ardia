import { layout } from "../ui/theme";
import { dockedCardLeft } from "./dockMotion";

export function pageFrameInsets(show: boolean, stripHeight = 0) {
  const side = show ? layout.cardInset : 0;
  return { top: stripHeight || side, right: side, bottom: side, left: side };
}

export function pageFrameDockedLeft(show: boolean, sidebarWidth: number) {
  return show ? dockedCardLeft(sidebarWidth) : sidebarWidth;
}

export function pageFrameRadius(show: boolean, fullscreen: boolean, small: boolean) {
  return fullscreen ? 0 : show || small ? layout.cardRadius : 0;
}
