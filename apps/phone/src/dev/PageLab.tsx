import {
  blocking,
  downloads,
  pages,
  PageView,
  type BlockingState,
  type DownloadProgress,
  type FindResult,
  type PageEngineEvent,
  type PageRequest,
  type PageSnapshot,
  type PageState,
  type ReadableContent,
} from "@ardia/phone-native";
import { openDatabaseSync } from "expo-sqlite";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { LAB_BLOCKING_URL, labBlockingHtml, runRestoreTest, runSelfTest, summarize, type TestLine } from "./selfTest";

const labPage = `<!doctype html><meta name="viewport" content="width=device-width"><title>Page Lab</title>
<body style="font:16px sans-serif;padding:12px">
<h3>Page Lab</h3>
<p><button id="alert" onclick="alert('lab alert')">Alert</button>
<button id="confirm" onclick="out.textContent='confirm '+confirm('lab confirm?')">Confirm</button>
<button id="prompt" onclick="out.textContent='prompt '+prompt('lab prompt','default')">Prompt</button></p>
<p><button id="popup" onclick="window.open('https://example.com/','_blank')">Popup</button>
<a href="https://example.org/" target="_blank">Blank link</a></p>
<p><button id="full" onclick="document.documentElement.requestFullscreen()">Fullscreen</button>
<button id="exit" onclick="document.exitFullscreen()">Exit full</button></p>
<p id="out">ready</p></body>`;

const LAB_URL = `data:text/html;charset=utf-8,${encodeURIComponent(labPage)}`;

const presets: [string, string][] = [
  ["Lab", LAB_URL],
  ["Wiki", "https://en.wikipedia.org/wiki/Web_browser"],
  ["Perms", "https://permission.site/"],
  ["UA", "https://www.whatsmyua.info/"],
];

const DOWNLOAD_URL = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

type SavedPage = { url: string | null; title: string; state: string; scrollY: number | null };

const store = (() => {
  let database: ReturnType<typeof openDatabaseSync> | null = null;
  const open = () => {
    if (!database) {
      database = openDatabaseSync("page-lab.db");
      database.execSync("create table if not exists saved_pages (id text primary key, url text, title text, state text not null, scrollY real)");
    }
    return database;
  };
  return {
    save: (id: string, page: SavedPage) =>
      open().runSync(
        "insert or replace into saved_pages (id, url, title, state, scrollY) values (?, ?, ?, ?, ?)",
        id,
        page.url,
        page.title,
        page.state,
        page.scrollY,
      ),
    load: (id: string) => open().getFirstSync<SavedPage>("select url, title, state, scrollY from saved_pages where id = ?", id),
  };
})();

