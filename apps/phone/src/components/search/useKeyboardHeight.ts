import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(Keyboard.metrics()?.height ?? 0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => setHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
