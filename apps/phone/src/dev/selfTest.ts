import { blocking, downloads, pages, type DownloadEvent, type PageEngineEvent, type PageState } from "@ardia/phone-native";

export type TestLine = { step: string; ok: boolean; detail: string };

const dataPage = (title: string, body: string) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:18px sans-serif;padding:12px">${body}</body>`)}`;

export const FIND_PAGE = dataPage("find", "<p>browser one</p><p>a browser two</p><p>the browser three</p>");
const UA_PAGE = dataPage("ua", "<script>document.title='ua '+(/Mobile/.test(navigator.userAgent)?'mobile':'desktop')</script><p>user agent</p>");
const DIALOG_PAGE = dataPage(
  "dialogs",
  "<p>dialogs</p><script>setTimeout(()=>{alert('lab alert');const c=confirm('lab confirm?');const p=prompt('lab prompt','default');document.title='c '+c+' p '+p},400)</script>",
);
export const ARTICLE_URL = "https://en.wikipedia.org/wiki/Web_browser";
export const ADS_URL = "https://d3ward.github.io/toolz/adblock.html";
export const DOWNLOAD_URL = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

const waitForPage = <T>(pick: (event: PageEngineEvent) => T | undefined, millis: number, what: string) =>
  new Promise<T>((resolve, reject) => {
    const subscription = pages.addListener((event) => {
      const value = pick(event);
      if (value === undefined) return;
      clearTimeout(timer);
      subscription.remove();
      resolve(value);
    });
    const timer = setTimeout(() => {
      subscription.remove();
      reject(new Error(`timed out waiting for ${what}`));
    }, millis);
  });

const waitForDownload = <T>(pick: (event: DownloadEvent) => T | undefined, millis: number, what: string) =>
  new Promise<T>((resolve, reject) => {
    const subscription = downloads.addListener((event) => {
      const value = pick(event);
      if (value === undefined) return;
      clearTimeout(timer);
      subscription.remove();
      resolve(value);
    });
    const timer = setTimeout(() => {
      subscription.remove();
      reject(new Error(`timed out waiting for ${what}`));
    }, millis);
  });

const pause = (millis: number) => new Promise((resolve) => setTimeout(resolve, millis));

const settledState = (pageId: string, accept: (state: PageState) => boolean, millis: number, what: string) =>
  waitForPage((event) => (event.name === "page.state" && event.pageId === pageId && !event.state.isLoading && accept(event.state) ? event.state : undefined), millis, what);

const load = async (pageId: string, url: string, accept: (state: PageState) => boolean = () => true, millis = 30000) => {
  const settled = settledState(pageId, (state) => state.url !== null && accept(state), millis, `load ${url.slice(0, 40)}`);
  await pages.load(pageId, url);
  return settled;
};

const answerNext = async (pageId: string, kind: string, answer: Parameters<typeof pages.answerRequest>[2]) => {
  const request = await waitForPage(
    (event) => (event.name === "page.request" && event.pageId === pageId && event.request?.kind === kind ? event.request : undefined),
    15000,
    `${kind} request`,
  );
  const answered = await pages.answerRequest(pageId, request.id, answer);
  return `${kind} "${request.title}" answered ${answer.type}=${answered}`;
};

