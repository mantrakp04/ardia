import { provideNativeModuleProvider } from "./expo-modules-core";
import { ardiaHost, hostModuleMethod, reportHostError } from "../host";

export * from "@ardia-real/ardiacore";
export { devPagerState, pagerState, selectPager, stepPager, SwipeArea, switchPager } from "./web/Pager";
export { HostWebView as WebView } from "./web/HostWebView";

provideNativeModuleProvider((module, method) => module === "ArdiaTabs" && method === "claimLaunchTab" && ardiaHost
  ? (...args: unknown[]) => { void hostModuleMethod(module, method)(...args).catch(reportHostError); }
  : undefined);
