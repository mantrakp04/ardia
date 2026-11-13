import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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

export function useBottomLift(): { lift: number; keyboard: boolean } {
  const keyboard = useKeyboardHeight();
  const inset = useSafeAreaInsets().bottom;
  if (!keyboard) return { lift: inset, keyboard: false };
  return { lift: Platform.OS === "android" ? keyboard + inset : Math.max(keyboard, inset), keyboard: true };
}