export async function runSelfTest(pageId: string, report: (line: TestLine) => void, saveState: (state: string, url: string | null) => void) {
  const step = async (name: string, work: () => Promise<string>) => {
    try {
      const detail = await work();
      report({ step: name, ok: true, detail });
    } catch (error) {
      report({ step: name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };

  await step("open", async () => {
    await pages.open(pageId, {});
    const state = await load(pageId, FIND_PAGE, (state) => state.title === "find");
    return `title=${state.title} live=${state.isLive}`;
  });

  await step("find", async () => {
    const first = waitForPage((event) => (event.name === "page.find" && event.pageId === pageId && event.result?.isDone ? event.result : undefined), 10000, "find result");
    await pages.find(pageId, "browser");
    const result = await first;
    const next = waitForPage((event) => (event.name === "page.find" && event.pageId === pageId && event.result && event.result.activeIndex === 1 ? event.result : undefined), 10000, "find next");
    await pages.findNext(pageId);
    const moved = await next;
    const ended = waitForPage((event) => (event.name === "page.find" && event.pageId === pageId && event.result === null ? true : undefined), 10000, "find end");
    await pages.endFind(pageId);
    await ended;
    if (result.total !== 3) throw new Error(`expected 3 matches, got ${result.total}`);
    return `total=${result.total} first=${result.activeIndex + 1} next=${moved.activeIndex + 1} ended`;
  });

  await step("zoom", async () => {
    const zoomedIn = await pages.zoomIn(pageId);
    const state = await pages.state(pageId);
    const zoomedOut = await pages.zoomOut(pageId);
    const reset = await pages.setPageZoom(pageId, 1);
    if (!(zoomedIn > 1) || state?.pageZoom !== zoomedIn || !(zoomedOut < zoomedIn) || reset !== 1) throw new Error(`in=${zoomedIn} state=${state?.pageZoom} out=${zoomedOut} reset=${reset}`);
    return `in=${zoomedIn} state=${state?.pageZoom} out=${zoomedOut} reset=${reset}`;
  });

  await step("desktop site", async () => {
    const mobile = await load(pageId, UA_PAGE, (state) => state.title.startsWith("ua "));
    const desktop = settledState(pageId, (state) => state.isDesktopSite && state.title === "ua desktop", 20000, "desktop title");
    await pages.setDesktopSite(pageId, true);
    const switched = await desktop;
    const back = settledState(pageId, (state) => !state.isDesktopSite && state.title === "ua mobile", 20000, "mobile title");
    await pages.setDesktopSite(pageId, false);
    await back;
    if (mobile.title !== "ua mobile") throw new Error(`first load said ${mobile.title}`);
    return `${mobile.title} → ${switched.title} (isDesktopSite=${switched.isDesktopSite}) → ua mobile`;
  });

  await step("dialogs", async () => {
    const done = settledState(pageId, (state) => state.title.startsWith("c "), 45000, "dialog results in title");
    await pages.load(pageId, DIALOG_PAGE);
    const lines = [
      await answerNext(pageId, "alert", { type: "accept" }),
      await answerNext(pageId, "confirm", { type: "accept" }),
      await answerNext(pageId, "prompt", { type: "text", text: "from lab" }),
    ];
    const state = await done;
    if (state.title !== "c true p from lab") throw new Error(`page saw "${state.title}"`);
    return `${lines.join("; ")}; page title "${state.title}"`;
  });

  await step("download", async () => {
    const started = waitForPage((event) => (event.name === "page.download" && event.pageId === pageId ? event : undefined), 15000, "page.download");
    const finished = waitForDownload((event) => (event.name === "downloads.finished" ? event : undefined), 60000, "downloads.finished");
    await pages.download(pageId, DOWNLOAD_URL);
    const event = await started;
    const outcome = await finished;
    if (!event.downloadId || !outcome.uri) throw new Error(`id=${event.downloadId} failure=${outcome.failure}`);
    return `${event.fileName} id=${event.downloadId} → ${outcome.uri}`;
  });

  await step("reader", async () => {
    await load(pageId, ARTICLE_URL, (state) => state.title.length > 0, 60000);
    const content = await pages.readableContent(pageId);
    if (!content || content.wordCount < 300) throw new Error(`content=${content ? content.wordCount : "null"}`);
    return `"${content.title}" ${content.siteName} ${content.wordCount} words, ${content.paragraphs.length} paragraphs, article=${content.isArticle}`;
  });

  await step("snapshot", async () => {
    await pause(800);
    const snapshot = await pages.snapshot(pageId);
    if (!snapshot) throw new Error("no snapshot");
    return `${snapshot.width}x${snapshot.height} ${snapshot.path}`;
  });

  await step("save state", async () => {
    const state = await pages.state(pageId);
    const saved = await pages.saveState(pageId);
    if (!saved || !state?.canGoBack) throw new Error(`saved=${saved?.length} canGoBack=${state?.canGoBack}`);
    saveState(saved, state.url);
    return `${saved.length} base64 chars, url=${state.url}, canGoBack=${state.canGoBack}`;
  });

  await step("private page", async () => {
    const privateId = `${pageId}-private`;
    const settled = settledState(privateId, (state) => state.isPrivate && state.title === "find", 30000, "private page");
    await pages.open(privateId, { url: FIND_PAGE, isPrivate: true });
    const state = await settled;
    const ended = waitForPage((event) => (event.name === "pages.privateSessionEnded" ? true : undefined), 10000, "privateSessionEnded");
    await pages.endPrivateSession();
    await ended;
    const ids = await pages.ids();
    if (ids.includes(privateId)) throw new Error("private page still open");
    return `isPrivate=${state.isPrivate} → session ended, page closed`;
  });

  await step("blocking", async () => {
    let status = await blocking.state();
    if (status.enabledRuleCount === 0) {
      await blocking.updateLists();
      status = await blocking.state();
    }
    await load(pageId, ADS_URL, () => true, 60000);
    await pause(10000);
    const blocked = (await pages.state(pageId))?.blockedRequests ?? 0;
    const counted = await blocking.blockedCount(pageId);
    if (blocked === 0) throw new Error(`no requests blocked; rules=${status.enabledRuleCount} status=${status.status}`);
    return `rules=${status.enabledRuleCount} blocked=${blocked} blockedCount()=${counted}`;
  });

  await step("blocking off for site", async () => {
    const host = await blocking.setEnabledForSite(ADS_URL, false);
    const enabled = await blocking.isEnabledForSite(ADS_URL);
    const settled = settledState(pageId, () => true, 60000, "reload");
    await pages.reload(pageId);
    await settled;
    await pause(10000);
    const blocked = (await pages.state(pageId))?.blockedRequests ?? -1;
    await blocking.setEnabledForSite(ADS_URL, true);
    if (enabled || blocked !== 0) throw new Error(`host=${host} enabled=${enabled} blocked=${blocked}`);
    return `off for ${host}: isEnabledForSite=${enabled}, blocked after reload=${blocked}; turned back on`;
  });
}

export async function runRestoreTest(pageId: string, saved: { url: string | null; state: string }, report: (line: TestLine) => void) {
  try {
    const settled = settledState(pageId, () => true, 60000, "restored page");
    await pages.open(pageId, { url: saved.url ?? undefined, savedState: saved.state });
    const state = await settled;
    const ok = state.canGoBack && state.url === saved.url;
    report({ step: "restore after kill", ok, detail: `url=${state.url} canGoBack=${state.canGoBack} (saved url ${saved.url})` });
  } catch (error) {
    report({ step: "restore after kill", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}
