import { forwardRef, useCallback, useContext, useMemo, useRef } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { assignRef, CoverClips } from "../engine/coverClip";

export const ClipView = forwardRef<View, ViewProps>(function ClipView({ children, ...props }, forwarded) {
  const node = useRef<View | null>(null);
  const above = useContext(CoverClips);
  const clips = StyleSheet.flatten(props.style)?.overflow === "hidden";
  const chain = useMemo(() => (clips ? [...above, () => node.current] : above), [above, clips]);
  const ref = useCallback(
    (value: View | null) => {
      node.current = value;
      assignRef(forwarded, value);
    },
    [forwarded],
  );
  return (
    <View {...props} ref={ref}>
      <CoverClips.Provider value={chain}>{children}</CoverClips.Provider>
    </View>
  );
});
