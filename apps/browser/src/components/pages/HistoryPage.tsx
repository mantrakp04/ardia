import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useTab, useWindow } from "../../state/browser/hooks";
import { useHistory } from "../../state/history/hooks";
import { removeHistory } from "../../state/history/actions";
import type { HistoryEntry } from "../../state/browser/types";
import { requestClearData, useClearDataRequest } from "../../state/profiles/clearDataRequest";
import { Button, Symbol, Text, useTheme } from "../ui";
import { ClearDataDialog } from "./ClearDataDialog";
import { layoutHistory } from "./historyLayout";
import { confirmRemoveSelected } from "../../state/history/historyMenus";
import { HistoryList } from "./HistoryList";
import { EmptyState, hostLabel, PageHeader } from "./PageLayout";
import { EMPTY_ICON, emptyIcon } from "./tokens";

const NO_HISTORY: HistoryEntry[] = [];

export function HistoryPage({ tabId, profileId, initialQuery }: { tabId: string; profileId: string; initialQuery: string }) {
  const theme = useTheme();
  const windowId = useTab(tabId, (t) => t?.windowId ?? "");
  const history = useHistory((h) => h[profileId] ?? NO_HISTORY);
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clearOpen, setClearOpen] = useState(false);
  const lastClicked = useRef<string | null>(null);

  const clearRequest = useClearDataRequest((r) => r.windowId);
  const activeHere = useWindow(windowId, (w) => w?.activeTabIds[w!.profileId] === tabId);
  useEffect(() => {
    if (clearRequest === windowId && activeHere) {
      setClearOpen(true);
      requestClearData(null);
    }
  }, [clearRequest, activeHere]);

  useEffect(() => setQuery(initialQuery), [initialQuery]);

  const layout = useMemo(() => layoutHistory(history, query), [history, query]);
  const latest = useRef({ layout, profileId });
  latest.current = { layout, profileId };

  const toggle = useCallback((url: string, shift: boolean) => {
    const { rows } = latest.current.layout;
    const from = shift && lastClicked.current ? rows.findIndex((r) => r.entry.url === lastClicked.current) : -1;
    setSelected((prev) => {
      const next = new Set(prev);
      if (from >= 0) {
        const to = rows.findIndex((r) => r.entry.url === url);
        const [a, b] = [from, to].sort((x, y) => x - y);
        for (let i = a!; i <= b!; i++) next.add(rows[i]!.entry.url);
      } else if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
    lastClicked.current = url;
  }, []);
  const moreFromSite = useCallback((url: string) => setQuery(hostLabel(url)), []);
  const remove = useCallback((url: string) => removeHistory(latest.current.profileId, [url]), []);

  const deleteSelected = async () => {
    const confirmed = await confirmRemoveSelected(windowId);
    if (!confirmed) return;
    removeHistory(profileId, [...selected]);
    setSelected(new Set());
  };

  const actions =
    selected.size > 0 ? (
      <>
        <Text size="small" tone="textSecondary">{`${selected.size} selected`}</Text>
        <Button title="Cancel" onPress={() => setSelected(new Set())} />
        <Button title="Delete" kind="primary" onPress={() => void deleteSelected()} />
      </>
    ) : (
      <Button title="Clear Browsing Data…" onPress={() => setClearOpen(true)} />
    );

  return (
    <View style={{ flex: 1 }}>
      <PageHeader title="History" query={query} onQuery={setQuery} placeholder="Search history" actions={actions} />
      {layout.rows.length === 0 ? (
        <EmptyState
          icon={<Symbol name="clock" size={emptyIcon.size} color={theme.textTertiary} style={EMPTY_ICON} />}
          title={query ? "No search results found" : "Your browsing history appears here"}
        />
      ) : (
        <HistoryList
          layout={layout}
          profileId={profileId}
          windowId={windowId}
          selected={selected}
          onToggle={toggle}
          onMoreFromSite={moreFromSite}
          onRemove={remove}
        />
      )}
      {clearOpen && <ClearDataDialog profileId={profileId} onClose={() => setClearOpen(false)} />}
    </View>
  );
}
