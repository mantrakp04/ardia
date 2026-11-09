import { useEffect, useRef, useState } from "react";
import { Animated } from "react-native";
import { useCardFrame } from "../window/cardFrame";
import { curve, duration } from "../ui/motion";
import { useActiveTabId, useTab, useWindowId } from "../../state/browser/hooks";
import { closeBoostEditor, useBoostEditor } from "../../state/boosts/editor";
import { BoostPanel } from "./BoostPanel";
import { BOOST_PANEL } from "./tokens";

export function BoostEditorDock() {
  const windowId = useWindowId();
  const { splitGap } = useCardFrame();
  const editor = useBoostEditor(windowId);
  const activeId = useActiveTabId();
  const tabAlive = useTab(editor?.tabId, (t) => !!t);
  const appear = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(editor);
  useEffect(() => {
    if (editor && (activeId !== editor.tabId || !tabAlive)) closeBoostEditor(windowId);
  }, [editor?.tabId, activeId, tabAlive, windowId]);
  useEffect(() => {
    if (editor) setShown(editor);
    Animated.timing(appear, { toValue: editor ? 1 : 0, duration: duration.base, easing: curve.enter, useNativeDriver: false }).start(({ finished }) => {
      if (finished && !editor) setShown(null);
    });
  }, [editor?.tabId, editor?.boostId]);
  if (!shown) return null;
  const room = BOOST_PANEL.width + splitGap;
  return (
    <Animated.View style={{ width: appear.interpolate({ inputRange: [0, 1], outputRange: [0, room] }), overflow: "hidden" }}>
      <Animated.View style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: BOOST_PANEL.width, opacity: appear }}>
        <BoostPanel key={`${shown.tabId}:${shown.boostId}`} windowId={windowId} editor={shown} />
      </Animated.View>
    </Animated.View>
  );
}
