import { useEffect, useRef } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { ImportWindow } from "../import/ImportWindow";
import { SettingsWindow } from "./SettingsWindow";
import { SETTINGS_WINDOW_ID } from "../../state/settings/settingsWindows";

const EMPTY_CHECK_MS = 2000;

function useReportEmptyContent(id: string) {
  const size = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const laidOut = size.current;
      if (laidOut && laidOut.width > 0 && laidOut.height > 0) return;
      const shown = laidOut ? `${Math.round(laidOut.width)}x${Math.round(laidOut.height)}` : "never laid out";
      console.warn(`[window] ${id} content is empty ${EMPTY_CHECK_MS} ms after opening: ${shown}`);
    }, EMPTY_CHECK_MS);
    return () => clearTimeout(timer);
  }, [id]);
  return (e: LayoutChangeEvent) => {
    size.current = e.nativeEvent.layout;
  };
}

export function UtilityWindow({ id }: { id: string }) {
  const onLayout = useReportEmptyContent(id);
  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      {id === SETTINGS_WINDOW_ID ? <SettingsWindow /> : <ImportWindow />}
    </View>
  );
}
