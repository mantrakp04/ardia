import type { FaviconImage } from "@ardia-real/ardiacore";
import { faviconFor } from "../pages";
import { provideNativeModule } from "./expo-modules-core";

export * from "@ardia-real/ardiacore";
export { devPagerState, pagerState, selectPager, stepPager, SwipeArea, switchPager } from "./web/Pager";
export { WebView } from "./web/WebView";

const ENGINE_ONLY: Record<string, string[]> = {
  ArdiaHistory: ["query", "add", "import", "deleteUrls", "watch"],
  ArdiaBookmarks: ["tree", "apply", "watch"],
  ArdiaFavicons: ["get", "set"],
  ArdiaTabs: ["lastTabPolicy"],
  ArdiaEngine: ["batterySaver", "trimMemory", "openTaskManager", "cliControlStatus", "setCliControl", "setCliActiveTab"],
  ArdiaExtensions: ["watchActions", "syncState", "syncApply"],
  ArdiaDownloads: ["settings", "setSettings"],
};
const ANSWERS: Record<string, Record<string, unknown>> = {
  ArdiaTabs: { strips: { rev: 0, cmd: null, strips: [] } },
  ArdiaExtensions: { list: { extensions: [] } },
  ArdiaSearch: { engines: { list: { engines: [] } } },
};
for (const module of new Set([...Object.keys(ENGINE_ONLY), ...Object.keys(ANSWERS)]))
  provideNativeModule(module, {
    call: async (name: string) => {
      if (ENGINE_ONLY[module]?.includes(name)) throw Object.assign(new Error(`${name} is not on the web`), { code: "ERR_ENGINE" });
      return JSON.stringify(ANSWERS[module]?.[name] ?? null);
    },
  });

export async function faviconsFor(_profile: string, pages: string[], _icons: string[] = []) {
  const found = pages.flatMap((page) => {
    const uri = faviconFor(page);
    return uri ? [[page, { uri, icon: uri }] as const] : [];
  });
  return { pages: new Map(found), icons: new Map<string, string>() };
}

export async function fetchFavicon(url: string, _profile: string, _page?: string): Promise<FaviconImage | null> {
  return { uri: url, width: 32, height: 32 };
}
