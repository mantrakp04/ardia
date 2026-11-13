import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import { registerPageHandle, updateNavigation, updateTone, type OpenPage } from "../../state/browse/store";
import { browseLayout, PageView, type PageViewHandle } from "../ui";

export function PageSurface({ page }: { page: OpenPage }) {
  const handle = useRef<PageViewHandle>(null);
  useEffect(() => {
    registerPageHandle(handle.current);
    return () => registerPageHandle(null);
  }, [page.id]);
  return (
    <PageView
      ref={handle}
      style={StyleSheet.absoluteFill}
      pageId={page.id}
      initialUrl={page.initialUrl}
      toneInsets={{ top: 0, bottom: browseLayout.pageOverlap }}
      onPageState={updateNavigation}
      onPageTone={updateTone}
    />
  );
}
