import "../src/main.tsx";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Symbol } from "../src/shims/web/Symbol.tsx";
import { SYMBOL_NAMES } from "../src/shims/web/symbols/data.ts";
import { BUILT_IN_ENGINES, suggestRequestUrl } from "../../../packages/core/src/engines.ts";
import { createSuggestFetcher } from "../src/suggestFetcher.ts";
import { LAUNCH_STEPS, claimAppLaunch, hostLaunchRecord } from "../src/appServices.ts";

const hostileColor = '\"><img src=x onerror="window.__symbolInjection=1"><svg onload="window.__symbolInjection=2" data-x="&\'';
const gallery = document.getElementById("symbol-fixture");
createRoot(gallery).render(createElement("div", null,
  SYMBOL_NAMES.map((name) => createElement(Symbol, { key: name, name, size: 14, color: "#334455", style: { width: 20, height: 20 } })),
  createElement("div", { id: "hostile-symbol" }, createElement(Symbol, { name: SYMBOL_NAMES[0], color: hostileColor })),
));

const connectViolations = [];
document.addEventListener("securitypolicyviolation", (event) => {
  if (event.effectiveDirective === "connect-src") connectViolations.push(event.blockedURI);
});
const suggestionProbes = BUILT_IN_ENGINES.map((engine) => suggestRequestUrl(engine, "ardia csp")).filter(Boolean);
const blockedProbes = ["https://example.com/collect", "https://www.google.com/search?q=ardia", "https://suggestqueries.google.com/other?q=ardia", "https://evil.duckduckgo.com/ac/?q=ardia"];
const probeConnect = async () => {
  for (const url of [...suggestionProbes, ...blockedProbes]) {
    const controller = new AbortController();
    const request = fetch(url, { signal: controller.signal }).catch(() => {});
    controller.abort();
    await request;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const blockedBy = (url) => connectViolations.some((blocked) => url.startsWith(blocked));
  const google = BUILT_IN_ENGINES.find((engine) => engine.id === "google");
  const bridged = await new Promise((resolve) => {
    const fetcher = createSuggestFetcher({ fetch: (url, init) => fetch(url, init), delay: 0 });
    const timer = setTimeout(() => resolve(null), 3000);
    fetcher.request(google, "ardia csp", (list) => { clearTimeout(timer); resolve(list); });
  });
  return {
    directFetchBlocked: [...suggestionProbes, ...blockedProbes].filter(blockedBy).length,
    directFetchAllowed: [...suggestionProbes, ...blockedProbes].filter((url) => !blockedBy(url)),
    bridged,
    bridgedRequests: [...window.__ardiaCspFixture.suggestRequests],
  };
};

const deadline = Date.now() + 10000;
const verify = async () => {
  const svgCount = gallery.querySelectorAll("svg").length;
  const uiCount = document.querySelectorAll("#root [data-symbol] svg").length;
  if ((svgCount !== SYMBOL_NAMES.length + 1 || !uiCount) && Date.now() < deadline) return setTimeout(verify, 20);
  const errors = [...window.__ardiaCspFixture.errors];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  check(!!globalThis.trustedTypes, "Trusted Types API unavailable");
  check(svgCount === SYMBOL_NAMES.length + 1, `Rendered ${svgCount} SVGs for ${SYMBOL_NAMES.length + 1} expected symbols`);
  check(uiCount > 0 && document.querySelector(".ardia-desktop.host"), "Host UI failed to initialize");
  check(!gallery.querySelector("script,img,foreignObject,iframe,object,embed"), "Injected non-geometry element");
  check(![...gallery.querySelectorAll("*")].some((element) => [...element.attributes].some((attribute) => /^on/i.test(attribute.name))), "Injected event attribute");
  check(document.querySelector("#hostile-symbol svg")?.getAttribute("color") === hostileColor, "Color escaped incorrectly");
  check(!window.__symbolInjection, "Injected script executed");
  check(window.__ardiaCspFixture.htmlAssignments.length >= svgCount, "Missing symbol HTML assignments");
  check(window.__ardiaCspFixture.htmlAssignments.every(Boolean), "Host assigned raw HTML to a Trusted Types sink");
  let rawHtmlBlocked = false;
  let unknownPolicyBlocked = false;
  let duplicatePolicyBlocked = false;
  let stringEvaluationBlocked = false;
  try { document.createElement("div").innerHTML = "<b>blocked</b>"; } catch { rawHtmlBlocked = true; }
  try { trustedTypes.createPolicy("unapproved", { createHTML: (value) => value }); } catch { unknownPolicyBlocked = true; }
  try { trustedTypes.createPolicy("ardia-symbols", { createHTML: (value) => value }); } catch { duplicatePolicyBlocked = true; }
  try { new Function("return 1")(); } catch { stringEvaluationBlocked = true; }
  check(rawHtmlBlocked, "Raw HTML sink is not protected");
  check(unknownPolicyBlocked, "CSP allowed another Trusted Types policy");
  check(duplicatePolicyBlocked, "CSP allowed duplicate symbol policies");
  check(stringEvaluationBlocked, "CSP allowed string evaluation");
  const connect = await probeConnect();
  const launchSteps = [...window.__ardiaCspFixture.launchSteps];
  const secondClaim = await claimAppLaunch({ locks: navigator.locks, record: hostLaunchRecord(window.__ardiaHost), run: async () => { errors.push("A second window ran the launch services"); } });
  check(LAUNCH_STEPS.every((step) => launchSteps.includes(step)), `The launch services did not finish: ${launchSteps.join(", ")}`);
  check(secondClaim === "alreadyDone", `A second window claimed the launch services: ${secondClaim}`);
  window.__ardiaCspResult = {
    passed: !errors.length, errors, symbols: SYMBOL_NAMES.length, svgCount, uiCount,
    trustedAssignments: window.__ardiaCspFixture.htmlAssignments.filter(Boolean).length,
    rawHtmlBlocked, unknownPolicyBlocked, duplicatePolicyBlocked, stringEvaluationBlocked,
    launchSteps: launchSteps.length, secondClaim,
    directFetchBlocked: connect.directFetchBlocked, bridgedSuggestions: connect.bridged?.length ?? 0,
  };
};
setTimeout(verify, 100);
