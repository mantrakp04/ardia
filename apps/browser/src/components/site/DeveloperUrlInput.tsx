import { useEffect, useRef, useState } from "react";
import { findNodeHandle, TextInput } from "react-native";
import { claimFocusTag, urlEditFocus } from "../../lib/focusClaims";
import { webviews } from "../../lib/webviews";
import { endUrlEdit, submitUrlEdit, useUrlEdit } from "./developerMode";

const MONOSPACED = ".AppleSystemUIFontMonospaced-Regular";

export function DeveloperUrlInput({ tabId, windowId, initial, color }: { tabId: string; windowId: string; initial: string; color: string }) {
  const [text, setText] = useState(initial);
  const input = useRef<TextInput>(null);
  const finished = useRef(false);
  const request = useUrlEdit((u) => u.request);
  useEffect(() => {
    finished.current = false;
    setText(initial);
    const t = setTimeout(() => {
      input.current?.focus();
      input.current?.setSelection(0, initial.length);
    }, 0);
    claimFocusTag(windowId, urlEditFocus(tabId), () => findNodeHandle(input.current));
    return () => clearTimeout(t);
  }, [request]);
  const finish = (submit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (submit) submitUrlEdit(tabId, text);
    else endUrlEdit(tabId);
    void webviews.get(tabId)?.focus();
  };
  return (
    <TextInput
      ref={input}
      value={text}
      onChangeText={setText}
      enableFocusRing={false}
      autoCorrect={false}
      spellCheck={false}
      onSubmitEditing={() => finish(true)}
      onBlur={() => {
        if (finished.current) return;
        finished.current = true;
        endUrlEdit(tabId);
      }}
      keyDownEvents={[{ key: "Escape" }]}
      onKeyDown={(e) => e.nativeEvent.key === "Escape" && finish(false)}
      style={{ height: 18, marginLeft: -2, marginTop: 4, fontSize: 11, fontFamily: MONOSPACED, color, paddingVertical: 0, paddingHorizontal: 0 }}
    />
  );
}
