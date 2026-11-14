import { forwardRef, useCallback, useContext, useMemo, useRef } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type ViewProps } from "react-native";
import { assignRef, coverClip, CoverClips } from "../engine/coverClip";

export const ClipView = forwardRef<View, ViewProps>(function ClipView({ children, onLayout, ...props }, forwarded) {
  const node = useRef<View | null>(null);
  const clip = useRef(coverClip(() => node.current)).current;
  const above = useContext(CoverClips);
  const clips = StyleSheet.flatten(props.style)?.overflow === "hidden";
  const chain = useMemo(() => (clips ? [...above, clip] : above), [above, clips, clip]);
  const ref = useCallback(
    (value: View | null) => {
      node.current = value;
      assignRef(forwarded, value);
    },
    [forwarded],
  );
  const layout = useCallback(
    (event: LayoutChangeEvent) => {
      clip.moved();
      onLayout?.(event);
    },
    [clip, onLayout],
  );
  return (
    <View {...props} ref={ref} onLayout={layout}>
      <CoverClips.Provider value={chain}>{children}</CoverClips.Provider>
    </View>
  );
});
