import { forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useInputRegion } from "./shellAbove";

type RegionProps = { testID: string; dataSet?: Record<string, string>; children: ReactNode };

export const PageOverlayRegion = forwardRef<View & HTMLElement, RegionProps>(function PageOverlayRegion({ testID, dataSet, children }, ref) {
  const region = useRef<View & Element>(null);
  useImperativeHandle(ref, () => region.current as View & HTMLElement);
  useInputRegion(region, "hit");
  return (
    <View ref={region} testID={testID} pointerEvents="box-none" style={StyleSheet.absoluteFill} {...({ dataSet } as object)}>
      {children}
    </View>
  );
});
