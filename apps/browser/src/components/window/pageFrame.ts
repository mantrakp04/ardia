import { layout } from "../ui/theme";

export function pageFrameInsets(show: boolean, stripHeight = 0, stripInset = 0) {
  const side = show ? (stripHeight ? stripInset : layout.cardInset) : 0;
  return { top: stripHeight || (show ? layout.cardTop : 0), right: side, bottom: side, left: side };
}

export function pageFrameRadius(show: boolean, fullscreen: boolean, small: boolean) {
  return fullscreen ? 0 : show || small ? layout.cardRadius : 0;
}
