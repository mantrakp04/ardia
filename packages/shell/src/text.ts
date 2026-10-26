import { Shell } from "./shellNative";

export const startDictation = () => Shell.startDictation();

export function copyText(text: string) {
  Shell.copyText(text);
}
