import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { pageStateChanged, pageToneChanged } from "../../state/browse/store";
import { registerPageHandle } from "../../state/pages/store";
import { tabSavedState } from "../../state/tabs/store";
import type { BrowserTab } from "../../state/tabs/tabModels";
import { PageView, type PageViewHandle } from "../ui";

export function PageSurface({ tab, toneBottom }: { tab: BrowserTab; toneBottom: number }) {
  const handle = useRef<PageViewHandle>(null);
  const id = tab.id;
  const [setup] = useState(() => ({ url: tab.url, title: tab.title, saved: tabSavedState(id) ?? undefined }));
  useEffect(() => {
    registerPageHandle(id, handle.current);
    return () => registerPageHandle(id, null);
  }, [id]);
  return (
    <PageView
      ref={handle}
      style={StyleSheet.absoluteFill}
      pageId={id}
      initialUrl={setup.url}
      title={setup.title}
      isPrivate={tab.isPrivate}
      savedState={setup.saved}
      toneInsets={{ top: 0, bottom: toneBottom }}
      onPageState={(state) => pageStateChanged(id, state)}
      onPageTone={(tone) => pageToneChanged(id, tone)}
    />
  );
}
