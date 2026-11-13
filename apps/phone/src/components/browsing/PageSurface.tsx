import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { pageMounted, pageStateChanged, pageToneChanged } from "../../state/browse/store";
import { registerPageHandle } from "../../state/pages/store";
import type { BrowserTab } from "../../state/tabs/tabModels";
import { browseLayout, PageView, type PageViewHandle } from "../ui";

export function PageSurface({ tab }: { tab: BrowserTab }) {
  const handle = useRef<PageViewHandle>(null);
  const id = tab.id;
  const [initialUrl] = useState(tab.url);
  useEffect(() => {
    pageMounted(id);
    registerPageHandle(id, handle.current);
    return () => registerPageHandle(id, null);
  }, [id]);
  return (
    <PageView
      ref={handle}
      style={StyleSheet.absoluteFill}
      pageId={id}
      initialUrl={initialUrl}
      toneInsets={{ top: 0, bottom: browseLayout.pageOverlap }}
      onPageState={(state) => pageStateChanged(id, state)}
      onPageTone={(tone) => pageToneChanged(id, tone)}
    />
  );
}