function Button({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.button, active && styles.active]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const Row = ({ children }: { children: ReactNode }) => <View style={styles.row}>{children}</View>;

function Lab() {
  const insets = useSafeAreaInsets();
  const [pageId, setPageId] = useState("lab-a");
  const [privateIds, setPrivateIds] = useState<string[]>([]);
  const [showView, setShowView] = useState(true);
  const [url, setUrl] = useState(LAB_URL);
  const [query, setQuery] = useState("browser");
  const [states, setStates] = useState<Record<string, PageState>>({});
  const [find, setFind] = useState<FindResult | null>(null);
  const [request, setRequest] = useState<{ pageId: string; request: PageRequest } | null>(null);
  const [popup, setPopup] = useState<{ pageId: string; popupId: string; url: string | null } | null>(null);
  const [reader, setReader] = useState<ReadableContent | null | "none">(null);
  const [snapshot, setSnapshot] = useState<PageSnapshot | null | "none">(null);
  const [blockingState, setBlockingState] = useState<BlockingState | null>(null);
  const [siteBlocking, setSiteBlocking] = useState<boolean | null>(null);
  const [active, setActive] = useState<DownloadProgress[]>([]);
  const [finished, setFinished] = useState<{ fileName: string; uri: string | null; failure: string | null } | null>(null);
  const [restoreSource, setRestoreSource] = useState<SavedPage | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const popupCount = useRef(0);
  const [results, setResults] = useState<TestLine[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const announce = useCallback((line: string) => {
    console.log(line);
    setSummary(line);
  }, []);
  const report = useCallback((line: TestLine) => {
    console.log(`PAGELAB ${line.ok ? "PASS" : "FAIL"} ${line.step}: ${line.detail}`);
    setResults((all) => [...all, line]);
  }, []);

  const note = useCallback((line: string) => setLog((lines) => [`${new Date().toISOString().slice(11, 19)} ${line}`, ...lines].slice(0, 14)), []);
  const run = useCallback(
    (label: string, work: () => Promise<unknown>) => {
      work().then(
        (result) => note(`${label} → ${JSON.stringify(result ?? null)?.slice(0, 120)}`),
        (error: { code?: string; message?: string }) => note(`${label} ✗ ${error.code ?? ""} ${error.message ?? ""}`),
      );
    },
    [note],
  );

  useEffect(() => {
    const onPage = (event: PageEngineEvent) => {
      switch (event.name) {
        case "page.state":
          setStates((all) => ({ ...all, [event.pageId]: event.state }));
          return;
        case "page.find":
          setFind(event.result);
          note(`find ${event.result ? `${event.result.activeIndex + 1}/${event.result.total} done=${event.result.isDone}` : "ended"}`);
          return;
        case "page.request":
          setRequest(event.request ? { pageId: event.pageId, request: event.request } : null);
          note(`request ${event.pageId} ${event.request ? `${event.request.kind} "${event.request.title}"` : "cleared"}`);
          return;
        case "page.popup":
          setPopup({ pageId: event.pageId, popupId: event.popupId, url: event.url });
          note(`popup from ${event.pageId} ${event.url} gesture=${event.isUserGesture}`);
          return;
        case "pages.privateSessionEnded":
          note("private session ended");
          return;
        default:
          note(`${event.name} ${JSON.stringify({ ...event, name: undefined }).slice(0, 140)}`);
      }
    };
    const subscriptions = [
      pages.addListener(onPage),
      blocking.addListener((event) => setBlockingState(event.state)),
      downloads.addListener((event) => {
        if (event.name === "downloads.progress") setActive(event.downloads);
        else {
          setFinished(event);
          note(`download finished ${event.fileName} ${event.uri ?? event.failure}`);
        }
      }),
    ];
    blocking.state().then(setBlockingState, () => undefined);
    const restored = store.load("lab-saved");
    if (restored) setRestoreSource(restored);
    const capabilities = pages.capabilities();
    note(`engine ${capabilities.engineName} private=${capabilities.supportsPrivatePages}`);
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [note]);

  const state = states[pageId];
  const isPrivate = privateIds.includes(pageId);

  useEffect(() => {
    if (!state?.url) return;
    blocking.isEnabledForSite(state.url, isPrivate).then(setSiteBlocking, () => setSiteBlocking(null));
  }, [state?.url, isPrivate, blockingState]);

  const go = (target: string) => {
    setUrl(target);
    run("load", () => pages.load(pageId, target));
  };

  const openPrivate = () => {
    const id = `lab-private-${privateIds.length + 1}`;
    run("open private", async () => {
      await pages.open(id, { url: LAB_URL, isPrivate: true });
      setPrivateIds((ids) => [...ids, id]);
      setPageId(id);
    });
  };

  const answer = (body: Parameters<typeof pages.answerRequest>[2]) => {
    if (!request) return;
    run(`answer ${body.type}`, () => pages.answerRequest(request.pageId, request.request.id, body));
  };

  const openPopup = () => {
    if (!popup) return;
    popupCount.current += 1;
    const id = `lab-popup-${popupCount.current}`;
    run("open popup", async () => {
      const opened = await pages.openPopup(id, popup.popupId);
      setPopup(null);
      if (opened) setPageId(id);
      return opened;
    });
  };

  const save = () =>
    run("save state", async () => {
      const saved = await pages.saveState(pageId);
      if (!saved) return null;
      const scroll = await pages.scrollPosition(pageId);
      const entry = { url: state?.url ?? null, title: state?.title ?? "", state: saved, scrollY: scroll?.y ?? null };
      store.save("lab-saved", entry);
      setRestoreSource(entry);
      return `${saved.length} chars at scrollY ${Math.round(scroll?.y ?? -1)}`;
    });

  const restore = () => {
    if (!restoreSource) return;
    run("restore", async () => {
      await pages.open("lab-restored", { url: restoreSource.url ?? undefined, title: restoreSource.title, savedState: restoreSource.state });
      setPageId("lab-restored");
    });
  };

  const host = state?.url ? (/^https?:\/\/([^/?#]+)/.exec(state.url)?.[1] ?? null) : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {results.length > 0 && (
        <View style={styles.results}>
          {summary && <Text style={styles.summary}>{summary}</Text>}
          {results.map((line, index) => (
            <Text key={`${index}-${line.step}`} style={[styles.result, !line.ok && styles.failed]} numberOfLines={2}>
              {line.ok ? "PASS" : "FAIL"} {line.step}: {line.detail}
            </Text>
          ))}
        </View>
      )}
      {request && (
        <View style={styles.panel}>
          <Text style={styles.status}>
            {request.request.kind}: {request.request.title} {request.request.message ?? ""}
          </Text>
          <Row>
            <Button label="Accept" onPress={() => answer({ type: "accept" })} />
            <Button label="Dismiss" onPress={() => answer({ type: "dismiss" })} />
            <Button label="Answer text" onPress={() => answer({ type: "text", text: "from lab" })} />
            <Button label="Pick files" onPress={() => answer({ type: "pickFiles" })} />
          </Row>
        </View>
      )}
      {popup && (
        <View style={styles.panel}>
          <Text style={styles.status}>popup {popup.url}</Text>
          <Row>
            <Button label="Open popup" onPress={openPopup} />
            <Button label="Dismiss popup" onPress={() => run("dismiss popup", async () => {
              const dismissed = await pages.dismissPopup(popup.popupId);
              setPopup(null);
              return dismissed;
            })} />
          </Row>
        </View>
      )}
      <ScrollView style={styles.controls} contentContainerStyle={styles.controlsContent}>
        <Text style={styles.status} numberOfLines={2}>
          {pageId} {isPrivate ? "(private) " : ""}
          {state ? `${state.isLoading ? `loading ${Math.round(state.progress * 100)}% ` : ""}${state.title || "untitled"}` : "no state"}
        </Text>
        <Text style={styles.status} numberOfLines={1}>
          zoom {state?.pageZoom ?? "-"} desktop {String(state?.isDesktopSite ?? "-")} blocked {state?.blockedRequests ?? "-"} security{" "}
          {state?.security ?? "-"} back {String(state?.canGoBack ?? "-")}
        </Text>
        <Row>
          <Button label="Self test" onPress={() => {
            setResults([]);
            setSummary(null);
            setPageId("lab-test");
            setTimeout(() => {
              const lines: TestLine[] = [];
              const collect = (line: TestLine) => {
                lines.push(line);
                report(line);
              };
              runSelfTest("lab-test", collect, (saved, savedUrl, scrollY) => {
                const entry = { url: savedUrl, title: "", state: saved, scrollY };
                store.save("lab-saved", entry);
                setRestoreSource(entry);
              }).then(() => announce(summarize(lines)));
            }, 300);
          }} />
          <Button label="Restore test" onPress={() => {
            if (!restoreSource) return report({ step: "restore after kill", ok: false, detail: "nothing saved" });
            setResults([]);
            setSummary(null);
            const lines: TestLine[] = [];
            runRestoreTest("lab-restored", restoreSource, (line) => {
              lines.push(line);
              report(line);
            }).then(() => {
              setPageId("lab-restored");
              announce(summarize(lines));
            });
          }} />
          <Button label="Clear results" onPress={() => setResults([])} />
          <Button label="Discard others" onPress={() => run("discard background", async () => {
            await pages.discardBackgroundPages(pageId);
            return pages.livePageIds();
          })} />
        </Row>
        <Row>
          {["lab-a", "lab-b"].map((id) => (
            <Button key={id} label={id === "lab-a" ? "Page A" : "Page B"} active={pageId === id} onPress={() => setPageId(id)} />
          ))}
          <Button label="Private" onPress={openPrivate} />
          <Button label="End private" onPress={() => run("end private", async () => {
            await pages.endPrivateSession();
            setPrivateIds([]);
            setPageId("lab-a");
          })} />
          <Button label={showView ? "Hide view" : "Show view"} onPress={() => setShowView((shown) => !shown)} />
        </Row>
        <Row>
          <TextInput style={styles.input} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} accessibilityLabel="URL" />
          <Button label="Go" onPress={() => go(url)} />
        </Row>
        <Row>
          {presets.map(([label, target]) => (
            <Button key={label} label={label} onPress={() => go(target)} />
          ))}
          <Button label="Ads" onPress={() => run("local ad page", () => pages.loadHtml(pageId, labBlockingHtml(), LAB_BLOCKING_URL))} />
        </Row>
        <Row>
          <Button label="Back" onPress={() => run("back", () => pages.goBack(pageId))} />
          <Button label="Fwd" onPress={() => run("forward", () => pages.goForward(pageId))} />
          <Button label="Reload" onPress={() => run("reload", () => pages.reload(pageId))} />
          <Button label="Stop" onPress={() => run("stop", () => pages.stopLoading(pageId))} />
          <Button label="Close page" onPress={() => run("close", () => pages.close(pageId))} />
        </Row>
        <Row>
          <TextInput style={styles.input} value={query} onChangeText={setQuery} autoCapitalize="none" accessibilityLabel="Find text" />
          <Button label="Find" onPress={() => run("find", () => pages.find(pageId, query))} />
          <Button label="Next" onPress={() => run("next", () => pages.findNext(pageId))} />
          <Button label="Prev" onPress={() => run("previous", () => pages.findPrevious(pageId))} />
          <Button label="End find" onPress={() => run("end find", () => pages.endFind(pageId))} />
        </Row>
        <Text style={styles.status}>find {find ? `${find.activeIndex + 1}/${find.total} "${find.query}"` : "none"}</Text>
        <Row>
          <Button label="Zoom +" onPress={() => run("zoom in", () => pages.zoomIn(pageId))} />
          <Button label="Zoom -" onPress={() => run("zoom out", () => pages.zoomOut(pageId))} />
          <Button label="Zoom 1" onPress={() => run("zoom reset", () => pages.setPageZoom(pageId, 1))} />
          <Button label="Desktop" active={state?.isDesktopSite} onPress={() => run("desktop", () => pages.setDesktopSite(pageId, !state?.isDesktopSite))} />
        </Row>
        <Row>
          <Button label="Download" onPress={() => run("download", () => pages.download(pageId, DOWNLOAD_URL))} />
          <Button label="Reader" onPress={() => run("reader", async () => {
            const content = await pages.readableContent(pageId);
            setReader(content ?? "none");
            return content ? `${content.title} ${content.wordCount} words` : null;
          })} />
          <Button label="Snapshot" onPress={() => run("snapshot", async () => {
            const taken = await pages.snapshot(pageId);
            setSnapshot(taken ?? "none");
            return taken;
          })} />
          <Button label="Save state" onPress={save} />
          <Button label="Restore" onPress={restore} />
        </Row>
        <Row>
          <Button label="Night on" onPress={() => run("night", () => pages.setNightShade("always", host, isPrivate))} />
          <Button label="Night off" onPress={() => run("night", () => pages.setNightShade(null, host, isPrivate))} />
          <Button label="Exit full" onPress={() => run("exit fullscreen", () => pages.exitFullscreen(pageId))} />
          <Button label="Inspect" onPress={() => run("inspectable", () => pages.setInspectable(true))} />
        </Row>
        <Text style={styles.status} numberOfLines={2}>
          blocking {blockingState ? `${blockingState.isEnabled ? "on" : "off"} ${blockingState.status} rules ${blockingState.enabledRuleCount} lists ${blockingState.lists.filter((list) => list.isEnabled).length}/${blockingState.lists.length}${blockingState.isUpdating ? " updating" : ""}` : "-"} site {String(siteBlocking)}
        </Text>
        <Row>
          <Button label={blockingState?.isEnabled === false ? "Blocking on" : "Blocking off"} onPress={() => run("blocking", () => blocking.setEnabled(blockingState?.isEnabled === false))} />
          <Button label={siteBlocking === false ? "Site on" : "Site off"} onPress={() => state?.url && run("site", () => blocking.setEnabledForSite(state.url!, siteBlocking === false, isPrivate))} />
          <Button label="Update lists" onPress={() => run("update lists", () => blocking.updateLists())} />
          <Button label="Count" onPress={() => run("blocked count", () => blocking.blockedCount(pageId))} />
        </Row>
        {active.map((download) => (
          <Text key={download.id} style={styles.status}>
            downloading {download.fileName} {download.bytes}/{download.total ?? "?"}
          </Text>
        ))}
        {finished && (
          <Row>
            <Text style={styles.status}>
              finished {finished.fileName} {finished.failure ?? "ok"}
            </Text>
            {finished.uri && <Button label="Open file" onPress={() => run("open file", () => downloads.open(finished.uri!))} />}
          </Row>
        )}
        {reader && (
          <Text style={styles.status} numberOfLines={4}>
            reader {reader === "none" ? "not readable" : `${reader.title} · ${reader.siteName} · ${reader.wordCount} words · ${reader.paragraphs[0] ?? ""}`}
          </Text>
        )}
        {snapshot && (
          <Row>
            {snapshot === "none" ? (
              <Text style={styles.status}>no snapshot</Text>
            ) : (
              <>
                <Image source={{ uri: snapshot.uri }} style={styles.snapshot} accessibilityLabel="Snapshot image" />
                <Text style={styles.status}>
                  {snapshot.width}×{snapshot.height}
                </Text>
              </>
            )}
          </Row>
        )}
        {log.map((line, index) => (
          <Text key={`${index}-${line}`} style={styles.log} numberOfLines={2}>
            {line}
          </Text>
        ))}
      </ScrollView>
      <View style={styles.page}>
        {showView && (
          <PageView
            key="page"
            style={StyleSheet.absoluteFill}
            pageId={pageId}
            initialUrl={LAB_URL}
            isPrivate={isPrivate}
            onPageError={(error) => note(`view error ${error.code} ${error.message}`)}
          />
        )}
      </View>
    </View>
  );
}

export function PageLab() {
  return (
    <SafeAreaProvider>
      <Lab />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f1ee" },
  controls: { flexGrow: 0, maxHeight: "52%" },
  controlsContent: { padding: 6, gap: 4 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 4, alignItems: "center" },
  button: { backgroundColor: "#ddd5ce", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6 },
  active: { backgroundColor: "#b9a6d6" },
  buttonText: { fontSize: 13, color: "#1d1a17" },
  input: { flex: 1, minWidth: 120, borderWidth: 1, borderColor: "#bbb", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4, fontSize: 13, color: "#1d1a17" },
  status: { fontSize: 12, color: "#1d1a17" },
  log: { fontSize: 11, color: "#4a4440", fontFamily: "monospace" },
  results: { backgroundColor: "#e9f3e4", padding: 6, gap: 2 },
  summary: { fontSize: 13, fontWeight: "700", color: "#1d1a17" },
  result: { fontSize: 11, color: "#1d4d12" },
  failed: { color: "#a1170f" },
  panel: { backgroundColor: "#fff3c4", padding: 6, borderRadius: 6, gap: 4 },
  snapshot: { width: 90, height: 160, borderWidth: 1, borderColor: "#999" },
  page: { flex: 1, borderTopWidth: 1, borderColor: "#999" },
});
