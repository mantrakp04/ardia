import { readDocument } from "../../src/platform/documents";

const real = globalThis.fetch;
const blocked = [];

if (readDocument("bench-offline") !== null) {
  globalThis.fetch = function guardedFetch(input, init) {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(url)) return real(input, init);
    blocked.push(url.replace(/[?#].*$/, ""));
    return Promise.resolve(new Response("{}", { status: 200, headers: { "x-bench-blocked": "1" } }));
  };
}

globalThis.__acBlockedFetches = () => blocked.slice();
