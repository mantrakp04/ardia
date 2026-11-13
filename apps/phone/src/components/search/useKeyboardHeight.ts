import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

const SHOW = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
const HIDE = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(Keyboard.metrics()?.height ?? 0);
  useEffect(() => {
    const show = Keyboard.addListener(SHOW, (event) => setHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener(HIDE, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
