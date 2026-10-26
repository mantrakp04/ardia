import { generateBrief, loadDailyBrief, useDailyBriefs } from "../../state/briefs/dailyBriefs";
import { DailyBriefPage } from "../briefs/DailyBriefPage";
import { briefTitleForDate } from "../briefs/assets";
import { briefDateFromUrl, localBriefDate } from "../../lib/briefDates";
import { openSettings } from "../../state/settings/settingsWindows";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useTab } from "../../state/browser/hooks";
import { currentTab } from "../../state/browser/current";
import { useTabBookmarkProfileId } from "../../state/bookmarks/hooks";
import { updateLive, updateTab } from "../../state/tabs/actions";
import { setPageProgress } from "../../state/tabs/pageProgress";
import { BookmarksPage } from "./BookmarksPage";
import { DownloadsPage } from "./DownloadsPage";
import { HistoryPage } from "./HistoryPage";
import { INTERNAL_PAGES, internalPageOf, internalQuery, tabDestination } from "../../state/pages/urls";

export function InternalPage({ tabId }: { tabId: string }) {
  const url = useTab(tabId, (t) => (t ? tabDestination(t) : ""));
  const page = internalPageOf(url);
  const date = briefDateFromUrl(url);
  const profileId = useTab(tabId, (t) => t?.profileId ?? "");
  const bookmarkProfile = useTabBookmarkProfileId(tabId);

  const brief = useDailyBriefs((s) => s.entries[`${profileId}/${date}`]);
  useEffect(() => {
    if (page === "brief") loadDailyBrief(profileId, date);
  }, [page, profileId, date]);

  useEffect(() => {
    if (!page) return;
    const t = currentTab(tabId);
    const title = page === "brief" ? briefTitleForDate(date) : INTERNAL_PAGES[page].title;
    if (t && (t.url !== url || t.title !== title)) updateTab(tabId, { url, title, favicon: null });
    updateLive(tabId, { isLoading: false, canGoBack: false, canGoForward: false });
    setPageProgress(tabId, 0);
  }, [page, url]);

  if (!page) return null;
  return (
    <View style={StyleSheet.absoluteFill}>
      {page === "brief" && <DailyBriefPage key={url} date={date} content={brief?.content} loading={brief?.loading} error={brief?.error} onGenerate={date === localBriefDate() ? () => void generateBrief(profileId, date) : undefined} onConfigure={() => openSettings("dailyBriefs")} />}
      {page === "history" && <HistoryPage tabId={tabId} profileId={profileId} initialQuery={internalQuery(url)} />}
      {page === "bookmarks" && <BookmarksPage key={bookmarkProfile} tabId={tabId} profileId={bookmarkProfile} />}
      {page === "downloads" && <DownloadsPage tabId={tabId} />}
    </View>
  );
}
