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
const busted = (url: string, token: string) => `${url}${url.includes("?") ? "&" : "?"}ardia=${token}`;
const freshToken = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const labBlockingHtml = (token = freshToken()) =>
  `<!doctype html><meta name="viewport" content="width=device-width"><title>blocking</title><body style="font:18px sans-serif;padding:12px"><p>blocking</p>${LAB_BLOCKED_REQUESTS.map((url) => (url.endsWith(".gif") ? `<img src="${busted(url, token)}">` : `<script async src="${busted(url, token)}"></script>`)).join("")}</body>`;
export const REAL_SITE_URL = "https://example.com/";
const injectRequests = (token: string) =>
  `(() => { for (const url of ${JSON.stringify(LAB_BLOCKED_REQUESTS.map((url) => busted(url, token)))}) { if (url.includes(".gif?")) { const image = new Image(); image.src = url; document.body.appendChild(image); } else { const script = document.createElement("script"); script.async = true; script.src = url; document.head.appendChild(script); } } return ${LAB_BLOCKED_REQUESTS.length}; })()`;

const steadyBlockedCount = async (pageId: string) => {
  let last = -1;
  let steadySince = Date.now();
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const count = (await pages.state(pageId))?.blockedRequests ?? 0;
    if (count !== last) {
      last = count;
      steadySince = Date.now();
    } else if (Date.now() - steadySince >= 1500) {
      break;
    }
    await pause(250);
  }
  return last;
};

const blockedOnRealSite = async (pageId: string, round: number) => {
  await load(pageId, `${REAL_SITE_URL}?lab=${round}-${freshToken()}`, (state) => state.url?.startsWith(REAL_SITE_URL) ?? false, 45000);
  await pause(500);
  const before = await steadyBlockedCount(pageId);
  await pages.evaluate(pageId, injectRequests(freshToken()));
  return { before, after: await steadyBlockedCount(pageId) };
};
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
  const urls: string[] = [];
  const done = settledState(pageId, (state) => state.url === baseUrl && sawLoading, 30000, `local page ${baseUrl}`);
  const loading = pages.addListener((event) => {
    if (event.name !== "page.state" || event.pageId !== pageId) return;
    if (event.state.isLoading) sawLoading = true;
    const url = event.state.url?.slice(0, 30) ?? "null";
    if (sawLoading && urls[urls.length - 1] !== url) urls.push(url);
  });
  try {
    await pages.loadHtml(pageId, html, baseUrl);
    await done;
    return { blocked: await steadyBlockedCount(pageId), urls };
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
    const settled = (accept: (index: number, total: number) => boolean, what: string, millis = 8000) =>
      waitForPage(
        (event) => (event.name === "page.find" && event.pageId === pageId && event.result?.isDone && accept(event.result.activeIndex, event.result.total) ? event.result : undefined),
        millis,
        what,
      );
    try {
      const counted = settled((_, total) => total > 0, "find count", 15000);
      await pages.find(pageId, "browser");
      const first = await counted;
      const next = settled((index) => index !== first.activeIndex, "find next");
      await pages.findNext(pageId);
      const moved = await next;
      const previous = settled((index) => index !== moved.activeIndex, "find previous");
      await pages.findPrevious(pageId);
      const back = await previous;
      const eventsBeforeRepeat = seen.length;
      await pages.find(pageId, "browser");
      await pause(800);
      const repeatMoved = seen.length !== eventsBeforeRepeat;
      const ended = waitForPage((event) => (event.name === "page.find" && event.pageId === pageId && event.result === null ? true : undefined), 10000, "find end");
      await pages.endFind(pageId);
      await ended;
      const unsettled = seen.filter((line) => line.endsWith("…"));
      const problems = [
        first.total !== 3 && `expected 3 matches, got ${first.total}`,
        back.activeIndex !== first.activeIndex && `previous landed on ${back.activeIndex + 1}, not ${first.activeIndex + 1}`,
        repeatMoved && "finding the same text again moved the match",
        unsettled.length > 0 && `${unsettled.length} unsettled events`,
      ].filter(Boolean);
      if (problems.length) throw new Error(problems.join("; "));
      return `findNext calls 1; total=${first.total} first=${first.activeIndex + 1} next=${moved.activeIndex + 1} previous=${back.activeIndex + 1}; same text again stays; events ${seen.join(" ")}`;
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
    return `route=${snapshot.route ?? "?"} ${snapshot.bytes ?? "?"} bytes ${snapshot.width}x${snapshot.height} ${snapshot.path}`;
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

  await step("shown again after discard", async () => {
    const other = `${pageId}-other`;
    await pages.open(other, { url: FIND_PAGE });
    await pages.discardBackgroundPages(other);
    const afterDiscard = await pages.livePageIds();
    if (afterDiscard.includes(pageId)) throw new Error(`still live after discard: ${afterDiscard.join(",")}`);
    const live = settledState(pageId, (state) => state.isLive, 30000, "the page live again");
    await pages.discardBackgroundPages(pageId);
    await live;
    await pause(1000);
    const scroll = await pages.scrollPosition(pageId);
    await pages.close(other);
    const width = Math.round(scroll?.viewportWidth ?? 0);
    const height = Math.round(scroll?.viewportHeight ?? 0);
    if (width <= 0 || height <= 0) throw new Error(`web view is ${width}x${height} after showing it again`);
    return `discarded, kept again with a new web view at ${width}x${height}; live ${(await pages.livePageIds()).join(",")}`;
  });

  await step("blocking", async () => {
    const status = await blocking.state();
    await blocking.setEnabledForSite(REAL_SITE_URL, true);
    const real = await blockedOnRealSite(pageId, 1);
    const local = await loadLabHtml(pageId, labBlockingHtml(), LAB_BLOCKING_URL);
    const counted = await blocking.blockedCount(pageId);
    const blocked = real.after - real.before;
    if (blocked < LAB_BLOCKED_REQUESTS.length) throw new Error(`example.com: blocked ${blocked} of ${LAB_BLOCKED_REQUESTS.length}; rules=${status.enabledRuleCount} status=${status.status}`);
    return `example.com: blocked ${blocked} of ${LAB_BLOCKED_REQUESTS.length}; local page: blocked ${local.blocked}, blockedCount()=${counted}, urls ${local.urls.join(" → ")}`;
  });

  await step("blocking off for site", async () => {
    const host = await blocking.setEnabledForSite(REAL_SITE_URL, false);
    const enabled = await blocking.isEnabledForSite(REAL_SITE_URL);
    const off = await blockedOnRealSite(pageId, 2);
    await blocking.setEnabledForSite(REAL_SITE_URL, true);
    const on = await blockedOnRealSite(pageId, 3);
    const offBlocked = off.after;
    const onBlocked = on.after - on.before;
    if (enabled || offBlocked !== 0 || onBlocked < LAB_BLOCKED_REQUESTS.length) {
      throw new Error(`host=${host} isEnabledForSite=${enabled} off: ${off.before}→${off.after}, back on: ${on.before}→${on.after}`);
    }
    return `off for ${host}: blocked ${offBlocked}; back on: blocked ${onBlocked} of ${LAB_BLOCKED_REQUESTS.length}`;
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
