import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../ios/ArdiaCoreContentBlocker.mm", import.meta.url), "utf8");

export function nativeString(name) {
  const start = source.indexOf(`NSString *const ${name} =`);
  if (start < 0) throw new Error(`no ${name} in ArdiaCoreContentBlocker.mm`);
  let rest = source.slice(start + `NSString *const ${name} =`.length);
  let out = "";
  for (;;) {
    rest = rest.trimStart();
    if (rest.startsWith(";")) return out;
    const literal = /^@?("(?:[^"\\]|\\.)*")/.exec(rest);
    if (!literal) throw new Error(`${name} isn't a string literal`);
    out += JSON.parse(literal[1]);
    rest = rest.slice(literal[0].length);
  }
}

export const format = (template, args) => {
  const parts = template.split("%@");
  return parts.map((part, i) => part + (i < args.length ? String(args[i]) : "")).join("");
};

export const scriptWith = (template, args) => format(template, args.map((a) => JSON.stringify(a)));

export const extensionOrigin = `chrome-extension://${nativeString("kAdNauseamId")}`;
export const offDirective = nativeString("kOffDirective");

export function runOnPage(script, { background, send = () => Promise.reject(new Error("send isn't available")), storage = {} }) {
  return new Promise((resolve) => {
    const chrome = {
      extension: { getBackgroundPage: () => typeof background === "function" ? background() : background },
      runtime: {},
      storage: {
        local: {
          get: (key, done) => done({ [key]: storage[key] }),
          set: (values, done) => done(Object.assign(storage, values)),
          remove: (key, done) => done(delete storage[key]),
        },
      },
    };
    const vAPI = { messaging: { send: (channel, message) => send(message) } };
    const post = (kind, json) => resolve(JSON.parse(json));
    Function("chrome", "self", "vAPI", "location", "post", "document", script)(
      chrome,
      { vAPI },
      vAPI,
      { origin: extensionOrigin, href: `${extensionOrigin}/blank.html` },
      post,
      undefined,
    );
  });
}

export const inPrelude = (expression, name = "AdNauseam") =>
  format(nativeString("kPrelude"), ["false", JSON.stringify(offDirective), JSON.stringify(extensionOrigin), JSON.stringify(name), 5000, expression]);

export const revoke = (epoch) => format(nativeString("kOwnPageCall"), [scriptWith(nativeString("kRevokeClicks"), [epoch])]);

export const grant = (consent, issued) => inPrelude(scriptWith(nativeString("kClicks"), [consent, issued]));
