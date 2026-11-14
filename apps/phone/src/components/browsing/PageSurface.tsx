import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { pageStateChanged, pageToneChanged } from "../../state/browse/store";
import { registerPageHandle } from "../../state/pages/store";
import { tabSavedState } from "../../state/tabs/store";
import type { BrowserTab } from "../../state/tabs/tabModels";
import { usePreferences } from "../../state/settings/hooks";
import { pageSwipe } from "../../state/settings/settingsRules";
import { PageView, type PageViewHandle } from "../ui";

export function PageSurface({ tab, toneBottom }: { tab: BrowserTab; toneBottom: number }) {
  const handle = useRef<PageViewHandle>(null);
  const id = tab.id;
  const swipe = usePreferences((p) => p.swipeNavigation);
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
      swipeNavigation={pageSwipe(swipe)}
      pullToRefresh
      onPageState={(state) => pageStateChanged(id, state)}
      onPageTone={(tone) => pageToneChanged(id, tone)}
    />
  );
}
