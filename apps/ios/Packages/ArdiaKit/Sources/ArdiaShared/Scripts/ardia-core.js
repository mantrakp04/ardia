"use strict";
(function () {
const __factories = new Map();
const __cache = new Map();
const __define = (path, factory) => __factories.set(path, factory);
const __export = (target, name, get) => Object.defineProperty(target, name, { get, enumerable: true, configurable: true });
const __exportAll = (target, source) => { for (const name of Object.keys(source)) if (name !== "default" && !(name in target)) __export(target, name, () => source[name]); };
const __require = (path) => {
  if (__cache.has(path)) return __cache.get(path);
  const exports = {};
  __cache.set(path, exports);
  __factories.get(path)(exports, __require);
  return exports;
};
__define("packages/core/src/mobile.ts", function (exports, __require) {
  __exportAll(exports, __require("packages/core/src/index.ts"));


});
__define("packages/core/src/index.ts", function (exports, __require) {
  __exportAll(exports, __require("packages/core/src/appUrls.ts"));
  __exportAll(exports, __require("packages/core/src/bangs.ts"));
  __exportAll(exports, __require("packages/core/src/calculator.ts"));
  __exportAll(exports, __require("packages/core/src/cleanUrl.ts"));
  __exportAll(exports, __require("packages/core/src/engines.ts"));
  __exportAll(exports, __require("packages/core/src/extensionRows.ts"));
  __exportAll(exports, __require("packages/core/src/fuzzy.ts"));
  __exportAll(exports, __require("packages/core/src/idn.ts"));
  __exportAll(exports, __require("packages/core/src/omnibox.ts"));
  __exportAll(exports, __require("packages/core/src/openTabs.ts"));
  __exportAll(exports, __require("packages/core/src/quickCreate.ts"));
  __exportAll(exports, __require("packages/core/src/siteSearch.ts"));
  __exportAll(exports, __require("packages/core/src/suggest.ts"));
  __exportAll(exports, __require("packages/core/src/suggestFetcher.ts"));
  __exportAll(exports, __require("packages/core/src/textFragment.ts"));
















});
__define("packages/core/src/appUrls.ts", function (exports, __require) {
  __export(exports, "toAppUrl", () => toAppUrl);
  __export(exports, "toEngineUrl", () => toEngineUrl);
  __export(exports, "appUrlOrigin", () => appUrlOrigin);
  __export(exports, "appUrlRoute", () => appUrlRoute);
const APP_SCHEME = "ardia";

const APP_PREFIX = /^(view-source:)?ardia:(?:\/\/)?/i;
const ENGINE_PREFIX = /^(view-source:)?chrome:(?:\/\/)?/i;
const ABOUT_PAGE = /^about:(blank|srcdoc)([?#]|$)/i;
const ABOUT_ALIAS = /^about:([a-z][a-z0-9-]*)/i;

const APP_PAGE_HOSTS = ["history", "bookmarks", "downloads"]         ;
                                                          

function split(url        , prefix        )                                                            {
  const m = prefix.exec(url);
  if (!m) return null;
  const after = url.slice(m[0].length);
  const host = /^[^/?#]*/.exec(after) [0];
  return { viewSource: m[1] ? "view-source:" : "", host: host.toLowerCase(), rest: after.slice(host.length) };
}

function toAppUrl(url        )         {
  const parts = split(url, APP_PREFIX) ?? split(url, ENGINE_PREFIX);
  if (parts) return parts.host ? `${parts.viewSource}${APP_SCHEME}://${parts.host}${parts.rest}` : url;
  if (ABOUT_PAGE.test(url)) return url;
  const about = ABOUT_ALIAS.exec(url);
  return about ? `${APP_SCHEME}://${about[1] .toLowerCase()}${url.slice(about[0].length)}` : url;
}

function toEngineUrl(url        )         {
  const parts = split(url, APP_PREFIX);
  return parts?.host ? `${parts.viewSource}chrome://${parts.host}${parts.rest}` : url;
}

const isAppUrl = (url                           ) => !!url && /^ardia:\/\/[^/?#]/i.test(url);

function appUrlParts(url        )                                                                     {
  if (!isAppUrl(url)) return null;
  const parts = split(url, APP_PREFIX) ;
  const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(parts.rest) ;
  return { host: parts.host, path: m[1] ?? "", query: m[2] ?? "", hash: m[3] ?? "" };
}

function appUrlOrigin(url        )                {
  const parts = appUrlParts(toAppUrl(url));
  return parts ? `${APP_SCHEME}://${parts.host}` : null;
}

                         
                                       
                                                
                      
                                    

function appUrlRoute(url        )                     {
  const parts = appUrlParts(url);
  if (!parts) return null;
  if ((APP_PAGE_HOSTS                     ).includes(parts.host)) return { kind: "page", page: parts.host                };
  if (parts.host === "newtab") return { kind: "newTab" };
  if (parts.host === "settings") {
    const section = parts.path.split("/").filter(Boolean)[0];
    return { kind: "settings", section: section ?? null };
  }
  return { kind: "engine", url: toEngineUrl(url) };
}

});
__define("packages/core/src/bangs.ts", function (exports, __require) {
  __export(exports, "BANG_PLACEHOLDER", () => BANG_PLACEHOLDER);
  __export(exports, "MAX_BANG_LIST_CHARS", () => MAX_BANG_LIST_CHARS);
  __export(exports, "parseLooseJson", () => parseLooseJson);
  __export(exports, "isValidBangTemplate", () => isValidBangTemplate);
  __export(exports, "staysOnSite", () => staysOnSite);
  __export(exports, "slimBangs", () => slimBangs);
  __export(exports, "bangTable", () => bangTable);
  __export(exports, "checkedBangTable", () => checkedBangTable);
  __export(exports, "bangDocument", () => bangDocument);
  __export(exports, "readBangDocument", () => readBangDocument);
  __export(exports, "joinBangTables", () => joinBangTables);
  __export(exports, "findBang", () => findBang);
  __export(exports, "escapeSearchTerms", () => escapeSearchTerms);
  __export(exports, "fillBangTemplate", () => fillBangTemplate);
                                                                                     

                                                                                 

                                                                   

const BANG_PLACEHOLDER = "{searchTerms}";
const STORED_PLACEHOLDER = "{s}";
const MIN_BANGS = 1000;
const MAX_BANG_LIST_CHARS = 4_000_000;
const REQUIRED_TRIGGERS = ["gh", "w", "yt"];
const BANG_DOCUMENT = "ardia-bangs 1";

function endOfString(text        , from        )         {
  let at = from;
  for (;;) {
    const quote = text.indexOf('"', at);
    if (quote < 0) return text.length;
    let slashes = 0;
    while (text.charCodeAt(quote - 1 - slashes) === 92) slashes++;
    if (slashes % 2 === 0) return quote + 1;
    at = quote + 1;
  }
}

function skipBlank(text        , from        )         {
  let at = from;
  for (;;) {
    while (at < text.length && /\s/.test(text[at] )) at++;
    if (text.startsWith("//", at)) {
      const end = text.indexOf("\n", at);
      at = end < 0 ? text.length : end;
    } else if (text.startsWith("/*", at)) {
      const end = text.indexOf("*/", at + 2);
      at = end < 0 ? text.length : end + 2;
    } else return at;
  }
}

function parseLooseJson(text        )          {
  const parts           = [];
  const special = /["/,]/g;
  let from = 0;
  for (let m = special.exec(text); m; m = special.exec(text)) {
    const at = m.index;
    const c = m[0];
    if (c === '"') {
      special.lastIndex = endOfString(text, at + 1);
    } else if (c === "/") {
      const next = text[at + 1];
      if (next !== "/" && next !== "*") continue;
      parts.push(text.slice(from, at));
      const end = next === "/" ? text.indexOf("\n", at) : text.indexOf("*/", at + 2);
      from = end < 0 ? text.length : next === "/" ? end : end + 2;
      special.lastIndex = from;
    } else {
      const close = text[skipBlank(text, at + 1)];
      if (close === "]" || close === "}") {
        parts.push(text.slice(from, at));
        from = at + 1;
      }
    }
  }
  parts.push(text.slice(from));
  return JSON.parse(parts.join(""));
}

const VALID_TEMPLATE = /^https?:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#]\S*)?$/i;
const ORIGIN = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\\]*)/i;

const isValidBangTemplate = (template        ) => VALID_TEMPLATE.test(template);

function staysOnSite(url        , template        )          {
  const to = ORIGIN.exec(url);
  const from = ORIGIN.exec(template);
  if (!to || !from || !from[2] || /[\s\x00-\x1f\x7f]/.test(url)) return false;
  return to[1] .toLowerCase() === from[1] .toLowerCase() && to[2] .toLowerCase() === from[2].toLowerCase();
}

const expandTemplate = (stored        ) =>
  (/^https?:\/\//i.test(stored) ? stored : `https://${stored}`).split(STORED_PLACEHOLDER).join(BANG_PLACEHOLDER);

function slimBangs(json        )                {
  let list         ;
  try {
    list = parseLooseJson(json);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const seen = new Set        ();
  const lines           = [];
  for (const entry of list             ) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { s, ts, u } = entry                           ;
    if (typeof s !== "string" || !Array.isArray(ts) || typeof u !== "string") continue;
    if (!isValidBangTemplate(u) || u.includes(STORED_PLACEHOLDER)) continue;
    const name = s.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const triggers           = [];
    for (const t of ts) {
      if (typeof t !== "string") continue;
      const trigger = t.trim().toLowerCase();
      if (!trigger || /[\s!]/.test(trigger) || seen.has(trigger)) continue;
      seen.add(trigger);
      triggers.push(trigger);
    }
    if (!triggers.length) continue;
    const stored = u.replace(/^https:\/\//i, "").split(BANG_PLACEHOLDER).join(STORED_PLACEHOLDER);
    lines.push(`${triggers.join(" ")}\t${name}\t${stored}`);
  }
  return lines.length >= MIN_BANGS ? lines.join("\n") : null;
}

function homeOf(template        )         {
  const origin = /^https?:\/\/[^/?#]+/i.exec(template)?.[0];
  return origin ? `${origin}/` : template;
}

function indexTriggers(slim        )                      {
  const lines = new Map                ();
  for (let at = 0; at < slim.length; ) {
    let end = slim.indexOf("\n", at);
    if (end < 0) end = slim.length;
    const tab = slim.indexOf("\t", at);
    if (tab > at && tab < end) {
      for (let from = at; from < tab; ) {
        const space = slim.indexOf(" ", from);
        const stop = space < 0 || space > tab ? tab : space;
        const trigger = slim.slice(from, stop);
        if (trigger && !lines.has(trigger)) lines.set(trigger, at);
        from = stop + 1;
      }
    }
    at = end + 1;
  }
  return lines;
}

function bangTable(slim        )            {
  const lines = indexTriggers(slim);
  const parsed = new Map                     ();
  const get = (trigger        )                   => {
    const key = trigger.toLowerCase();
    const cached = parsed.get(key);
    if (cached !== undefined) return cached ?? undefined;
    const at = lines.get(key);
    let bang              = null;
    if (at !== undefined) {
      const end = slim.indexOf("\n", at);
      const [, name = "", stored = ""] = slim.slice(at, end < 0 ? slim.length : end).split("\t");
      const template = expandTemplate(stored);
      if (name && isValidBangTemplate(template)) bang = { trigger: key, name, template, home: homeOf(template) };
    }
    parsed.set(key, bang);
    return bang ?? undefined;
  };
  return { size: lines.size, get };
}

function checkedBangTable(slim        )                   {
  if (slim.length > MAX_BANG_LIST_CHARS) return null;
  let count = 0;
  for (const line of slim.split("\n")) {
    const [triggers, name, stored, extra] = line.split("\t");
    if (!triggers || !name || !stored || extra !== undefined || !/^[^\s!]+(?: [^\s!]+)*$/.test(triggers)) return null;
    if (!isValidBangTemplate(expandTemplate(stored))) return null;
    count++;
  }
  if (count < MIN_BANGS) return null;
  const table = bangTable(slim);
  return REQUIRED_TRIGGERS.every((t) => table.get(t)) ? table : null;
}

const bangDocument = (etag               , slim        ) => `${BANG_DOCUMENT}\t${etag ?? ""}\n${slim}`;

function readBangDocument(doc                           )                                                   {
  if (!doc || doc.length > MAX_BANG_LIST_CHARS + 1024) return null;
  const firstLine = doc.indexOf("\n");
  if (firstLine < 0) return null;
  const [magic, etag = "", extra] = doc.slice(0, firstLine).split("\t");
  if (magic !== BANG_DOCUMENT || extra !== undefined) return null;
  const table = checkedBangTable(doc.slice(firstLine + 1));
  return table ? { etag: etag || null, table } : null;
}

function joinBangTables(tables                      )            {
  return {
    size: tables.reduce((n, t) => n + t.size, 0),
    get: (trigger) => {
      for (const t of tables) {
        const bang = t.get(trigger);
        if (bang) return bang;
      }
      return undefined;
    },
  };
}

function findBang(text        , table                              )                   {
  if (!table || !text.includes("!") || text.trimStart().startsWith("?")) return null;
  const words = text.trim().split(/\s+/);
  const last = words.length - 1;
  for (const at of last > 0 ? [0, last] : [0]) {
    const word = words[at] ;
    if (word.length < 2 || word[0] !== "!") continue;
    const bang = table.get(word.slice(1));
    if (!bang) continue;
    const query = words.filter((_, i) => i !== at).join(" ");
    const url = query ? fillBangTemplate(bang.template, query) : bang.home;
    if (staysOnSite(url, bang.template)) return { bang, query, url };
  }
  return null;
}

function wellFormed(text        )         {
  return Array.from(text, (c) => (c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff ? "�" : c)).join("");
}

const PATH_UNSAFE = /[^\x21-\x7e]+|["#%:<>?[\\\]^`{|}]/g;

function escapeSearchTerms(terms        , inQuery         )         {
  const text = wellFormed(terms);
  return inQuery ? encodeURIComponent(text).replace(/%20/g, "+") : text.replace(PATH_UNSAFE, (m) => encodeURIComponent(m));
}

function fillBangTemplate(template        , terms        )         {
  const at = template.indexOf(BANG_PLACEHOLDER);
  if (at < 0) return template;
  const question = template.indexOf("?");
  const escaped = escapeSearchTerms(terms, question >= 0 && at > question);
  return template.split(BANG_PLACEHOLDER).join(escaped);
}

});
__define("packages/core/src/calculator.ts", function (exports, __require) {
  __export(exports, "evaluate", () => evaluate);
  __export(exports, "calculate", () => calculate);

                                                                                                            

const CONSTANTS                         = { pi: Math.PI, "π": Math.PI, e: Math.E, tau: 2 * Math.PI, "τ": 2 * Math.PI };

const FUNCTIONS                                                = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  ln: Math.log,
  log: (x, base) => (base === undefined ? Math.log10(x) : Math.log(x) / Math.log(base)),
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

const OPERATOR_ALIASES                         = { "×": "*", "·": "*", "÷": "/", "−": "-", "–": "-", "**": "^" };

function tokenize(source        )                 {
  const tokens          = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const space = /^\s+/.exec(rest);
    if (space) {
      i += space[0].length;
      continue;
    }
    const num = /^(\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
    if (num) {
      tokens.push({ type: "num", value: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const op = /^(\*\*|[-+*/^%!(),×·÷−–°])/.exec(rest);
    if (op) {
      tokens.push({ type: "op", value: OPERATOR_ALIASES[op[0]] ?? op[0] });
      i += op[0].length;
      continue;
    }
    const id = /^([a-z][a-z0-9]*|π|τ)/i.exec(rest);
    if (id) {
      tokens.push({ type: "id", value: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    return null;
  }
  return tokens;
}

class Parser {
          i = 0;
                   tokens         ;
  constructor(tokens         ) {
    this.tokens = tokens;
  }

  parse()                {
    const value = this.expr();
    return this.i === this.tokens.length ? value : null;
  }

          peek(offset = 0)                    {
    return this.tokens[this.i + offset];
  }

          isOp(value        , offset = 0)          {
    const t = this.peek(offset);
    return t?.type === "op" && t.value === value;
  }

          isId(value        , offset = 0)          {
    const t = this.peek(offset);
    return t?.type === "id" && t.value === value;
  }

          startsPrimary(offset = 0)          {
    const t = this.peek(offset);
    return !!t && (t.type === "num" || (t.type === "id" && (t.value in CONSTANTS || t.value in FUNCTIONS)) || (t.type === "op" && t.value === "("));
  }

          expr()         {
    let value = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.tokens[this.i++]                     ).value;
      const rhs = this.term();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

          term()         {
    let value = this.unary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/") || this.isId("mod") || this.isId("of") || this.isId("x")) {
        const t = this.tokens[this.i++] ;
        const rhs = this.unary();
        if (t.value === "/") value /= rhs;
        else if (t.value === "mod") value %= rhs;
        else value *= rhs;
      } else if (this.isOp("%") && this.startsPrimary(1)) {
        this.i++;
        value %= this.unary();
      } else if (this.peek()?.type !== "num" && this.startsPrimary()) {
        value *= this.unary();
      } else {
        return value;
      }
    }
  }

          unary()         {
    if (this.isOp("-")) {
      this.i++;
      return -this.unary();
    }
    if (this.isOp("+")) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

          power()         {
    const base = this.postfix();
    if (this.isOp("^")) {
      this.i++;
      return Math.pow(base, this.unary());
    }
    return base;
  }

          postfix()         {
    let value = this.primary();
    for (;;) {
      if (this.isOp("!")) {
        this.i++;
        value = factorial(value);
      } else if (this.isOp("%") && !this.startsPrimary(1)) {
        this.i++;
        value /= 100;
      } else if (this.isOp("°") || this.isId("deg") || this.isId("degrees")) {
        this.i++;
        value *= Math.PI / 180;
      } else {
        return value;
      }
    }
  }

          primary()         {
    const t = this.tokens[this.i++];
    if (!t) throw new SyntaxError("unexpected end");
    if (t.type === "num") return t.value;
    if (t.type === "op" && t.value === "(") {
      const value = this.expr();
      this.expect(")");
      return value;
    }
    if (t.type === "id" && t.value in CONSTANTS) return CONSTANTS[t.value] ;
    if (t.type === "id" && t.value in FUNCTIONS) {
      this.expect("(");
      const args = [this.expr()];
      while (this.isOp(",")) {
        this.i++;
        args.push(this.expr());
      }
      this.expect(")");
      return FUNCTIONS[t.value] (...args);
    }
    throw new SyntaxError(`unexpected ${t.value}`);
  }

          expect(op        ) {
    if (!this.isOp(op)) throw new SyntaxError(`expected ${op}`);
    this.i++;
  }
}

function factorial(n        )         {
  if (!Number.isInteger(n) || n < 0 || n > 170) return NaN;
  let out = 1;
  for (let k = 2; k <= n; k++) out *= k;
  return out;
}

function evaluate(expression        )                {
  const source = /[a-z]\s*\(/i.test(expression) ? expression : expression.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  const tokens = tokenize(source);
  if (!tokens?.length) return null;
  try {
    const value = new Parser(tokens).parse();
    return value !== null && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function formatNumber(value        , digits = 12)         {
  if (value === 0) return "0";
  const rounded = Number(value.toPrecision(digits));
  const abs = Math.abs(rounded);
  if (abs >= 1e21 || abs < 1e-9) return rounded.toExponential().replace(/\.?0+e/, "e");
  return String(rounded);
}

                                                           

const UNITS                       = {};
function units(dim        , factor        , label        , ...names          ) {
  for (const name of [label, ...names]) UNITS[name.toLowerCase()] = { dim, factor, label };
}
units("length", 1, "m", "meter", "meters", "metre", "metres");
units("length", 1000, "km", "kilometer", "kilometers", "kilometre", "kilometres");
units("length", 0.01, "cm", "centimeter", "centimeters");
units("length", 0.001, "mm", "millimeter", "millimeters");
units("length", 1609.344, "mi", "mile", "miles");
units("length", 0.9144, "yd", "yard", "yards");
units("length", 0.3048, "ft", "foot", "feet");
units("length", 0.0254, "in", "inch", "inches");
units("length", 1852, "nmi", "nautical mile");
units("mass", 1, "kg", "kilogram", "kilograms", "kilo", "kilos");
units("mass", 0.001, "g", "gram", "grams");
units("mass", 1e-6, "mg", "milligram", "milligrams");
units("mass", 0.45359237, "lb", "lbs", "pound", "pounds");
units("mass", 0.028349523125, "oz", "ounce", "ounces");
units("mass", 6.35029318, "st", "stone", "stones");
units("mass", 1000, "t", "tonne", "tonnes");
units("volume", 1, "l", "liter", "liters", "litre", "litres");
units("volume", 0.001, "ml", "milliliter", "milliliters", "millilitre", "millilitres");
units("volume", 3.785411784, "gal", "gallon", "gallons");
units("volume", 0.946352946, "qt", "quart", "quarts");
units("volume", 0.473176473, "pt", "pint", "pints");
units("volume", 0.2365882365, "cup", "cups");
units("volume", 0.0295735295625, "fl oz", "floz");
units("volume", 0.01478676478125, "tbsp", "tablespoon", "tablespoons");
units("volume", 0.00492892159375, "tsp", "teaspoon", "teaspoons");
units("time", 0.001, "ms", "millisecond", "milliseconds");
units("time", 1, "s", "sec", "secs", "second", "seconds");
units("time", 60, "min", "mins", "minute", "minutes");
units("time", 3600, "h", "hr", "hrs", "hour", "hours");
units("time", 86400, "days", "day", "d");
units("time", 604800, "weeks", "week", "wk");
units("time", 31556952, "years", "year", "yr");
units("data", 0.125, "bits", "bit");
units("data", 1, "bytes", "byte", "B");
units("data", 1e3, "KB", "kilobyte", "kilobytes");
units("data", 1e6, "MB", "megabyte", "megabytes");
units("data", 1e9, "GB", "gigabyte", "gigabytes");
units("data", 1e12, "TB", "terabyte", "terabytes");
units("data", 1024, "KiB");
units("data", 1024 ** 2, "MiB");
units("data", 1024 ** 3, "GiB");
units("data", 1024 ** 4, "TiB");
units("speed", 1, "m/s");
units("speed", 1000 / 3600, "km/h", "kph", "kmh");
units("speed", 1609.344 / 3600, "mph");
units("speed", 1852 / 3600, "knots", "knot", "kn");

const TEMPERATURES                                  = {
  c: "C", "°c": "C", celsius: "C", f: "F", "°f": "F", fahrenheit: "F", k: "K", kelvin: "K",
};
const toCelsius = { C: (v        ) => v, F: (v        ) => ((v - 32) * 5) / 9, K: (v        ) => v - 273.15 };
const fromCelsius = { C: (v        ) => v, F: (v        ) => (v * 9) / 5 + 32, K: (v        ) => v + 273.15 };

const unitPattern = [...Object.keys(UNITS), ...Object.keys(TEMPERATURES)]
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[/.]/g, "\\$&").replace(/ /g, "\\s*"))
  .join("|");
const CONVERSION = new RegExp(`^(.+?)\\s*(${unitPattern})\\s+(?:to|in|into|as|=|->|→)\\s+(${unitPattern})$`, "i");

function convert(input        )                                         {
  const m = CONVERSION.exec(input);
  if (!m) return null;
  const amount = evaluate(m[1] );
  if (amount === null) return null;
  const from = m[2] .toLowerCase().replace(/\s+/g, " ");
  const to = m[3] .toLowerCase().replace(/\s+/g, " ");
  const tFrom = TEMPERATURES[from];
  const tTo = TEMPERATURES[to];
  if (tFrom && tTo) return { value: fromCelsius[tTo](toCelsius[tFrom](amount)), unit: `°${tTo}`.replace("°K", "K") };
  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b || a.dim !== b.dim) return null;
  return { value: (amount * a.factor) / b.factor, unit: b.label };
}

                                                                                 

function calculate(raw        )                     {
  const expression = raw.trim().replace(/^=\s*/, "").replace(/\s*=\s*\??$/, "");
  if (!expression || expression.length > 200 || !/[\dπτ]|\b(pi|e|tau)\b/i.test(expression)) return null;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(expression) || /^\d+(\.\d+){2,}$/.test(expression)) return null;

  const converted = convert(expression);
  if (converted) {
    const display = `${formatNumber(converted.value, 9)} ${converted.unit}`;
    return { expression, value: converted.value, display };
  }
  const hasOperator = /[\w).πτ]\s*(\*\*|[-+*/^%×·÷−–]|mod|of|x)\s*[\d(.a-zπτ]/i.test(expression) || /[!%°]\s*$/.test(expression);
  const hasFunction = new RegExp(`\\b(${Object.keys(FUNCTIONS).join("|")})\\s*\\(`, "i").test(expression);
  if (!hasOperator && !hasFunction) return null;
  const value = evaluate(expression);
  if (value === null) return null;
  return { expression, value, display: formatNumber(value) };
}

});
__define("packages/core/src/cleanUrl.ts", function (exports, __require) {
  __export(exports, "cleanUrl", () => cleanUrl);
  __export(exports, "markdownLink", () => markdownLink);

const GLOBAL_PARAMS = new Set([
  "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "gad_source", "gad_campaignid", "_ga", "_gl", "srsltid",
  "fbclid", "igshid", "msclkid", "twclid", "ttclid", "li_fat_id", "yclid", "ysclid", "rdt_cid", "epik",
  "mc_cid", "mc_eid", "_hsenc", "_hsmi", "__hssc", "__hstc", "__hsfp", "hsctatracking", "mkt_tok", "elqtrackid",
  "elqtrack", "vero_id", "vero_conv", "_kx", "__s",
  "oly_anon_id", "oly_enc_id", "_openstat", "wickedid", "rb_clickid", "s_cid", "irclickid", "cjevent", "sscid",
  "zanpid", "ranmid", "raneaid", "ransiteid", "trk_contact", "trk_msg", "trk_module", "trk_sid",
]);

const GLOBAL_PREFIXES = ["utm_", "pk_", "mtm_", "piwik_", "matomo_", "hsa_", "stm_"];

const SITE_PARAMS                                                               = [
  { hosts: ["youtube.com", "youtu.be", "music.youtube.com"], params: ["si", "pp", "feature"] },
  { hosts: ["open.spotify.com"], params: ["si", "nd", "context"] },
  { hosts: ["instagram.com"], params: ["igsh", "img_index"] },
  { hosts: ["x.com", "twitter.com"], params: ["s", "t", "ref_src", "ref_url"] },
  { hosts: ["threads.net", "threads.com"], params: ["xmt", "slof"] },
  { hosts: ["tiktok.com"], params: ["is_from_webapp", "sender_device", "sender_web_id", "_r", "_t"] },
  { hosts: ["linkedin.com"], params: ["trk", "trackingid", "lipi", "midtoken", "midsig", "trkemail", "eid"] },
  { hosts: ["reddit.com"], params: ["share_id", "ref_source", "ref_campaign"] },
  { hosts: ["medium.com"], params: ["source"] },
  { hosts: ["facebook.com"], params: ["mibextid", "sfnsn", "rdid", "share_url"] },
  {
    hosts: ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.it", "amazon.es", "amazon.ca", "amazon.co.jp", "amazon.in", "amazon.com.au"],
    params: ["_encoding", "psc", "ref", "ref_", "tag", "linkcode", "linkid", "camp", "creative", "creativeasin", "content-id", "crid", "sprefix", "qid", "sr", "dib", "dib_tag"],
    prefixes: ["pd_rd_", "pf_rd_"],
  },
];

function siteRules(hostname        ) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return SITE_PARAMS.filter((r) => r.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
}

function decodeName(raw        )         {
  try {
    return decodeURIComponent(raw.replace(/\+/g, " ")).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function isTrackingParam(name        , hostname = "")          {
  const key = name.toLowerCase();
  if (GLOBAL_PARAMS.has(key) || GLOBAL_PREFIXES.some((p) => key.startsWith(p))) return true;
  return siteRules(hostname).some((r) => r.params.includes(key) || r.prefixes?.some((p) => key.startsWith(p)));
}

function cleanUrl(url        )         {
  const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url);
  if (!match?.[2]) return url;
  let hostname = "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url;
    hostname = parsed.hostname;
  } catch {
    return url;
  }
  const [, base = "", query = "", hash = ""] = match;
  const pairs = query.slice(1).split("&");
  const kept = pairs.filter((pair) => pair && !isTrackingParam(decodeName(pair.split("=")[0] ), hostname));
  if (kept.length === pairs.length) return url;
  return `${base}${kept.length ? `?${kept.join("&")}` : ""}${hash}`;
}

function markdownLink(title        , url        )         {
  return `[${(title || url).replace(/([[\]])/g, "\\$1")}](${cleanUrl(url)})`;
}

});
__define("packages/core/src/engines.ts", function (exports, __require) {
  __export(exports, "BUILT_IN_ENGINES", () => BUILT_IN_ENGINES);
  __export(exports, "allEngines", () => allEngines);
  __export(exports, "extensionEngineId", () => extensionEngineId);
  __export(exports, "controllingExtensionEngine", () => controllingExtensionEngine);
  __export(exports, "extensionEnginesFromChrome", () => extensionEnginesFromChrome);
  __export(exports, "engineById", () => engineById);
  __export(exports, "searchUrl", () => searchUrl);
  __export(exports, "suggestRequestUrl", () => suggestRequestUrl);
  __export(exports, "engineHost", () => engineHost);
  __export(exports, "parseSuggestions", () => parseSuggestions);
  __export(exports, "validateEngine", () => validateEngine);
  __export(exports, "makeCustomEngine", () => makeCustomEngine);
const { hostOf, searchUrlFor } = __require("packages/core/src/omnibox.ts");

                            
             
               
                  
              
                      
                   
                                           
  

                                                                                            

                                     
                  
                      
                        
               
                  
              
                      
                     
  

const BUILT_IN_ENGINES                          = [
  {
    id: "google",
    name: "Google",
    keyword: "google.com",
    url: "https://www.google.com/search?q=%s",
    suggestUrl: "https://suggestqueries.google.com/complete/search?client=firefox&ie=utf-8&oe=utf-8&q=%s",
  },
  { id: "bing", name: "Bing", keyword: "bing.com", url: "https://www.bing.com/search?q=%s", suggestUrl: "https://api.bing.com/osjson.aspx?query=%s" },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    keyword: "duckduckgo.com",
    url: "https://duckduckgo.com/?q=%s",
    suggestUrl: "https://duckduckgo.com/ac/?q=%s&type=list",
  },
  { id: "perplexity", name: "Perplexity", keyword: "perplexity.ai", url: "https://www.perplexity.ai/search?q=%s" },
  { id: "chatgpt", name: "ChatGPT", keyword: "chatgpt.com", url: "https://chatgpt.com/?q=%s" },
  {
    id: "ecosia",
    name: "Ecosia",
    keyword: "ecosia.org",
    url: "https://www.ecosia.org/search?q=%s",
    suggestUrl: "https://ac.ecosia.org/autocomplete?q=%s&type=list",
  },
  {
    id: "brave",
    name: "Brave Search",
    keyword: "search.brave.com",
    url: "https://search.brave.com/search?q=%s",
    suggestUrl: "https://search.brave.com/api/suggest?q=%s",
  },
  { id: "kagi", name: "Kagi", keyword: "kagi.com", url: "https://kagi.com/search?q=%s" },
  {
    id: "startpage",
    name: "Startpage",
    keyword: "startpage.com",
    url: "https://www.startpage.com/do/search?q=%s",
    suggestUrl: "https://www.startpage.com/osuggestions?q=%s",
  },
  {
    id: "yahoo",
    name: "Yahoo",
    keyword: "yahoo.com",
    url: "https://search.yahoo.com/search?p=%s",
    suggestUrl: "https://search.yahoo.com/sugg/ff?output=fxjson&command=%s",
  },
  {
    id: "baidu",
    name: "Baidu",
    keyword: "baidu.com",
    url: "https://www.baidu.com/s?wd=%s",
    suggestUrl: "https://www.baidu.com/su?action=opensearch&ie=utf-8&wd=%s",
  },
  {
    id: "yandex",
    name: "Yandex",
    keyword: "yandex.com",
    url: "https://yandex.com/search/?text=%s",
    suggestUrl: "https://suggest.yandex.com/suggest-ff.cgi?part=%s",
  },
];

function allEngines(custom                                = [], extension                                   = [])                 {
  const engines                 = [...BUILT_IN_ENGINES, ...custom.map((e) => ({ ...e, custom: true }))];
  const seen = new Set        ();
  for (const e of extension) {
    if (seen.has(e.extensionId)) continue;
    seen.add(e.extensionId);
    engines.push({
      id: extensionEngineId(e.extensionId),
      name: e.name,
      keyword: e.keyword,
      url: e.url,
      suggestUrl: e.suggestUrl || undefined,
      extension: { id: e.extensionId, name: e.extensionName },
    });
  }
  return engines;
}

const extensionEngineId = (extensionId        ) => `extension:${extensionId}`;

function controllingExtensionEngine(extension                                  )                                    {
  return extension.find((e) => e.isDefault);
}

const withoutPlaceholders = (url        ) => url.replace(/\{[^{}%]*\}/g, "");

function extensionEnginesFromChrome(profile        , list         )                          {
  const groups = list && typeof list === "object" ? Object.values(list                           ) : [];
  const out                          = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const e of group                             ) {
      const ext = e?.extension                                                ;
      if (!ext || typeof ext.id !== "string" || e.isOmniboxExtension) continue;
      if (typeof e.url !== "string" || !e.url.includes("%s") || out.some((o) => o.extensionId === ext.id)) continue;
      out.push({
        profile,
        extensionId: ext.id,
        extensionName: typeof ext.name === "string" ? ext.name : "",
        name: typeof e.name === "string" && e.name ? e.name : String(ext.name ?? ""),
        keyword: typeof e.keyword === "string" ? e.keyword : "",
        url: withoutPlaceholders(e.url),
        suggestUrl:
          typeof e.suggestionsUrl === "string" && e.suggestionsUrl.includes("%s") ? withoutPlaceholders(e.suggestionsUrl) : undefined,
        isDefault: e.default === true,
      });
    }
  }
  return out;
}

function engineById(engines                         , id                    )               {
  return engines.find((e) => e.id === id) ?? BUILT_IN_ENGINES[0] ;
}

const searchUrl = (engine                           , query        ) => searchUrlFor(engine.url, query);

const suggestRequestUrl = (engine              , query        ) =>
  engine.suggestUrl && query.trim() ? searchUrlFor(engine.suggestUrl, query) : null;

const engineHost = (engine                           ) => hostOf(engine.url.replace(/%s/g, "q"));

function parseSuggestions(body         )           {
  if (!Array.isArray(body) || !Array.isArray(body[1])) return [];
  return (body[1]             ).filter((s)              => typeof s === "string" && s.trim() !== "").map((s) => s.trim());
}

                                                                         

function validateEngine(input             , engines                         , ignoreId         )                {
  const name = input.name.trim();
  const keyword = input.keyword.trim().toLowerCase();
  const url = input.url.trim();
  if (!name) return "Enter a name.";
  if (!keyword) return "Enter a shortcut.";
  if (/\s/.test(keyword)) return "The shortcut can't contain spaces.";
  if (!/^https?:\/\/[^/?#\s]+/i.test(url)) return "Enter a URL that starts with http:// or https://.";
  if (!url.includes("%s")) return "The URL must contain %s where the search terms go.";
  if (engines.some((e) => e.id !== ignoreId && e.keyword.toLowerCase() === keyword)) return `“${keyword}” is already used by another search engine.`;
  return null;
}

function makeCustomEngine(input             , id        )                     {
  return { id, name: input.name.trim(), keyword: input.keyword.trim().toLowerCase(), url: input.url.trim() };
}

});
__define("packages/core/src/omnibox.ts", function (exports, __require) {
  __export(exports, "hostOf", () => hostOf);
  __export(exports, "fixupUrl", () => fixupUrl);
  __export(exports, "searchUrlFor", () => searchUrlFor);
  __export(exports, "resolveInput", () => resolveInput);
  __export(exports, "classifyPaste", () => classifyPaste);
  __export(exports, "breadcrumb", () => breadcrumb);
  __export(exports, "urlForDisplay", () => urlForDisplay);
const { appUrlOrigin, toAppUrl } = __require("packages/core/src/appUrls.ts");
const { cleanUrl } = __require("packages/core/src/cleanUrl.ts");
const { displayHost } = __require("packages/core/src/idn.ts");
const { PSL_TLDS } = __require("packages/core/src/tlds.ts");

const SEARCH_URL = "https://www.google.com/search?q=";

                                                                                                                  

const URL_PARTS = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)(?::(\d+))?([^?#]*)(\?[^#]*)?(#.*)?$/i;

function parseUrl(url        )                   {
  const m = URL_PARTS.exec(url.trim());
  if (!m) return null;
  return { scheme: m[1] .toLowerCase(), host: m[2] .toLowerCase(), port: m[3] ?? "", path: m[4] ?? "", query: m[5] ?? "", hash: m[6] ?? "" };
}

function hostOf(url        )         {
  return (parseUrl(url)?.host ?? "").replace(/^www\./, "");
}

const KNOWN_SCHEMES = new Set([
  "http", "https", "file", "about", "data", "blob", "mailto", "tel", "sms", "facetime", "ftp", "view-source",
  "ardia", "chrome", "chrome-extension", "devtools", "x-apple.systempreferences", "itms-apps", "slack", "zoommtg", "vscode",
  "cursor", "notion", "figma", "spotify", "linear", "obsidian", "raycast",
]);

const KNOWN_TLDS = new Set(
  (
    "com net org edu gov mil int info biz name pro mobi app dev io ai co me tv cc gg sh fm ly so to xyz online site tech store " +
    "blog shop cloud page news live art design studio agency media digital network systems solutions services software " +
    "email chat social link click space website world today life fun games game zone wiki tools codes run build host " +
    "rocks ninja guru expert academy school university health care money finance bank capital fund law legal travel " +
    "photos photo pics gallery video music film movie radio audio events social group team community church city " +
    "london nyc paris berlin tokyo africa asia eu aero coop museum jobs cat post tel travel moe onl one top vip win " +
    "work works company business center global plus inc ltd llc gmbh srl cafe restaurant pizza bar pub coffee wine beer " +
    "fashion style shoes clothing jewelry watch camera computer phone mobile download security domains hosting " +
    "google youtube gmail android chrome amazon apple microsoft windows office azure aws netflix meta search " +
    "local localhost test internal lan arpa onion " +
    "ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca cc " +
    "cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga " +
    "gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp " +
    "ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms " +
    "mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro " +
    "rs ru rw sa sb sc sd se sg sh si sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt " +
    "tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw"
  ).split(" "),
);
let registries                         ;
const knownTld = (tld        ) => KNOWN_TLDS.has(tld) || (registries ??= new Set(PSL_TLDS.split(/\s+/))).has(tld);

function isLocalHost(host        )          {
  return (
    host === "localhost" ||
    !host.includes(".") ||
    host.startsWith("[") ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ||
    /\.(local|localhost|test|internal|lan|home\.arpa)$/.test(host)
  );
}

const L = "a-z0-9\\u00a1-\\uffff";
const LABEL = `[${L}](?:[${L}-]*[${L}])?`;
const HOST = new RegExp(
  `^(localhost|\\[[0-9a-f:.]+\\]|(\\d{1,3}\\.){3}\\d{1,3}|(${LABEL}\\.)+([a-z\\u00a1-\\uffff](?:[${L}-]*[${L}])?|xn--[a-z0-9-]+)|${LABEL})\\.?(:\\d{1,5})?(?=[/?#]|$)`,
  "i",
);

function fixupUrl(raw        )                {
  const url = fixup(raw);
  return url && toAppUrl(url);
}

function fixup(raw        )                {
  const input = raw.trim();
  if (!input || (/\s/.test(input) && !/^([a-z][a-z0-9+.-]*:\/\/|\/[^\s/])/i.test(input))) return null;
  if (/^(about|data|mailto|tel|sms|facetime|view-source):/i.test(input)) return input;

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(input)?.[1]?.toLowerCase();
  if (scheme && KNOWN_SCHEMES.has(scheme) && (input.slice(scheme.length + 1).startsWith("//") || !/^\d/.test(input.slice(scheme.length + 1)))) {
    return scheme + input.slice(scheme.length).replace(/\s/g, "%20");
  }
  if (scheme && !KNOWN_SCHEMES.has(scheme) && input.slice(scheme.length + 1).startsWith("//")) return input;
  if (input.startsWith("/") && !input.startsWith("//")) return `file://${input.replace(/\s/g, "%20")}`;

  if (!/[.:/?#[]/.test(input)) return input.toLowerCase() === "localhost" ? `http://${input}` : null;
  const host = HOST.exec(input);
  if (!host) return null;
  const name = host[1] .toLowerCase().replace(/\.$/, "");
  const numeric = /^[\d.]+$/.test(name);
  if (numeric && !name.includes(".")) return null;
  const dotted = name.includes(".") && !numeric && name.charCodeAt(0) !== 91;
  const tld = dotted ? name.slice(name.lastIndexOf(".") + 1) : "";
  const rest = input.slice(host[0].length);
  const special = name === "localhost" || name.charCodeAt(0) === 91 || numeric;
  const proto = isLocalHost(name) ? "http" : "https";
  if (special || (dotted && (knownTld(tld) || tld.startsWith("xn--")))) return `${proto}://${input}`;
  if (!host[5] && !rest.includes("/") && !rest.includes("?") && !rest.includes("#")) return null;
  const path = /^[^?#]*/.exec(rest) [0];
  const query = /\?[^#]*/.exec(rest)?.[0] ?? "";
  const fragment = /#.*/.exec(rest)?.[0] ?? "";
  const parts = (host[5] ? 1 : 0) + (path ? 1 : 0) + (query.length > 1 ? 1 : 0) + (fragment.length > 1 ? 1 : 0);
  return host[5] || path.endsWith("/") || parts > 1 ? `${proto}://${input}` : null;
}

function searchUrlFor(template        , query        )         {
  const q = encodeURIComponent(query.trim());
  return template.includes("%s") ? template.replace(/%s/g, q) : template + q;
}

function resolveInput(raw        , search = SEARCH_URL)         {
  const input = raw.trim();
  if (!input) return "";
  if (input.startsWith("?")) return input.length > 1 ? searchUrlFor(search, input.slice(1)) : "";
  return fixupUrl(input) ?? searchUrlFor(search, input);
}

                                                                                          

function classifyPaste(text        )                     {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const url = /\s/.test(trimmed) ? null : fixupUrl(trimmed);
  if (url && !/^(about|data):/i.test(url)) return { kind: "go", url: cleanUrl(url) };
  return { kind: "search", query: trimmed.replace(/\s+/g, " ").slice(0, 2000) };
}

function breadcrumb(url        , title         )                                    {
  const parsed = parseUrl(url);
  const app = appUrlOrigin(url);
  const host = app ?? (parsed ? displayHost(parsed.host).replace(/^www\./, "") : url);
  const seen = new Set([host.toLowerCase(), ...(app && parsed ? [parsed.host] : [])]);
  const trail = (title ?? "")
    .split(/\s[|/·–—-]\s/)
    .map((s) => s.trim())
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { host, trail };
}

function urlForDisplay(url        )         {
  if (appUrlOrigin(url)) return toAppUrl(url).replace(/^([^/]*\/\/[^/?#]*)\/(?=[?#]|$)/, "$1");
  const rest = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const host = /^[^/?#:]*/.exec(rest) [0];
  return (displayHost(host) + rest.slice(host.length)).replace(/^www\./i, "");
}

});
__define("packages/core/src/idn.ts", function (exports, __require) {
  __export(exports, "punycodeEncode", () => punycodeEncode);
  __export(exports, "displayHost", () => displayHost);
  __export(exports, "hostSpoofReason", () => hostSpoofReason);

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_CODE_POINT = 0x10ffff;

function adapt(delta        , points        , first         )         {
  delta = first ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / points);
  let k = 0;
  for (; delta > ((BASE - T_MIN) * T_MAX) >> 1; k += BASE) delta = Math.floor(delta / (BASE - T_MIN));
  return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

const digitValue = (c        ) => (c >= 0x30 && c <= 0x39 ? c - 22 : c >= 0x41 && c <= 0x5a ? c - 0x41 : c >= 0x61 && c <= 0x7a ? c - 0x61 : BASE);
const digitChar = (d        ) => String.fromCharCode(d < 26 ? d + 0x61 : d + 22);

function punycodeDecode(input        )                {
  const output           = [];
  const delimiter = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(delimiter, 0); j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) return null;
    output.push(c);
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let index = delimiter > 0 ? delimiter + 1 : 0; index < input.length; ) {
    const oldI = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) return null;
      const digit = digitValue(input.charCodeAt(index++));
      if (digit >= BASE || digit > Math.floor((MAX_CODE_POINT - i) / w)) return null;
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const points = output.length + 1;
    bias = adapt(i - oldI, points, oldI === 0);
    n += Math.floor(i / points);
    i %= points;
    if (n > MAX_CODE_POINT || (n >= 0xd800 && n <= 0xdfff)) return null;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

function punycodeEncode(input        )         {
  const points = Array.from(input, (c) => c.codePointAt(0) );
  let output = points.filter((c) => c < 0x80).map((c) => String.fromCharCode(c)).join("");
  const basic = output.length;
  let handled = basic;
  if (basic) output += "-";
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (handled < points.length) {
    const m = Math.min(...points.filter((c) => c >= n));
    delta += (m - n) * (handled + 1);
    n = m;
    for (const c of points) {
      if (c < n) delta++;
      if (c !== n) continue;
      let q = delta;
      for (let k = BASE; ; k += BASE) {
        const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
        if (q < t) break;
        output += digitChar(t + ((q - t) % (BASE - t)));
        q = Math.floor((q - t) / (BASE - t));
      }
      output += digitChar(q);
      bias = adapt(delta, handled + 1, handled === basic);
      delta = 0;
      handled++;
    }
    delta++;
    n++;
  }
  return output;
}

const SCRIPTS = [
  "Latin", "Greek", "Cyrillic", "Armenian", "Hebrew", "Arabic", "Thaana", "Devanagari", "Bengali", "Gurmukhi",
  "Gujarati", "Oriya", "Tamil", "Telugu", "Kannada", "Malayalam", "Sinhala", "Thai", "Lao", "Tibetan", "Myanmar",
  "Georgian", "Hangul", "Ethiopic", "Khmer", "Hiragana", "Katakana", "Bopomofo", "Han",
]         ;
                                       
function scx(name        )         {
  try {
    new RegExp(`\\p{Script_Extensions=${name}}`, "u");
    return `\\p{Script_Extensions=${name}}`;
  } catch {
    return `\\p{Script=${name}}`;
  }
}
const SCRIPT_TESTS = SCRIPTS.map((name) => [name, new RegExp(scx(name), "u")]         );
const COMMON = /[\p{Script=Common}\p{Script=Inherited}]/u;

const IDENTIFIER = /^[\p{Ll}\p{Lo}\p{Lm}\p{Mn}\p{Mc}\p{Nd}-]$/u;
const EXCLUDED = new RegExp(
  "[" +
    "\\u0138\\u0149\\u017f\\u01c4-\\u01cc\\u01dd\\u0180-\\u019f\\u01a2-\\u01ae\\u01b1-\\u01cc\\u01f1-\\u01f3\\u01f6\\u01f7" +
    "\\u021c\\u021d\\u0220-\\u0225\\u0234-\\u024f" +
    "\\u0250-\\u0258\\u025a-\\u02ff" +
    "\\u0305\\u030d\\u030e\\u0310\\u0312\\u0315-\\u031a\\u031c-\\u0322\\u0329-\\u032c\\u032f\\u0332-\\u0334\\u0336\\u0337\\u033a-\\u036f" +
    "\\u0370-\\u038f\\u03cf-\\u03ff\\u1f00-\\u1fff" +
    "\\u0482-\\u0489" +
    "\\u1d00-\\u1dbf\\u1dc0-\\u1dff\\u2c60-\\u2c7f\\ua720-\\ua7ff\\uab30-\\uab6f" +
    "\\u10a0-\\u10cf\\u1c90-\\u1cbf" +
    "\\u0964\\u0965\\u0970\\u0e2f\\u0e46\\u0eaf\\u0ec6\\u0f01-\\u0f1f\\u0f2a-\\u0f3f\\u104a-\\u104f\\u17d4-\\u17d6\\u17d8-\\u17db" +
    "\\u3031-\\u3035\\u303b\\u303c\\u3099\\u309a\\u309b\\u309c\\u309f\\u30a0\\u30ff\\u3131-\\u318e" +
    "]",
  "u",
);
const ALLOWED_COMMON = /^[-\u00b7\u30fb\u30fc\u3005-\u3007\u0300-\u0304\u0306-\u030c\u030f\u0311\u0313\u0314\u031b\u0323-\u0328\u032d\u032e\u0330\u0331\u0335\u0338\u0339]$/u;

function isAllowed(c        )          {
  if (ALLOWED_COMMON.test(c)) return true;
  if (!IDENTIFIER.test(c) || EXCLUDED.test(c)) return false;
  if (c.normalize("NFKC") !== c || c.toLowerCase() !== c) return false;
  return scriptsOf(c) !== null;
}

function scriptsOf(c        )                  {
  const scripts = SCRIPT_TESTS.filter(([, re]) => re.test(c)).map(([name]) => name);
  if (scripts.length) return scripts;
  return COMMON.test(c) ? [] : null;
}

function augmented(scripts          )              {
  const set = new Set        (scripts);
  if (set.has("Han")) ["Hanb", "Jpan", "Kore"].forEach((s) => set.add(s));
  if (set.has("Hiragana") || set.has("Katakana")) set.add("Jpan");
  if (set.has("Hangul")) set.add("Kore");
  if (set.has("Bopomofo")) set.add("Hanb");
  return set;
}

                                                                            

function restrictionLevel(chars          )              {
  if (chars.every((c) => c.charCodeAt(0) < 0x80)) return "ascii";
  const sets = chars.map((c) => augmented(scriptsOf(c) ?? [])).filter((s) => s.size);
  const intersect = (list               ) => list.reduce                    ((acc, s) => (acc ? new Set([...acc].filter((x) => s.has(x))) : new Set(s)), null);
  const all = intersect(sets);
  if (!all || all.size) return "single";
  const nonLatin = intersect(sets.filter((s) => !s.has("Latin")));
  if (!nonLatin || !nonLatin.size) return "minimal";
  if (["Hanb", "Jpan", "Kore"].some((s) => nonLatin.has(s))) return "highly";
  if (!nonLatin.has("Cyrillic") && !nonLatin.has("Greek")) return "moderately";
  return "minimal";
}

function digitSystems(chars          )              {
  const zeros = new Set        ();
  for (const c of chars) {
    if (!/\p{Nd}/u.test(c)) continue;
    const cp = c.codePointAt(0) ;
    let zero = cp;
    while (zero > 0 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1)) && cp - zero < 9) zero--;
    zeros.add(zero);
  }
  return zeros;
}

const DEVIATIONS = /[\u00df\u03c2\u200c\u200d]/u;
const DIGIT_LOOKALIKES = /[θ२২੨૨೩೭Շзҙӡउওਤ੩૩౩ဒვპ੫丩ㄐճ৪੪୫૭୨౨]/u;
const KANA_EXCEPTIONS = /[\u3078-\u307a\u30d8-\u30da\u30fb-\u30fe]/u;
const COMBINING_DIACRITICS = /[\u0300-\u0339]/u;
const NON_ASCII_LATIN = /(?![a-z])\p{Script=Latin}/u;
const LGC_OR_ASCII = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}0-9._\u0300-\u0339-]*$/u;

const WHOLE_SCRIPT_CONFUSABLES                                                           = [
  { script: /\p{Script=Armenian}/u, lookalikes: /[ագզէլհյնոսւօՙ]/u, tlds: ["am"] },
  { script: /\p{Script=Cyrillic}/u, lookalikes: /[асԁеһіјӏорԗԛѕԝхуъЬҽпгѵѡ]/u, tlds: ["bg", "by", "kz", "pyc", "ru", "su", "ua", "uz"] },
  { script: /\p{Script=Ethiopic}/u, lookalikes: /[ሀሁሃሠሡሰሱሲቀቁበቡነኑኒከኮዐዑዕዖፀፁፐ]/u, tlds: ["er", "et"] },
  { script: /\p{Script=Georgian}/u, lookalikes: /[იოყჽ]/u, tlds: ["ge"] },
  { script: /\p{Script=Greek}/u, lookalikes: /[αικνρυωϲοτχ]/u, tlds: ["gr"] },
  { script: /\p{Script=Hebrew}/u, lookalikes: /[דוחיןסם]/u, tlds: ["il"] },
  { script: /\p{Script=Khmer}/u, lookalikes: /[ឧ]/u, tlds: ["kh"] },
  { script: /\p{Script=Lao}/u, lookalikes: /[ບປຍຮຣຨຫອພຟຝ໐]/u, tlds: ["la"] },
  { script: /\p{Script=Sinhala}/u, lookalikes: /[ථ]/u, tlds: ["lk"] },
  { script: /\p{Script=Thai}/u, lookalikes: /[ทนบพรหเแ๐ดลปฟม]/u, tlds: ["th"] },
];

const DANGEROUS = new RegExp(
  [
    `[^${scx("Katakana")}${scx("Hiragana")}${scx("Han")}][\\u30ce\\u30f3\\u30bd\\u30be\\u4e36\\u4e40\\u4e41\\u4e3f]`,
    `[\\u30ce\\u30f3\\u30bd\\u30be\\u4e36\\u4e40\\u4e41\\u4e3f][^${scx("Katakana")}${scx("Hiragana")}${scx("Han")}]`,
    `^[${scx("Katakana")}]+[\\u3078-\\u307a][${scx("Katakana")}]+$`,
    `^[${scx("Hiragana")}]+[\\u30d8-\\u30da][${scx("Hiragana")}]+$`,
    `[^${scx("Katakana")}${scx("Hiragana")}]\\u30fc|^\\u30fc`,
    `[^${scx("Katakana")}][\\u30fd\\u30fe]|^[\\u30fd\\u30fe]`,
    "[a-z]\\u30fb|\\u30fb[a-z]",
    `[^${scx("Han")}]\\u4e00|\\u4e00[^${scx("Han")}]`,
    `[^${scx("Bopomofo")}]\\u3127|\\u3127[^${scx("Bopomofo")}]`,
    `[^${scx("Latin")}${scx("Greek")}${scx("Cyrillic")}][\\u0300-\\u0339]`,
    "\\u0131[\\u0300-\\u0339]",
    "[ijl\\u0131]\\u0307",
    "[a-z][\\u0585\\u0581]|[\\u0585\\u0581][a-z]",
    `[${scx("Armenian")}][og]|[og][${scx("Armenian")}]`,
    `[^${scx("Arabic")}][\\u064b-\\u0652\\u0670]`,
    `[^${scx("Hebrew")}]\\u05b4`,
  ].join("|"),
  "u",
);

                         
             
                         
               
                  
                  
                        
                          
                     
                     
                           
                        
                      
                         

function labelSpoofReason(label        , tld        )                     {
  const chars = Array.from(label);
  if (!chars.length) return "invalid";
  if (!chars.every(isAllowed)) return "disallowedCharacter";
  for (let i = 1; i < chars.length; i++) if (chars[i] === chars[i - 1] && /\p{M}/u.test(chars[i] )) return "invisible";
  if (digitSystems(chars).size > 1) return "mixedNumbers";
  const level = restrictionLevel(chars);
  if (level === "minimal") return "mixedScripts";
  if (DEVIATIONS.test(label)) return "deviationCharacter";
  if (chars.length > 1 && tld !== "is" && /[þð]/u.test(label)) return "tldSpecificCharacter";
  if (chars.length > 1 && tld !== "az" && label.includes("ə")) return "tldSpecificCharacter";
  if (label.includes("·") && (tld !== "cat" || /[^l]·|·[^l]|^·|·$/u.test(label))) return "unsafeMiddleDot";
  if (level === "ascii") return null;
  if (DIGIT_LOOKALIKES.test(label) && chars.every((c) => /[0-9]/.test(c) || DIGIT_LOOKALIKES.test(c))) return "digitLookalikes";
  if (level === "single" && !KANA_EXCEPTIONS.test(label) && !COMBINING_DIACRITICS.test(label)) {
    const unicodeTld = decodeLabel(tld) ?? tld;
    for (const { script, lookalikes, tlds } of WHOLE_SCRIPT_CONFUSABLES) {
      const letters = chars.filter((c) => script.test(c));
      if (!letters.length || !letters.every((c) => lookalikes.test(c))) continue;
      const tldUsesScript = Array.from(unicodeTld).every((c) => script.test(c));
      if (!tlds.includes(tld) && !tldUsesScript) return "wholeScriptConfusable";
    }
    return null;
  }
  if (NON_ASCII_LATIN.test(label) && !LGC_OR_ASCII.test(label)) return "nonAsciiLatinMixed";
  if (DANGEROUS.test(label)) return "dangerousPattern";
  return null;
}

function decodeLabel(label        )                {
  if (!/^xn--/i.test(label)) return null;
  const ascii = label.slice(4).toLowerCase();
  const unicode = punycodeDecode(ascii);
  if (!unicode || /^[\x00-\x7f]*$/.test(unicode)) return null;
  if (unicode.normalize("NFC") !== unicode || unicode.toLowerCase() !== unicode || punycodeEncode(unicode) !== ascii) return null;
  return unicode;
}

const TOP_DOMAINS = (
  "google.com youtube.com facebook.com instagram.com twitter.com x.com whatsapp.com wikipedia.org amazon.com " +
  "apple.com icloud.com microsoft.com live.com outlook.com office.com bing.com linkedin.com netflix.com yahoo.com " +
  "reddit.com tiktok.com github.com gitlab.com paypal.com ebay.com dropbox.com adobe.com spotify.com twitch.tv " +
  "discord.com slack.com zoom.us notion.so figma.com openai.com chatgpt.com anthropic.com claude.ai stripe.com " +
  "shopify.com coinbase.com binance.com kraken.com blockchain.com metamask.io chase.com bankofamerica.com " +
  "wellsfargo.com citi.com americanexpress.com capitalone.com hsbc.com barclays.co.uk santander.com revolut.com " +
  "wise.com venmo.com cash.app booking.com airbnb.com expedia.com uber.com lyft.com doordash.com walmart.com " +
  "target.com bestbuy.com costco.com etsy.com aliexpress.com alibaba.com temu.com shein.com baidu.com qq.com " +
  "weibo.com yandex.ru vk.com mail.ru ok.ru naver.com kakao.com line.me rakuten.co.jp yahoo.co.jp amazon.co.jp " +
  "amazon.co.uk amazon.de amazon.fr amazon.in bbc.co.uk bbc.com cnn.com nytimes.com theguardian.com " +
  "washingtonpost.com wsj.com bloomberg.com reuters.com forbes.com medium.com substack.com wordpress.com " +
  "blogger.com tumblr.com pinterest.com quora.com stackoverflow.com imdb.com steampowered.com steamcommunity.com " +
  "epicgames.com roblox.com playstation.com xbox.com nintendo.com ea.com battle.net salesforce.com atlassian.com " +
  "trello.com asana.com canva.com docusign.com okta.com cloudflare.com godaddy.com squarespace.com wix.com " +
  "mozilla.org duckduckgo.com proton.me protonmail.com gmail.com googledrive.com fedex.com ups.com usps.com dhl.com " +
  "irs.gov gov.uk"
).split(" ");

const CONFUSABLES                         = {
  ø: "o", đ: "d", ħ: "h", ı: "i", ł: "l", ŧ: "t", ð: "d", þ: "p", ə: "e", ß: "ss", œ: "oe", æ: "ae",
  а: "a", в: "b", е: "e", з: "3", и: "u", к: "k", м: "m", н: "h", о: "o", п: "n", р: "p", с: "c", т: "t", у: "y",
  х: "x", ь: "b", ѕ: "s", і: "i", ј: "j", ԁ: "d", һ: "h", ӏ: "l", ԛ: "q", ԝ: "w", ҽ: "e", ѵ: "v", ѡ: "w", г: "r",
  α: "a", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w", ϲ: "c",
  օ: "o", ս: "u", հ: "h", ց: "g", ք: "p", զ: "q", ո: "n",
  "0": "o", "1": "l", m: "rn", w: "vv",
};

function skeleton(text        )         {
  return Array.from(text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(), (c) => CONFUSABLES[c] ?? c).join("");
}

let topSkeletons                             = null;

function similarTopDomain(host        )                {
  topSkeletons ??= new Map(TOP_DOMAINS.map((d) => [skeleton(d), d]));
  const bare = host.replace(/^www\./, "").replace(/\.$/, "");
  const labels = bare.split(".");
  for (const candidate of [bare, labels.slice(-2).join("."), labels.slice(-3).join(".")]) {
    const match = topSkeletons.get(skeleton(candidate));
    if (match && match !== candidate) return match;
  }
  return null;
}

const cache = new Map                ();

function displayHost(host        )         {
  if (!/(^|\.)xn--/i.test(host)) return host;
  const cached = cache.get(host);
  if (cached !== undefined) return cached;
  const labels = host.toLowerCase().split(".");
  const tld = labels[labels.length - 1] || labels[labels.length - 2] || "";
  let changed = false;
  const shown = labels.map((label) => {
    const unicode = decodeLabel(label);
    if (!unicode || labelSpoofReason(unicode, tld)) return label;
    changed = true;
    return unicode;
  });
  let result = changed ? shown.join(".") : host;
  if (changed && similarTopDomain(result)) result = host;
  if (cache.size > 500) cache.clear();
  cache.set(host, result);
  return result;
}

function hostSpoofReason(host        )                     {
  const labels = host.toLowerCase().split(".");
  const tld = labels[labels.length - 1] || "";
  for (const label of labels) {
    if (!/^xn--/.test(label)) continue;
    const unicode = decodeLabel(label);
    if (!unicode) return "invalid";
    const reason = labelSpoofReason(unicode, tld);
    if (reason) return reason;
  }
  return displayHost(host) === host && /(^|\.)xn--/.test(host.toLowerCase()) ? "topDomainLookalike" : null;
}

});
__define("packages/core/src/tlds.ts", function (exports, __require) {
  __export(exports, "PSL_TLDS", () => PSL_TLDS);
// Generated from Chromium's net/base/registry_controlled_domains/effective_tld_names.dat (ICANN section, the last label of every
// rule): the registries Chrome's AutocompleteInput::Parse counts as a "known TLD". Unicode TLDs are as the PSL spells them.
const PSL_TLDS =
`aaa aarp abb abbott abbvie abc able abogado abudhabi ac academy accenture accountant accountants aco actor ad ads
adult ae aeg aero aetna af afl africa ag agakhan agency ai aig airbus airforce airtel akdn al alibaba alipay allfinanz
allstate ally alsace alstom am amazon americanexpress americanfamily amex amfam amica amsterdam analytics android
anquan anz ao aol apartments app apple aq aquarelle ar arab aramco archi army arpa art arte as asda asia associates at
athleta attorney au auction audi audible audio auspost author auto autos aw aws ax axa az azure ba baby baidu banamex
band bank bar barcelona barclaycard barclays barefoot bargains baseball basketball bauhaus bayern bb bbc bbt bbva bcg
bcn bd be beats beauty beer berlin best bestbuy bet bf bg bh bharti bi bible bid bike bing bingo bio biz bj black
blackfriday blockbuster blog bloomberg blue bm bms bmw bn bnpparibas bo boats boehringer bofa bom bond boo book
booking bosch bostik boston bot boutique box br bradesco bridgestone broadway broker brother brussels bs bt build
builders business buy buzz bv bw by bz bzh ca cab cafe cal call calvinklein cam camera camp canon capetown capital
capitalone car caravan cards care career careers cars casa case cash casino cat catering catholic cba cbn cbre cc cd
center ceo cern cf cfa cfd cg ch chanel channel charity chase chat cheap chintai christmas chrome church ci cipriani
circle cisco citadel citi citic city ck cl claims cleaning click clinic clinique clothing cloud club clubmed cm cn co
coach codes coffee college cologne com commbank community company compare computer comsec condos construction
consulting contact contractors cooking cool coop corsica country coupon coupons courses cpa cr credit creditcard
creditunion cricket crown crs cruise cruises cu cuisinella cv cw cx cy cymru cyou cz dad dance data date dating datsun
day dclk dds de deal dealer deals degree delivery dell deloitte delta democrat dental dentist desi design dev dhl
diamonds diet digital direct directory discount discover dish diy dj dk dm dnp do docs doctor dog domains dot download
drive dtv dubai dupont durban dvag dvr dz earth eat ec eco edeka edu education ee eg email emerck energy engineer
engineering enterprises epson equipment er ericsson erni es esq estate et eu eurovision eus events exchange expert
exposed express extraspace fage fail fairwinds faith family fan fans farm farmers fashion fast fedex feedback ferrari
ferrero fi fidelity fido film final finance financial fire firestone firmdale fish fishing fit fitness fj fk flickr
flights flir florist flowers fly fm fo foo food football ford forex forsale forum foundation fox fr free fresenius frl
frogans frontier ftr fujitsu fun fund furniture futbol fyi ga gal gallery gallo gallup game games gap garden gay gb
gbiz gd gdn ge gea gent genting george gf gg ggee gh gi gift gifts gives giving gl glass gle global globo gm gmail
gmbh gmo gmx gn godaddy gold goldpoint golf goodyear goog google gop got gov gp gq gr grainger graphics gratis green
gripe grocery group gs gt gu gucci guge guide guitars guru gw gy hair hamburg hangout haus hbo hdfc hdfcbank health
healthcare help helsinki here hermes hiphop hisamitsu hitachi hiv hk hkt hm hn hockey holdings holiday homedepot
homegoods homes homesense honda horse hospital host hosting hot hotel hotels hotmail house how hr hsbc ht hu hughes
hyatt hyundai ibm icbc ice icu id ie ieee ifm ikano il im imamat imdb immo immobilien in inc industries infiniti info
ing ink institute insurance insure int international intuit investments io ipiranga iq ir irish is ismaili ist
istanbul it itau itv jaguar java jcb je jeep jetzt jewelry jio jll jm jmp jnj jo jobs joburg jot joy jp jpmorgan jprs
juegos juniper kaufen kddi ke kerryhotels kerryproperties kfh kg kh ki kia kids kim kindle kitchen kiwi km kn koeln
komatsu kosher kp kpmg kpn kr krd kred kuokgroup kw ky kyoto kz la lacaixa lamborghini lamer land landrover lanxess
lasalle lat latino latrobe law lawyer lb lc lds lease leclerc lefrak legal lego lexus lgbt li lidl life lifeinsurance
lifestyle lighting like lilly limited limo lincoln link live living lk llc llp loan loans locker locus lol london
lotte lotto love lpl lplfinancial lr ls lt ltd ltda lu lundbeck luxe luxury lv ly ma madrid maif maison makeup man
management mango map market marketing markets marriott marshalls mattel mba mc mckinsey md me med media meet melbourne
meme memorial men menu merck merckmsd mg mh miami microsoft mil mini mint mit mitsubishi mk ml mlb mls mm mma mn mo
mobi mobile moda moe moi mom monash money monster mormon mortgage moscow moto motorcycles mov movie mp mq mr ms msd mt
mtn mtr mu museum music mv mw mx my mz na nab nagoya name navy nba nc ne nec net netbank netflix network neustar new
news next nextdirect nexus nf nfl ng ngo nhk ni nico nike nikon ninja nissan nissay nl no nokia norton now nowruz
nowtv np nr nra nrw ntt nu nyc nz obi observer office okinawa olayan olayangroup ollo om omega one ong onion onl
online ooo open oracle orange org organic origins osaka otsuka ott ovh pa page panasonic paris pars partners parts
party pay pccw pe pet pf pfizer pg ph pharmacy phd philips phone photo photography photos physio pics pictet pictures
pid pin ping pink pioneer pizza pk pl place play playstation plumbing plus pm pn pnc pohl poker politie porn post pr
praxi press prime pro prod productions prof progressive promo properties property protection pru prudential ps pt pub
pw pwc py qa qpon quebec quest racing radio re read realestate realtor realty recipes red redumbrella rehab reise
reisen reit reliance ren rent rentals repair report republican rest restaurant review reviews rexroth rich richardli
ricoh ril rio rip ro rocks rodeo rogers room rs rsvp ru rugby ruhr run rw rwe ryukyu sa saarland safe safety sakura
sale salon samsclub samsung sandvik sandvikcoromant sanofi sap sarl sas save saxo sb sbi sbs sc scb schaeffler schmidt
scholarships school schule schwarz science scot sd se search seat secure security seek select sener services seven sew
sex sexy sfr sg sh shangrila sharp shell shia shiksha shoes shop shopping shouji show si silk sina singles site sj sk
ski skin sky skype sl sling sm smart smile sn sncf so soccer social softbank software sohu solar solutions song sony
soy spa space sport spot sr srl ss st stada staples star statebank statefarm stc stcgroup stockholm storage store
stream studio study style su sucks supplies supply support surf surgery suzuki sv swatch swiss sx sy sydney systems sz
tab taipei talk taobao target tatamotors tatar tattoo tax taxi tc tci td tdk team tech technology tel temasek tennis
teva tf tg th thd theater theatre tiaa tickets tienda tips tires tirol tj tjmaxx tjx tk tkmaxx tl tm tmall tn to today
tokyo tools top toray toshiba total tours town toyota toys tr trade trading training travel travelers
travelersinsurance trust trv tt tube tui tunes tushu tv tvs tw tz ua ubank ubs ug uk unicom university uno uol ups us
uy uz va vacations vana vanguard vc ve vegas ventures verisign versicherung vet vg vi viajes video vig viking villas
vin vip virgin visa vision viva vivo vlaanderen vn vodka volvo vote voting voto voyage vu wales walmart walter wang
wanggou watch watches weather weatherchannel webcam weber website wed wedding weibo weir wf whoswho wien wiki
williamhill win windows wine winners wme woodside work works world wow ws wtc wtf xbox xerox xihuan xin xxx xyz yachts
yahoo yamaxun yandex ye yodobashi yoga yokohama you youtube yt yun za zappos zara zero zip zm zone zuerich zw
vermögensberater vermögensberatung ελ ευ бг бел дети ею католик ком мкд мон москва онлайн орг рус рф сайт срб укр қаз
հայ ישראל קום ابوظبي ارامكو الاردن البحرين الجزائر السعودية السعوديه السعودیة السعودیۃ العليان المغرب اليمن امارات
ايران ایران بارت بازار بيتك بھارت تونس سودان سوريا سورية شبكة عراق عرب عمان فلسطين قطر كاثوليك كوم مصر مليسيا
موريتانيا موقع همراه پاكستان پاکستان ڀارت कॉम नेट भारत भारतम् भारोत संगठन বাংলা ভারত ভাৰত ਭਾਰਤ ભારત ଭାରତ இந்தியா
இலங்கை சிங்கப்பூர் భారత్ ಭಾರತ ഭാരതം ලංකා คอม ไทย ລາວ გე みんな アマゾン クラウド グーグル コム ストア セール ファッション ポイント 世界 中信 中国 中國 中文网 亚马逊
企业 佛山 信息 健康 八卦 公司 公益 台湾 台灣 商城 商店 商标 嘉里 嘉里大酒店 在线 大拿 天主教 娱乐 家電 广东 微博 慈善 我爱你 手机 招聘 政务 政府 新加坡 新闻 时尚 書籍 机构 淡马锡 游戏 澳門 澳门 点看
移动 组织机构 网址 网店 网站 网络 联通 臺灣 谷歌 购物 通販 集团 電訊盈科 飞利浦 食品 餐厅 香格里拉 香港 닷넷 닷컴 삼성 한국`;

});
__define("packages/core/src/extensionRows.ts", function (exports, __require) {
  __export(exports, "extensionSuggestions", () => extensionSuggestions);
const { matchActions } = __require("packages/core/src/fuzzy.ts");
                                               

                                  
             
                
                      
                  
                   
  

                                                                   

const NONE                = { rows: [], exact: false };
const MIN_PARTIAL_QUERY = 3;
const MIN_SCORE = 50;

function extensionSuggestions(query        , extensions                               , limit = 2)                {
  if (!extensions.length) return NONE;
  const q = query.trim();
  const matches = matchActions(q, extensions, limit).filter((m) => m.exact || (q.length >= MIN_PARTIAL_QUERY && m.score >= MIN_SCORE));
  if (!matches.length) return NONE;
  const rows               = [];
  matches.forEach(({ action: x }, i) => {
    if (x.action) rows.push({ kind: "extension", id: x.id, title: x.title, icon: x.icon, open: "action" });
    if (x.options && (i === 0 || !x.action)) rows.push({ kind: "extension", id: x.id, title: x.title, icon: x.icon, open: "options" });
  });
  return rows.length ? { rows, exact: matches[0] .exact } : NONE;
}

});
__define("packages/core/src/fuzzy.ts", function (exports, __require) {
  __export(exports, "fuzzyScore", () => fuzzyScore);
  __export(exports, "matchActions", () => matchActions);
                                                                                          

                                                      
            
                
                 
  

const words = (text        ) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function isSubsequence(needle        , haystack        )          {
  let from = 0;
  for (let i = 0; i < needle.length; i++) {
    const at = haystack.indexOf(needle[i] , from);
    if (at < 0) return false;
    from = at + 1;
  }
  return true;
}

function fuzzyScore(query        , text        )         {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t === q) return 1000;
  const tw = words(t);
  let score = t.startsWith(q) ? 200 : 0;
  for (const token of words(q)) {
    const i = tw.findIndex((w) => w.startsWith(token));
    if (i >= 0) score += 60 + token.length * 4 - i * 2;
    else if (token.length >= 3 && t.includes(token)) score += 25 + token.length;
    else if (token.length >= 2 && isSubsequence(token, t.replace(/[^a-z0-9]/g, ""))) score += 8;
    else return 0;
  }
  return score - tw.length;
}

                                                               

function nameOf(text        )       {
  const lower = text.toLowerCase();
  return { lower, words: words(lower) };
}

                                                                                                                   
const prepared = new WeakMap                                        ();

function preparedNames(actions                            )             {
  let list = prepared.get(actions);
  if (!list) prepared.set(actions, (list = []));
  for (let a = 0; a < actions.length; a++) {
    const action = actions[a] ;
    let p = list[a];
    if (!p || p.action !== action || p.title !== action.title || p.keywords !== action.keywords) {
      p = list[a] = { action, title: action.title, keywords: action.keywords, names: [action.title, ...(action.keywords ?? [])].map(nameOf) };
    }
  }
  list.length = actions.length;
  return list;
}

function scoreName(q        , tokens                   , n      )         {
  const t = n.lower;
  if (t === q) return 1000;
  const tw = n.words;
  let score = t.startsWith(q) ? 200 : 0;
  for (const token of tokens) {
    let i = 0;
    while (i < tw.length && !tw[i] .startsWith(token)) i++;
    if (i < tw.length) score += 60 + token.length * 4 - i * 2;
    else if (token.length >= 3 && t.includes(token)) score += 25 + token.length;
    else if (token.length >= 2 && isSubsequence(token, (n.plain ??= t.replace(/[^a-z0-9]/g, "")))) score += 8;
    else return 0;
  }
  return score - tw.length;
}

function matchActions                           (query        , actions              , limit = 3)                   {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (q.length < 2) return [];
  const tokens = words(q);
  const names = preparedNames(actions);
  const hits                   = [];
  for (let a = 0; a < actions.length; a++) {
    const list = names[a] .names;
    let score = -Infinity;
    let exact = false;
    for (let i = 0; i < list.length; i++) {
      const n = list[i] ;
      if (n.lower === q) exact = true;
      const s = scoreName(q, tokens, n) - (i > 0 ? 5 : 0);
      if (s > score) score = s;
    }
    if (score > 0) hits.push({ action: actions[a] , score, exact });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

});
__define("packages/core/src/openTabs.ts", function (exports, __require) {
  __export(exports, "recentTabSuggestions", () => recentTabSuggestions);
                                               

                                                                                                                  

function recentTabSuggestions(tabs                       , options                                       = {})               {
  const { exclude, limit = 8 } = options;
  return tabs
    .filter((t) => t.url && t.id !== exclude)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, limit)
    .map((t) => ({ kind: "page", url: t.url, title: t.title, favicon: t.favicon, tabId: t.id }));
}

});
__define("packages/core/src/quickCreate.ts", function (exports, __require) {
  __export(exports, "matchQuickCreate", () => matchQuickCreate);
                           
             
                
              
                             
               
  

const QUICK_CREATE                         = [
  { id: "doc", title: "New Google Doc", url: "https://docs.new", aliases: ["doc", "docs", "document", "google doc", "gdoc"], site: "docs.google.com" },
  { id: "sheet", title: "New Google Sheet", url: "https://sheets.new", aliases: ["sheet", "sheets", "spreadsheet", "google sheet"], site: "sheets.google.com" },
  { id: "slides", title: "New Google Slides", url: "https://slides.new", aliases: ["slides", "slide", "presentation", "deck", "google slides"], site: "slides.google.com" },
  { id: "form", title: "New Google Form", url: "https://forms.new", aliases: ["form", "forms", "survey", "google form"], site: "forms.google.com" },
  { id: "meeting", title: "New Google Calendar Event", url: "https://meeting.new", aliases: ["meeting", "event", "calendar", "invite"], site: "calendar.google.com" },
  { id: "meet", title: "New Google Meet", url: "https://meet.new", aliases: ["meet", "call", "video call", "google meet"], site: "meet.google.com" },
  { id: "notion", title: "New Notion Page", url: "https://notion.new", aliases: ["notion", "note", "page", "notion page"], site: "notion.so" },
  { id: "linear", title: "New Linear Issue", url: "https://linear.new", aliases: ["linear", "issue", "ticket", "linear issue"], site: "linear.app" },
  { id: "jira", title: "New Jira Issue", url: "https://jira.new", aliases: ["jira", "ticket", "issue", "jira issue"], site: "atlassian.com" },
  { id: "confluence", title: "New Confluence Page", url: "https://confluence.new", aliases: ["wiki", "confluence", "confluence page"], site: "atlassian.com" },
  { id: "gist", title: "New GitHub Gist", url: "https://gist.new", aliases: ["gist", "snippet", "github gist"], site: "github.com" },
  { id: "repo", title: "New GitHub Repository", url: "https://repo.new", aliases: ["repo", "repository", "github repo"], site: "github.com" },
  { id: "figma", title: "New Figma Design", url: "https://figma.new", aliases: ["figma", "design", "figma design"], site: "figma.com" },
  { id: "figjam", title: "New FigJam Board", url: "https://figjam.new", aliases: ["figjam", "whiteboard", "board"], site: "figma.com" },
  { id: "word", title: "New Word Document", url: "https://word.new", aliases: ["word", "word document"], site: "word.cloud.microsoft" },
  { id: "excel", title: "New Excel Workbook", url: "https://excel.new", aliases: ["excel", "workbook"], site: "excel.cloud.microsoft" },
  { id: "powerpoint", title: "New PowerPoint Presentation", url: "https://powerpoint.new", aliases: ["powerpoint", "ppt"], site: "powerpoint.cloud.microsoft" },
];

function matchQuickCreate(query        , limit = 3)                {
  const m = /^(?:new|create)(\s+(.*))?$/i.exec(query.trimStart());
  if (!m || !m[1]) return [];
  const rest = (m[2] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!rest) return QUICK_CREATE.slice(0, limit);
  const rank = (c             ) => (c.aliases.includes(rest) ? 0 : c.aliases.some((a) => a.startsWith(rest)) ? 1 : Infinity);
  return QUICK_CREATE.map((c, order) => ({ c, r: rank(c), order }))
    .filter((x) => x.r !== Infinity)
    .sort((a, b) => a.r - b.r || a.order - b.order)
    .slice(0, limit)
    .map((x) => x.c);
}

});
__define("packages/core/src/siteSearch.ts", function (exports, __require) {
  __export(exports, "findScope", () => findScope);
  __export(exports, "scopedSearchUrl", () => scopedSearchUrl);
  __export(exports, "offeredSiteSearch", () => offeredSiteSearch);
  __export(exports, "keywordBySpace", () => keywordBySpace);
  __export(exports, "asksForBackspace", () => asksForBackspace);
  __export(exports, "siteSearchKey", () => siteSearchKey);
const { engineHost, searchUrl } = __require("packages/core/src/engines.ts");
const { hostOf, searchUrlFor } = __require("packages/core/src/omnibox.ts");

                                                                     

const POPULAR_SITE_SEARCHES                        = [
  { host: "youtube.com", name: "YouTube", url: "https://www.youtube.com/results?search_query=%s" },
  { host: "wikipedia.org", name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=%s" },
  { host: "github.com", name: "GitHub", url: "https://github.com/search?q=%s" },
  { host: "amazon.com", name: "Amazon", url: "https://www.amazon.com/s?k=%s" },
  { host: "reddit.com", name: "Reddit", url: "https://www.reddit.com/search/?q=%s" },
  { host: "x.com", name: "X", url: "https://x.com/search?q=%s" },
  { host: "twitter.com", name: "X", url: "https://x.com/search?q=%s" },
  { host: "stackoverflow.com", name: "Stack Overflow", url: "https://stackoverflow.com/search?q=%s" },
  { host: "npmjs.com", name: "npm", url: "https://www.npmjs.com/search?q=%s" },
  { host: "maps.google.com", name: "Google Maps", url: "https://www.google.com/maps/search/%s" },
  { host: "drive.google.com", name: "Google Drive", url: "https://drive.google.com/drive/search?q=%s" },
  { host: "mail.google.com", name: "Gmail", url: "https://mail.google.com/mail/u/0/#search/%s" },
  { host: "imdb.com", name: "IMDb", url: "https://www.imdb.com/find/?q=%s" },
  { host: "open.spotify.com", name: "Spotify", url: "https://open.spotify.com/search/%s" },
  { host: "linkedin.com", name: "LinkedIn", url: "https://www.linkedin.com/search/results/all/?keywords=%s" },
  { host: "ebay.com", name: "eBay", url: "https://www.ebay.com/sch/i.html?_nkw=%s" },
  { host: "pinterest.com", name: "Pinterest", url: "https://www.pinterest.com/search/pins/?q=%s" },
  { host: "news.ycombinator.com", name: "Hacker News", url: "https://hn.algolia.com/?q=%s" },
  { host: "developer.mozilla.org", name: "MDN", url: "https://developer.mozilla.org/en-US/search?q=%s" },
  { host: "figma.com", name: "Figma", url: "https://www.figma.com/files/search?q=%s" },
  { host: "notion.so", name: "Notion", url: "https://www.notion.so/search?q=%s" },
  { host: "apps.apple.com", name: "App Store", url: "https://www.apple.com/us/search/%s?src=serp" },
  { host: "translate.google.com", name: "Google Translate", url: "https://translate.google.com/?text=%s" },
];

                           
                                      
               
               
              
                    
  

                            
                                   
                                
                            
  

function normalize(text        )         {
  return text.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

function siteLabel(host        )         {
  const parts = host.split(".");
  return parts.length >= 2 ? parts[parts.length - 2]  : host;
}

function findScope(text        , { engines, sites = POPULAR_SITE_SEARCHES, hosts = [] }              )                     {
  const t = normalize(text);
  if (!t || /\s/.test(t)) return null;
  const host = hostOf(`https://${t}`) || t;

  for (const e of engines) {
    if (e.custom && e.keyword.toLowerCase() === t) return engineScope(e);
  }
  for (const e of engines) {
    if (e.custom) continue;
    const eHost = engineHost(e);
    if (e.keyword.toLowerCase() === host || eHost === host || (t.length >= 3 && t === siteLabel(eHost))) return engineScope(e);
  }
  for (const s of sites) {
    if (s.host === host || host.endsWith(`.${s.host}`) || (t === host && t.length >= 3 && s.host.split(".").length === 2 && siteLabel(s.host) === t)) {
      return { kind: "site", name: s.name, host: s.host, url: s.url };
    }
  }
  if (host.includes(".") && hosts.includes(host)) return { kind: "history", name: host, host, url: "" };
  return null;
}

function engineScope(e              )              {
  return { kind: "engine", name: e.name, host: engineHost(e), url: e.url, engineId: e.id };
}

function scopedSearchUrl(scope             , query        , defaultEngine                           )         {
  if (scope.kind === "history") return searchUrl(defaultEngine, `site:${scope.host} ${query.trim()}`);
  return searchUrlFor(scope.url, query);
}

function offeredSiteSearch(typed        , completion        , sources              )                     {
  const t = typed.trim();
  if (!t || /\s/.test(t)) return null;
  return findScope(typed + completion, sources);
}

                                  
                
                     
                            
                              
                    
  

                                                                                                                    

                           
                                                       
                                   
                                     

                                                               

function keywordBySpace(typed        , next        )                        {
  if (!typed.trim() || /\s$/.test(typed) || next !== `${typed} `) return null;
  return { keyword: typed, from: next };
}

function asksForBackspace(scope                    )          {
  return !!scope;
}

function siteSearchKey(key        , modifiers                        , state                    )                       {
  const { shiftKey, altKey, metaKey, ctrlKey } = modifiers;
  if (key === "Tab" && !shiftKey && !ctrlKey) {
    if (!state.scope && state.offered) return { kind: "enter", scope: state.offered, from: state.typed + state.completion };
    if (state.completion) return { kind: "accept", text: state.typed + state.completion };
    return null;
  }
  const plain = !shiftKey && !altKey && !metaKey && !ctrlKey;
  if (key === "Backspace" && plain && state.scope) return { kind: "leave", text: state.scopeFrom };
  return null;
}

});
__define("packages/core/src/suggest.ts", function (exports, __require) {
  __export(exports, "displayUrl", () => displayUrl);
  __export(exports, "prepareSuggestions", () => prepareSuggestions);
  __export(exports, "suggestionKey", () => suggestionKey);
  __export(exports, "buildSuggestions", () => buildSuggestions);
const { findBang } = __require("packages/core/src/bangs.ts");
const { calculate } = __require("packages/core/src/calculator.ts");
const { extensionSuggestions } = __require("packages/core/src/extensionRows.ts");
const { BUILT_IN_ENGINES, searchUrl } = __require("packages/core/src/engines.ts");
const { matchActions } = __require("packages/core/src/fuzzy.ts");
const { fixupUrl, hostOf, urlForDisplay } = __require("packages/core/src/omnibox.ts");
const { matchQuickCreate } = __require("packages/core/src/quickCreate.ts");
const { scopedSearchUrl } = __require("packages/core/src/siteSearch.ts");

                                
                                                                                      
                                                                                                                
                                                                                
  

                                                                               

                        
     
                   
                  
                    
                             
                     
                           
                        
     
                                                                                                    
                                                                    
                                                                               
                                                                            
                                                                                                      

                                
                      
                     
  

                              
                 
               
                                              
                                    
                             
                                     
                                             
                        
                      
                             
                          
                           
  

function displayUrl(url        )         {
  return urlForDisplay(url).replace(/\/$/, "");
}

const DAY = 86_400_000;
const pageKey = (url        ) => url.replace(/#.*$/, "").replace(/\/$/, "");

                                                      
                                                                      
                                               

                 
              
              
                
                     
                     
                     
                      
                       
                
                         
                     
  

const pageTexts = new WeakMap                  ();

const logVisitsOf           = [];
const logVisits = (visits        ) => (visits >= 0 && visits < 1024 && (visits | 0) === visits ? (logVisitsOf[visits] ??= Math.log2(1 + visits) * 8) : Math.log2(1 + visits) * 8);

const NOT_WORD = /[^a-z0-9]+/g;
const PLAIN_WORDS = /^[a-z0-9]+(?: [a-z0-9]+)*$/;
const wordsOf = (lower        ) => (PLAIN_WORDS.test(lower) ? ` ${lower}` : ` ${lower}`.replace(NOT_WORD, " "));
const shownWordsOf = (t          ) => (t.shownWords ??= wordsOf(t.shownLower));

function pageText(row                                )           {
  let text = pageTexts.get(row);
  if (!text) {
    const shown = displayUrl(row.url);
    const shownLower = shown.toLowerCase();
    const titleLower = row.title.toLowerCase();
    text = { url: row.url, key: pageKey(row.url), shown, shownLower, titleLower, titleWords: wordsOf(titleLower) };
    pageTexts.set(row, text);
  }
  return text;
}

const hostOfPage = (t          ) => (t.host ??= hostOf(t.url));
const hostPart = (shown        ) => /^[^/?#]*/.exec(shown) [0];
const hostLowerOfPage = (t          ) => (t.hostLower ??= hostPart(t.shownLower));
const originOfPage = (t          ) => (t.origin === undefined ? (t.origin = /^https?:\/\/[^/?#]+/i.exec(t.url)?.[0] ?? null) : t.origin);

                  
              
                
                         
                 
                    
                    
                      
                 
                  
                 
  

                                                                                     
                                                 

                                                                                                                           
                
                     
                                 
                    
                                
                        
                         
                    
  

const bases = new WeakMap                                      ();
const builders = new WeakMap                                                                 ();
const NO_BOOKMARKS                         = [];
const historyCandidates = new WeakMap                       ();
const SLICE_CHECK = 64;

function baseFor(bookmarks                        )               {
  let base = bases.get(bookmarks);
  if (!base) bases.set(bookmarks, (base = { list: [], byKey: new Map(), keys: new Set(), cursor: 0, done: false }));
  return base;
}

function advance(b         , bookmarks                        , deadline        )          {
  if (b.pool) return true;
  let n = 0;
  const late = () => ++n % SLICE_CHECK === 0 && Date.now() > deadline;
  const base = b.base;
  while (!base.done && base.cursor < bookmarks.length) {
    const row = bookmarks[base.cursor++] ;
    const text = pageText(row);
    base.keys.add(text.key);
    if (!base.byKey.has(text.key)) {
      const c            = { url: row.url, title: row.title, favicon: row.favicon, visits: 0, lastVisit: 0, logVisits: 0, bookmarked: true, text };
      base.list.push(c);
      base.byKey.set(text.key, c);
    }
    if (late()) return false;
  }
  base.done = true;
  while (b.historyCursor < b.history.length) {
    const h = b.history[b.historyCursor++] ;
    const text = pageText(h);
    if (!b.byKey.has(text.key)) {
      const bookmarked = base.keys.has(text.key);
      let c = historyCandidates.get(h);
      if (!c || c.bookmarked !== bookmarked) {
        c = { url: h.url, title: h.title, favicon: h.favicon, visits: h.visits, lastVisit: h.lastVisit, logVisits: logVisits(h.visits), bookmarked, text };
        historyCandidates.set(h, c);
      }
      b.list.push(c);
      b.byKey.set(text.key, c);
    }
    if (late()) return false;
  }
  while (b.bookmarkCursor < base.list.length) {
    const c = base.list[b.bookmarkCursor++] ;
    if (!b.byKey.has(c.text.key)) b.list.push(c);
    if (late()) return false;
  }
  const history = b.byKey;
  b.pool = {
    list: b.list,
    byKey: { get: (key) => history.get(key) ?? base.byKey.get(key), has: (key) => history.has(key) || base.byKey.has(key) },
  };
  return true;
}

function builderFor(history                       , bookmarks                        )          {
  let byBookmarks = builders.get(history);
  if (!byBookmarks) builders.set(history, (byBookmarks = new WeakMap()));
  let b = byBookmarks.get(bookmarks);
  if (!b) byBookmarks.set(bookmarks, (b = { base: baseFor(bookmarks), history, list: [], byKey: new Map(), historyCursor: 0, bookmarkCursor: 0, pool: null }));
  return b;
}

function poolFor(history                       , bookmarks                        )       {
  const b = builderFor(history, bookmarks);
  advance(b, bookmarks, Infinity);
  return b.pool ;
}

function prepareSuggestions(source                  , deadline        )          {
  const bookmarks = source.bookmarks ?? NO_BOOKMARKS;
  const b = builderFor(source.history, bookmarks);
  if (b.pool) return true;
  for (const rows of [source.history, bookmarks]) {
    let n = 0;
    for (const row of rows) {
      if (pageTexts.has(row)) continue;
      pageText(row);
      if (++n % SLICE_CHECK === 0 && Date.now() > deadline) return false;
    }
  }
  return advance(b, bookmarks, deadline);
}

                                                                                                                                  
const tabsOverCache = new WeakMap                             ();

function tabsOver(pool      , tabs                   , currentTabId         )           {
  const cached = tabsOverCache.get(tabs);
  if (cached && cached.pool === pool && cached.currentTabId === currentTabId && cached.rows.length === tabs.length) {
    let same = true;
    for (let i = 0; same && i < tabs.length; i++) same = cached.rows[i] === tabs[i];
    if (same) return cached;
  }
  const tabIds = new Map                ();
  const extra              = [];
  for (const t of tabs) {
    if (!t.url || t.id === currentTabId) continue;
    const text = pageText(t);
    if (tabIds.has(text.key)) continue;
    tabIds.set(text.key, t.id);
    if (!pool.byKey.has(text.key)) extra.push({ url: t.url, title: t.title, favicon: t.favicon, visits: 0, lastVisit: 0, logVisits: 0, fresh: true, bookmarked: false, tabId: t.id, text });
  }
  const result = { pool, currentTabId, rows: tabs.slice(), tabIds, extra };
  tabsOverCache.set(tabs, result);
  return result;
}

              
            
                                         
                
                 
                                                            
                 
  

const WORD = /^[a-z0-9]+$/;

function parseQuery(q        , tokens                   )        {
  return {
    q,
    segmentStarts: /[./]/.test(q) ? null : [`.${q}`, `/${q}`],
    word: WORD.test(q),
    spaced: ` ${q}`,
    tokens: tokens.map((text) => ({ text, word: WORD.test(text), spaced: ` ${text}` })),
    needle: tokens.reduce((a, b) => (b.length > a.length ? b : a), ""),
  };
}

function matchScore(t          , query       )         {
  const shown = t.shownLower;
  const title = t.titleLower;
  const { q } = query;
  if (!shown.includes(query.needle) && !title.includes(query.needle)) return 0;
  let s = 0;
  if ((t.shownBlank ??= /\s/.test(shown))) {
    const seg = query.segmentStarts;
    if (shown.startsWith(q)) s = 100;
    else if (seg && (shown.includes(seg[0]) || shown.includes(seg[1]))) s = 60;
    else if (shown.includes(q)) s = 30;
  }
  const ti = title.indexOf(q);
  if (ti === 0) s += 40;
  else if (ti > 0) s += 20;
  if (s > 0) return s;
  for (const token of query.tokens) {
    if (token.word && t.titleWords.includes(token.spaced)) s += 15;
    else if (token.word && shownWordsOf(t).includes(token.spaced)) s += 10;
    else if (token.text.length >= 3 && (title.includes(token.text) || shown.includes(token.text))) s += 5;
    else return 0;
  }
  return s;
}

function matchScoreWord(t          , query       )         {
  const shown = t.shownLower;
  const title = t.titleLower;
  const q = query.q;
  const si = shown.indexOf(q);
  const ti = title.indexOf(q);
  if (si < 0 && ti < 0) return 0;
  let s = 0;
  if (si === 0) s = 100;
  else if (si > 0) {
    const seg = query.segmentStarts;
    if (seg && (shown.includes(seg[0]) || shown.includes(seg[1]))) s = 60;
    else if (q.length >= 2) s = 30;
  }
  if (ti === 0) s += 40;
  else if (q.length >= 2 ? ti > 0 : query.word && t.titleWords.includes(query.spaced)) s += 20;
  return s;
}

                                                                                     
const MATCHED_KEPT = 8;
let matchedChain                                  = { pool: null                   , list: [] };

function narrowing(pool      , q        , tokens                   )                 {
  const chain = matchedChain;
  if (chain.pool !== pool) return null;
  for (let k = chain.list.length - 1; k >= 0; k--) {
    const last = chain.list[k] ;
    if (!q.startsWith(last.q)) continue;
    const i = last.tokens.length - 1;
    const word = last.tokens[i] ;
    if (i === 0 || word === tokens[i] || word.length >= 3) return last;
  }
  return null;
}

function remember(pool      , q        , tokens          , pages             , scores          ) {
  let chain = matchedChain;
  if (chain.pool !== pool) matchedChain = chain = { pool, list: [] };
  const list = chain.list;
  while (list.length && !q.startsWith(list[list.length - 1] .q)) list.pop();
  if (q.length < 2) {
    list.length = 0;
    return;
  }
  if (list.length && list[list.length - 1] .q === q) list.pop();
  list.push({ q, tokens, pages, scores });
  if (list.length > MATCHED_KEPT) list.shift();
}

                                                                                

class TopList {
           items           = [];
  floor = -Infinity;
                   size        ;
  constructor(size        ) {
    this.size = size;
  }
  offer(r        ) {
    const items = this.items;
    if (items.length === this.size && items[items.length - 1] .s >= r.s) return;
    let i = items.length;
    while (i > 0 && items[i - 1] .s < r.s) i--;
    items.splice(i, 0, r);
    if (items.length > this.size) items.pop();
    if (items.length === this.size) this.floor = items[items.length - 1] .s;
  }
}

const pageSuggestion = (c           , tabId                            = c.tabId)             => ({
  kind: "page",
  url: c.url,
  title: c.title,
  favicon: c.favicon,
  ...(tabId ? { tabId } : {}),
  ...(c.bookmarked ? { bookmarked: true } : {}),
  ...(c.visits > 0 ? { visited: true } : {}),
});

function suggestionKey(s            )         {
  switch (s.kind) {
    case "page":
      return `${s.tabId ? "tab" : "page"}:${pageKey(s.url)}`;
    case "search":
      return `search:${s.url}`;
    case "calc":
      return `calc:${s.expression}`;
    case "action":
      return `action:${s.id}`;
    case "create":
      return `create:${s.id}`;
    case "extension":
      return `extension:${s.open}:${s.id}`;
  }
}

function buildSuggestions(raw        , source                  , options                 = {})                   {
  const { limit = 8, now = Date.now(), engine = BUILT_IN_ENGINES[0] , preference = "website", remote = [], actions = [], scope, preventInline = false } = options;
  const query = raw.trim();
  if (!query) return { items: [], completion: "" };
  const bare = query[0] === "h" || query[0] === "H" ? query.replace(/^https?:\/\/(?=\S)/i, "") : query;
  const q = bare.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  const bang = scope ? null : findBang(query, options.bangs);
  if (bang) return bangSuggestions(bang, source, options, limit);

  if (!scope && query.startsWith("?")) {
    const text = query.slice(1).trim();
    if (!text) return { items: [], completion: "" };
    const out = new Output(limit);
    out.push({ kind: "search", query: text, url: searchUrl(engine, text), engine: engine.name });
    out.push(...dedupeSuggestions(remote, text).slice(0, 4).map((t)             => ({ kind: "search", query: t, url: searchUrl(engine, t), engine: engine.name, suggested: true })));
    return { items: out.items, completion: "" };
  }

  const pool = poolFor(source.history, source.bookmarks ?? NO_BOOKMARKS);
  const { tabIds, extra } = tabsOver(pool, source.tabs, options.currentTabId);
  const currentKey = options.currentUrl ? pageKey(options.currentUrl) : null;
  const known = (url        ) => {
    const key = pageKey(url);
    const c = pool.byKey.get(key) ?? extra.find((x) => x.text.key === key);
    return c && pageSuggestion(c, null);
  };

  const websiteFirst = preference === "website";
  const oneWord = tokens.length === 1;
  const noInline = preventInline || (oneWord && raw.length !== query.length && /\s$/.test(raw));
  const completes = websiteFirst && !scope && oneWord && !noInline;
  const from = narrowing(pool, q, tokens);
  const pages = from ? from.pages : pool.list;
  const again = from !== null && from.q === q;
  const parsed = parseQuery(q, tokens);
  const matched              = again ? from.pages : [];
  const scores           = again ? from.scores : [];
  let found = 0;
  const top = new TopList(limit + 1);
  const onSite = scope ? new TopList(4) : null;
  const score = oneWord ? matchScoreWord : matchScore;
  const bound = Boolean(scope);
  let inline                = null;
  for (const list of [pages, extra]) {
    const inPages = list === pages;
    for (let at = 0; at < list.length; at++) {
      const c = list[at] ;
      const m = again && inPages ? scores[at]  : score(c.text, parsed);
      if (m <= 0) continue;
      if (inPages && !again) {
        matched[found] = c;
        scores[found++] = m;
      }
      const key = c.text.key;
      const derank = currentKey !== null && key === currentKey ? 80 : 0;
      const lastVisit = c.fresh ? now : c.lastVisit;
      let age = 10;
      if (lastVisit) {
        const d = (now - lastVisit) / DAY;
        age = d < 0 ? 0 : d > 30 ? 30 : d;
      }
      const base = c.logVisits - age + (c.bookmarked ? 20 : 0);
      if (!bound && top.floor >= m + base - derank + 7) {
        if (!completes) continue;
        if (inline === null ? false : inline.s >= m + base - derank + 7) continue;
        if (c.visits <= 0 || !c.text.shownLower.startsWith(q)) continue;
      }
      const tabId = c.tabId ?? tabIds.get(key);
      const s = m + (base + (tabId ? 6 : 0)) - derank;
      let r                    ;
      if (top.floor < s || top.items.length < limit + 1) {
        r = { c, tabId, m, s };
        top.offer(r);
      }
      if (onSite) {
        const host = hostOfPage(c.text);
        if (host === scope .host || host.endsWith(`.${scope .host}`)) onSite.offer(r ?? { c, tabId, m, s });
      }
      if (completes && (!inline || s > inline.s) && c.visits > 0 && inlineMatch(c.text, q)) inline = r ?? { c, tabId, m, s };
    }
  }
  remember(pool, q, tokens, matched, scores);
  const ranked = top.items;

  const out = new Output(limit);
  const remoteRows = (url                          , name        ) =>
    dedupeSuggestions(remote, query)
      .slice(0, 4)
      .map((text)             => ({ kind: "search", query: text, url: url(text), engine: name, suggested: true }));

  if (scope) {
    const scopedUrl = (text        ) => scopedSearchUrl(scope, text, engine);
    out.push({ kind: "search", query, url: scopedUrl(query), engine: scope.name });
    out.push(...remoteRows(scopedUrl, scope.name));
    out.push(...onSite .items.map((x) => pageSuggestion(x.c, x.tabId)));
    return { items: out.items, completion: "" };
  }

  const search             = { kind: "search", query, url: searchUrl(engine, query), engine: engine.name };
  const typedUrl = fixupUrl(query);
  const calc = calculate(query);
  const creates = matchQuickCreate(raw.trimStart());
  const actionRows = query.length >= 4 ? 4 : 2;
  const actionMatches = matchActions(query, actions, actionRows).filter((m) => m.exact || m.score >= 50);
  const extensionMatches = extensionSuggestions(query, options.extensions ?? []);

  const best = ranked[0];
  const target = inline && inlineTarget(q, inline.c);
  const completion = target ? target.text.slice(bare.length) : "";

  let first            ;
  if (creates.length && /^\S+\s+\S/.test(query)) first = createRow(creates[0] );
  else if (actionMatches[0]?.exact) first = actionRow(actionMatches[0].action);
  else if (target && completion) first = known(target.url) ?? { kind: "page", url: target.url, title: "", favicon: target.favicon };
  else if (typedUrl) first = known(typedUrl) ?? { kind: "page", url: typedUrl, title: "", favicon: null };
  else if (extensionMatches.exact) first = extensionMatches.rows[0] ;
  else if (websiteFirst && best && best.m >= 40 && (!noInline || typedIsPage(best.c.text, q))) first = pageSuggestion(best.c, best.tabId);
  else first = search;

  out.push(first);
  out.push(search);
  if (calc) out.push({ kind: "calc", expression: calc.expression, value: calc.display, url: searchUrl(engine, calc.expression) });
  out.push(...actionMatches.map((m) => actionRow(m.action)));
  out.push(...extensionMatches.rows);
  out.push(...creates.map(createRow));
  const pageRows = ranked.map((x) => pageSuggestion(x.c, x.tabId));
  out.push(...pageRows.slice(0, 3));
  out.push(...remoteRows((text) => searchUrl(engine, text), engine.name));
  out.push(...pageRows.slice(3));
  return { items: out.items, completion };
}

function typedIsPage(t          , q        )          {
  return q === t.shownLower || q === hostLowerOfPage(t);
}

function inlineMatch(t          , q        )          {
  if (hostLowerOfPage(t).startsWith(q) && originOfPage(t)) return true;
  return q.includes("/") && !/[?#]/.test(t.shown) && t.shownLower.startsWith(q);
}

function inlineTarget(q        , c           )                                                        {
  const origin = originOfPage(c.text);
  const host = hostPart(c.text.shown);
  if (origin && host.toLowerCase().startsWith(q)) return { text: host, url: `${origin}/`, favicon: c.favicon };
  return { text: c.text.shown, url: c.url, favicon: c.favicon };
}

function bangSuggestions(match           , source                  , options                , limit        )                   {
  const { bang, query } = match;
  const out = new Output(limit);
  if (!query) {
    out.push({ kind: "page", url: bang.home, title: bang.name, favicon: null });
    return { items: out.items, completion: "" };
  }
  out.push({ kind: "search", query, url: match.url, engine: bang.name, bang: true });
  const scope              = { kind: "site", name: bang.name, host: hostOf(bang.home), url: bang.template };
  out.push(...buildSuggestions(query, source, { ...options, scope, remote: [], bangs: null }).items.slice(1));
  return { items: out.items, completion: "" };
}

class Output {
           items               = [];
                   seen = new Set        ();
                   limit        ;
  constructor(limit        ) {
    this.limit = limit;
  }
  push(...rows              ) {
    for (const row of rows) {
      const key = suggestionKey(row);
      if (this.items.length >= this.limit || this.seen.has(key)) continue;
      this.seen.add(key);
      this.items.push(row);
    }
  }
}

const createRow = (c                                                          )             => ({ kind: "create", id: c.id, title: c.title, url: c.url, site: c.site });

const actionRow = (a               )             => ({
  kind: "action",
  id: a.id,
  title: a.title,
  ...(a.icon ? { icon: a.icon } : {}),
  ...(a.hint ? { hint: a.hint } : {}),
});

function dedupeSuggestions(remote                   , query        )           {
  const seen = new Set([query.trim().toLowerCase()]);
  return remote.filter((s) => {
    const key = s.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

});
__define("packages/core/src/suggestFetcher.ts", function (exports, __require) {
  __export(exports, "createSuggestFetcher", () => createSuggestFetcher);
const { parseSuggestions, suggestRequestUrl } = __require("packages/core/src/engines.ts");

                                                              
                                                                                               

                              
                                                                                                
                 
  

function createSuggestFetcher({
  fetch,
  delay = 120,
  cacheSize = 64,
}   
                   
                 
                     
 )                 {
  const cache = new Map                  ();
  let timer                                           ;
  let inFlight                             ;
  let generation = 0;

  const cancel = () => {
    generation++;
    clearTimeout(timer);
    timer = undefined;
    inFlight?.abort();
    inFlight = undefined;
  };

  const remember = (url        , suggestions          ) => {
    cache.delete(url);
    cache.set(url, suggestions);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value );
  };

  return {
    cancel,
    request(engine, query, onResult) {
      cancel();
      const url = suggestRequestUrl(engine, query);
      if (!url) return;
      const current = generation;
      const cached = cache.get(url);
      if (cached) {
        void Promise.resolve().then(() => current === generation && onResult(cached));
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        const controller = new AbortController();
        inFlight = controller;
        fetch(url, { signal: controller.signal })
          .then(async (res) => {
            if (!res.ok) return [];
            try {
              return parseSuggestions(JSON.parse(await res.text()));
            } catch {
              return [];
            }
          })
          .then(
            (suggestions) => {
              if (controller.signal.aborted) return;
              remember(url, suggestions);
              if (current === generation) {
                inFlight = undefined;
                onResult(suggestions);
              }
            },
            () => {},
          );
      }, delay);
    },
  };
}

});
__define("packages/core/src/textFragment.ts", function (exports, __require) {
  __export(exports, "chooseTextFragment", () => chooseTextFragment);
  __export(exports, "withTextFragment", () => withTextFragment);

                                                                                             

                                
                   
                 
                
                   
  

const MAX_EXACT_WORDS = 10;
const RANGE_WORDS = 3;
const MAX_CONTEXT_WORDS = 5;

const normalize = (s        ) => s.replace(/\s+/g, " ").trim();
const wordsOf = (s        ) => normalize(s).split(" ").filter(Boolean);

function occurrences(haystack        , needle        )         {
  if (!needle) return 0;
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) count++;
  return count;
}

const WORD_END = /[\p{L}\p{N}_]+$/u;
const WORD_START = /^[\p{L}\p{N}_]+/u;

function toWordBoundaries({ selected, before, after, pageText }                  )                   {
  const head = WORD_START.test(selected) ? (WORD_END.exec(before)?.[0] ?? "") : "";
  const tail = WORD_END.test(selected) ? (WORD_START.exec(after)?.[0] ?? "") : "";
  return {
    selected: head + selected + tail,
    before: before.slice(0, before.length - head.length),
    after: after.slice(tail.length),
    pageText,
  };
}

function chooseTextFragment(context                  )                      {
  const { selected, before, after, pageText } = toWordBoundaries(context);
  const blocks = selected.split(/\s*\n\s*/).map(normalize).filter(Boolean);
  if (!blocks.length) return null;
  const page = normalize(pageText).toLowerCase();
  const count = (text        ) => occurrences(page, text.toLowerCase());
  const all = blocks.flatMap(wordsOf);
  const beforeWords = wordsOf(before);
  const afterWords = wordsOf(after);

  if (blocks.length === 1 && all.length <= MAX_EXACT_WORDS) {
    const start = all.join(" ");
    if (count(start) <= 1) return { start };
    for (let n = 1; ; n++) {
      const prefix = beforeWords.slice(-n).join(" ");
      const suffix = afterWords.slice(0, n).join(" ");
      const exhausted = n >= MAX_CONTEXT_WORDS || n >= Math.max(beforeWords.length, afterWords.length);
      if (exhausted || count([prefix, start, suffix].filter(Boolean).join(" ")) <= 1)
        return { ...(prefix && { prefix }), start, ...(suffix && { suffix }) };
    }
  }
  const first = wordsOf(blocks[0] );
  const last = wordsOf(blocks[blocks.length - 1] );
  const most = blocks.length === 1 ? Math.floor(all.length / 2) : Math.min(first.length, last.length);
  let n = Math.min(RANGE_WORDS, most);
  while (n < most && count(first.slice(0, n).join(" ")) > 1) n++;
  const start = first.slice(0, n).join(" ");
  const end = last.slice(-n).join(" ");
  if (count(start) <= 1 || !beforeWords.length) return { start, end };
  return { prefix: beforeWords.slice(-RANGE_WORDS).join(" "), start, end };
}

const encodeTerm = (s        ) => encodeURIComponent(s).replace(/-/g, "%2D");

function textDirective({ prefix, start, end, suffix }              )         {
  const parts = [prefix && `${encodeTerm(prefix)}-`, encodeTerm(start), end && encodeTerm(end), suffix && `-${encodeTerm(suffix)}`];
  return `text=${parts.filter(Boolean).join(",")}`;
}

function withTextFragment(url        , fragment              )         {
  const hash = url.indexOf("#");
  const base = hash === -1 ? url : url.slice(0, hash);
  let ref = hash === -1 ? "" : url.slice(hash + 1);
  const directive = ref.indexOf(":~:");
  if (directive !== -1) ref = ref.slice(0, directive);
  return `${base}#${ref}:~:${textDirective(fragment)}`;
}

});
globalThis.ArdiaCore = __require("packages/core/src/mobile.ts");
})();
