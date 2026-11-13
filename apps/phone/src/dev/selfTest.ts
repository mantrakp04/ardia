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
export const LAB_BLOCKING_URL = "https://lab.ardia.dev/blocking";
export const LAB_BLOCKED_REQUESTS = [
  "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
  "https://ad.doubleclick.net/ddm/ad/lab.gif",
  "https://www.google-analytics.com/analytics.js",
  "https://connect.facebook.net/en_US/fbevents.js",
  "https://static.hotjar.com/c/hotjar-1.js",
  "https://cdn.taboola.com/libtrc/lab/loader.js",
];
export const labBlockingHtml = `<!doctype html><meta name="viewport" content="width=device-width"><title>blocking</title><body style="font:18px sans-serif;padding:12px"><p>blocking</p>${LAB_BLOCKED_REQUESTS.map((url) => (url.endsWith(".gif") ? `<img src="${url}">` : `<script async src="${url}"></script>`)).join("")}</body>`;
export const ARTICLE_URL = "https://en.wikipedia.org/wiki/Web_browser";
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

const describe = (state: PageState | null) =>
  state ? `url=${state.url?.slice(0, 60)} loading=${state.isLoading} back=${state.canGoBack} title="${state.title}"` : "no state event";

const settledState = (pageId: string, accept: (state: PageState) => boolean, millis: number, what: string) =>
  new Promise<PageState>((resolve, reject) => {
    let last: PageState | null = null;
    const subscription = pages.addListener((event) => {
      if (event.name !== "page.state" || event.pageId !== pageId) return;
      last = event.state;
      if (event.state.isLoading || !accept(event.state)) return;
      clearTimeout(timer);
      subscription.remove();
      resolve(event.state);
    });
    const timer = setTimeout(() => {
      subscription.remove();
      reject(new Error(`timed out waiting for ${what}; last ${describe(last)}`));
    }, millis);
  });

const loadLabHtml = async (pageId: string, html: string, baseUrl: string) => {
  let sawLoading = false;
  const done = settledState(
    pageId,
    (state) => {
      if (state.url !== baseUrl) return false;
      return sawLoading;
    },
    30000,
    `local page ${baseUrl}`,
  );
  const loading = pages.addListener((event) => {
    if (event.name === "page.state" && event.pageId === pageId && event.state.isLoading) sawLoading = true;
  });
  try {
    await pages.loadHtml(pageId, html, baseUrl);
    const state = await done;
    await pause(1500);
    return (await pages.state(pageId))?.blockedRequests ?? state.blockedRequests;
  } finally {
    loading.remove();
  }
};

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

export async function runSelfTest(
  pageId: string,
  report: (line: TestLine) => void,
  saveState: (state: string, url: string | null, scrollY: number | null) => void,
) {
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
    const seen: string[] = [];
    const trace = pages.addListener((event) => {
      if (event.name === "page.find" && event.pageId === pageId) seen.push(event.result ? `${event.result.activeIndex + 1}/${event.result.total}${event.result.isDone ? "" : "…"}` : "end");
    });
    const findEvent = (accept: (index: number, total: number) => boolean, what: string, millis = 4000) =>
      waitForPage(
        (event) => (event.name === "page.find" && event.pageId === pageId && event.result?.isDone && accept(event.result.activeIndex, event.result.total) ? event.result : undefined),
        millis,
        what,
      );
    try {
      const counted = findEvent((_, total) => total > 0, "find count", 10000);
      await pages.find(pageId, "browser");
      const first = await counted;
      let tries = 0;
      let moved: Awaited<typeof counted> | null = null;
      while (!moved && tries < 3) {
        tries += 1;
        const next = findEvent((index) => index !== first.activeIndex, "find next");
        await pages.findNext(pageId);
        moved = await next.catch(() => null);
      }
      if (!moved) throw new Error(`no find event after ${tries} findNext calls`);
      const back = findEvent((index) => index === first.activeIndex, "find previous");
      await pages.findPrevious(pageId);
      await back;
      const ended = waitForPage((event) => (event.name === "page.find" && event.pageId === pageId && event.result === null ? true : undefined), 10000, "find end");
      await pages.endFind(pageId);
      await ended;
      if (first.total !== 3) throw new Error(`expected 3 matches, got ${first.total}`);
      return `total=${first.total} first=${first.activeIndex + 1} next=${moved.activeIndex + 1} (findNext calls ${tries}) previous=${first.activeIndex + 1} ended; events ${seen.join(" ")}`;
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; events ${seen.join(" ") || "none"}`);
    } finally {
      trace.remove();
    }
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
    const scroll = await pages.scrollPosition(pageId);
    saveState(saved, state.url, scroll?.y ?? null);
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
    const status = await blocking.state();
    await blocking.setEnabledForSite(LAB_BLOCKING_URL, true);
    const blocked = await loadLabHtml(pageId, labBlockingHtml, LAB_BLOCKING_URL);
    const counted = await blocking.blockedCount(pageId);
    if (blocked < 3) throw new Error(`blocked ${blocked} of ${LAB_BLOCKED_REQUESTS.length}; rules=${status.enabledRuleCount} status=${status.status}`);
    return `local page: blocked ${blocked} of ${LAB_BLOCKED_REQUESTS.length}, blockedCount()=${counted}, rules=${status.enabledRuleCount}`;
  });

  await step("blocking off for site", async () => {
    const host = await blocking.setEnabledForSite(LAB_BLOCKING_URL, false);
    const enabled = await blocking.isEnabledForSite(LAB_BLOCKING_URL);
    const off = await loadLabHtml(pageId, labBlockingHtml, LAB_BLOCKING_URL);
    await blocking.setEnabledForSite(LAB_BLOCKING_URL, true);
    const on = await loadLabHtml(pageId, labBlockingHtml, LAB_BLOCKING_URL);
    if (enabled || off !== 0 || on < 3) throw new Error(`host=${host} isEnabledForSite=${enabled} blocked off=${off} back on=${on}`);
    return `off for ${host}: blocked ${off}; back on: blocked ${on}`;
  });
}

export const summarize = (lines: TestLine[]) => {
  const pass = lines.filter((line) => line.ok).length;
  return `PAGELAB RESULT pass=${pass} fail=${lines.length - pass}`;
};

export async function runRestoreTest(
  pageId: string,
  saved: { url: string | null; state: string; scrollY?: number | null },
  report: (line: TestLine) => void,
) {
  try {
    const settled = settledState(pageId, (state) => state.canGoBack && state.url === saved.url, 60000, "the restored history");
    await pages.open(pageId, { url: saved.url ?? undefined, savedState: saved.state });
    const state = await settled;
    await pause(1500);
    const scroll = await pages.scrollPosition(pageId);
    const scrollNote = scroll ? `scrollY ${Math.round(scroll.y)} of ${Math.round(scroll.contentHeight)} (saved at ${saved.scrollY == null ? "?" : Math.round(saved.scrollY)})` : "no scroll position";
    report({ step: "restore after kill", ok: true, detail: `url=${state.url} canGoBack=${state.canGoBack}; ${scrollNote}` });
  } catch (error) {
    report({ step: "restore after kill", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}
