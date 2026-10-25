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
  __export(exports, "mobileLoadBangDocument", () => mobileLoadBangDocument);
  __export(exports, "mobileBangDocument", () => mobileBangDocument);
  __export(exports, "mobileSetSources", () => mobileSetSources);
  __export(exports, "mobileSetSearch", () => mobileSetSearch);
  __export(exports, "mobileEngines", () => mobileEngines);
  __export(exports, "mobileWarmBangs", () => mobileWarmBangs);
  __export(exports, "mobileSuggest", () => mobileSuggest);
  __export(exports, "mobileResolve", () => mobileResolve);
  __export(exports, "mobileSuggestRequest", () => mobileSuggestRequest);
  __export(exports, "mobileParseRemote", () => mobileParseRemote);
  __export(exports, "mobileFindScope", () => mobileFindScope);
  __export(exports, "mobileClean", () => mobileClean);
  __export(exports, "mobileDisplay", () => mobileDisplay);
  __exportAll(exports, __require("packages/core/src/index.ts"));
const { BANG_LIST, BANG_LIST_UNICODE } = __require("packages/core/src/bangList.ts");
const { bangDocument, bangTable, findBang, joinBangTables, readBangDocument, slimBangs } = __require("packages/core/src/bangs.ts");
const { cleanUrl } = __require("packages/core/src/cleanUrl.ts");
const { allEngines, engineById, parseSuggestions, suggestRequestUrl } = __require("packages/core/src/engines.ts");
const { breadcrumb, fixupUrl, searchUrlFor, urlForDisplay } = __require("packages/core/src/omnibox.ts");
const { findScope } = __require("packages/core/src/siteSearch.ts");
const { buildSuggestions, prepareSuggestions } = __require("packages/core/src/suggest.ts");



class HostURL {
           protocol        ;
           hostname        ;
           href        ;
  constructor(url        ) {
    const match = /^([a-z][a-z0-9+.-]*:)(?:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*))?/i.exec(String(url));
    if (!match) throw new TypeError("Invalid URL");
    this.protocol = match[1] .toLowerCase();
    this.hostname = (match[2] ?? "").toLowerCase();
    this.href = String(url);
  }
}

const scope = globalThis                     ;
if (typeof scope.URL === "undefined") scope.URL = HostURL;

                                                                                                                         
                             
                             
                               
                           
                                    
                 
                          
                             
               
  
                                                                                                               

let source                   = { tabs: [], history: [], bookmarks: [] };
let engines                 = allEngines();
let engine               = engines[0] ;
let bangs                   = null;

const bangTableOnce = () => (bangs ??= joinBangTables([bangTable(BANG_LIST), bangTable(BANG_LIST_UNICODE)]));

function mobileLoadBangDocument(doc        )                {
  const read = readBangDocument(doc);
  if (!read) return null;
  bangs = read.table;
  return read.etag ?? "";
}

function mobileBangDocument(json        , etag               )                {
  const slim = slimBangs(json);
  if (!slim) return null;
  const doc = bangDocument(etag, slim);
  return mobileLoadBangDocument(doc) === null ? null : doc;
}

function mobileSetSources(next                  )          {
  source = { tabs: next.tabs ?? [], history: next.history ?? [], bookmarks: next.bookmarks ?? [] };
  return prepareSuggestions(source, Infinity);
}

function mobileSetSearch(search              )                                                               {
  const list = allEngines(search.customEngines ?? []);
  if (search.customUrl?.includes("%s")) list.push({ id: "custom", name: "Custom", keyword: "custom", url: search.customUrl, custom: true });
  engines = list;
  engine = engineById(engines, search.engineId ?? undefined);
  return { id: engine.id, name: engine.name, url: engine.url, suggests: Boolean(engine.suggestUrl) };
}

function mobileEngines()                                                               {
  return engines.map((e) => ({ id: e.id, name: e.name, url: e.url, custom: Boolean(e.custom) }));
}

function mobileWarmBangs()         {
  return bangTableOnce().size;
}

function mobileSuggest(text        , options                       = {})                   {
  const result = buildSuggestions(text, source, {
    engine,
    limit: options.limit ?? 8,
    preference: options.preference ?? "website",
    remote: options.remote ?? [],
    currentUrl: options.currentUrl ?? undefined,
    currentTabId: options.currentTabId ?? undefined,
    preventInline: options.preventInline ?? false,
    scope: options.scope ?? null,
    now: options.now,
    bangs: text.includes("!") ? bangTableOnce() : null,
  });
  return { items: result.items.filter((s) => s.kind === "page" || s.kind === "search" || s.kind === "calc"), completion: result.completion };
}

function mobileResolve(text        , scope                     = null)                          {
  const input = text.trim();
  if (!input) return null;
  if (scope) return { kind: "search", url: searchUrlFor(scope.url, input), query: input, engine: scope.name };
  const bang = input.includes("!") ? findBang(input, bangTableOnce()) : null;
  if (bang) return { kind: "bang", url: bang.url, query: bang.query, engine: bang.bang.name };
  if (input.startsWith("?")) {
    const query = input.slice(1).trim();
    return query ? { kind: "search", url: searchUrlFor(engine.url, query), query, engine: engine.name } : null;
  }
  const url = fixupUrl(input);
  if (url) return { kind: "url", url, query: input, engine: engine.name };
  return { kind: "search", url: searchUrlFor(engine.url, input), query: input, engine: engine.name };
}

function mobileSuggestRequest(text        , scope                     = null)                {
  const query = text.trim().replace(/^\?/, "").trim();
  if (!query || /^[a-z][a-z0-9+.-]*:\/\//i.test(query)) return null;
  if (query.includes("!") && findBang(query, bangTableOnce())) return null;
  if (scope && scope.kind !== "engine") return null;
  const from = scope?.kind === "engine" ? engineById(engines, scope.engineId) : engine;
  return suggestRequestUrl(from, query);
}

function mobileParseRemote(body        )           {
  try {
    return parseSuggestions(JSON.parse(body)).slice(0, 8);
  } catch {
    return [];
  }
}

function mobileFindScope(text        )                     {
  return findScope(text, { engines, hosts: [] });
}

function mobileClean(url        )         {
  return cleanUrl(url);
}

function mobileDisplay(url        , title = "")                                                     {
  return { display: urlForDisplay(url), ...breadcrumb(url, title) };
}

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
__define("packages/core/src/bangList.ts", function (exports, __require) {
  __export(exports, "BANG_LIST_ETAG", () => BANG_LIST_ETAG);
  __export(exports, "BANG_LIST_GENERATED_AT", () => BANG_LIST_GENERATED_AT);
  __export(exports, "BANG_LIST", () => BANG_LIST);
  __export(exports, "BANG_LIST_UNICODE", () => BANG_LIST_UNICODE);
const BANG_LIST_ETAG = "\"6ad9e8e9-512a8\"";
const BANG_LIST_GENERATED_AT = "2026-10-14T11:11:02.825Z";
const BANG_LIST = `5	Fiverr	fiverr.com/gigs/search?query={s}
a az amz aus buy amus price amazon	Amazon.com	www.amazon.com/s?k={s}
b bing	Bing	bing.com/search?q={s}
d def tfd define idioms dictionary thefreedictionary	The Free Dictionary	www.thefreedictionary.com/{s}
e eb ebay	eBay	www.ebay.com/sch/items/?_nkw={s}
f flickr	Flickr	www.flickr.com/search/?q={s}
h ho hgl hgle hoogle	Hoogle	hoogle.haskell.org/?hoogle={s}&scope=set:stackage
k kagi	Kagi	kagi.com/search?q={s}
o	OneLook.com	onelook.com/?w={s}&ls=a
r reddit	Reddit	www.reddit.com/search?q={s}
s sp	StartPage	startpage.com/do/metasearch.pl?query={s}
t syn like thes tref synonym synonyms thesaurus	Thesaurus.com	thesaurus.com/browse/{s}
u ud urban urbandictionary	Urban Dictionary	www.urbandictionary.com/define.php?term={s}
w wi wk wiki wikipedia encyclopedia	Wikipedia	wikipedia.org/w/index.php?search={s}
x twid twit tweet twitter	X	x.com/search?q={s}
y yahoo	Yahoo!	search.yahoo.com/search?p={s}
./ /. slashdot	Slashdot	slashdot.org/index2.pl?fhfilter={s}
'f frax	Franskt Lexikon	www.fransktlexikon.se/{s}
14	14-tage-wettervorhersage.de	14-tage-wettervorhersage.de/suche/?q={s}&lg=de
1c	1cak	1cak.com/search-0-{s}
3t	TriTrans (Engelsk)	www.tritrans.net/cgibin/translate.cgi?spraak=Engelsk&Fra={s}&button=Translate!
42	42 Intra	profile.intra.42.fr/searches/search?query={s}
47	47 News	www.47news.jp/search?phrase={s}
4g	4chan - /g/ - Technology	4chan.org/g/{s}
52	Food52	food52.com/recipes/search?q={s}
5a	QuintoAndar	www.quintoandar.com.br/alugar/imovel/{s}/
5e	D&D 5e Wiki	engl393-dnd5th.wikia.com/wiki/Special:Search?query={s}
8a	8a.nu	www.8a.nu/scorecard/Search.aspx?Mode=SIMPLE&AscentType=0&CragName={s}
91	91 mobiles	www.91mobiles.com/topic/{s}/all
93	The Hermetic Library	hermetic.com/index?do=search&id={s}
9g 9gag	9gag	9gag.com/search?query={s}
a2 alt ato alto altto alternative alternativeto	AlternativeTo.net	alternativeto.net/browse/search/?q={s}
a5	Angular.io v5	v5.angular.io/api?query={s}
a6	Angular.io v6	v6.angular.io/api?query={s}
a7	Angular.io v7	v7.angular.io/api?query={s}
aa	Amazon Automotive	www.amazon.com/s/&url=search-alias=automotive&field-keywords={s}
ad askd applese	Apple StackExchange	apple.stackexchange.com/search?q={s}
ae ali aliexp aliexpress	AliExpress	www.aliexpress.com/wholesale?SearchText={s}
af acr	Acronym Finder	www.acronymfinder.com/{s}.html
ag	Android Geeks	www.android.gs/?s=&q={s}
ah appie alberthein	Albert Heijn	www.ah.nl/zoeken?rq={s}
ak accountkiller	Account Killer	www.accountkiller.com/en/delete-{s}-account
al an	AniList	anilist.co/search/anime?search={s}
am amaps applemaps	Apple Maps	maps.apple.com/?q={s}
ao amazonorders	Amazon.com order history	www.amazon.com/your-orders/search?opt=ab&search={s}
ap apnews	AP News	apnews.com/search?q={s}
av avclub	A.V. Club	www.avclub.com/search?q={s}
aw archwiki archlinuxit	Arch Linux Wiki	wiki.archlinux.org/index.php?title=Special:Search&search={s}
ax	androidxref	androidxref.com/5.1.0_r1/search?q={s}
ay	AboutYou	www.aboutyou.de/suche?term={s}
b5	The Babylon Project	babylon5.wikia.com/wiki/Special:Search?search={s}
ba beer	Beer Advocate	beeradvocate.com/search?q={s}&qt=beer
bb bitbucket	Bitbucket	bitbucket.org/repo/all/?name={s}
bc	Blockchain	blockchain.info/search/{s}
bd	baidu	www.baidu.com/s?wd={s}
bf buzzfeed	BuzzFeed	www.buzzfeed.com/search?q={s}
bg bgw bible biblegateway	BibleGateway	www.biblegateway.com/passage/?search={s}
bh bhphotovideo	B&H Photo Video	www.bhphotovideo.com/c/search?Ntt={s}
bi bim bimages bingimages	Bing Images	www.bing.com/images/search?q={s}&go=
bl bluk	The British Library Catalogue	explore.bl.uk/primo_library/libweb/action/search.do?fn=search&vl(freeText0)={s}
bm bmaps bingmaps	Bing Maps	www.bing.com/maps/?q={s}&obox=1
bn b&n barnesandnoble	Barnes & Noble	www.barnesandnoble.com/search?q={s}
bo	Boerse Online	www.boerse-online.de/suchergebnisse?_search={s}
bp	Beautiful Pixels	beautifulpixels.com/?s={s}
bq	BloombergQuint	www.bloombergquint.com/search?q={s}
bs	Bing Shopping	www.bing.com/shop?q={s}
bt	Microsoft/Bing Translator	www.bing.com/translator?text={s}
bu bpa bulba bpedia bulbapedia	Bulbapedia	bulbapedia.bulbagarden.net/w/index.php?title=Special:Search&search={s}
bv bvideo bvideos bingvideos	Bing Videos	www.bing.com/videos?q={s}
bw	Bing Weather	www.bing.com/weather/forecast?q={s}
c2	Wiki Wiki Web	c2.com/cgi/fullSearch?search={s}
c4 channel4	Channel 4	www.channel4.com/search/?q={s}
cb crunchbase	CrunchBase	www.crunchbase.com/textsearch?q={s}
cc	Openverse Creative Commons Search	openverse.org/search/?q={s}
cd collins	Collins Dictionary	www.collinsdictionary.com/dictionary/english/{s}?showCookiePolicy=true
ce	Cheat Engine Forums	forum.cheatengine.org/search.php?q={s}
cg	CultureGraph	hub.culturegraph.org/search?query={s}
ci	CodeIgniter	www.codeigniter.com/user_guide/search.html?q={s}
cj	Conjour	conjour.world/?s={s}
ck chef	Chefkoch	www.chefkoch.de/rs/s0/{s}/Rezepte.html
cl craigslist	Craigslist	www.craigslist.org/search/sss?query={s}
co cobalt	cobalt	cobalt.tools/#{s}
cp	CoinPaprika	coinpaprika.com/?sort={s}
cq	QRZCQ Database	qrzcq.com/call/{s}
cr	codereview.stackexchange.com	codereview.stackexchange.com/search?q={s}
cs	CheapShark	www.cheapshark.com/search?q={s}
ct canadiantire	Canadian Tire	www.canadiantire.ca/en/search-results.html?q={s}
cu ciu cius caniuse	Can I use...	caniuse.com/?search={s}
cv crossvalidated	Cross Validated (Stats StackExchange)	stats.stackexchange.com/search?q={s}
cw	CodeWars	www.codewars.com/kata/search/?q={s}
d2 light lightgg	Light.gg	www.light.gg/db/search/?q={s}
da deviantart	DeviantArt	www.deviantart.com/browse/all/?section=&global=1&q={s}
db douban	Douban	m.douban.com/search/?query={s}
dc	DuckDuckGo Community	duck.co/forum/search?q={s}
dd dev devdocs	DevDocs	devdocs.io/#q={s}
dg	Desiring God	www.desiringgod.org/search/results?q={s}
dh dhub docker dockerhub	Docker Hub	hub.docker.com/search?q={s}
di cdi codi	collinsdictionary	www.collinsdictionary.com/dictionary/english/{s}
dj django	Django Docs	docs.djangoproject.com/search/?q={s}
dl	DesdeLinux	blog.desdelinux.net/?s={s}
dm dailymotion	Dailymotion	www.dailymotion.com/search/{s}
dn	Dagens Nyheter	www.dn.se/sok/?q={s}&page=1&sort=relevance
do	DigitalOcean	www.digitalocean.com/community/search?q={s}
dq	Dragon Quest Wiki	dragon-quest.org/w/index.php?search={s}
dr dribble dribbble	Dribbble	dribbble.com/search?q={s}
ds standaard	De Standaard	www.standaard.be/zoeken?keyword={s}
dt dtwiki dthority	Deskthority Wiki	deskthority.net/wiki/index.php?search={s}
dv	Dictionnaire visuel	www.ikonet.com/fr/ledictionnairevisuel/static/qc/searchresults?ie=UTF-8&q={s}
dw	DramaWiki	wiki.d-addicts.com/index.php?search={s}
dz deezer	Deezer	www.deezer.com/search/{s}
e2	Everything 2	everything2.com/title/{s}?searchy=search
ec eco ecosia	Ecosia	www.ecosia.org/search?q={s}
eh	English Heritage	www.english-heritage.org.uk/search?searchTerm={s}
ei ecim	Ecosia Image Search	www.ecosia.org/images?q={s}
ej	Tanoshii Japanese English > Japanese	www.tanoshiijapanese.com/dictionary/index.cfm?j=&e={s}&search=Search+>
ek	Elektronik-Kompendium	www.elektronik-kompendium.de/service/suchen/suchen.php?q={s}
em	eBay Motors	motors.shop.ebay.com/eBay-Motors-/6000/i.html?_nkw={s}&_trksid=p2050885.m570.l1313&_rdc=1
en enstex seenglish	English StackExchange	english.stackexchange.com/search?q={s}
eo ety etym etymo etymology etymonline	Online Etymology Dictionary	www.etymonline.com/search?q={s}
ep ever everi everipedia	Everipedia	everipedia.org/wiki/{s}
er erowid	Erowid	www.erowid.org/search.php?q={s}
et	El Tiempo	www.eltiempo.es/buscar?q={s}
eu	European Union	europa.eu/search/?QueryText={s}
ev	Electrek	cse.google.com/cse?cx=008464549922976904202:3wy4ipwvlno&q={s}
ex examine	Examine	examine.com/search/?q={s}
f1	F1Zone	www.f1zone.net/news/index.php?s={s}
f3	France 3	www.france3.fr/recherche?s={s}
f6 fordsix	The FordSix Performance Forum	fordsix.com/search.php?keywords={s}
fa faff	Film Affinity	www.filmaffinity.com/es/search.php?stext={s}&stype=all
fb fbk facebook	Facebook	www.facebook.com/s.php?q={s}
fd freedict freedictionary	Free Dictionary	freedictionary.org/?Query={s}&button=Search
ff	fanfiction.net	www.fanfiction.net/search.php?type=story&keywords={s}&match=title&sort=0&genreid=0&subgenreid=0&characterid=0&subcharacterid=0&words=0&ready=1&categoryid=0
fg fangraphs	Fangraphs	www.fangraphs.com/search?q={s}
fh file filehippo	FileHippo	filehippo.com/search?q={s}
fj	Funnyjunk	funnyjunk.com/search/?q={s}
fk flip flipkart	Flipkart	www.flipkart.com/search?q={s}
fm	Filmaster	filmaster.com/search/?q={s}
fn	foodnetwork.com	www.foodnetwork.com/search/{s}-
fo	File.org	file.org/extension/{s}
fp fanpop	Fanpop	www.fanpop.com/search?query={s}
fs	Factual News Search	factualsearch.news/#/&gsc.q={s}
ft	Financial Times	www.ft.com/search?q={s}
fv fvz	Finviz	finviz.com/quote.ashx?t={s}
fw	Forgotten Weapons	www.forgottenweapons.com/?s={s}
ga googleoz	Google Australia	www.google.com.au/search?q={s}
ge	Google Encrypted	google.com/#q={s}
gf stock gfinance	Google Finance	finance.google.com/?q={s}&sa=N&tab=fe
gh git github	GitHub	github.com/search?q={s}
gi gim gimg gimages googleimg googleimages	Google Images	google.com/search?tbm=isch&q={s}&tbs=imgo:1
gj googlejp	Google Japan	www.google.co.jp/search?q={s}
gk gamekult	Gamekult	www.gamekult.com/rechercher-jeu.html?q={s}
gl	OpenGL	www.opengl.org/search/?q={s}
gn gnus gnews	Google News	news.google.com/search?q={s}
go gma gmailh	Gmail	mail.google.com/mail/u/0/#search/{s}
gq	GQ	www.gq.com/search?qt=dismax&sort=score+desc&query={s}
gr	Goodreads	www.goodreads.com/search?q={s}
gs shopping gshopping	Google Shopping	www.google.com/search?q={s}&udm=28
gw gwiki gentoo gentoowiki installgentoo	Gentoo Wiki	wiki.gentoo.org/index.php?search={s}
gy gyear	Google (Past Year)	www.google.com/search?q={s}&tbs=qdr:y
gz	GeekZone	www.geekzone.fr/?s={s}
hb humble	Humblebundle	www.humblebundle.com/store/search?search={s}
hc	HolidayCheck	www.holidaycheck.de/schnellsuche.php?q={s}
hd	HUDOC	hudoc.echr.coe.int/eng#{"fulltext":["{s}"],"documentcollectionid2":["GRANDCHAMBER","CHAMBER"]}
hg	Mecurial	www.mercurial-scm.org/wiki/Mercurial?action=fullsearch&context=180&value={s}&titlesearch=Title
hh	Home Hardware	www.homehardware.ca/search?query={s}
hj	Honest John	www.honestjohn.co.uk/search/?q={s}
hk	HackTips	hacktips.it/?s={s}
hl	Hugelol	hugelol.com/search?q={s}
hm	HERE maps	wego.here.com/search/{s}?
hn newsyc hnsearch searchyc hackernews	Hacker News	hn.algolia.com/?q={s}
hp	HP	search.hp.com/query.html?lang=en&submit.x=0&submit.y=0&qt={s}&la=en&cc=us
hs	Honyaku Star	honyakustar.com/en/{s}
ht yu hkt htb hook htube hooktube	Hooktube	hooktube.com/results?search_query={s}
hv	Hinnavaatlus	www.hinnavaatlus.ee/search/?Type=products&Query={s}
hw	HaloWeb	halo.umbc.edu/cgi-bin/haloweb/nrc1.pl?display=json&operation=search&keyword={s}
hx hexpm	Hex.pm	hex.pm/packages?search={s}&sort=downloads
hy	Hypothes.is Via	via.hypothes.is/{s}
i3	i3-Technologies	www.i3-technologies.com/en/resources/knowledge-base/?q={s}
ia wbm wayback archived archiveweb webarchive waybackmachine	Wayback Machine	web.archive.org/web/*/{s}
ib	Indiebound.org	www.indiebound.org/search/book?keys={s}
ic imperial	Imperial College London	www.imperial.ac.uk/search/?q={s}
ig igu insta instagram	Instagram	www.instagram.com/explore/tags/{s}/
ip	WhatIsMyIPAddress.com	whatismyipaddress.com/ip/{s}
is	Ilmainen Sanakirja	ilmainensanakirja.fi/sanakirja/{s}?
iv itverb	Italian Verbs	www.italian-verbs.com/italian-verbs/conjugation.php?verbo={s}
iw	instantwatcher	instantwatcher.com/search?content_type=1+2&source=1+2+3&q={s}
ja jeopardy	J! Archive	www.j-archive.com/search.php?search={s}
jb	jupiter broadcasting	www.jupiterbroadcasting.com/?s={s}
je	Tanoshii Japanese	www.tanoshiijapanese.com/dictionary/index.cfm?j={s}&e=&search=Search+>
ji jisho	Jisho.org	jisho.org/search/{s}
jj	Jinja	jinja.pocoo.org/docs/2.10/search/?q={s}
jl johnlewis	John Lewis	www.johnlewis.com/search?search-term={s}
jm joe joemonster	Joe Monster	joemonster.org/search.php?q={s}
jo	Jotrin Electronics	www.jotrin.com/product/list?keyword={s}
jq jquery	jQuery Docs	api.jquery.com/?ns0=1&s={s}
jr	JoyReactor	joyreactor.cc/search?q={s}
js mdnjs	Mozilla Developer Network (JS)	developer.mozilla.org/en-US/search?topic=api&topic=js&q={s}
jv jvd jeux jvcom	JeuxVideo	www.jeuxvideo.com/recherche.php?q={s}
jw	Jehovah's Witnesses	www.jw.org/en/search/?q={s}
ka khan khanacademy	Khan Academy	www.khanacademy.org/search?page_search_query={s}
kd	Kanji Damage	kanjidamage.com/kanji/search?utf8=%E2%9C%93&q={s}
kf	Kagi Feedback	kagifeedback.org/?q={s}
kh	Kubeapps Hub	hub.kubeapps.com/charts?q={s}
kj	King James Bible Study	www.biblestudytools.com/search/?q={s}&s=Bibles&t=kjv
kk	KubeKings	kubekings.com/buscar?controller=search&orderby=position&orderway=desc&search_query={s}&submit_search=
kl	KabarLinux	kabarlinux.id/?s={s}
km	Karaoke Mugen	kara.moe/base/karas?filter={s}
kn	Knoema	knoema.com/search?query={s}
kp	Kupujemprodajem	www.kupujemprodajem.com/pretraga?keywords={s}
ks kst kickstarter	Kickstarter	www.kickstarter.com/projects/search?utf8=%E2%9C%93&term={s}
kt tr ktr kagit	Kagi Translate	translate.kagi.com/?from=auto&to=en&text={s}
l1	Level 1	level-1.fr/?s={s}
la	Langenscheidt (de2en)	de.langenscheidt.com/deutsch-englisch/search?term={s}
lb lbx ltr letterboxd	Letterboxd	letterboxd.com/search/{s}
lc laracasts	Laracasts	laracasts.com/search?q={s}
ld	Longman Dictionary of Contemporary English	www.ldoceonline.com/search/?q={s}
le	University of Leicester	le.ac.uk/search?q={s}
lf frontalux	LesFrontaliers	www.lesfrontaliers.lu/search?text={s}
lh lifehack lifehacker	Lifehacker	lifehacker.com/search?q={s}
li linkedin	LinkedIn	www.linkedin.com/search/results/all/?keywords={s}
lk lolking	LolKing	www.lolking.net/search?name={s}
ll liveleak	LiveLeak	www.liveleak.com/browse?q={s}
lm	LiveMixtapes	www.livemixtapes.com/main.php?artist={s}
ln	Le Newbie	lenewbie.com/?s={s}
lp launchpad	Launchpad	launchpad.net/+search?field.text={s}
lq	Linux Quimper	forum.linuxquimper.org/search?q={s}
ls	LittleSis	littlesis.org/search?q={s}
lt libthing librarything	LibraryThing	www.librarything.com/search.php?searchtype=work&search={s}
lu	Liberty University	www.liberty.edu/search/?q={s}
lv	Livermore library	www.livermore.lib.ca.us/search/a?searchtype=X&SORT=D&searchscope=7&searcharg={s}
lw	LessWrong	lesswrong.com/search/results?q={s}
lx	Lexico (Powered by Oxford)	www.lexico.com/definition/{s}
m1	Motor1	www.motor1.com/search/?q={s}
ma mema malpha startrek memoryalpha	Memory Alpha	memory-alpha.org/index.php?search={s}
mb musicbrainz	MusicBrainz (artist)	musicbrainz.org/search/textsearch.html?type=artist&query={s}&handlearguments=1
mc metacritic	Metacritic	www.metacritic.com/search/{s}/
md msd posh dotnet msdocs	Microsoft Docs	learn.microsoft.com/en-us/search/?terms={s}
me	Mass Effect Wiki	masseffect.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
mf	Morguefile	morguefile.com/search/morguefile/1/{s}/pop
mh mhwiki	The Monster Hunter Wiki	monsterhunter.wikia.com/wiki/index.php?search={s}
mi myinstants	myinstants	www.myinstants.com/search/?name={s}
mk	Mechanical Keyboards	mechanicalkeyboards.com/search.php?switch_id=ALL&size=ALL&keyword={s}
ml	Google Maps Lite	google.com/maps/search/{s}?force=canvas
mm macbrit	Macmillan Dictionary (British)	www.macmillandictionary.com/dictionary/british/{s}
mn	medicinanet	www.medicinanet.com.br/pesquisas/{s}.htm
mo mathoverflow	MathOverflow	mathoverflow.net/search?q={s}
mp mpny menupages	MenuPages	www.menupages.com/restaurants/text/{s}/all-areas/all-neighborhoods/all-cuisines/
mq mapquest	MapQuest	www.mapquest.com/?q={s}
mr	Mac Rumors	www.macrumors.com/search?s={s}
ms microsoft	Microsoft	search.microsoft.com/results.aspx?mkt=en-US&form=MSHOME&setlang=en-US&q={s}
mt multitran	Multitran	www.multitran.com/m.exe?s={s}
mu macupdate	MacUpdate	www.macupdate.com/find/mac/context={s}
mv	Myvideo	www.myvideo.de/Videos_A-Z?searchWord={s}
mw dic dmw mwd mweb merriamwebster	Merriam-Webster	www.merriam-webster.com/dictionary/{s}
mx	MxToolbox	mxtoolbox.com/SuperTool.aspx?action=mx:{s}&run=networktools
mz	Mittelbayerische Zeitung	www.mittelbayerische.de/suche/?scope=20000&type=articles,galleries,videos&interval=month&searchterm={s}
nb	Nasjonalbiblioteket	www.nb.no/search?q={s}
nc namecheap	Namecheap	www.namecheap.com/domains/registration/results.aspx?domain={s}
nd	Notre Dame Library OneSearch	onesearch.library.nd.edu/primo-explore/search?query=any,contains,{s}&tab=onesearch&search_scope=malc_blended&vid=NDU&lang=en_US&offset=0
ne newegg	Newegg	www.newegg.com/Product/ProductList.aspx?Submit=ENE&DEPA=0&Description={s}
nf net netflix	Netflix	www.netflix.com/search?q={s}
ng ng4 angular	Angular.io	angular.io/api?query={s}
nh nhw nethack	NetHack Wiki	nethackwiki.com/mediawiki/index.php?search={s}
ni	National Instruments	search.ni.com/nisearch/app/main/p/bot/no/ap/global/lang/en/pg/1/q/{s}/
nk	NorgesKart	norgeskart.no/#!?project=seeiendom&layers=1002,1015&zoom=4&lat=7197864.00&lon=396722.00&sok={s}
nm	Nexus Mods	www.nexusmods.com/search?keyword={s}
nn	Natural News	www.naturalnews.com/SearchResults.asp?query={s}&pr=NN
np tnp noun thenoun nounproject thenounproject	The Noun Project	thenounproject.com/search/?q={s}
nr	Nixpkgs Repository	github.com/NixOS/nixpkgs/search?q={s}
ns	DuckDuckGo (safeoff)	duckduckgo.com/?q=!safeoff+{s}
nt	Newstral	newstral.com/search/articles?&q={s}
nu	nu.nl	www.nu.nl/zoeken?q={s}
nw ninja	Ninjawords	ninjawords.com/{s}
o2	O2 uk	www.o2.co.uk/shop/{s}
ob	OpenBuilds	openbuilds.com/search/49203883/?q={s}
oc occ	OpenClassroom Cours	openclassrooms.com/courses?q={s}
od	Oxford English Dictionary	www.oed.com/search/dictionary/?q={s}
oh	Open Hub	www.openhub.net/p?q={s}
ol	OregonLive	search.oregonlive.com/{s}
on	Government of Ontario	www.ontario.ca/search/search-results?query={s}
oo ottooffice	OTTO Office DE	www.otto-office.com/de/app/search/index?query[query]={s}
op	OpenPlaques	openplaques.org/search?utf8=%E2%9C%93&phrase={s}
os susepkg opensusesoftware	OpenSUSE Software Search	software.opensuse.org/search?q={s}
ot	Microsoft Office Templates	templates.office.com/en-US/Search/results?query={s}
ou	The University of Oklahoma	www.ou.edu/content/web/search.html?q={s}
ov so sof stack stackoverflow	StackOverflow	stackoverflow.com/search?q={s}
ow	Open Whyd	openwhyd.org/search?q={s}
ox	Oxford Dictionary	www.lexico.com/search?utf8=%E2%9C%93&filter=noad&dictionary=en&query={s}
oz	OZ.by	oz.by/search/?q={s}
p5	p5.js Reference	p5js.org/reference/#/p5/{s}
pb pinf pinboard	Pinboard	pinboard.in/search/?query={s}&mine=Search+Mine
pc	President's Choice	www.presidentschoice.ca/en_CA/search-page.query@{s}.html
pd	The People's Dictionary	folkets-lexikon.csc.kth.se/folkets/folkets.en.html#lookup&{s}&0
pf pdfy	PrintFriendly & PDF	www.printfriendly.com/print/?source=site&url={s}
pg gutenberg projectgutenberg	Project Gutenberg	www.gutenberg.org/ebooks/search/?query={s}
ph producthunt	Product Hunt	www.producthunt.com/search?q={s}
pi	The Philadelphia Inquirer	www.philly.com/philly/search/?search=y&adv=y&searchKeywords={s}&minscore=50&pagesize=20&sites=philly&fields=full&sections=5&queryType=all
pj pris prisjakt	Prisjakt	www.prisjakt.nu/search?query={s}
pk peek	Peekier	peekier.com/#!{s}
pm pmd pub pmid pubmed publabs	Pubmed	pubmed.ncbi.nlm.nih.gov/?term={s}
pn anow	Amazon Prime Now	primenow.amazon.com/search?k={s}
po	Prensa Obrera	prensaobrera.com/buscar?q={s}
pp passapalavra	Passa Palavra	passapalavra.info/?s={s}
pr	PR Vademecum Argentina	ar.prvademecum.com/?s={s}
ps playstation	Playstation	www.playstation.com/search-results/?q={s}
pu	PulseUniform - Nursing Uniforms, Medical Scrubs, Lab Coats and Accessories	www.pulseuniform.com/search.asp?q={s}
pv	Prime Video	www.primevideo.com/region/eu/search?phrase={s}&ie=UTF8
px pxb pixabay	Pixabay	pixabay.com/en/photos/?q={s}
py py3 py3k python python3	Python 3 Docs	docs.python.org/3/search.html?q={s}
qb	Quimbee	www.quimbee.com/search?q={s}
qm qwm	Qwant music search	www.qwant.com/music/search?q={s}
qp	Quip	www.quip.com/search?q={s}
qr	QR Code Search	api.qrserver.com/v1/create-qr-code/?qzone=1&data={s}
qs	Qlik Sense Help	help.qlik.com/en-US/search/?q={s}
qu quora	Quora	www.quora.com/search?q={s}
qw qwt qwant	Qwant	www.qwant.com/?q={s}
qz quartz	Quartz	qz.com/search/{s}
r7	Rapid7	www.rapid7.com/?q={s}
ra retroachievements	RetroAchievements	retroachievements.org/search?query={s}
rb ruby	Current ruby docs	docs.ruby-lang.org/en/master/?q={s}
rc	Reader's Cave	www.readerscave.com/?s={s}
rf	Reasonable Faith	www.reasonablefaith.org/search/results?q={s}
rg gen rap genius	Genius	genius.com/search?q={s}
rh	Robin Hood	robinhood.com/stocks/{s}
rj radiojavan	RadioJavan	www.radiojavan.com/search?query={s}
rk	robokart	www.robokart.com/index.php?route=product/search&search={s}
rn	recruit.net	india.recruit.net/search.html?query={s}&location=delhi
ro	admin.ch	www.admin.ch/opc/search/?text={s}&lang=fr&language[]=fr&product[]=ClassifiedCompilation
rp rpi raspberrypi	Raspberry Pi	www.raspberrypi.org/search/{s}
rr reprap	RepRap Wiki	reprap.org/mediawiki/index.php?search={s}
rt rottentomato rottentomatoes	Rotten Tomatoes	www.rottentomatoes.com/search/?search={s}
ru	RedUSERS	www.redusers.com/noticias/?s={s}
rw rationalwiki	RationalWiki	rationalwiki.org/w/index.php?search={s}
rz rhyme	RhymeZone	www.rhymezone.com/r/rhyme.cgi?Word={s}&typeofrhyme=perfect&org1=syl&org2=l&org3=y
s2 smsc ssch semantic	Semantic Scholar	www.semanticscholar.org/search?q={s}
s6 s6all	Society6 (all content)	society6.com/search/?q={s}
s9	Sanctum Nine	sanctum9.wordpress.com/?s={s}
sa	Scientific American	www.scientificamerican.com/search/?q={s}&x=-783&y=-180
sb	SwagBucks	www.swagbucks.com/?t=w&p=1&b=0&f=0&sef=1&q={s}
sc sound scloud sndcld soundcloud	SoundCloud	soundcloud.com/search?q={s}
sd slickdeals	SlickDeals	slickdeals.net/newsearch.php?q={s}&searcharea=deals&searchin=first
sf serverfault	ServerFault	serverfault.com/search?q={s}
sg sourcegraph	Sourcegraph	sourcegraph.com/search?q={s}
sh shodan	shodan	www.shodan.io/search?query={s}
sj	sitejabber	www.sitejabber.com/search?q={s}
sk songkick	Songkick	www.songkick.com/search?query={s}
sl setlist	Setlist.fm	www.setlist.fm/search?query={s}
sm smashingmagazine	Smashing Magazine	www.smashingmagazine.com/search-results/?q={s}
sn	SoylentNews	soylentnews.org/search.pl?query={s}
sr rds sbr rsub subr reddits sreddit subreddit	Reddit subreddit	www.reddit.com/r/{s}
ss	SurreySearch	surrey.primo.exlibrisgroup.com/discovery/search?vid=44SUR_INST:44SUR_VU1&tab=Everything&query=any,contains,{s}
st	stocktwits	stocktwits.com/search?q={s}
su superuser	SuperUser	superuser.com/search?q={s}
sw wsimple simplewiki wikisimple	Simple English Wikipedia	simple.wikipedia.org/w/index.php?search={s}
sx stex stackexchange	Stack Exchange	stackexchange.com/search?q={s}
sy wsyn bighuge	Big Huge Thesaurus	words.bighugelabs.com/{s}
t+	Termium+	www.btb.termiumplus.gc.ca/tpv2alpha/alpha-fra.html?lang=fra&i=&index=alt&__index=alt&srchtxt={s}&comencsrch.x=0&comencsrch.y=0
t3	T3 Chat	www.t3.chat/new?q={s}
ta	tripadvisor	www.tripadvisor.com/Search?q={s}
tb tokobagus	OLX.co.id (Tokobagus)	www.olx.co.id/halaman/mencari/{s}/search
tc techcrunch	Techcrunch	techcrunch.com/search/{s}
td	TimeAndDate	www.timeanddate.com/search/results.html?query={s}
te tenc	Treccani Enciclopedia	www.treccani.it/enciclopedia/tag/{s}/
tf teflo tflow tensorflow	TensorFlow	www.tensorflow.org/s/results/?q={s}
ti tunein	TuneIn Radio	tunein.com/search/?query={s}
tj tacojohns	Taco John's	www.tacojohns.com/?s={s}
tl teamliquid	Teamliquid	www.teamliquid.net/forum/search.php?q={s}
tm trademe	Trade Me	www.trademe.co.nz/Browse/SearchResults.aspx?searchString={s}
tn	Times Now	www.timesnownews.com/latest-news?search={s}
tp	Thesaurus Plus	thesaurus.plus/search?q={s}
ts	TurboSquid	www.turbosquid.com/Search/Index.cfm?keyword={s}
tt	Texas Tribune	www.texastribune.org/search/?q={s}
tu	TU Dresden	tu-dresden.de/@@search?SearchableText={s}
tv imbd	IMBD	www.imdb.com/find?q={s}&s=all
tx	TV Tokyo	www.tv-tokyo.co.jp/search/?q={s}
tz	timeanddate	www.timeanddate.com/worldclock/results.html?query={s}
uc uchi	University of Chicago Library Catalog	catalog.lib.uchicago.edu/vufind/Search/Results?lookfor={s}&type=AllFields
ug tabs gtabs chords ultimateguitar ultimate-guitar	Ultimate Guitar	www.ultimate-guitar.com/search.php?search_type=title&value={s}
uh	uHasselt	www.uhasselt.be/google-search?q={s}
ul	Ulule	www.ulule.com/discover/?q={s}
un	United Nations	search.un.org/search?ie=utf8&site=un_org&output=xml_no_dtd&client=UN_Website_en&num=10&lr=lang_en&proxystylesheet=UN_Website_en&oe=utf8&q={s}&Submit=Go
up upackages ubuntupack	Ubuntu Packages	packages.ubuntu.com/search?keywords={s}
uq	Ultronomicon	wiki.uqm.stack.nl/script/index.php?search={s}&go=Go&title=Special:Search
ut	utexas.edu	www.utexas.edu/search/results?query={s}
uw uwo	SSJOY Uncharted waters Korean wiki	www.ssjoy.org/dho/?vid=&mid=home&act=IS&is_target=all&is_keyword={s}
ux	UX stackexchange	ux.stackexchange.com/search?q={s}
v0	v0	v0.dev/chat?q={s}
va vimaw vimawesome	Vim Awesome	vimawesome.com/?q={s}
vb	VedaBase	vedabase.com/en/search/site/{s}
vc	VoucherCodes	www.vouchercodes.co.uk/search/?q={s}
ve	VideoETA	videoeta.com/search?utf8=%E2%9C%93&keywords={s}
vf verben	VerbFormen	www.verbformen.de/konjugation/?i={s}
vg	Google (verbatim)	google.com/search?hl=en&q={s}&tbs=li:1
vh	Vantagehunt	www.vantagehunt.com/jobs?search={s}
vo weo eowiki wikieo vikipedio	Esperanto Wikipedia	eo.wikipedia.org/w/index.php?search={s}
vp	Price Charting	www.pricecharting.com/search-products?type=prices&q={s}&go=Go
vs	Vivid Seats	www.vividseats.com/Search.action?searchTerm={s}
vt virustotal	VirusTotal	www.virustotal.com/gui/search?query={s}
vw	Void Linux Wiki	wiki.voidlinux.org/index.php?search={s}&title=Special:Search&go=Go
vy	Vajeh Yab	www.vajehyab.com/?q={s}
w0	Wikizero	www.wikizero.com/search.php?s={s}&lang=en
w2	WIKI2	en.wiki2.org/w/index.php?search={s}
wa	Wolfram Alpha	wolframalpha.com/input?i={s}
wb wikibooks	Wikibooks	en.wikibooks.org/wiki/Special:Search?search={s}
wc weatherchannel	The Weather Channel	www.weather.com/search/enhancedlocalsearch?where={s}&loctypes=1/5/9/11/13/19/
wd wdt wikidata	Wikidata	www.wikidata.org/w/index.php?search={s}
we wen w.en enwiki wikien	Wikipedia (English)	en.wikipedia.org/w/index.php?search={s}
wf	fr.wikipedia.org	fr.wikipedia.org/wiki/Special:Search?search={s}
wg wu wunderground	Weather Underground	www.wunderground.com/cgi-bin/findweather/getForecast?query={s}
wh whw whow wikihow	wikiHow	www.wikihow.com/wikiHowTo?search={s}
wj	Wikipedia in Japanese	ja.wikipedia.org/wiki/{s}
wl wikileaks	WikiLeaks	search.wikileaks.org/?q={s}
wm	Wikipedia mobile	en.m.wikipedia.org/wiki?search={s}
wn wikinews	Wikinews	en.wikinews.org/wiki/Special:Search?search={s}
wo wetteronline	Wetter Online	www.wetteronline.de/wetter/{s}
wp wordpress	WordPress.org	wordpress.org/search/{s}
wq quotes	WikiQuote	en.wikiquote.org/wiki/Special:Search?search={s}
wr wrn wren	WordReference (EN)	www.wordreference.com/definition/{s}
ws wikisource	Wikisource	en.wikisource.org/w/index.php?search={s}&title=Special:Search&go=Go
wt wdic wkten wtionary wictionary	Wiktionary	en.wiktionary.org/w/index.php?search={s}&title=Special:Search&go=Go
wv wikivoyage	Wikivoyage	en.wikivoyage.org/w/index.php?search={s}
ww wwen wikiwand	WikiWand	www.wikiwand.com/en/{s}
wy wkp wykop	Wykop.pl	www.wykop.pl/szukaj/{s}/?
wz	Warpzone e.V.	www.warpzone.ms/?s={s}
xf xojo	Xojo Forums	forum.xojo.com/conversations/all?search={s}
xl	!Xtend-Life	www.xtend-life.com/search-results?q={s}
xu	Xavier University	www.xavier.edu/search/?q={s}
y8	Y8	www.y8.com/search?utf8=%E2%9C%93&kind=game&q={s}
yc	Hacker News Search	hn.algolia.com/?query={s}
yd	YourDictionary	www.yourdictionary.com/search/?ydQ={s}
yf yfinance	Yahoo Finance	finance.yahoo.com/quote/{s}
yg sgd yeast	Saccharomyces Genome Database	www.yeastgenome.org/search?q={s}&is_quick=true
yh	Yandex Haritalar	yandex.com.tr/harita/?text={s}
yi	Yahoo Image Search	images.search.yahoo.com/search/images?p={s}
yj yjp	Yahoo Japan	search.yahoo.co.jp/search?p={s}
yn yubnub	Yubnub	yubnub.org/parser/parse?command={s}
yo	YoChicago	yochicago.com/?s={s}
yp	YellowPages	www.yellowpages.com/search?search_terms={s}
yv	Yahoo Video Search	video.search.yahoo.com/search/video?p={s}
yz	youzeek	youzeek.com/?lng=RU#xPAGE_V3-Artist_?lng=RU&Artist={s}&page=General
zd	Zelda Dungeon	www.zeldadungeon.net/?s={s}
zh	Zero Hedge	www.zerohedge.com/search-content?search_api_fulltext={s}
zu zeldauniverse	Zelda Universe	www.zeldauniverse.net/?s={s}
zw zeldawiki zeldapedia	Zelda Wiki	zeldawiki.wiki/w/index.php?search={s}
zz	ZeroZero	www.zerozero.pt/search.php?op=all&inputString={s}
@fb	Facebook User Page	facebook.com/{s}
/.j	Slashdot Japan	slashdot.jp/index2.pl?fhfilter={s}
0bo bom mojo	Box Office Mojo	boxofficemojo.com/search/?q={s}
101	101 Domain	www.101domain.com/domain-availability-search.htm?q={s}&sa.x=0&sa.y=0
118	TDC 118	118.dk/search/go?what={s}
140	140journos	140journos.com/search?q={s}
144	b144	b144.co.il/PrivateResults.aspx?&p_name={s}
17t	17TRACK	www.17track.net/en/track?nums={s}
180	180.no	www.180.no/Search/All?w={s}
1mg	1mg	www.1mg.com/search/all?name={s}
1p5	OnePeterFive	onepeterfive.com/?s={s}
20m	20 Minutes	www.20minutes.fr/search?q={s}
2hu	TouhouDB	touhoudb.com/Search?filter={s}
2nn	2NN	www.2nn.jp/word/{s}
2pl	2player.com	2player.com/search/?search={s}
3bm	3Bmeteo	www.3bmeteo.com/meteo/{s}
3da	3dagogo	3dagogo.com/search?q={s}
3dj	3DJuegos	www.3djuegos.com/?q={s}&zona=resultados-buscador&ni=1
4_b 4chrandom	4chan /b/	boards.4chan.org/b/catalog#s={s}
4cc	Implyingrigged	implyingrigged.info/w/index.php?search={s}
4ch	4chan Board	4chan.org/{s}
4ga	4chan /g/ archive	archive.rebeccablacktech.com/g/search/text/{s}/
4pl 4players	4players	www.4players.de/4players.php/suchergebnis/Allgemein/4players/?s={s}
4sq foursquare	Foursquare	foursquare.com/explore?q={s}
500 500px	500px	500px.com/search?q={s}
538	fivethirtyeight.com	fivethirtyeight.com/?s={s}
5ch 2channel 5channel	5channel	find.5ch.net/search?q={s}
5ew	D&D 5e Wikidot	dnd5e.wikidot.com/search:site/a/p/q/{s}
6pm	6pm.com	www.6pm.com/search?term={s}
7tv	7TV	7tv.app/emotes?q={s}
800	800notes.com	800notes.com/Phone.aspx/{s}
80k	80,000 hours	80000hours.org/search/?q={s}
911	911tabs	www.911tabs.com/search.php?search={s}&type=band
95g	9to5google	cse.google.com/cse?cx=008464549922976904202:uxmexxzm3k4&q={s}
990	990 Search (Foundation Center)	990finder.foundationcenter.org/990results.aspx?990_type=&fn={s}&st=&zp=&ei=&fy=&action=Search
999	999.md	999.md/ru/search?query={s}
a.t	Arcade Tokyo	arcade.tokyo/?s={s}
aaa	AAA	careers-calstate.aaa.com/search-results?keywords={s}
aaj	All About Jazz	www.allaboutjazz.com/php/article_center.php?in_artist={s}&in_album=&in_label=&in_author=&in_type=0&orderby=dt_pub
aam	AAM	careers.aam.com/us/en/search-results?keywords={s}
aau amau amazonau	Amazon Australia	www.amazon.com.au/s?k={s}
aaw	Ace Attorney Wiki	aceattorney.wikia.com/wiki/{s}
abb	ABB	new.abb.com/search/results#query={s}
abc	abcnotation	abcnotation.com/searchTunes?q={s}
abe amazonbe	Amazon Belgium	www.amazon.com.be/s?k={s}
abn	ABN Lookup	abr.business.gov.au/Search.aspx?SearchText={s}
abr	Amazon Brazil	www.amazon.com.br/s?k={s}
abs	AllBookstores	www.allbookstores.com/search?q={s}
aca amca azca am.ca amazonca	Amazon.ca	www.amazon.ca/s?k={s}
ace	Ace Hardware	www.acehardware.com/search?query={s}
ach archch archchine	Arch Chinese	www.archchinese.com/chinese_english_dictionary.html?find={s}
acl	ACL Anthology	www.aclweb.org/anthology/search/?q={s}
acm	ACM Guide	dl.acm.org/results.cfm?dlr=GUIDE&query={s}
acn amcn amazoncn	Amazon.cn	www.amazon.cn/s?k={s}
acs	ACS Publications	pubs.acs.org/action/doSearch?AllField={s}
acw	Animal Crossing Wikia	animalcrossing.wikia.com/wiki/Special:Search?query={s}
adb	Arquivo da Bola	arquivodabola.com.br/busca.html?termo={s}
adc cocoa appledev devapple	Apple Developer Center	developer.apple.com/search/index.php?q={s}
ade age ama azd a.at a.de ager amde amznde amazonde amazon_de	Amazon Germany / Austria	www.amazon.de/s?k={s}
adf	Apple dev form	developer.apple.com/forums/search?q={s}
adi	ADI	www.adiglobaldistribution.us/search?criteria={s}
adn	AnimeDigitalNetwork	animedigitalnetwork.fr/video#search={s}
adr	Adrenaline	www.adrenaline.com.br/?s={s}
ads adsbeta	ADS bumblebee	ui.adsabs.harvard.edu/#search/q={s}
adz	Audeze	www.audeze.com/search?q={s}*
aeo	American Eagle Outfitters	www.ae.com/search/{s}
aeq	AE7Q Amateur Extra Query Tools	ae7q.com/query/data/CallHistory.php?CALL={s}
aes aze a.es ames amazones	Amazon ES	www.amazon.es/s?k={s}
afc	Arsenal	www.arsenal.com/search?search={s}
afh	Android File Host	androidfilehost.com/?w=search&s={s}
afl	Adafruit Learn	learn.adafruit.com/search?q={s}
afp afpf	AFP	www.afpforum.com/AFPForum/Search/Results.aspx?pn=1&smd=8&fst={s}&fto=7&mui=3&t=2
afr azf amfr amazonfr	Amazon.fr	www.amazon.fr/s?k={s}
aft fruit adafruit	Adafruit	www.adafruit.com/search?q={s}
ags	Adventure Gamers	adventuregamers.com/games/search?keywords={s}
agw applegaming applegamingwiki	Apple Gaming Wiki	www.applegamingwiki.com/w/index.php?search={s}
ahd	american heritage dictionary	ahdictionary.com/word/search.html?q={s}&submit.x=0&submit.y=0
ahk	AutoHotkey	www.autohotkey.com/search/search.php?site=4&refine=0&template_demo=phpdig.html&result_page=search.php&search=Go+...&limite=100&option=start&path=docs/&query_string={s}
aie	Amazon Ireland	www.amazon.ie/s?k={s}
ain azi a.in amin amznin amazonin amazon.in	Amazon India	www.amazon.in/s?k={s}
aip	aip.org	scitation.aip.org/search?value1={s}&option1=fulltext
ais archiveis	archive.is	archive.is/search/?q={s}
ait a.it amit amazonit amazon.it	Amazon.it	www.amazon.it/s?k={s}
aja	Al Jazeera America	america.aljazeera.com/search.html?q={s}
ajb	Acha Jogo Barato	www.achajogobarato.com.br/search.html?query={s}
aje aljazeera intaljazeera	Al Jazeera	www.aljazeera.com/search/{s}
akc	American Kennel Club	www.akc.org/?s={s}
aks	AllKeyShop	www.allkeyshop.com/blog/catalogue/search-{s}/
ala	alaMaula	www.alamaula.com/q/{s}/S0
alb	alibaba	www.alibaba.com/trade/search?fsb=y&IndexArea=product_en&CatId=&SearchText={s}
alc eijirou	Alc Japanese English Dictionary	eow.alc.co.jp/search?q={s}
alf	ALF Insight	www.alfinsight.com/app/SearchResults?quickSearch={s}
alg	Algomation	www.algomation.com/search?q={s}
all	All in One	all-io.net/?q={s}
alp pkg pacman	Arch Linux Packages	www.archlinux.org/packages/?sort=&q={s}
alw	alpine linux wiki	wiki.alpinelinux.org/w/index.php?search={s}
amd	AMD	www.amd.com/en/search/site-search.html#q={s}
amf	Ask Metafilter	ask.metafilter.com/search.mefi?q={s}
amg allmus allmusic	All Music	www.allmusic.com/search/all/{s}
amo fad ffa firefox mozaddon firefoxaddon firefoxaddons	Firefox Add-ons	addons.mozilla.org/search/?q={s}
amu applemusic	Apple Music	music.apple.com/us/search?term={s}
anf	Abercrombie & Fitch	www.abercrombie.com/webapp/wcs/stores/servlet/Search?storeId=10051&catalogId=10901&langId=-1&departmentCategoryId=10000&search-field={s}
ani anilist	Anilist	anilist.co/search/anime?sort=SEARCH_MATCH&search={s}
anj	Action News Jax	www.actionnewsjax.com/?q={s}
ann animenewsnetwork	Anime News Network	www.animenewsnetwork.com/search?q={s}
anu	The Australian National University	find.anu.edu.au/search?filter=0&client=anu_frontend&proxystylesheet=anu_frontend&site=default_collection&btnG=Search&q={s}&search1=Go
anw	Algemeen Nederlands Woordenboek	anw.inl.nl/search?type=simple&q={s}
ao3	Archive of our Own	archiveofourown.org/works/search?utf8=%E2%9C%93&work_search[query]={s}
aoe	Age of Empires Wiki	ageofempires.wikia.com/wiki/Special:Search?search={s}
aol	AOL	search.aol.com/aol/search?enabled_terms=&s_it=comsearch&q={s}
aom	Art of Manliness	www.artofmanliness.com/?s={s}
apa	APA Style	apastyle.org/search.aspx?query={s}
apc	Australia Post Postcode Lookup	auspost.com.au/search?q={s}
aph	Arcade PreHacks	ArcadePrehacks.com/{s}
apk	APK Downloader	apps.evozi.com/apk-downloader/?id={s}
apl	Applied Physics Letters	scitation.aip.org/search?value1={s}&option1=all
apm atompackages	Atom Packages	atom.io/packages/search?q={s}
apo	Pale Moon Add-ons	addons.palemoon.org/search/?terms={s}
app	Amazon Prime Pantry	www.amazon.com/s/search-alias=pantry&field-keywords={s}
aps prl	APS Journals	journals.aps.org/search?q={s}
apt puc	Ubuntu Packages Search	packages.ubuntu.com/search?keywords={s}&searchon=all&suite=all&section=all
ara	Diari Ara	www.ara.cat/cercador/?text={s}
arb awerb	Awesome Ruby (LibHun)	ruby.libhunt.com/search?query={s}
ard	ARD Mediathek	www.ardmediathek.de/ard/search/{s}
ark	Intel Processor Specification	www.intel.com/content/www/us/en/search.html#cf-tabfilter=Products&q={s}
arl	The Ayn Rand Lexicon	aynrandlexicon.com/searchresults/index.html?q={s}
arr gearr	GamerEscape	ffxiv.gamerescape.com/wiki/Special:Search?search={s}
ars arstechnica	Ars Technica	arstechnica.com/search/?q={s}
arx arxiv	arXiv.org	arxiv.org/search?query={s}&searchtype=all
asa	Awesome SysAdmin (LibHunt)	sysadmin.libhunt.com/search?query={s}
asb	astrobites	astrobites.org/?s={s}
ash	Awesome Selfhosted	selfhosted.libhunt.com/search?query={s}
ask sask	Ask.com	www.ask.com/web?q={s}
asx	Australian Securities Exchange	www.asx.com.au/content/asx/search.html?q={s}
atd	allthingsd	allthingsd.com/?s={s}:
ath	Athletic.net	www.athletic.net/Search.aspx#?q={s}
ati	Access to Insight	www.accesstoinsight.org/search_results.html?q={s}
atk	America's Test Kitchen	www.americastestkitchen.com/search?q={s}
atl	ATL Wiki	atlwiki.net/Special:Search/{s}
atp	ATP World Tour	www.atpworldtour.com/Search/Site.aspx?q={s}
ats	Above Top Secret	www.abovetopsecret.com/search.php?q={s}
att	Advanced Tau Tactica	www.advancedtautactica.com/search.php?keywords={s}
atx	Atomix.vg	atomix.vg/?s={s}
au3	AutoIt Forums	www.autoitscript.com/forum/search/?q={s}
aub	Aalborg Universitetsbibliotek	kbdk-aub.primo.exlibrisgroup.com/discovery/search?query=any,contains,{s}&tab=Everything&search_scope=MyInst_and_CI&vid=45KBDK_AUB:AUB&lang=daprimo_library~2Flibweb~2Faction~2Fsearch.do&offset=0
auk a.uk amuk azuk amazonuk	Amazon.co.uk	www.amazon.co.uk/s?k={s}
aur	Arch User Repository	aur.archlinux.org/packages/?K={s}
avc	The A.V. Club	www.avclub.com/search/?q={s}
avg	AVG Secure Search	search.avg.com/search?q={s}
avi	Avicultura	avicultura.com/?s={s}
avw	Anevandos Wiki	anevandos.wikia.com/wiki/Special:Search?query={s}
awc	Aviation Weather Center	aviationweather.gov/data/metar/?id={s}&hours=0&include_taf=ye
awd	Amazon Warehouse Deals	www.amazon.com/s/url=search-alias=warehouse-deals&field-keywords={s}
aws	Amazon Web Services	docs.aws.amazon.com/search/doc-search.html?searchPath=documentation&searchQuery={s}
azl azlyrics	Az Lyrics	search.azlyrics.com/search.php?q={s}
azm azom	AZoM	www.azom.com/search.aspx?q={s}&site=all&fsb=1
azs	AZspot	azspot.net/search/{s}
b4x	B4X	www.b4x.com/android/forum/pages/results/?query={s}
bab	Bab.la FR	www.babla.fr/anglais-francais/{s}
bac	BuenosAiresConnect	buenosairesconnect.com/?s={s}
bam	Books-A-Million	www.booksamillion.com/search2?query={s}
bav bavarikon	bavarikon	bavarikon.de/search?terms={s}
bax	Bax-shop	www.bax-shop.nl/assortiment?keyword={s}&avz=true
bbb	Better Business Bureau	www.bbb.org/us/Find-Business-Reviews/name/{s}
bbc	BBC.co.uk	www.bbc.co.uk/search/?q={s}
bbr bkr	Basketball-Reference	www.basketball-reference.com/player_search.cgi?search={s}
bbt	BB&T Bank	www.bbt.com/search-results.html?query={s}
bby bestbuy	Bestbuy	www.bestbuy.com/site/olspage.jsp?id=pcat17071&type=page&st={s}&sc=Global&cp=1&nrp=15&sp=&qp=&list=n&iht=y&usc=All+Categories&ks=960
bcc	BCC	www.bcc.nl/search?fh_location=//catalog01/nl_NL/channel>{m2ebcc2enl}&search={s}
bce bdi	Bing dict	cn.bing.com/dict/search?q={s}
bcl	boston.craigslist.org	boston.craigslist.org/search/sss?query={s}
bcm	Brawl Custom Music	www.brawlcustommusic.com/index.php?song={s}&submit=Search
bco	Board Crucial dot Org	boardcrewcial.org/search/thread/{s}/
bcp	Best Current Practices	tools.ietf.org/html/bcp{s}
bct	Biblioteche civiche torinesi	bct.comperio.it/opac/search/lst?q={s}
bcw	Box Critters Wiki	boxcritters.wiki/?search={s}
bdb	Bad Dog Books	baddogbooks.com/?s={s}&post_type=product
bde ding dict-de beolingus	BEOLINGUS	dict.tu-chemnitz.de/dings.cgi?query={s}
bdh	Le blog du hacker	www.leblogduhacker.fr/?s={s}
bel	Bob Enyart Live	kgov.com/search?query={s}
beo	Beolingus De-en	dict.tu-chemnitz.de/dings.cgi?service=deen&query={s}
beu	Bertholdsson.eu	bertholdsson.eu/?s={s}
bfi	British Film Institute	www.bfi.org.uk/search/search-bfi/{s}
bfx	Bergfex	www.bergfex.at/suchen/?q={s}
bgc	Bankgirot - Search Bankgiro number by Company Name	www.bankgirot.se/en/sok-bg-nr/?company={s}
bgg boardgame	Board Game Geek	boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q={s}&B1=Go
bgl	Baby Gear Lab	www.babygearlab.com/search?ftr={s}
bgn	Bankgirot - Search Bankgiro number	www.bankgirot.se/en/sok-bg-nr/?bgnr={s}
bgo	Bankgirot - Search Bankgiro number by Organization Number	www.bankgirot.se/en/sok-bg-nr/?orgnr={s}
bgp	Hurricane Electrics Internet Services	bgp.he.net/search?search[search]={s}&commit=Search
bgs	Board Game Search (Australia)	www.boardgamesearch.com.au/#!/search/{s}
bhb bibhub biblehub	BibleHub	biblehub.net/search.php?q={s}
bho	British History Online	www.british-history.ac.uk/search?query={s}
bil billiger	Billiger.de	www.billiger.de/search?searchstring={s}
bio biography	Biography	www.biography.com/search?query={s}
bir bri	Bing Reverse Image Search	www.bing.com/images/search?q=imgurl:{s}&view=detailv2&iss=sbi
biz	IncFact	incfact.com/company/search/?q={s}
bjj	BJJ Heroes	www.bjjheroes.com/?s={s}
bjp	BJP	www.bjp.org/search/content?keys={s}
bkt bli bkit blink blinkit	Blinkit	blinkit.com/s/?q={s}
blb blueletterbible	Blue Letter Bible	www.blueletterbible.org/search/search.cfm?Criteria={s}&t=KJV#s=s_primary_0_1
bld	Blacks Law Dictionary	thelawdictionary.org/search2/?q={s}}
ble	Bluetooth LE Wiki	bluetoothle.wiki/start?do=search&id=start&q={s}
blf	BudgetLightForum.com	budgetlightforum.com/search?q_as={s}
blg blenderguru	Blender Guru	www.blenderguru.com/?s={s}&submit.x=0&submit.y=0
blm	Blogmotion	blogmotion.fr/?s={s}
bln	Blender Nation	www.blendernation.com/?s={s}
blx	Blox.pl	www.blox.pl/html?page=blogPublicSearch&container_search={s}
bmj	The BMJ	www.bmj.com/search/advanced/{s}
bmk	blendermarket.com	blendermarket.com/search?q={s}
bmo mbug bugzilla	Mozilla Bugzilla	bugzilla.mozilla.org/buglist.cgi?quicksearch={s}
bmp	Book My Parts	bookmyparts.com/?s={s}&post_type=product
bmr	Blue Moon Rising	bluemoonrising.com/?s={s}
bms bookmyshow	BookMY Show	in.bookmyshow.com/search/results/?_s=0.2&search={s}
bnf	Catalogue BNF	catalogue.bnf.fr/rechercher.do?motRecherche={s}
bnl	Bing Netherlands	www.bing.com/search?q={s}&cc=nl
bnr	BNR Metal Pages	www.bnrmetal.com/v5/search/search/{s}
boi isaac rebirth	Binding of Isaac: Rebirth Wiki	bindingofisaacrebirth.wiki.gg/index.php?search={s}
bol	bol.com	www.bol.com/nl/s/?searchtext={s}
boo susebug	openSUSE Bugzilla	bugzilla.opensuse.org/buglist.cgi?quicksearch={s}
bpi	Biodegradable Products Institute	products.bpiworld.org/companies?title=&field_industry_category_tid=&field_member_id_value={s}
bpl	Backpacking Light	www.backpackinglight.com/cgi-bin/backpackinglight/search.html?q={s}
bpm	Song Bpm	songbpm.com/{s}
bpo bpoi pybug	Python Bug Tracker	bugs.python.org/issue?search_text={s}
bpt	Brown Paper Tickets	www.brownpapertickets.com/browse.html?keywords={s}
brd	Boardreader	boardreader.com/s/{s}.html
brk	Bruun Rasmussen Auctioneers	www.bruun-rasmussen.dk/search.do?q={s}
bro	BroPages	bropages.org/{s}
brt brit ebrit britannica	Britannica.com	www.britannica.com/search?query={s}
bs4	Beautifulsoup	www.crummy.com/software/BeautifulSoup/bs4/doc/search.html?q={s}
bsa	Bible Society Australia	www.biblesociety.org.au/?s={s}&x=0&y=0
bsb	Bayerische Staatsbibliothek	opacplus.bsb-muenchen.de/discovery/search?query=any,contains,{s}&tab=Everything&search_scope=MyInst_and_CI&vid=49BVB_BSB:VU1&offset=0
bsc bscan blockscan	Blockscan	blockscan.com/home/searchaddress?searchAddress={s}
bsi	Business Insider	www.businessinsider.com/s?q={s}
bsl	SignBSL	www.signbsl.com/sign/{s}
bsp	blendswap.com	www.blendswap.com/blends/search?keywords={s}
bsr	BlueSkyRotor	www.blueskyrotor.com/performance/search/index.php?keyword={s}
bst	Barbershop Tags	www.barbershoptags.com/dbpage.php?pg=tags&go=Go&_searchq={s}
bsw	Blade and Soul Wiki	bladeandsoul.gamepedia.com/index.php?search={s}
btc	Blockchain.com	www.blockchain.com/search?search={s}
bts dbts dbugs debbug	Debian Bug Tracking System	bugs.debian.org/cgi-bin/bugreport.cgi?bug={s}
bub	BookBub	www.bookbub.com/search?search={s}
bum bakaupdatesmanga	Baka-Updates Manga	www.mangaupdates.com/search.html?search={s}
buz	www.buzer.de	www.buzer.de/s1.htm?a=&g={s}
bvg	BVG	fahrinfo.bvg.de/Fahrinfo/bin/query.bin/?from={s}
bwc	Belfry Web Comics	belfrycomics.net/pg/?searchtype=Titles&searchpat={s}
bws	BWS	bws.com.au/search?searchTerm={s}
bxr	BSD Cross Reference	bxr.su/search?refs={s}
byu	Brigham Young University	www.byu.edu/search-all?q={s}
c++ cxx stl rcpp cplusplus	cplusplus.com	www.cplusplus.com/search.do?q={s}
c21	Channel21	www.channel21.de/catalogsearch/result/?q={s}
c24	Chrono24	www.chrono24.com/search/index.htm?watchTypes=&query={s}&dosearch=true&searchexplain=1&accessoryTypes=
c2c	Camptocamp	www.camptocamp.org/summits/list/snam/{s}
c2e	Google Translate (Czech to English)	translate.google.com/#cs/en/{s}
c74	Cycling '74	cycling74.com/search?q={s}
caa	Canadian Automobile Association	www.caa.ca/?s={s}&submit=Search&lang=en
cad	CADdetails	www.caddetails.com/search?q={s}
cah calvinandhobbes	Calvin and Hobbes	michaelyingling.com/random/calvin_and_hobbes/search.php?phrase={s}
cam	University of Cambridge	search.cam.ac.uk/web?query={s}
can canada	Canada.ca	www.canada.ca/fr/sr/srb.html?q={s}&wb-srch-sub=#wb-land
cap ccm cmc ccap coin cmcap coinmc coinmarketcap	CoinMarketCap	coinmarketcap.com/search/?q={s}
cas	Common Chemistry (CAS Registry Number)	www.commonchemistry.org/ChemicalDetail.aspx?ref={s}
cat iec diec	Institut d'Estudis Catalans	dlc.iec.cat/results.asp?txtEntrada={s}
cbc	CBC News	www.cbc.ca/search?q={s}
cbd	Christianbook.com	www.christianbook.com/Christian/Books/easy_find?Ntt={s}&N=0&Ntk=keywords&action=Search&Ne=0
cbk	Carminbook	carminbook.com/?s={s}
cbn	Christian Broadcasting Network	www1.cbn.com/cbn-search?search_term={s}&site=default_collection
cbr	Comic Book Roundup	comicbookroundup.com/search_results.php?f_search={s}
cbs	Artikelen van het CBS	www.cbs.nl/nl-nl/zoeken/?query={s}
cbx choual choualbox	Choualbox	choualbox.com/recherche?q={s}
ccb	Climbbybike.com	www.climbbybike.com/climbs_selection.asp?Mountainname={s}
ccc camel	CamelCamelCamel	camelcamelcamel.com/search?sq={s}
ccd	FoxHollow CCD	hamster.foxhollow.ca/ccd/index.php?keywords={s}
cck	cinemaclock	cinemaclock.com/search?r=bri&m=Vancouver&key={s}
ccl	CCL	www.cclonline.com/search/?q={s}
ccp	Canadian Couch Potato	canadiancouchpotato.com/?s={s}&submit=Search
ccu	CoinCheckup	coincheckup.com/coins/{s}
cda	CDA	cda.chronomania.net/search.php?search={s}
cdc	CDC	www.cdc.gov/search.do?queryText={s}
cdd	CheapDigitalDownload	cheapdigitaldownload.com/catalog/search-{s}
cde	Computer Desktop Encyclopedia	lookup.computerlanguage.com/host_app/search?cid=C999999&term={s}&lookup.x=0&lookup.y=0
cdj	CDJapan	www.cdjapan.co.jp/products?q={s}
cdl	Collins Dictionaries (English for Learners)	www.collinsdictionary.com/dictionary/english-cobuild-learners/{s}
cdm	Cafe del Montenegro	www.cdm.me/pretraga/{s}
cdn	Cdn js	www.cdnjs.com/#/search/{s}
cdp	CDP (Carbon Disclosure Project)	www.cdp.net/en/responses?utf8=%E2%9C%93&queries[name]={s}
cds	CDS Portal	cdsportal.u-strasbg.fr/#{s}
cdt cth	Collins English Thesaurus	www.collinsdictionary.com/dictionary/english-thesaurus/{s}
cdu	CDUniverse	www.cduniverse.com/sresult.asp?HT_Search_Info={s}
cdw	CDW	www.cdw.com/shop/search/result.aspx?key={s}
ceb	eBay: completed listings	www.ebay.com/csc/items/?_nkw={s}+&LH_Complete=1
cep	Consultar CEP	www.consultarcep.com.br/resultados.html?q={s}
cev	BibleGateway: Contemporary English Version	www.biblegateway.com/quicksearch/?quicksearch={s}&qs_version=CEV
cex	CeX	uk.webuy.com/search/index.php?stext={s}
cfa	CFA Institute	www.cfainstitute.org/en/search#q={s}
cfb	Channel Fireball	store.channelfireball.com/products/search?query={s}
cfd	Cold Fusion Docs	cfdocs.org/{s}
cfe	Coding For Entrepreneurs	www.codingforentrepreneurs.com/search/?q={s}
cfn cloudformation	AWS CloudFormation Documentation	docs.aws.amazon.com/search/doc-search.html?searchQuery={s}&this_doc_product=AWS+CloudFormation
cfp	WikiCFP	wikicfp.com/cfp/servlet/tool.search?q={s}&year=f
cfr	eCFR	www.ecfr.gov/cgi-bin/searchECFR?q1={s}
cge cgerrit	Chromium Review	chromium-review.googlesource.com/q/{s}
cgl	craigslist	pittsburgh.craigslist.org/search/sss?query={s}
cgp	Catalog of Government Publications	catalog.gpo.gov/F?func=find-b&find_code=WRD&request={s}
cgt	cgtrader	www.cgtrader.com/3d-models?keywords={s}
cgw	Chinese Grammar Wiki	resources.allsetlearning.com/gramwiki/?search={s}
chd	CampHikeDrive	camphikedrive.blogspot.com.au/search?q={s}&m=1
che gws	Chrome Web Store Extensions	chrome.google.com/webstore/search/{s}?_category=extensions
chl	Church History Library	catalog.churchofjesuschrist.org/search/_simple/{s}?lang=eng
chp computerhope	Computer Hope	www.computerhope.com/search2.htm?q={s}
chs	SoChain	chain.so/address/{s}
cia	CIA World Factbook	www.cia.gov/search?q={s}&site=WORLD_FACTBOOK&btnG=Search&x=0&y=0&output=xml_no_dtd&client=CIA&myAction=/search&proxystylesheet=CIA&submitMethod=get&sort=date:D:L:d1&oe=UTF-8&ie=UTF-8&ud=1&exclude_apps=1
cib	Classification Internationale des Brevets (2016)	patentscope.wipo.int/search/en/result.jsf?query={s}&sortBy=-score
cie	Paper.sc	paper.sc/search/?as=page&query={s}
cif	Cinema In Focus	www.cinemainfocus.com/search?q={s}
cio	Company.info	company.info/organisations/search?q={s}
civ civilization	Civilization Wikia	civilization.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
ck2 ckiiwiki	CK2Wiki	ck2.paradoxwikis.com/index.php?search={s}
ckt	Creation Kit	www.creationkit.com/index.php?search={s}
clc	CLC Nederland	clcnederland.com/producten/zoeken?sq={s}
cld	Cloudinary	support.cloudinary.com/hc/en-us/search?utf8=%E2%9C%93&query={s}
clf	Command Line Fu	www.commandlinefu.com/commands/matching/{s}/bys=/sort-by-votes
clj	ClojureDocs	clojuredocs.org/search?q={s}
clr	Clear Linux* Project	clearlinux.org/search?search={s}
clu	Catalogue Leiden University	catalogue.leidenuniv.nl/primo-explore/search?query=any,contains,{s}&tab=all_content&search_scope=All_Content&vid=UBL_V1&lang=en_US&offset=0
cme	Chicago Music Exchange	www.chicagomusicexchange.com/search?query={s}
cmi	CMI Library	library.cmi.ac.in/cgi-bin/koha/opac-search.pl?q={s}
cml	Columbus Metropolitan Library	catalog.clcohio.org/polaris/search/searchresults.aspx?term={s}
cms	Chicago Manual of Style	www.chicagomanualofstyle.org/search.epl?q={s}
cnh	Conservative Home	www.conservativehome.com/?s={s}
cnm	Central New Mexico Community College	www.cnm.edu/@@gcse-searchresults?q={s}
cnn	CNN	www.cnn.com/search/?q={s}
cnt	Casino News Today	casinonews.today/?s={s}
cnz ccnz	Cheapies NZ	www.cheapies.nz/search/node/{s}
cog	Cloud of Goods	www.cloudofgoods.com/s/products?query={s}
col	Colourbox	www.colourbox.com/search/find?q={s}
com	Computernewb Wiki	computernewb.com/w/index.php?search={s}
coq	Coq	coq.inria.fr/distrib/current/refman/search.html?q={s}
cor	Cornish-English Dictionary	www.cornishdictionary.org.uk/home?locale=en#{s}
cos	Consequence of Sound	consequenceofsound.net/?s={s}
cow cbwiki	Combine OverWiki	combineoverwiki.net/index.php?search={s}&title=Special:Search&go=Go
cpb	Cpu Benchmarks	www.passmark.com/search/zoomsearch.php?zoom_query={s}
cpc	CPC	cpc.farnell.com/search?st={s}
cpg cygwin	Cygwin Package Grep	cygwin.com/cgi-bin2/package-grep.cgi?grep={s}
cpl	Chicago Public Library	chipublib.bibliocommons.com/search?&t=title&search_category=title&q={s}
cpt	CPT Codes	coder.aapc.com/cpt-codes/{s}
crc	Chain Reaction Cycles	www.chainreactioncycles.com/searchresults?descriptionfilter={s}
cri	The Criterion Collection	www.criterion.com/search#stq={s}
crr	Chemistry Reference Resolver	chemsearch.kovsky.net/index.php?q={s}
crs	Crunchyroll	www.crunchyroll.com/search?from=&q={s}
crt	crt.sh	crt.sh/?q={s}
crw	Clash Royale Wiki	clashroyale.fandom.com/wiki/Special:Search?query={s}
crx cws chrome cstore cwebstore chromestore chromewebstore	Chrome Web Store	chromewebstore.google.com/search/{s}
csa androidcs android-code	Android Code Search	cs.android.com/search?q={s}
csc	Chicken Scheme Chickadee	api.call-cc.org/cdoc?q={s}&query-regex=Regexp
csi coolstuffinc	CoolStuffInc	www.coolstuffinc.com/main_search.php?pa=searchOnName&page=1&resultsPerPage=25&q={s}
csm commonsensemedia	Common Sense Media	www.commonsensemedia.org/search/{s}
css mdncss	Mozilla Developer Network CSS	developer.mozilla.org/en-US/search?q={s}&topic=css
csu	CheckShortURL	checkshorturl.com/expand.php?u={s}
csv	Computer Service & Vertrieb	www.csv.de/artsearchresult.php?STICHWORT={s}
csw	Chicken Scheme Wiki	wiki.call-cc.org/search?text={s}&ident=
ctd	Cheaper Than Dirt	www.cheaperthandirt.com/SolrSearchResults.aspx?site=All+Products&num=15&q={s}
ctt	CTT	www.ctt.pt/feapl_2/app/open/objectSearch/objectSearch.jspx?objects={s}
ctv	CTV	www.ctv.ca/searchResult.aspx?q={s}
cul	Cornell University Library	newcatalog.library.cornell.edu/search?q={s}
cup	Cambridge University Press	www.cambridge.org/gb/search?query={s}
cve	Common Vulnerabilities and Exposures (CVE)	www.cve.org/CVERecord/SearchResults?query={s}
cvm	CV Market	www.cvmarket.lt/joboffers.php?op=search&search[keyword]={s}
cvo cvofire	CVO	www.cvo.co.uk/?s={s}
cvr	Danish Central Business Register	datacvr.virk.dk/data/visninger?soeg={s}
cvs	CVS	www.cvs.com/search/_/N-0?searchTerm={s}&pt=global
cwe	Common Weakness Enumeration	cse.google.com/cse?oe=utf8&ie=utf8&source=uds&q={s}&start=0&cx=012899561505164599335:tb0er0xsk_o
cwj	CWJobs	www.cwjobs.co.uk/jobs/{s}
cwt	Crossword Tracker	crosswordtracker.com/answer/{s}/
cyb	Cyberlearn	cyberlearn.hes-so.ch/course/search.php?search={s}
cye	Chooseyourevent.co.uk	www.chooseyourevent.co.uk/keywordsearch.asp?searchterms={s}
czc	CZC.cz	www.czc.cz/search?q-fulltext={s}
d&d dnd dndbeyond	D&D Beyond	www.dndbeyond.com/search?q={s}
d&r	d&r	www.dr.com.tr/search?q={s}
d20 srd d20srd	The Hypertext d20 SRD	www.d20srd.org/search.htm?q={s}
d2w	Diablo II Wiki	diablo2.diablowiki.net/index.php?title=Special:Search&redirs=1&search={s}&fulltext=Search&ns0=1&ns14=1
d4u	Datasheet4u	datasheet4u.com/share_search.php?sWord={s}
d66	D66	d66.nl/?s={s}
dax ddg duckduckgo	DuckDuckGo	duckduckgo.com/?q={s}
dbd	Dead by Daylight Wiki	deadbydaylight.wiki.gg/index.php?search={s}
dbk	Databaze knih	www.databazeknih.cz/search?q={s}
dbl	Discord Bot List	discordbots.org/search?q={s}
dbm doubanmovie	Douban Movie	movie.douban.com/subject_search?search_text={s}
dbo bukdev	BukkitDev	dev.bukkit.org/search?search={s}
dbp	Dropbox Paper	paper.dropbox.com/?q={s}
dbr danbooru	Danbooru	danbooru.donmai.us/posts?tags={s}+rating:safe
dbv	Dragonbolt Vanguard Wiki	dragonbolt-vanguard.wikia.com/search?query={s}
dcc deen dende dictcc dict.cc	dict.cc	www.dict.cc/?s={s}
dcn dicn	Dict.cn Chinese<>English Dictionary	dict.cn/{s}
dcp	Dynacase documentation	docs.anakeen.com/dynacase/stable/#{s}
dcr	dcrainmaker.com	www.dcrainmaker.com/?s={s}
dcw	DCinside wiki	wiki.dcinside.com/wiki/{s}
ddb	Deutsche Digitale Bibliothek	www.deutsche-digitale-bibliothek.de/searchresults?query={s}
dde ddgde	Duckduckgo Germany	duckduckgo.com/?kl=de-de&q={s}
ddi dgi dim ddgi dggi ddg-i ddg-img ddg-imgs ddg-pics ddg-image ddg-images ddg-pictures	DuckDuckGo Images	duckduckgo.com/?q={s}&iax=images&ia=images
ddn	Dayton Daily News	www.daytondailynews.com/google-search/?q={s}
ddo dkord ordnet	Den Danske Ordbog	ordnet.dk/ddo/ordbog?query={s}
deb dtr dpkg dpts dpackages debianpack debpackages	Debian Packages	packages.debian.org/search?keywords={s}
dei	Deichmann (Deutschland)	www.deichmann.com/DE/de/shop/search.html?q={s}
des	The free dictionary ES	es.thefreedictionary.com/{s}
dew	de.wikipedia.org	de.wikipedia.org/wiki/{s}
dex	Index	index.hu/24ora/?word=1&pepe=1&tol=1999-01-01&ig=2016-01-18&s={s}
dfa	Dog Food Advisor	www.dogfoodadvisor.com/?s={s}
dfw dorf dwarf dfwiki	DwarfFortress Wiki	dwarffortresswiki.org/index.php?title=Special:Search&search={s}
dgg	GG - dejure.org	dejure.org/gesetze/GG/{s}.html
dgs	De gule sider	www.degulesider.dk/person/resultat/{s}
dhc	High Court of Delhi	delhihighcourt.nic.in/SiteSearch.asp?zoom_query={s}
dhg	DHgate	www.dhgate.com/wholesale/search.do?act=search&sus=&searchkey={s}
dhl	DHL	mydhl.express.dhl/us/en/tracking.html#/results?id={s}
dia	Instant Answers	duck.co/ia?q={s}
die lpm	Linux.die.net man pages	www.die.net/search/?q={s}
dig host	dig Lookup	networking.ringofsaturn.com/Tools/dig.php?domain=ANY+{s}
dio invd invid invidio invidious	Invidious	invidio.us/search?q={s}
dir route groute	Google.de Maps	www.google.de/maps/dir/{s}
dis discogs	Discogs	www.discogs.com/search?q={s}&type=all
dit demauro	Dizionario Internazionale De Mauro	dizionario.internazionale.it/parola/{s}
diy	DIY Network	www.diynetwork.com/search/{s}
dji	DJI	store.dji.com/product-search?q={s}
djs	Discord.JS Docs	discord.js.org/#/docs/main/stable/search?q={s}
dkc	Digikey.ca	www.digikey.ca/product-search/en?x=-1308&y=-74&lang=en&site=ca&KeyWords={s}
dkp	Diksiyonaryo	diksiyonaryo.ph/search/{s}
dky dgky	Digikey	www.digikey.com/products/en?keywords={s}
dlc	DLCompare	www.dlcompare.com/search?q={s}
dlf	dlf	www.deutschlandfunk.de/suchergebnisse.448.de.html?search[submit]=1&search[withNews][]=WithNews&search[word]={s}
dll	DLL-files.com	www.dll-files.com/search.php?q={s}
dlo	dict.leo.org (german-english)	dict.leo.org/german-english/{s}
dmg appsmac macapps appstoremac	App Store (Mac)	apps.apple.com/mac/search?term={s}
dmi dmiby	DMI Byvejr	www.dmi.dk/byindex?by={s}
dnb	Deutsche Nationalbibliothek	portal.dnb.de/opac/simpleSearch?query={s}
dnf	DNF Documentation	dnf.readthedocs.io/en/latest/search.html?q={s}
dnp	Der Neue Pauly	referenceworks.brillonline.com/search?s.q={s}&s.f.s2_parent=s.f.book.der-neue-pauly
dns	MXToolbox (dns)	mxtoolbox.com/SuperTool.aspx?action=a:{s}&run=toolpage
dnt	Norwegian Trekking Association	www.dnt.no/sok/?q={s}
dnw danawa	Danawa	search.danawa.com/dsearch.php?query={s}
doc	DoctorOfCredit	www.doctorofcredit.com/?s={s}
dog	CanIGiveMyDog	canigivemydog.com/?s={s}
doi	Digital Object Identifier	doi.org/{s}
dom	Mozilla Developer Network (API)	developer.mozilla.org/en-US/search?topic=api&q={s}
dot	Digital Ocean Tutorials	www.digitalocean.com/community/tutorials?q={s}
dox	Amdocs	www.amdocs.com/search?search={s}
dpb derpi derpibooru derpibooruorg	Derpibooru	derpibooru.org/search?q={s}
dpc	DVDpasCher	dvdpascher.net/recherche/?q={s}
dpg	DPG Verhandlungen	www.dpg-verhandlungen.de/year/2019/conference/regensburg/search?query={s}&submit=Search
dpi	Dogpile Images	www.dogpile.com/search/images?q={s}
dpl deepl	DeepL Translator	www.deepl.com/translator#xx/en/{s}
dpm	DPM LOL	dpm.lol/{s}
dpn	Dogpile News	www.dogpile.com/search/news?q={s}
dpr dpreview	Digital Photgrapy Review	www.dpreview.com/search/?query={s}
dpt dicio	Dicio	www.dicio.com.br/pesquisa.php?q={s}
dpv	Dogpile Video	www.dogpile.com/search/video?q={s}
dpw	Dogpile Web	www.dogpile.com/search/web?q={s}
drf	Django REST Framework	www.django-rest-framework.org/?q={s}
dro	Retskrivningsordbogen (dansk)	dsn.dk/?retskriv={s}
drs rs-docs	Docs.rs - Documentation for Rust packages	docs.rs/{s}
ds1 dsw	Dark Souls Wiki	darksouls.wiki.fextralife.com/{s}
dsa	Wiki Aventurica	wiki-aventurica.de/wiki/index.php?title=Spezial:Suche&search={s}
dsc	Debian Screenshots	screenshots.debian.net/packages?utf8=%E2%9C%93&search={s}
dsd	Den Store Danske	www.denstoredanske.dk/Special:Opslag?q={s}
dsr	Dota 2 subreddit	www.reddit.com/r/DotA2/search?q={s}&restrict_sr=on&sort=relevance&t=all
dst	Debian Security Tracker	security-tracker.debian.org/tracker/{s}
dtc	DansTonChat	danstonchat.com/search.html?search={s}
dtg	data.gouv.fr	www.data.gouv.fr/search/?q={s}
dtn	Discover the Networks	www.discoverthenetworks.org/search/?q={s}
dub	Dub Package Registry	code.dlang.org/search?q={s}
duc	Duke University Catalog	find.library.duke.edu/?search_field=all_fields&q={s}
duk r-uk	DuckDuckGo UK	duckduckgo.com/?q={s}&kah=uk-en&kl=uk-en&ia=web
dul	Duke University Libraries	library.duke.edu/find/all?Ntt={s}
dvb	DVB	m.dvb.de/de/verbindungsauskunft/verbindungen.do?vaform[startname]={s}
dvp dvlp developpez	Developpez.com	www.developpez.com/recherche/?q={s}
dvr	Xbox DVR	xboxdvr.com/gamer/{s}
dwd	Deutscher Wetterdienst (WarnWetter)	www.dwd.de/DE/wetter/warnungen/warnWetter_node.html?ort={s}
dww tardis	The Doctor Who Wiki	tardis.wiki/wiki/Special:Search?search={s}
dxn dcom d.com	Dictionary.com	www.dictionary.com/browse/{s}?s=ts
dxo	dxomark.com	www.dxomark.com/?s={s}
dxr mozdxr	Mozilla DXR Code Search	dxr.mozilla.org/mozilla-central/search?q={s}
dyn	Dynasty Reader	dynasty-scans.com/search?q={s}
e-c	e-chords	www.e-chords.com/search-all/{s}
e2c	Google Translate (English to Czech)	translate.google.com/#en/cs/{s}
e5p	Everything 5 Pounds	www.everything5pounds.com/en/search/?q=:bestSeller&text={s}
ean	EAN Search	www.ean-search.org/perl/ean-search.pl?q={s}
eat ebayat	ebay.at	www.ebay.at/sch/items/?_nkw={s}
eau ebau ebayau	ebay.com.au	www.ebay.com.au/sch/items/?_nkw={s}
ebc	ebay (Canada)	www.ebay.ca/sch/{s}
ebd eatbydate	Eat By Date	eatbydate.com/search/?q={s}
ebe ebbe ebaybe	ebay.be	www.befr.ebay.be/sch/items/?_nkw={s}
ebg	EB Games	ebgames.com.au/any/any?q={s}
ebi	European Bioinformatics Institute	www.ebi.ac.uk/ebisearch/search.ebi?db=allebi&query={s}
eca ebca ebayca	ebay.ca	www.ebay.ca/sch/items/?_nkw={s}
ech ebch ebaych	ebay.ch	www.ebay.ch/sch/items/?_nkw={s}
eci	El Corte Ingles	www.elcorteingles.es/multi-search/?s={s}
ecs	Soton Electronics and Computer Science	secure.ecs.soton.ac.uk/kb/search/?q={s}&s=1
edb	Exploits Database by Offensive Security (exploit-db.com)	www.exploit-db.com/search/?action=search&description={s}
edc	Everyday Carry	everydaycarry.com/search{s}
ede ebde ebayde	ebay.de	www.ebay.de/sch/items/?_nkw={s}
edf	Elite Dangerous Forum	forums.frontier.co.uk/search.php?do=process&query={s}
edh	El Diario de Hoy	www.elsalvador.com/search?s={s}
edm	edmofy.com	edmofy.com/?s={s}
edw	Elite: Dangerous Wiki	elite-dangerous.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
edx	Edx	www.edx.org/course?search_query={s}
ees ebes ebayes	ebay (ES)	www.ebay.es/sch/items/?_nkw={s}
eff	Electronic Frontier Foundation	www.eff.org/search/site/{s}
efr ebfr ebayfr	ebay.fr	www.ebay.fr/sch/items/?_nkw={s}
eft	Escape From Tarkov Gamepedia	escapefromtarkov.gamepedia.com/{s}
ego	Gnome Extensions	extensions.gnome.org/#search={s}
egs	Epic Games Store	www.epicgames.com/store/en-US/store-search?q={s}
egt engadget	Engadget	www.engadget.com/search/?q={s}
ehk ebhk ebayhk	ebay.com.hk	shop.ebay.com.hk/?_nkw={s}&_sacat=See-All-Categories
ehu	Evony Hookups	www.evonyhookups.info/?s={s}
eic	Education in Chemistry	eic.rsc.org/searchresults?qkeyword={s}
eie ebie ebayie	ebay.ie	www.ebay.ie/sch/items/?_nkw={s}
ein ebin ebayin	ebay.in	shop.ebay.in/?_nkw={s}&_sacat=See-All-Categories
eit ebit ebayit	ebay.it	www.ebay.it/sch/items/?_nkw={s}
ejw	Econ Journal Watch	econjwatch.org/search/?m=all&q={s}
eka ebaykleinanzeigen	Ebay Kleinanzeigen	www.ebay-kleinanzeigen.de/s-{s}/k0
ekb	eBay Kleinanzeigen Berlin	kleinanzeigen.ebay.de/anzeigen/s-berlin/{s}/k0l3331
ekh	eBay Kleinanzeigen Hamburg	www.ebay-kleinanzeigen.de/s-hamburg/{s}/k0l9409
ekl	eBay Kleinanzeigen Leipzig	www.ebay-kleinanzeigen.de/s-leipzig/{s}/k0l4233
elb	Bibleserver (ELB)	www.bibleserver.com/text/ELB/{s}
ele	Electron	electronjs.org/search?q={s}
elf	Elfetex	www.elfetex.cz/catalogsearch/result/?q={s}
ell	English Language Learners	ell.stackexchange.com/search?q={s}
elm	Elm Search	klaftertief.github.io/elm-search/?q={s}
elw wel elwiki wikiel	Greek Wikipedia	el.wikipedia.org/w/index.php?search={s}
elx	Eve Lexicon	evelexicon.com/term/{s}
ema	European Medicines Agency	www.ema.europa.eu/ema/index.jsp?curl=pages/includes/medicines/medicines_landing_page.jsp&searchkwByEnter=true&quickSearch={s}
emc	Electronic Medicines Compendium	www.medicines.org.uk/emc/search?q={s}
emo	Emotiyou	www.emotiyou.com/search/{s}
emp	EMP	www.emp.de/search/{s}/
emu	Emulation General Wiki	emulation.gametechwiki.com/index.php?search={s}
emy ebmy ebaymy	ebay.com.my	shop.ebay.com.my/?_nkw={s}&_sacat=See-All-Categories
enc encyclo	Encyclo	www.encyclo.nl/begrip/{s}
enl ebnl ebaynl	ebay.nl	www.ebay.nl/sch/items/?_nkw={s}
ens ensembl	Ensembl	www.ensembl.org/Multi/Search/Results?q={s};site=ensembl
eol	Encyclopedia of Life	eol.org/search?q={s}&search=Go
eom encyclopediaofmath	Encyclopedia of Mathematics	www.encyclopediaofmath.org/index.php?title=Special:Search&search={s}
eop	eune.OP.GG	eune.op.gg/summoner/userName={s}
eor	Eorzea Database	eu.finalfantasyxiv.com/lodestone/playguide/db/search/?q={s}
eos	Eosdigitaal.nl	www.eosdigitaal.nl/forum/search.php?keywords={s}&terms=all&author=&sc=1&sf=all&sk=t&sd=d&sr=posts&st=0&ch=300&t=0&submit=Zoeken
epa	US Environmental Protection Agency	search.epa.gov/epasearch/?querytext={s}&areaname=&areacontacts=&areasearchurl=&typeofsearch=epa&result_template=#/
epd	EpisoDate	www.episodate.com/search?q={s}
eph ebph ebayph	ebay.ph	shop.ebay.ph/?_nkw={s}&_sacat=See-All-Categories
epl ebpl ebaypl	ebay.pl	shop.ebay.pl/?_nkw={s}&_sacat=See-All-Categories
epw	Episode World	www.episodeworld.com/search/?searchitem={s}
eq2	EQ2i	eq2.wikia.com/wiki/Special:Search?query={s}
eqd	Equestria Daily	www.google.com/cse?cx=partner-pub-6285692791338183:7732117278&ie=UTF-8&q={s}
eqr	EQ Resource	eqresource.com/search.php?q={s}
erf	ERF	www.erf.de/?node=1097&page=1&NAV_CatSelect=0&NAV_MetaSuchtext={s}
erl	Erlang Docs	erlang.org/doc/search/?q={s}
es1	Ethnic Smart Wholesale	www.ethnicsmart.com/catalogsearch/result/?q={s}
esg ebsg ebaysg	ebay.com.sg	shop.ebay.com.sg/?_nkw={s}&_sacat=See-All-Categories
esh xsh eshell explainshell	explainshell	explainshell.com/explain?cmd={s}
eso	Esolangs	esolangs.org/w/index.php?search={s}&title=Special:Search
est	Emacs Stack Exchange	emacs.stackexchange.com/search?q={s}
esv	ESV Bible	www.esv.org/search/?q={s}
etc	Electronic Theatre Controls	www.etcconnect.com/Search.aspx?q={s}
etg	Enter the Gungeon Wiki	enterthegungeon.wiki.gg/index.php?search={s}
eth etherscan	EtherScan	etherscan.io/search?q={s}
etw	Eat The Weeds	www.eattheweeds.com/?s={s}
eu3	Europa Universalis III Wiki	www.eu3wiki.com/index.php?title=Special:Search&search={s}
eu4 eu4wiki	EU4 Wiki	eu4.paradoxwikis.com/index.php?search={s}
euk ebuk ebayuk	ebay.co.uk	www.ebay.co.uk/sch/items/?_nkw={s}
eut	Essen und Trinken	www.essen-und-trinken.de/suche#site=eut&category=Rezept&query={s}&page=1&sorting=relevance
eve	Eve University	wiki.eveuniversity.org/index.php?search={s}
evo	Eauxvives	www.eauxvives.org/forum/search.php?keywords={s}
evs	Eesti-vene	eki.ee/dict/evs/index.cgi?Q={s}
ewc	Eternal Warcry: Cards	eternalwarcry.com/cards?query={s}
exa	ExaSoft	www.exasoft.cz/default.asp?cls=stoitems&stifulltext_search=and&fulltext={s}
exp	IrfanTOOR Exploits	irfantoor.com/exploits?s={s}
ext filext	FILExt	filext.com/file-extension/{s}
eyb	Eat Your Books	www.eatyourbooks.com/bookshelf?q={s}
ezt	Easytrieve Document	techdocs.broadcom.com/us/en/ca-mainframe-software/devops/ca-easytrieve-report-generator/11-6/search.html?q={s}&page=1
f64	F64.ro	www.f64.ro/{s}
fab	Fab	fab.com/search/?q={s}
faf	Filmaffinity	www.filmaffinity.com/es/advsearch2.php?q={s}:
fas fonta faicon fontawesome	Font Awesome	fontawesome.com/search?q={s}
faw flightaware	FlightAware	flightaware.com/live/flight/{s}
faz	Frankfurter Allgemeine	www.faz.net/suche/?query={s}
fbm	Facebook Messages	www.facebook.com/messages/search?action=search-snippet&mquery={s}
fbp	Facebook Pages	www.facebook.com/search/top/?q={s}&type=pages
fbr	Pro Football Reference	www.pro-football-reference.com/player_search.fcgi?search={s}
fbs	FBSchedules	www.fbschedules.com/search.php?q={s}
fcc	ForoCoches	www.forocoches.com/foro/search.php?do=process&titleonly=1&query={s}
fda	FDA	search.usa.gov/search?utf8=%E2%9C%93&affiliate=fda&query={s}&commit=Search
fdf	Freshdesk forums	support.freshdesk.com/support/search/topics?term={s}
fdl feedly	Feedly	feedly.com/i/search/{s}
fdo	freedesktop.org	www.google.com/search?sitesearch=http://www.freedesktop.org/wiki/&q={s}&gws_rd=ssl
fds	Freshdesk solutions	support.freshdesk.com/support/search/solutions?term={s}
fe7	Fire Emblem Fandom Wiki	fireemblem.fandom.com/search?query={s}
fee	Foundation for Economic Education (FEE)	fee.org/search/?q={s}
feh fehw	Fire Emblem Heroes Wiki	feheroes.gamepedia.com/index.php?search={s}
fer	University of Zagreb Faculty of Electrical Engineering and Computing	www.fer.unizg.hr/search?sq={s}&s_skip=0
few fewiki	Fire Emblem Wiki	fireemblemwiki.org/w/index.php?title=Special:Search&search={s}
fex	Fireside Xpressions	www.firesidexpressions.com/index.php?route=product/search&search={s}
ffc	Found Footage Critic	foundfootagecritic.com/?s={s}
ffi	Finder.fi	www.finder.fi/search?what={s}
ffm	Fast Food Music	fastfoodmusic.com/?s={s}
ffn	FanFiction	www.fanfiction.net/search/?keywords={s}&ready=1&type=story
ffs	freefallsupport.com	www.freefallsupport.com/?s={s}
ffw	Fanfiction.net Writers	www.fanfiction.net/search.php?type=writer&keywords={s}&match=title&sort=0&genreid=0&subgenreid=0&characterid=0&subcharacterid=0&words=0&ready=1&categoryid=0#
ffz	FrankerFaceZ	www.frankerfacez.com/emoticons/?q={s}
fgf	Flightgear Forums	www.flightgear.org/forums/search.php?keywords={s}
fhq	FidgetHQ	fidgethq.com/search?q={s}
fid	File.net	www.file.net/process/{s}.html
fim fimfic fimfiction	FimFiction.net	www.fimfiction.net/stories?q={s}
fin	finviz.com	finviz.com/search.ashx?p={s}
fip	Fip Radio	www.fip.fr/player/{s}
fiu	Fonts in Use	fontsinuse.com/search?terms={s}
fkb	Biblioteket Frederiksberg	fkb.dk/search/ting/{s}
fkk	fkk-freunde	fkk-freunde.info/search.php?keywords={s}
fkt felleskatalogen	Felleskatalogen	felleskatalogen.no/medisin/sok?sokord={s}
fld	Front Line Defenders	www.frontlinedefenders.org/en/search/{s}
fle	DocCheck Flexikon	flexikon.doccheck.com/de/Spezial:Suche?q={s}
flr	FluidLang subreddit	www.reddit.com/r/FluidLang/search?q={s}&restrict_sr=on
flt flutter	Flutter	flutter.io/search/?q={s}
fly	FlyBase	flybase.org/search/{s}
fm4	Radio FM4	fm4.orf.at/elasticsearch?query={s}&sort=date
fma	Free Music Archive	freemusicarchive.org/search/?quicksearch={s}&sort=track_interest
fmd fashionmodeldirectory	The Fashion Model Directory	www.fashionmodeldirectory.com/search/?q={s}
fmi	Ilmatieteen Laitos	ilmatieteenlaitos.fi/saa/{s}
fms	Foromedios	www.foromedios.com/index.php?app=core&module=search&do=search&andor_type=&sid=&search_app_filters[forums][sortKey]=date&search_app_filters[forums][sortKey]=date&search_app_filters[forums][searchInKey]=&search_term={s}&search_app=forums
fmx	Fightmatrix	www.fightmatrix.com/fighter-search/?fName={s}
fnb	Fanburst	www.fanburst.com/search?q={s}
fnd	fnd	fnd.io/#/us/search?mediaType=all&term={s}
fok	FOK!	zoeken.fok.nl/zoek/?searchmode=simple&tab=fok&startdate=&enddate=&startdatelast=&enddatelast=&bycreator=&byuser=&orderby=relevance&s_fields[]=titel&s_fields[]=bericht&s_fields[]=reacties&status[]=open&status[]=gesloten&status[]=sticky&status[]=openstick&status[]=centraal&q={s}
fot	FotMob	www.fotmob.com/search?q={s}
fow	Force Of Will English Card Database	www.fowtcg.com/cards?w={s}
fox	Fox News	www.foxnews.com/search-results/search?q={s}&submit=Search
fpo	freepatentsonline	www.freepatentsonline.com/result.html?sort=relevance&srch=top&query_txt={s}&submit=&patents=on
fps fedpack fedorapkg	Fedora Package Search	packages.fedoraproject.org/search?query={s}
fqm	Frequent Miler	frequentmiler.com/?s={s}
frc fgcs frcs fcaesar	Frag Caesar	www.frag-caesar.de/lateinwoerterbuch/{s}-uebersetzung.html
frg	Fast Replacement Glass	www.fastreplacementglass.com/index.php?route=product/search&search={s}
fri	France Inter	www.franceinter.fr/recherche?q={s}
frs freesound	Freesound	www.freesound.org/search/?q={s}
frw	Freewave	www.freewave.at/?s={s}
fsc	Futura Sciences	www.futura-sciences.com/magazines/sciences/recherche/?q={s}
fsd fsfd	Free Software Directory	directory.fsf.org/wiki?title=Special:Search&search={s}&fulltext=Search
fsf	Free Software Foundation	www.fsf.org/search?SearchableText={s}
fsh	foodsharing.de	wiki.foodsharing.de/index.php?search={s}
fsk	FreeSteamKeys	www.freesteamkeys.com/search_gcse/?q={s}
fsm	Futurism	futurism.com/?s={s}
ftb	Official Feed The Beast Wiki	ftb.gamepedia.com/index.php?search={s}
ftk	Farmacotherapeutisch Kompas	www.farmacotherapeutischkompas.nl/snelzoeken?zoekterm={s}&domein=geneesmiddelen
ftl	Ftl: Faster Than Light Wiki	ftl.wikia.com/wiki/Special:Search?query={s}
ftn	Fortuneo	www.fortuneo.fr/recherche?term={s}
fts	FinTech Studios	apollo.fintechstudios.com/search?searchQuery={s}
ftu	FreeTutorials.Us	www.freetutorials.us/?s={s}
ftw factorio	Factorio wiki	wiki.factorio.com/index.php?search={s}&title=Special:Search&go=Go
fup	FilmUP.com	filmup.com/cgi-bin/search.cgi?ps=10&fmt=long&sy=0&q={s}
fwb filmweb	Filmweb	www.filmweb.pl/search?q={s}
fwy	Fayerwayer	www.fayerwayer.com/?q={s}
fxp	FXP	www.fxp.co.il/google.php?q={s}
fxr	FreeBSD Cross Reference	fxr.watson.org/fxr/ident?i={s}
fye	FYE	www.fye.com/search?q={s}
fyt	Fiyatlab	www.fiyatlab.com/?s={s}
g24 gday	Google (Past 24h)	www.google.com/search?q={s}&tbs=qdr:d
g2a	G2A	www.g2a.com/search?query={s}
g2p g2play	g2play	www.g2play.net/catalogsearch/result/index/?q={s}
g4y	games4you.rs	games4you.rs/search-glavni?search_api_views_fulltext={s}
gab	Gab	gab.ai/search/{s}
gae	Google AE	www.google.ae/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gag	GirlsAskGuys	www.girlsaskguys.com/search?q={s}
gah gethuman	GetHuman	gethuman.com/phone-number/search/{s}
gap	Anime+	graph.anime.plus/{s}
gar	Google AR	www.google.com.ar/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gas	Google American Samoa	www.google.as/search?q={s}
gat	Google AT	www.google.at/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gau	Google AU	www.google.com.au/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gba	Gmail by account	mail.google.com/mail/u/{s}
gbc	Great British Chefs	www.greatbritishchefs.com/search2#?pi=1&ps=48&st={s}&orderby=
gbe	Google BE	www.google.be/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gbf	Granblue Fantasy Wiki	gbf.wiki/index.php?search={s}
gbk gbm	Google Bookmarks	www.google.com/bookmarks/l#!q={s}
gbn	GAMEBANANA	gamebanana.com/search?query={s}
gbo	German-Bash.org	german-bash.org/?searchtext={s}&search_in=both&action=search_
gbr	Google BR	www.google.com.br/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gbs	Gigablast Encrypted	gigablast.org/search?c=main&index=search&q={s}
gca	Google CA	www.google.ca/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gcc	Google Images (Commercial Reuse)	www.google.com/search?tbm=isch&tbs=sur:fmc&as_q={s}
gch	Google CH	www.google.ch/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gci gck	Google Cook Islands	www.google.co.ck/search?q={s}
gcl	Google CL	www.google.cl/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gcm gcmap	Great Circle Mapper	www.gcmap.com/mapui?P={s}
gcn	Google CN	www.google.cn/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gco	Google CO	www.google.com.co/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gcp	Google Cloud Platform	cloud.google.com/s/results/?q={s}
gcs	Google Cloud Search	cloudsearch.google.com/cloudsearch/search?q={s}
gcu	Google Cuba	www.google.com/search?q={s}&tbs=ctr:countryCU&cr=countryCU
gcw	Deutsches Creepypasta Wikia	de.creepypasta.wikia.com/wiki/Spezial:Suche?query={s}
gcy	Google Cyprus	www.google.com.cy/search?q={s}
gcz	Google CZ	www.google.cz/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gdd godot	Godot Docs	docs.godotengine.org/en/stable/search.html?q={s}&check_keywords=yes&area=default
gde	Google DE	www.google.de/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gdk	Google DK	www.google.dk/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gds goodsearch	Goodsearch	www.goodsearch.com/search-web?keywords={s}
gdt	Grand Dictionnaire Terminologique	gdt.oqlf.gouv.qc.ca/resultat.aspx?terme={s}
gdv gview gviewer	Google Docs viewer	docs.google.com/viewer?url={s}
gec gecuador	Google Ecuador	www.google.com.ec/search?safe=active&q={s}
gee	Google EE	www.google.ee/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gem gems rubygems	RubyGems	rubygems.org/search?query={s}
geo	NCBI Gene Expression Omnibus	www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={s}
ges	Google Spain	www.google.es/search?q={s}
gex	gexsi	search.gexsi.com/en/search/?q={s}
gfa	Persian Google	www.google.com/search?hl=fa&q={s}
gfc	greatfirewallofchina.org	greatfirewallofchina.org/index.php?siteurl={s}
gfg geeks	geeksforgeeks	www.geeksforgeeks.org/search/?gq={s}
gfi	Google finland	www.google.fi/search?q={s}
gfk grafikart	grafikart	www.grafikart.fr/search?q={s}
gfl gflights	Google Flights	www.google.com/travel/flights/search?q={s}
gfr	Google FR	www.google.fr/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
ggb	Geogebra	www.geogebra.org/search/{s}
ggd	Google Guadeloupe	www.google.gp/?gws_rd=ssl#q={s}
ggj	Global Game Jam	globalgamejam.org/?q={s}
ghc ghcode	GitHub Code	github.com/search?q={s}&type=Code
ghd githubdocs	GitHub Docs	docs.github.com/search?query={s}
ghh ghs githubhelp githubsupport	GitHub Help	support.github.com/?q={s}
ghk	Google HK	www.google.com.hk/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
ghl	Groene Hart Lyceum	www.groenehartscholen.nl/lyceum/?s={s}
ghn	GitHub Notifications	github.com/notifications?query={s}
ghp	GitHub Private Search	github.com/search?q=is:private+{s}
ghr ghrepo	GitHub Repo	github.com/{s}
ght	GitHub Trending	github.com/trending/{s}
ghu	Google HU	www.google.hu/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gia	GIA	www.gia.edu/cs/Satellite?pagename=GST/Dispatcher&childpagename=GIA/Page/ReportCheck&c=Page&cid=1355954554547&reportno={s}
gib	Gibiru	gibiru.com/results.html?q={s}
gid	Google ID	www.google.co.id/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gie	Google IE	www.google.ie/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gii	Gesetze im Internet	www.gesetze-im-internet.de/cgi-bin/htsearch?config=Gesamt_bmjhome2005&method=and&words={s}
gik	Google IL	www.google.co.il/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gin googlein	Google India	www.google.co.in/search?q={s}
gip	Glosbe (itpl)	glosbe.com/it/pl/{s}
gir	Dear Computer Google Image Ripper SFW	dearcomputer.nl/gir/?q={s}&s=8&imgtype=any
gis	Google Image Search	www.google.com/search?site=imghp&tbm=isch&q={s}
gjp	Google JP	www.google.co.jp/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gkr	Google KR	www.google.co.kr/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gld glassdoor	Glassdoor	www.glassdoor.com/Search/results.htm?keyword={s}
glk	Google LK	www.google.lk/search?q={s}
gln gtin	GEPIR Suche	www.gepir.de/?search={s}
glt	Google LT	www.google.lt/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
glu	Google Luxembourg	www.google.lu/search?q={s}
glv	Google LV	www.google.lv/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gmc	Google Maps Classic	www.google.com/maps?q={s}&output=classic
gmd mapsr	Google Maps Directions With Two Addresses	www.google.com/maps/dir/{s}
gme	GM electronic	www.gme.cz/vysledky-vyhledavani?search_keyword={s}
gmg gmgf	greenmangaming.com	www.greenmangaming.com/search/{s}
gml	GML Bokhandel	www.gml.se/bocker/sok?q={s}
gmr	Gumraod	gumroad.com/discover?query={s}
gmx	Google (mx)	www.google.com.mx/#q={s}
gmy	Google MY	www.google.com.my/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gnb	Bibleserver Gute Nachricht Bibel	www.bibleserver.com/search/GNB/{s}/1
gnl	Google NL	www.google.nl/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gnm	Google News (mobile)	www.google.com/m/search?site=news&q={s}
gno	Google NO	www.google.no/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gns gnes	Google News Spain	www.google.com/search?q={s}&hl=es&prmd=niv&source=lnms&tbm=nws&sa=
gnt	Generation Nouvelles Technologies	www.generation-nt.com/s/{s}/
gnu bash	GNU Bash Homepage	www.gnu.org/cgi-bin/estseek.cgi?phrase={s}
gnz	Google New Zealand	www.google.co.nz/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
god	Guts of Darkness	www.gutsofdarkness.com/god/recherche.php?r1={s}
gog	GOG.com	www.gog.com/games?query={s}
gol	GamingOnLinux	www.gamingonlinux.com/index.php?module=search&q={s}
gos	Guru Of Sales	guruofsales.com/?s={s}
got	Gathering of Tweakers	gathering.tweakers.net/forum/find?keyword={s}
gov	US Government Search	search.usa.gov/search?affiliate=usagov&query={s}
gpa	Google Play Apps	play.google.com/store/search?q={s}&c=apps
gpb	Google Play Books	play.google.com/store/search?c=books&q={s}
gpe	Google PE	www.google.com.pe/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gpg	OpenPGP Key Search	keys.openpgp.org/search?q={s}
gph	Google Philippines	www.google.com.ph/search?hl=en&q={s}&tbs=ctr:countryPH&cr=countryPH
gpi	Glosbe (plit)	glosbe.com/pl/it/{s}
gpk gopkg golang	Go Package Reference	pkg.go.dev/search?q={s}
gpl	Google PL	www.google.pl/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gpo ebuild emerge genpkg ebuilds gentoopkg gpackages	Gentoo Packages	packages.gentoo.org/packages/search?q={s}
gps	Google Product Search	www.google.com/search?hl=en&tbm=shop&q={s}
gpt	Google PT	www.google.pt/search?q={s}
gq+ gotquestions	GotQuestions	www.gotquestions.org/search.php?zoom_query={s}
grf	goblinrefuge.com	goblinrefuge.com/mediagoblin/search/?query={s}
gri rgi	Google Reverse Image Search	lens.google.com/uploadbyurl?url={s}
gro	Google RO	www.google.ro/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
grp	Grails Plugins	plugins.grails.org/?query={s}&submit=Search
grs	Google RS	www.google.rs/search?q={s}
gru	Google RU	google.ru/search?hl=ru&q={s}
gsa	GSA Advantage	www.gsaadvantage.gov/advantage/s/search.do?q=0:0{s}&db=0&searchType=1
gsc gsch gschol papers scholar gscholar googlescholar	Google Scholar	scholar.google.com/scholar?&q={s}
gse	Google SE	www.google.se/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gsg	Google SG	www.google.com.sg/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gsi	Google SI	www.google.si/search?q={s}
gsk	Google SK	www.google.sk/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gsl	Google SL	www.google.com.sl/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gsm gsma gsmarena	GSM Arena	www.gsmarena.com/results.php3?sName={s}
gso	Google over StackOverflow	www.google.com/search?q=+[inurl:http://stackoverflow.com]+{s}
gsp	GegenStandpunkt Verlage	de.gegenstandpunkt.com/artikel/suche?modus=AND&volltextsuche={s}
gsv	Google Swedish	google.com/search?hl=sv&q={s}
gsw	GreaseSpot Wiki	wiki.greasespot.net/index.php?title=Special:Search&fulltext=Search&search={s}
gsx	Google Shopping Express	www.google.com/shopping/express/#SearchResultsPlace:s=0&c=24&q={s}
gtf	GlockTalk Forums	www.glocktalk.com/search/10717176/?q={s}&o=date
gth	Google TH	www.google.co.th/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gtm	Gta5-mods	fr.gta5-mods.com/search/{s}
gtn	Google Tunisia	www.google.tn/search?q={s}
gtr	Google TR	www.google.com.tr/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gtw	Google TW	www.google.com.tw/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gua	Google UA	www.google.com.ua/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
guk g.uk googleuk	Google UK	www.google.co.uk/search?q={s}
gus	Google US	www.google.com/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gvb	Google Verbatim	google.com/search?&tbs=li:1&q={s}
gve	Google VE	www.google.co.ve/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gvk	Gemeinsamer Verbundkatalog	gso.gbv.de/DB=2.1/CMD?MATCFILTER=N&MATCSET=N&ACT0=&IKT0=&TRM0=&ACT3=*&IKT3=8183&ACT=SRCHA&IKT=1016&SRT=YOP&TRM={s}
gvn	Google VN	www.google.com.vn/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gw2 gw2wiki	Guild Wars 2 Wiki	wiki.guildwars2.com/index.php?search={s}
gwi	Gowatchit	gowatchit.com/search?terms={s}
gwm	Girls with muscle	www.girlswithmuscle.com/images/?name={s}
gwr	Guinness World Records	www.guinnessworldrecords.com/search?term={s}
gwu	The George Washington University	www.gwu.edu/search/site?search_query={s}
gww	Guild Wars Wiki	wiki.guildwars.com/index.php?search={s}
gza	Google ZA	www.google.co.za/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
gzc	Google Simplified Chinese	www.google.com/search?q={s}&lr=lang_zh-CN
gzh giez geizhals giezhals	Geizhals	www.geizhals.at/eu/?such={s}
h2m	Hard2mano	duckduckgo.com/?q={s}&sites=hard2mano.com
hac	Home Assistant Community	community.home-assistant.io/search?q={s}
had hackaday	HackADay	hackaday.com/?s={s}
hak	The Hydrogenaudio Knowledgebase	wiki.hydrogenaudio.org/index.php?title=Special:Search&search={s}&go=Go
hal	HAL	hal.archives-ouvertes.fr/search/index/?q={s}
haq	Hakkani	hakkani.org/?term={s}
hbl	Hufvudstadsbladet	www.hbl.fi/?s={s}
hbm	Heart Bows & Makeup	www.heartbowsmakeup.com/?s={s}
hbt	Home Brew Talk	www.homebrewtalk.com/search/?keyword={s}
hbz	Hochschulbibliothekszentrum des Landes Nordrhein-Westfalen	okeanos-www.hbz-nrw.de/F/?func=find-c&ccl_term=WRD="{s}"
hcr helium	Helium Code	github.com/search?type=code&q=repo:imputnet/helium+{s}
hdb	Hockeydb.com	www.hockeydb.com/ihdb/stats/find_player.php?full_name={s}
hdc homedepotca	Home Depot Canada	www.homedepot.ca/en/home/search.html?q={s}
hdl	Heise Download	www.heise.de/download/search?terms={s}
hds	All Datasheet Catalog	search.datasheetcatalog.net/key/{s}
hdt	HDtracks.com	www.hdtracks.com/catalogsearch/result/?q={s}
hdu	Hangzhou Dianzi University Online Judge	acm.hdu.edu.cn/search.php?field=problem&key={s}
hdx hode homedepot	Home Depot	www.homedepot.com/s/{s}
heb	HEB Grocery Company	www.heb.com/search/?q={s}
hex color	ColorHexa	www.colorhexa.com/{s}
hfd	Hugging Face Datasets	huggingface.co/datasets?search={s}
hfm	Hugging Face Models	huggingface.co/models?search={s}
hfs	Hifishark	www.hifishark.com/search?q={s}
hft	Harbor Freight Tools	www.harborfreight.com/search?q={s}
hfu	Hochschule Furtwangen	www.hs-furtwangen.de/suche/?L=0&id=207&tx_solr[q]={s}
hga	Holbein Gymnasium Augsburg	holbein-gymnasium.de/index.php/component/search/?searchword={s}
hgs	Herold - Gelbe Seiten	www.herold.at/gelbe-seiten/was_{s}/
hhc	Hexagon Hot Chocolate	hexagonhotchocolate.wordpress.com/?s={s}
hi5	Hi5	hi5.com/friend/processHeaderNameSearch.do?searchText={s}
hio	Hackaday.io	hackaday.io/search?term={s}
hip	hip pressure cooking	www.hippressurecooking.com/?s={s}
hjs howjsay	HowJSay	howjsay.com/search?word={s}
hkg hckg hackage	Hackage	hackage.haskell.org/packages/search?terms={s}
hkw hkwiki	Hollow Knight Wiki	hollowknight.wiki/mw/index.php?search={s}
hlb hltb howlongtobeat	HowLongToBeat	howlongtobeat.com/?q={s}
hlj	HobbyLink Japan	hlj.com/search/go?w={s}
hln	Het Laatste Nieuws	www.hln.be/zoeken?query={s}
hmo	Home Manager - Option Search	home-manager-options.extranix.com/?query={s}&release=master
hnd	Hacker News (sort by date)	hn.algolia.com/?query={s}&sort=byDate
hno	hackernoon	hackernoon.com/search?q={s}
hnu	Hochschule Neu-Ulm	www.hs-neu-ulm.de/nc/suchergebnisse/?id=1289&L=0&q={s}
hoh	Heaven of Horror	www.heavenofhorror.com/?s={s}
hol	Klingon Assault Group	hol.kag.org/a/{s}
hon	honto	honto.jp/netstore/search_10{s}.html?srchf=1&tbty=0
hou	Houdini Documentation	cse.google.com/cse?cx=001106583893786776783:u81vudxhm7a&ie=UTF-8&q={s}&sa=Search&siteurl=www.sidefx.com/docs/houdini/&ref=www.sidefx.com/docs/&ss=504j116288j4
hpb	Half Price Books	www.hpb.com/products?utf8=%E2%9C%93&keywords={s}
hpc housepets	Housepets!	www.housepetscomic.com/?s={s}
hpf hpcf	Housepets! Forums	www.housepetscomic.com/forums/search.php?keywords={s}
hpp hpluspedia	H+Pedia	hpluspedia.org/index.php?search={s}
hpv	Heise.de Preisvergleich	www.heise.de/preisvergleich/?fs={s}
hro	Hogeschool Rotterdam	www.hogeschoolrotterdam.nl/zoek/?q={s}
hrv	HotelRestoVisio	www.restovisio.com/search?sq={s}
hsb	soblexx	soblexx.de/?cmd=search_soblex&p_w={s}
hsl	Helsingin Seudun Liikenne	www.hsl.fi/search/solr?keywords={s}
hsw	HowStuffWorks	computer.howstuffworks.com/search.php?terms={s}
htf howtoforge	HowtoForge	www.howtoforge.com/trip_search?keys={s}
htg howtogeek	How-To Geek	www.howtogeek.com/search/?q={s}
htw	HTW Dresden	www.htw-dresden.de/suche.html?tx_kesearch_pi1[sword]={s}
hud	University of Huddersfield Library	hud.summon.serialssolutions.com/search?ho=t&l=en&fvf=ContentType,Book+Review,t&q={s}&limit=everything
hum humblebest	Humble Bundle (Bestselling)	www.humblebundle.com/store/search?sort=bestselling&search={s}
hun	HealthUnlocked	healthunlocked.com/search/{s}
hvg	HVG.hu	hvg.hu/kereses?term={s}&x=0&y=0
hvv	HVV	geofox.hvv.de/jsf/home.seam?destination={s}
hwd thr	The Hollywood Reporter	www.hollywoodreporter.com/search/{s}
hws	Hacking With Swift	www.hackingwithswift.com/search/{s}
hwz	Hardware Zone Forums	www.hardwarezone.com.sg/search/forum/?{s}
hxh	Hunterpedia	hunterxhunter.wikia.com/wiki/Special:Search?query={s}
hyp hyperninjas	HyperNinjas	hyperninjas.com/search?q={s}
hyt	Hytiva	www.hytiva.com/search?searchString={s}
iav	IAV Automotive Engineering	www.iav.com/search/site/{s}
iaw	Infinity WIki	infinitythewiki.com/en/{s}
ibc	MTB-News	www.mtb-news.de/forum/search/12469693/?q={s}&o=relevance
ibd	Investor's business daily	research.investors.com/stock-quotes/nasdaq-apple-inc-{s}.htm?fromsearch=1
ibm	IBM	www.ibm.com/Search/?q={s}&v=16&en=utf&lang=en&cc=us&Search=Search
ibs	Internet Bookshop Italia	www.ibs.it/search/?ts=as&query={s}
ica	google canada	www.google.ca/imghp?{s}
icd	Code Suche	www.icd-code.de/suche/icd/recherche.html?sp=0&sp=S{s}
ici	Radio-Canada	ici.radio-canada.ca/recherche?q={s}
icm icheckmovies	iCheckMovies	www.icheckmovies.com/search/movies/?query={s}
ico	ICObench	icobench.com/icos?s={s}
idd	Impossibile da dimenticare	www.google.it/cse?cx=partner-pub-5110806989181281:4419033070&q={s}
ide idealo idealode	Idealo	www.idealo.de/preisvergleich/MainSearchProductCategory.html?q={s}
idg	Doomworld/idgames	www.doomworld.com/idgames//index.php?search=1&field=title&sort=time&order=desc&word={s}
idi	I Do Imaging	idoimaging.com/programs/fulltext?utf8=%E2%9C%93&Program[fulltext]={s}
idl	Interactive Data Language Documentation	www.nv5geospatialsoftware.com/docs/SearchResults.aspx?q={s}
ids	Instant Domain Search	instantdomainsearch.com/#search={s}
iel	Inspired eLearning Support	support.inspiredelearning.com/help/search/?phrase={s}
iep	Internet Encyclopedia of Philosophy	www.iep.utm.edu/{s}
ies	Inglise-eesti	www.eki.ee/dict/ies/index.cgi?Q={s}
iet	IET Digital Library	digital-library.theiet.org/search?value1={s}&option1=all&option2=contentType&pageSize=20&value2=
iex	IEX	www.iex.nl/Zoeken/Default.aspx?q={s}
iga	IGA Grocery Store	www.iga.net/en/search?k={s}
igg indiegogo	Indiegogo	www.indiegogo.com/explore?q={s}
ign	IGN	www.ign.com/search?q={s}
iid iidrn	Is It Down Right Now?	www.isitdownrightnow.com/{s}.html
ilm	ilmeteo.it	www.ilmeteo.it/meteo/{s}
imb	imbiomed	www.imbiomed.com.mx/1/1/articulos.php?method=searchKeyword&keywords={s}
imd	IMDb	www.imdb.com/find?q={s}+&s=all
imh	InMotion Hosting Support Center	www.inmotionhosting.com/support/search?searchword={s}
ims	Instituto Moreira Salles	ims.com.br/?s={s}
ind	India.com	www.india.com/searchresult/?q={s}
ing	ING DiBa	www.ing.de/suche/?query={s}
inl	Instituut voor de Nederlandse taal	ivdnt.org/zoeken-in-woordenboeken?w={s}
inn	Israel National News - Arutz Sheva 7	www.israelnationalnews.com/Search.aspx?string={s}
ino	Inoreader	www.inoreader.com/search/{s}
inp	DDG images excluding Pinterest	duckduckgo.com/?q=-site:pinterest.com+{s}&iar=images&iax=images&ia=images
ins instructables	Instructables	www.instructables.com/howto/{s}
inv	inventaire.io	inventaire.io/search?q={s}
io9 gizmodo	Gizmodo	gizmodo.com/search?q={s}
iol	IOL	www.iol.co.za/search?q={s}
iop	Institute of Physics Science	iopscience.iop.org/nsearch?terms={s}&searchType=yourSearch
ios	iOS Developer Library	developer.apple.com/library/ios/search/?q={s}
iot	RoomAlert.ro	www.roomalert.ro/search?q={s}
ipa iapp iosapps appstore iphoneapps	App Store (iPhone)	apps.apple.com/iphone/search?term={s}
ipl	IPL	www.iplt20.com/search?term={s}
ips	Interpersonal Skills	interpersonal.stackexchange.com/search?q={s}
irc	irc.netsplit.de	irc.netsplit.de/channels/?chat={s}
irs	IRS	search.irs.gov/search?q={s}&proxystylesheet=irs_portals_frontend
isb	isbns.net	www.isbns.net/search/?query={s}
isc storm	Internet Storm Center	isc.sans.edu/ipinfo.html?ip={s}
iso distro distrowatch	DistroWatch	distrowatch.com/table.php?distribution={s}
iss issuu	Issuu	issuu.com/search?q={s}
isw	Instant Street View	www.instantstreetview.com/s/{s}
its	Itsumo Navi	www.its-mo.com/search/freeword/{s}
itv	ITV	www.itv.com/itvplayer/search/term/{s}
ixl	IXL	ca.ixl.com/search?q={s}
iya ymg	Yandex Images (en)	yandex.com/images/search?text={s}
jab	Jabong.com	www.jabong.com/find/{s}
jal	JAL	www.jal.co.jp/cgi-bin/jal/insite_search/index.cgi?keyword={s}&collection=jalcojp&charset=shift_jis
jam jamendo	Jamendo	www.jamendo.com/search?q={s}
jap	support.justaddpower.com	support.justaddpower.com/kb/search/?q={s}
jar	FindJar.com	www.findjar.com/index.x?query={s}
jax	JAX Docs	jax.readthedocs.io/en/latest/search.html?q={s}
jay	Jaycar	www.jaycar.com.au/search?text={s}
jbo	The Logical Language Group Online Dictionary	jbovlaste.lojban.org/lookup?Form=lookup.pl1&Strategy=*&Query={s}
jcp	Java Community Process	jcp.org/en/jsr/summary?id={s}
jdf	Journal des femmes	www.journaldesfemmes.com/s/{s}
jdg	Le Journal du Geek	www.journaldugeek.com/?s={s}
jdk java9	Java Oracle documentation	docs.oracle.com/apps/search/search.jsp?category=java&q={s}
jdl	JD Lighting	www.jdlighting.com.au/catalogsearch/result/?q={s}
jdn	JournalDuNet	www.journaldunet.com/s/{s}
jdw	J D Weatherpoon	www.jdwetherspoon.co.uk/home/pubs/find/{s}
jed	Joomla Extensions	extensions.joomla.org/extensions/extension/?searchall={s}&filter[tags][]=&filter[core_catid]=&filter[includes]=&filter[versions]=&filter[type]=&filter[hasdemo]=&filter[newupdated]=&filter[score]=&dir=DESC&limitstart=&controller=filter&view=extension&layout=list&Itemid=145&clearorders=0&clearfilters=1
jep	The Journal of Economic Perspectives	www.aeaweb.org/journals/jep/search-results?within[title]=on&within[abstract]=on&within[author]=on&journal=3&q={s}
jfl	Jerry Falwell Library	www.liberty.edu/library/search-results/?type=all&q={s}
jfm	Journal of Fluid Mechanics	www.cambridge.org/core/journals/journal-of-fluid-mechanics/listing?q={s}
jgf	The Jazz Guitar Forum	www.jazzguitar.be/forum/search.php?searchid={s}
jhg	Website des JHG-Traunreut	jhg-traunreut.de/index.php?q={s}&option=com_finder&view=search
jid jellyneo	JellyNeo	items.jellyneo.net/search/?name={s}
jig	JayIsGames	jayisgames.com/search/?q={s}
jik	Jisho (kanji search)	jisho.org/search/{s}%20%23kanji
jit	Jobintree	www.jobintree.com/emploi?keywords={s}
jiv	JouwICTvacature	www.jouwictvacature.nl/vacatures?s={s}
jme	jMonkeyEngine Forum	hub.jmonkeyengine.org/search?q={s}
jmp	Jemepropose.com	www.jemepropose.com/annonces?keywords={s}
jnn jovemnerd	Joven Nerd	jovemnerd.com.br/?s={s}
job	Job.am	job.am/hy/jobs?q={s}
jpc	JPC	www.jpc.de/s/{s}
jpd	Japan Dict	www.japandict.com/?s={s}
jpj	We Sell Car Plate Number Online, Malaysia	www.buycarplate.com/?m=scr&searchval={s}
jpl	NASA Jet Propulsion Laboratory	www.jpl.nasa.gov/search.php?q={s}
jqd	jquery	api.jquery.com/{s}/
jqm	jquerymobile.com	jquerymobile.com/?s={s}
jqu	jQuery UI	jqueryui.com/?s={s}
jra	JRA	www.jra.go.jp/search/top/index.html?q={s}
jrs	Jesuit Refugee Service Belgium	jrsbelgium.org/spip.php?page=recherche&recherche={s}
jsd	jsDelivr	www.jsdelivr.com/?query={s}
jso	Java questions on Stack Overflow	stackoverflow.com/search?q=[java]+{s}
jsr	JSR	jsr.io/packages?search={s}
jtw	Just The Word	www.just-the-word.com/api/combinations?word={s}
jvc	Japanese Verb Conjugator	japaneseverbconjugator.com/VerbDetails.asp?txtVerb={s}
jvj	JapaneseVehicles.com	www.japanesevehicles.com/stocklist.php?qsearch_kbn=1&lang=en&opt=0&qsearch={s}
jwh justwatch	JustWatch	www.justwatch.com/us/search?q={s}
jwi	JustWatch India	www.justwatch.com/in/search?q={s}
jwp jwpepper	J.W. Pepper Sheet Music	www.jwpepper.com/sheet-music/search.jsp?keywords={s}
k8s kubernetes	Kubernetes	kubernetes.io/search/?q={s}
kaa kag kai kga kassistant	Kagi Assistant	kagi.com/assistant?q={s}
kam	www.kamusiturki.com	kamusiturki.com/{s}
kas kaskus w3kaskus	Kaskus	www.kaskus.co.id/search?q={s}
kbb	Kelly Blue Book	www.kbb.com/search/?source=homepage&query={s}
kbe	Kagi Bang Explorer	kbe.smaertness.net/search?q={s}
kbn	Korben	korben.info/?s={s}
kbt	Kabutan	kabutan.jp/stock/?code={s}
kcl	King's College London	www.kcl.ac.uk/search/search.aspx#/all?term={s}
kcp	KaOS	github.com/KaOS-Community-Packages?query={s}
kdb kxref codekx techmonk	code.kx	code.kx.com/q/search?query={s}
keh	KEH Camera	www.keh.com/shop/catalogsearch/result/?q={s}
ker	The Linux Kernel Archives	git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/log/?h=v5.0.1&qt=grep&q={s}
key	Keybase	keybase.io/{s}
kfd	Kagi Feedback (Discussions)	kagifeedback.org/?q={s}
kfs	Keyforsteam	www.keyforsteam.de/catalogue/search-{s}/
kfz	Kfz-Kennzeichen	www.kfz-info.net/{s}-kfz-kennzeichen/
khi vgm	KHInsider Video Game Music	downloads.khinsider.com/search?search={s}
kid	Kiddle	www.kiddle.co/s.php?q={s}
kim	Kids In Mind	kids-in-mind.com/?s={s}
kit	KIT-Bibliothek	primo.bibliothek.kit.edu/primo_library/libweb/action/search.do?mode=Basic&vid=KIT&vl(freeText0)={s}&vl(freeText0)=test&fn=search&tab=kit&srt=date
kjv	King James Bible Online	www.kingjamesbibleonline.org/search.php?q={s}
kkc	Kingkiller Wiki	kingkiller.wiki/w/index.php?search={s}
kln	MicKey's Land	klnavarro.free.fr/spip/spip.php?page=recherche&recherche={s}
kmc	Kaltura	knowledge.kaltura.com/search?search_api_views_fulltext={s}
kmf	forum.keyboardmaestro.com	forum.keyboardmaestro.com/search?q={s}
knf	Komisja Nadzoru Finansowego PL	www.knf.gov.pl/wyniki_wyszukiwania?searchText={s}&publicationId=18&sortType=accuracy
kol kolw	The KoLwiki	kol.coldfront.net/thekolwiki/index.php/Special:Search?search={s}&go=Go
kon	Konsolentreff.de	www.konsolentreff.de/search/1/?q={s}
kos	KingOfSat	en.kingofsat.net/find.php?question={s}&Submit=Zap
kpe	Kalliope Verbundkatalog	kalliope.staatsbibliothek-berlin.de/de/search.html?q={s}
krl	Kitsap Regional Library	catalog.krl.org/polaris/search/searchresults.aspx?ctx=1.1033.0.0.9&type=Keyword&term={s}&by=KW&sort=RELEVANCE&limit=TOM=*&query=&page=0&searchid=1
kro kroger	Kroger	www.kroger.com/search?query={s}
ksl	KSL Classifieds	classifieds.ksl.com/search?keyword={s}
ksp kspwiki	Kerbal Space Program Wiki	wiki.kerbalspaceprogram.com/index.php?search={s}
ksu kitsu animes	Kitsu Anime	kitsu.io/anime?text={s}
ktb ktechbase	KDE TechBase	techbase.kde.org/Special:Search?search={s}&fulltext=Search
kth	KTH	www.kth.se/search/search?q={s}
ktk kotaku	Kotaku	kotaku.com/search?q={s}
kts kotus	Kielitoimiston sanakirja	www.kielitoimistonsanakirja.fi/#/{s}?searchMode=all
kur	kurpirkt.lv	www.kurpirkt.lv/cena.php?q={s}
kvk	Kamer van Koophandel	www.kvk.nl/orderstraat/bedrijf-kiezen/?q={s}
kvr kvraudio	KVR	www.kvraudio.com/q.php?search=1&q={s}
kym meme knowyourmeme	Know Your Meme	knowyourmeme.com/search?utf8=%E2%9C%93&q={s}
kzs	KidzSearch	www.kidzsearch.com/kzsearch.php?q={s}
l-d	Legends-Decks	www.legends-decks.com/search.php?q={s}
l2d love2d	Love2D Wiki	www.love2d.org/w/index.php?search={s}
l4c	Left4Craft	www.left4craft.org/search.php?keywords={s}
lac	Library and Archives Canada Collection Search	www.bac-lac.gc.ca/eng/collectionsearch/Pages/collectionsearch.aspx?q={s}
lad	Glosbe	glosbe.com/la/en/{s}
laf feltrinelli	LaFeltrinelli	www.lafeltrinelli.it/fcom/it/home/pages/catalogo/searchresults.html?prkw={s}
lam	LambdaTest	www.lambdatest.com/blog/?s={s}
lar dict-fr larousse	Larousse French Dictionary	www.larousse.fr/dictionnaires/francais/{s}
las	Latin Word Study Tool	www.perseus.tufts.edu/hopper/morph?&la=la&l={s}&la=la
lat whitl	Whitaker's Latin	www.archives.nd.edu/cgi-bin/wordz.pl?keyword={s}
lau	Lebanese American University	www.lau.edu.lb/search/index.php?q={s}
law lii	Legal Information Institute	www.law.cornell.edu/search/site/{s}
laz lzd lzdph lazadaph	Lazada Philippines	www.lazada.com.ph/catalog/?q={s}
lbc leboncoin	Le Bon Coin	www.leboncoin.fr/recherche/?text={s}
lbf	La bonne formation	labonneformation.pole-emploi.fr/toutes-les-formations?motscles={s}
lbs	Logos Bible Software	www.logos.com/products/search?q={s}
lda	Langenscheid Deutsch-Arabisch	de.langenscheidt.com/deutsch-arabisch/search?term={s}
lde langen	Langenscheidt	en.langenscheidt.com/german-english/{s}
lds	LDS.org	www.lds.org/search?lang=eng&query={s}
leb	LowEndBox	lowendbox.com/?s={s}
lef	Linguee EN FR	www.linguee.com/english-french/search?source=french&query={s}
len	Mothereff.in Byte Counter	mothereff.in/byte-counter#{s}
leo	dict.leo.org	dict.leo.org/englisch-deutsch/{s}
les lies ltrans linesin lingues	Linguee (es2en)	www.linguee.es/espanol-ingles/search?source=auto&query={s}
let	LowEndTalk	www.lowendtalk.com/search?Search={s}
lfc	LiverpoolFC sub (old style)	old.reddit.com/r/LiverpoolFC/search?q={s}&restrict_sr=on
lfm lastfmmusic	last.fm music	www.last.fm/music/{s}/
lgw	libregamewiki	libregamewiki.org/index.php?search={s}
lhv	Le Hollandais Volant	lehollandaisvolant.net/?q={s}
lic	linkedin.com/company	www.linkedin.com/search/results/companies/?keywords={s}
lim	Limundo	www.limundo.com/pretragaLimundo.php?bSearchBox=1&txtPretraga={s}&Submit=
lin linef	Linguee (en2fr)	www.linguee.com/english-french/search?source=auto&query={s}
lio osl libraries	libraries.io	libraries.io/search?q={s}
lit	luvit.io	luvit.io/lit.html#{s}
lkn	LoKan.jp	lokan.jp/?s={s}
lmr latemodelresto latemodelrestoration	Late Model Restoration	www.latemodelrestoration.com/Product/Search?q={s}
lms	Lemma Soft Forums	lemmasoft.renai.us/forums/search.php?keywords={s}
lmw	lostmediawiki	lostmediawiki.com/index.php?search={s}
lnp	Logbuch:Netzpolitik	logbuch-netzpolitik.de/?s={s}
lns listennotes	Listen Notes	www.listennotes.com/search/?q={s}
loc	Library of Congress Catalog (loc.gov)	www.loc.gov/search/?q={s}
lof	Learn OmniFocus	learnomnifocus.com/?s={s}
log logeion	Logeion	logeion.uchicago.edu/{s}
loh	LibreOffice Help	help.libreoffice.org/index.php?title=Special:Search&profile=default&search={s}&fulltext=Search
lol	LocksOnline.co.uk	www.locksonline.co.uk/index.php?route=product/search&search={s}
lph	leifiphysik.de	www.leifiphysik.de/suche/{s}
lps	LaptopSpirit	www.laptopspirit.fr/search/{s}
lqw	Linux Questions Wiki	wiki.linuxquestions.org/index.php?search={s}
lrb	The London Review of Books	www.lrb.co.uk/search?q={s}
lse	Linux Security Expert	linuxsecurity.expert/search/?q={s}
lsg lzdsg	Lazada Singapore	www.lazada.sg/catalog/?q={s}
lsi	Let's sing it	search.letssingit.com/cgi-exe/am.cgi?a=search&l=archive&typeid=2&s={s}
lsr lilypond	LilyPond Snippet Repository	lsr.di.unimi.it/LSR/Search?q={s}
lta	LTA	www.lta.org.uk/search-results/?q={s}
ltb	Letras BR	www.letras.mus.br/?q={s}
ltc	Litecoin Holy Transaction	litecoin.holytransaction.com/address/{s}
lts	LaToileScoute	www.latoilescoute.net/spip.php?page=recherche&recherche={s}
ltt	LinusTechTips Forum	linustechtips.com/main/search/?&q={s}
ltu	Lambda the Ultimate	lambda-the-ultimate.org/search/node/{s}
lut	BibleServer Lutherbibel 2017	www.bibleserver.com/text/LUT/{s}
lux	Lux Leuphana Bibliothek	lux.leuphana.de/vufind/Search/Results?lookfor={s}&submit=Suchen
lvl	La vache libre	la-vache-libre.org/?s={s}
lwg ludwig	Ludwig	ludwig.guru/s/{s}
lwn	LWN.net	lwn.net/Search/DoSearch?words={s}
lxr	Linux Cross Reference	elixir.bootlin.com/linux/latest/ident/{s}
m4l	maxforlive.com	maxforlive.com/library/index.php?by=any&q={s}
maa	Mathematical Association of America	www.maa.org/search/node?keys={s}
mab	Encyclopaedia metallum	www.metal-archives.com/search?type=band_name&searchString={s}
mac macvendor	MAC address lookup	www.macvendorlookup.com/search/{s}
mal malist myanimelist	MyAnimeList	myanimelist.net/anime.php?q={s}
man archman manpage	Arch manual pages	man.archlinux.org/search?q={s}&go=Go
mar	marktplaats.nl	marktplaats.nl/z.html?query={s}
mbc	mybeercellar	www.mybeercellar.com/?search={s}
mbe mbevent	MusicBrainz events	musicbrainz.org/search?query={s}&type=event&method=indexed
mbl	MusicBrainz labels	musicbrainz.org/search?query={s}&type=label&method=indexed
mbp	MusicBrainz places	musicbrainz.org/search?query={s}&type=place&method=indexed
mbr mbrelease	MusicBrainz Releases	musicbrainz.org/search?query={s}&type=release
mbs mdbs	Mapa Interactivo de Buenos Aires	mapa.buenosaires.gov.ar/buscador/?dir={s}
mbw	MusicBrainz work	musicbrainz.org/search?query={s}&type=work&method=indexed
mcb	MyCallBot	mycallbot.com/numbers/{s}
mcc	MCC	www.monroecc.edu/search/#gsc.q={s}
mcf mineforum	Minecraft Forum	www.minecraftforum.net/search?search={s}
mch	Karten der Schweiz	map.geo.admin.ch/?swisssearch={s}
mck	McKesson	mms.mckesson.com/catalog?query={s}
mcm mkm mtgcm magiccardmarket	Magic Card Market	www.cardmarket.com/en/Magic/Products/Search?searchString={s}
mcr	Meta Crawler	www.metacrawler.com/search/web?fcoid=417&fcop=topnav&fpid=2&om_nextpage=True&q={s}
mcs	Movie-Censorship.com	www.movie-censorship.com/list.php?s={s}
mcu	Marvel Cinematic Universe wiki	marvelcinematicuniverse.wikia.com/wiki/Special:Search?query={s}
mcv	MovieCovers	moviecovers.com/multicrit.html?titre={s}
mcw mcwiki minecraft minecraftwiki	Official Minecraft Wiki	minecraft.wiki/?search={s}
mcz mapy	Mapy.cz	mapy.cz/?q={s}
md5	MD5 reverse lookup	md5.gromweb.com/?md5={s}
mda	Mark's Daily Apple	www.marksdailyapple.com/search-results/?q={s}
mdb	MoriDB	moridb.com/items/search?q={s}
mdc mdn javascript	MDN Web Docs	developer.mozilla.org/search?q={s}
mdj	Mixing.DJ	mixing.dj/?s={s}
mdl mydrama	MyDramaList	mydramalist.com/search?q={s}
mdp	MediaPart	www.mediapart.fr/search?search_word={s}&op=ok
mdr mdrde	Mitteldeutscher Rundfunk	www.mdr.de/nachrichten/index.html?q={s}
mdx mangadex	MangaDex	mangadex.org/search?q={s}
mec	Mountain Equipment Co-op	www.mec.ca/en/search?text={s}
med medium	Medium	medium.com/search?q={s}
mes	Messicks	www.messicks.com/search?q={s}
met	Meteox	meteox.de/search.aspx?s={s}
mfc	MyFigureCollection	myfigurecollection.net/browse.v4.php?keywords={s}
mfg	Mobafire	www.mobafire.com/league-of-legends/{s}-guide
mfm	Mount Fight Mountain Wikia	mfm.wikia.com/wiki/Special:Search?query={s}
mfp	My Fitness Pal	www.myfitnesspal.com/food/search?search={s}
mgh	Monumenta Germaniae Historica	www.dmgh.de/de/fs1/search/query.html?fulltext={s}
mgw	Metal Gear Wiki	metalgear.wikia.com/wiki/Special:Search?search={s}
mhr	Monster Hunter Subreddit	www.reddit.com/r/MonsterHunter/search?q={s}&restrict_sr=on
mib	Mibbit	search.mibbit.com/search/{s}
mik	Mikrotik Wiki	wiki.mikrotik.com/index.php?search={s}&title=Special:Search&go=Go
mit	MIT Subject Listing & Schedule	student.mit.edu/catalog/search.cgi?search={s}
mix	Cogimix	www.cogimix.com/?q={s}
mjs	Mining Job Search	www.miningjobsearch.com/Mining-Jobs/Search/{s}
mkg	MKG Sammlung Online	sammlungonline.mkg-hamburg.de/de/search?s={s}
mkw makerworld	Makerworld	makerworld.com/search/models?keyword={s}
mlb	MLB.com	mlb.mlb.com/searchGlobalSearchServlet?club=mlb&search_mode=1&searchtypeid=-1&page_number=1&query_text1={s}
mld mwl mwld learnersdictionary	Learner's Dictionary	www.learnersdictionary.com/definition/{s}
mlf	Manjaro Linux Forums	forum.manjaro.org/search?q={s}
mlg	My Laptop Guide	mylaptopguide.com/?s={s}
mll	Manitoba Liquor Marts	www.liquormarts.ca/search-products/all?search_api_fulltext={s}
mln mmls	Minuteman Library Network	find.minlib.net/iii/encore/search?formids=target&lang=eng&suite=def&reservedids=lang,suite&submitmode=&submitname=&target={s}
mlo	Mageia linux Online	www.mageialinux-online.org/search/search.php#results?q={s}&search_submit=Recherche
mlp	Equestripedia	equestripedia.org/w/index.php?search={s}&title=Special%3ASearch
mls	MLS Soccer	www.mlssoccer.com/search/{s}
mmc mcmaster	McMaster-Carr	www.mcmaster.com/#{s}
mme	MetroMatinee	metromatinee.com/search/{s}
mmf	My Mini Factory	www.myminifactory.com/search/?query={s}&searchType=1
mmi mymovies	My Movies Italia	www.mymovies.it/database/ricercalibera/default.asp?q={s}
mmk	Miniatur Market	www.miniaturemarket.com/searchresults?q={s}
mml manga	MyAnimeList Manga	myanimelist.net/manga.php?q={s}
mmm mrmoney	Mr. Money Mustache	www.mrmoneymustache.com/?s={s}
mmr	What is My MMR	na.whatismymmr.com/{s}
mmz	Cardmarket Manamaze	www.cardmarket.com/en/Magic/MainPage/browseUserProducts?idCategory=1&idUser=25674&resultsPage=0&cardName={s}
mna	M&A Critique	mnacritique.mergersindia.com/?s={s}
mnb	Minimalist Baker	minimalistbaker.com/?s={s}
mnf	Make New Friends Podcast	www.makenewfriendspodcast.com/?s={s}
mnm	Morrowind NexusMods	www.nexusmods.com/morrowind/search/?gsearch={s}&gsearchtype=mods
mnp	manpages.org	manpages.org/{s}
mnt	Medical News Today	www.medicalnewstoday.com/search?q={s}
mod modarchive	The Mod Archive	modarchive.org/index.php?request=search&query={s}&submit=Find&search_type=filename_or_songtitle
moj	Made of Jeans	www.madeofjeans.com/search/?q={s}
mol	TE-palvelut	paikat.te-palvelut.fi/tpt/?searchPhrase={s}
moo	MOO	www.moo.com/search?query={s}
moz	Mozilla	www.google.com/cse?cx=002443141534113389537:ysdmevkkknw&q={s}
mpg mpgde	Max Planck Gesellschaft	www.mpg.de/en/search?utf8=%E2%9C%93&searchfield={s}
mpl matplotlib	matplotlib	matplotlib.org/search.html?q={s}
mre	Reddit Mobile	m.reddit.com/search?q={s}
mrg	Mail.ru	go.mail.ru/msearch?q={s}
ms2	Maplestory 2 Forums	forums.maplestory2.nexon.net/search?Search={s}
msa	Microsoft Academic	academic.microsoft.com/search?q={s}
msc	AMS MathScinet	www.ams.org/mathscinet/search/publications.html?pg4=ALLF&s4={s}
mse magsx	Magento Stack Exchange	magento.stackexchange.com/search?q={s}
msg	messenger.com	www.messenger.com/t/{s}
msh mashable	Mashable	mashable.com/follow/search?q={s}
msi	MSI USA	us.msi.com/search/{s}
mso metaso	Meta Stack Overflow	meta.stackoverflow.com/search?q={s}
mss mstore winstore microsoftstore	Microsoft Store	apps.microsoft.com/search?query={s}
mst bturl	Microsoft/Bing Translator URL	www.microsofttranslator.com/bv.aspx?a={s}
msy	MSY (SA)	www.msy.com.au/saonline/search?controller=search&orderby=position&orderway=desc&search_query={s}&submit_search=Go
mtb	mtbproject	www.mtbproject.com/search?q={s}
mtf	Moestuinforum	www.moestuinforum.nl/search/gsearch_body.html?q={s}
mtg sfa sfl scry mc.info scryfall magiccard magiccards	Scryfall	scryfall.com/search?q={s}
mtk	mturk.com	www.mturk.com/mturk/searchbar?selectedSearchType=hitgroups&searchWords={s}
mtn mproj	Mountain Project	www.mountainproject.com/search?q={s}
mtr	Hong Kong MTR	mwsgsa01.mtr.com.hk/search?site=default_collection&output=xml_no_dtd&client=mtr_eng&proxystylesheet=mtr_eng&proxyreload=1&ie=big5&oe=UTF-8&q={s}
mts	Mod the Sims	www.modthesims.info/browse.php?tag={s}
mtt	Multitracks	www.multitracks.com/search/?q={s}
mtu	Michigan Technological University	www.mtu.edu/search/?q={s}
mtv	MTV	www.mtv.com/search/?searchterm={s}
mtw	Minetest Wiki	wiki.minetest.net/index.php?search={s}
mua	Makeup Alley	makeupalley.com/search.asp?q={s}
mui	Material UI	material-ui.com/api/{s}
muk muke	Google Maps UK (English)	www.google.co.uk/maps/?hl=en&q={s}
muo makeuseof	MakeUseOf	www.makeuseof.com/search/?q={s}
mvn mvnrep	The Maven Repository	mvnrepository.com/search?q={s}
mwb	Mijnwoordenboek	www.mijnwoordenboek.nl/vertaal/NL/EN/{s}
mwm	Wikimedia Meta	meta.wikimedia.org/w/index.php?&title=Special:Search&go=Go&search={s}
mwt	Thesaurus by Merriam-Webster	www.merriam-webster.com/thesaurus/{s}
mwu	Mobile Weather Underground	mobile.wunderground.com/q/{s}
mxc	MIxcloud	www.mixcloud.com/{s}
mxm mmatch musicxm musixmatch	Musixmatch	www.musixmatch.com/search/{s}
mxr	Mixer	www.mixer.com/{s}
mxs	MX Simulator	forum.mxsimulator.com/search.php?keywords={s}
myc	mycomicshop	www.mycomicshop.com/search?q={s}
myk	MyKnobs.com	www.myknobs.com/page/search?Ntt={s}
mym	MYmovies	www.mymovies.it/database/ricerca/?q={s}
myn myntra	Myntra	www.myntra.com/{s}
myp	My protein	pt.myprotein.com/elysium.search?search={s}
n11	n11.com	www.n11.com/arama?q={s}
n24 news24	News24	www.news24.com/search?q={s}
nab	notabug.org (free code hosting)	notabug.org/explore/repos?q={s}
nav	Navigium	www.navigium.de/latein-woerterbuch.php?form={s}&wb=gross&phr=true&mh=true
nba	NBA.com	www.nba.com/search#/{s}
nbc	NotebookCheck	www.notebookcheck.net/Google-Search.36690.0.html?q={s}
nbn	URN:NBN Resolver for Germany & Switzerland	nbn-resolving.org/{s}
nce	Nciku English	nciku.com/search/en/{s}
nck	Nciku	nciku.com/search/all/{s}
ncl	NC Live	www.nclive.org/search-everything?search={s}
ncr	National Catholic Register	www.ncregister.com/search/results?q={s}
ncz zhen	Nciku Chinese	nciku.com/search/zh/{s}
ndb	Deutsche Biographie (NDB/ADB)	www.deutsche-biographie.de/search?name={s}&kat=ndbadb&beruf=&orte=&geburtsjahr=&todesjahr=&gnd=&st=erw&facets=&cf=10&number=0&ot=&sl=[]&sort=
nde newsde	DuckDuckGo News DE	duckduckgo.com/?q={s}&iar=news&ia=news&kl=de-de
ndl	National Diet Library Online	ndlonline.ndl.go.jp/#!/search?keyword={s}
ndr ndrde	Norddeutscher Rundfunk	www.ndr.de/suche10.html?query={s}
nds	Nachdenkseiten	www.nachdenkseiten.de/?s={s}
neb	New England BioLabs	www.neb.com/search?q={s}
ned	NASA Extragalactic Database	ned.ipac.caltech.edu/cgi-bin/objsearch?objname={s}
neo	Neocities	neocities.org/browse?tag={s}
nes nese	Nationalencyklopedin	www.ne.se/sok?q={s}
nfb	National Film Board of Canada	www.nfb.ca/search/#?queryString={s}&index=0&language=en
nfr newsfr	DuckDuckGo News France	duckduckgo.com/?q={s}&iar=news&ia=news&kl=fr-fr
ng2	Angular.io v2	v2.angular.io/api?search={s}
ng8	Angular.io v8	v8.angular.io/api?search={s}
ngg	Newgrounds Games	www.newgrounds.com/portal/search/games/{s}
ngr	Google ngrams	books.google.com/ngrams/graph?content={s}&year_start=1850&year_end=2009&corpus=15&smoothing=0
nhk	NHK News Web	cgi2.nhk.or.jp/news/nsearch/query.cgi?col=news&st=1&rf=1&charset=utf-8&qt={s}&search.x=-318&search.y=-183
nhl	NHL.com	www.nhl.com/ice/search.htm?tab=news&q={s}&x=0&y=0
nhs	NHS Choices	www.nhs.uk/Search/?q={s}
nih	NIH	search.nih.gov/search?utf8=%E2%9C%93&affiliate=nih&query={s}&commit=Search&btnG.x=0&btnG.y=0&btnG=search
nin	Nine Inch Nails Wiki	www.ninwiki.com/index.php?title=Special:Search&redirs=0&search={s}&fulltext=Search
nis	Notes in Spanish	www.notesinspanish.com/?s={s}
nit ntr nitter	Nitter (alternative Twitter front-end)	nitter.net/search?f=tweets&q={s}
niv	BibleStudyTools.com	www.biblestudytools.com/search/?q={s}&s=Bibles&t=niv
nix nixos nixoswiki	NixOS Wiki	wiki.nixos.org/w/index.php?search={s}
njt	npm jump to	njt.vercel.app/jump?to={s}
nkj	Bible Gateway: New King James Version (NKJV)	www.biblegateway.com/quicksearch/?quicksearch={s}&qs_version=NKJV
nkr krdic kodict	Naver Korean Dictionary	ko.dict.naver.com/#/search?query={s}
nla	National Library of Australia Catalogue	catalogue.nla.gov.au/Search/Home?lookfor={s}
nlb	Bibleserver (NLB)	www.bibleserver.com/text/NLB/{s}
nlr	New Left Review	newleftreview.org/search/hybrid?query={s}
nmc mcname namemc	NameMC	namemc.com/search?q={s}
nms	No Man's Sky Wiki	nomanssky.gamepedia.com/index.php?title=Special:Search&search={s}
nmt	Nutrimatic	nutrimatic.org/?q={s}
nnd	Norwegian Nynorsk dictionary	ordbokene.no/nob/nn/{s}
nng	cowlevel	cowlevel.net/search?q={s}
nnl nicolive	Nico Nico Live	live.nicovideo.jp/search?keyword={s}
nns	Nico Nico Seiga	seiga.nicovideo.jp/search/{s}
nos	NOS	nos.nl/zoeken/?q={s}
npm npmjs	npm	www.npmjs.com/search?q={s}
npo uzg	NPO	www.npo.nl/zoeken?term={s}
npr	NPR.org	www.npr.org/search/index.php?query={s}
nps	National Park Service (USA)	www.nps.gov/search/?affiliate=nps&query={s}
nrc	NRC	www.nrc.nl/php/zoeken.php?q={s}#449
nrk	NRK	www.nrk.no/sok/?q={s}
nrl	National Rugby League	www.nrl.com/search/?keyword={s}&sort=Relevance
nse	National Stock Exchange of India	www.nseindia.com/gsa/search.jsp?q={s}
nsf safeweb nortonsafe nortonsafeweb	Norton Safe Web	safeweb.norton.com/report/show?url={s}
nsn	NationStats (nation)	nationstates.net/nation={s}
nsr	NationStates	nationstates.net/region={s}
nts	NTS	www.nts.live/find?q={s}&type=all
ntv	Nippon TV	www.ntv.co.jp/search/?q={s}
ntx	Nutritionix	www.nutritionix.com/search?q={s}
nvd nvds	NIST Vulnerability Database	nvd.nist.gov/vuln/search/results?form_type=Basic&results_type=overview&query={s}&search_type=all
nvi	Naver Images	search.naver.com/search.naver?sm=tab_hty.top&where=image&query={s}
nvu novelupdates	Novel updates	www.novelupdates.com/?s={s}&post_type=seriesplans
nwb	NIST Chemistry Webbook	webbook.nist.gov/cgi/cbook.cgi?Name={s}&Units=SI
nwn	Neverwinter Nights Wiki	nwn.wikia.com/wiki/Special:Search?query={s}
nws noaa wgov	NOAA	forecast.weather.gov/zipcity.php?inputstring={s}
nxi	Next INpact	www.nextinpact.com/recherche?_search={s}
nyt nytimes	The New York Times	www.nytimes.com/search?query={s}
nzf	New Zealand Formulary	nzf.org.nz/Search/Results?term={s}
oab	Open Access Button	openaccessbutton.org/?url={s}
oad	Oxford Dictionaries (American English)	www.oxforddictionaries.com/definition/american_english/{s}
oba	Online Books (Authors)	onlinebooks.library.upenn.edu/webbin/book/search?author={s}&amode=words
obb	oremus Bible Browser	bible.oremus.org/?passage={s}
obd	Engine Codes	engine-codes.com/search_codes.php?q={s}
obi	OBI	www.obi.de/decom/search/{s}
obs	openSUSE Build Service	build.opensuse.org/search?search_text={s}
oca ocal	Open Clip Art Library	www.openclipart.org/search/?query={s}
oco ocamloscope	OCamlOScope	camlspotter.github.io/ocamloscope.html?q={s}
ocs opendesktop	openDesktop.org	www.opendesktop.org/search?projectSearchText={s}
ocw mitocw	MIT OpenCourseWare	search.mit.edu/search?site=ocw&client=mit&output=xml_no_dtd&proxystylesheet=http://ocw.mit.edu/search/google-ocw.xsl&proxyreload=1&q={s}
oda	Oda	oda.com/no/search/products/?q={s}
odb	Our Daily Bread	odb.org/search?q={s}
odd	Odd1sOut	theodd1sout.com/search?q={s}
ods	Open Data Soft	public.opendatasoft.com/explore/dataset/european-train-stations/?q={s}
oec	Open Education Consortium	www.oeconsortium.org/courses/search/?search={s}
oed	OED - Oxford English Dictionary	www.oed.com/search?searchType=dictionary&q={s}&_searchBtn=Search
oel	OEL Fastrac	affygility.com/oel/search.html?addsearch={s}
oem	oemstrade	www.oemstrade.com/search/{s}
oer	OER Commons	www.oercommons.org/search?f.search={s}
off	OpenFoodFacts World	world.openfoodfacts.org/cgi/search.pl?search_terms={s}
ofl openfont	Open Font Library	openfontlibrary.org/en/search?query={s}
oga openga	OpenGameArt.org	opengameart.org/art-search?keys={s}
ogl	OutdoorGearLab	www.outdoorgearlab.com/search.php?ftr={s}
ogs	Online Go Server	forums.online-go.com/search?q={s}
ohm	Orbit Hangar Mods	orbithangar.com/advsearch.php?text={s}
ohr	OHRRPGCE Wiki	rpg.hamsterrepublic.com/ohrrpgce/index.php?title=Special:Search&search={s}&go=Go
oid	Search OID registry	oid-base.com/cgi-bin/display?oid={s}&submit=Display&action=display
okc	OKCupid	okcupid.com/profile/{s}
olx	OLX Poland	www.olx.pl/oferty/q-{s}/
omg omgu omgubuntu	OMG! Ubuntu!	www.omgubuntu.co.uk/?s={s}
oms	On MSFT	www.onmsft.com/?s={s}
omt	One More Thing	www.onemorething.nl/zoeken/{s}/
omx	OMX	theomx.com/companies?keyword]={s}
oni	Oxygen Not Included Wiki	oxygennotincluded.wiki.gg/index.php?search={s}
onm	Oblivion NexusMods	www.nexusmods.com/oblivion/search/?gsearch={s}&gsearchtype=mods
onr ohnorobot	Oh No Robot	www.ohnorobot.com/index.php?s={s}&Search=Search&comic=
ons	Office for National Statistics	www.ons.gov.uk/search?q={s}
ooc	Out of Cards	outof.cards/search/?query={s}
opc	OpenClassrooms	fr.openclassrooms.com/recherche/?search={s}
opg	Opgg Champion	www.op.gg/champion/{s}
opq	Opquast Checklists	checklists.opquast.com/fr/opquastv2?q={s}
opr openrouter	OpenRouter	openrouter.ai/models?q={s}
ore	Package Repository for Minecraft	ore.spongepowered.org/?q={s}
orf	Orion Feedback	orionfeedback.org/?q={s}
ors sro srold	Subreddit (Old Style)	old.reddit.com/r/{s}/
osa	OSA Publishing	www.osapublishing.org/search.cfm?q={s}
osc	Oscobo Search	oscobo.co.uk/search.php?q={s}
osf	Open Science Framework	osf.io/search/?q={s}
osi	Open Source Initiative	opensource.org/search/node/{s}
osm ost omap openmaps openstreet openstreetmap	OpenStreetMap	www.openstreetmap.org/search?query={s}
osr	Old Reddit (subreddit)	old.reddit.com/r/{s}
oss	OSStatus	www.osstatus.com/search/results?platform=all&framework=all&search={s}
osu	osu!	osu.ppy.sh/home/search?query={s}
osw opensuse	openSUSE Wiki	en.opensuse.org/index.php?title=Special:Search&profile=default&search={s}&fulltext=Search
ot4	optochip	optochip.org/search/?q={s}
otn	Oracle Technology Network	community.oracle.com/search.jspa?q={s}
ott	ottawa.ca	ottawa.ca/en/search?searchfield={s}
otw	Overpass Turbo Wizard	overpass-turbo.eu/?w={s}&R
oup	offerup	offerup.com/search/?q={s}
ovd overdrive	OverDrive	www.overdrive.com/search?q={s}
owc macsales	Other World Computing (MacSales)	eshop.macsales.com/search/?q={s}
owd	Webster's Dictionary 1828 - Online Edition	webstersdictionary1828.com/Dictionary/{s}
owm	Open Weather Map	openweathermap.org/find?q={s}
ows	Opera Add-ons XT WebStore	addons.opera.com/ru/search/?query={s}&type=extensions
oxl	Oxford Advanced Learners' dictionary	www.oxfordlearnersdictionaries.com/definition/english/{s}_1?isEntryInOtherDict=false
oxs oxt	Oxford Dictionary Thesaurus	en.oxforddictionaries.com/thesaurus/{s}
oyz oyez	Oyez	www.oyez.org/search/{s}
ozb ozbargain	OzBargain	www.ozbargain.com.au/search/node/{s}
p4k pitchfork	Pitchfork Media	pitchfork.com/search/?query={s}
pac apkg archpkg	Arch Package Search	www.archlinux.org/packages/?sort=&q={s}&maintainer=&flagged=
pad	Puzzle & Dragons Wiki	pad.wikia.com/wiki/Special:Search?search={s}&fulltext=Search&ns0=1&ns14=1
pai	PaginasAmarelas.pt	www.pai.pt/q/business/advanced/what/{s}/?contentErrorLinkEnabled=true
pan	Panlexicon	panlexicon.com/?q={s}
pat	pauker.at Dictionary (German-English)	www.pauker.at/pauker/DE_DE/EN/wb?modus=&suche={s}&page=1#
pbc probuilds	Probuilds Champion	www.probuilds.net/champions/details/{s}
pbf	Perry Bible Fellowship Comics	pbfcomics.com/?s={s}
pbl	pages blanches	www.pagesjaunes.fr/pagesblanches/recherche?quoiqui={s}&proximite=0
pbs	PBS	www.pbs.org/search/?q={s}
pcc	PC Connection	www.pcconnection.com/IPA/Shop/Product/Search.htm?SearchType=1&term={s}
pcd	PCDiga	www.pcdiga.com/catalogsearch/result/?q={s}
pcg	PC Gamer	www.pcgamer.com/search/?searchTerm={s}
pch	Publishers Clearing House	pch.com/?={s}
pci	PC INpact	www.pcinpact.com/recherche?_search={s}
pcs	Pro Cycling Stats	www.procyclingstats.com/search.php?term={s}
pdb	Protein Data Bank	www.rcsb.org/pdb/search/navbarsearch.do?f=&q={s}
pdl	Place des Libraires	www.placedeslibraires.fr/listeliv.php?mots_recherche={s}&base=allbooks
pef	www.pole-emploi.fr	candidat.pole-emploi.fr/offres/recherche?motsCles={s}
pep	Python PEP	www.python.org/dev/peps/pep-{s}/
per	Personality Database	personality-database.com/search?q={s}
pfi	Poinformowani	poinformowani.pl/szukaj?q={s}
pfl	Portage File List	www.portagefilelist.de/site/query/file/?file={s}&unique_packages=yes&do
pfr	pro-football-reference.com	www.pro-football-reference.com/search/search.fcgi?search={s}&pid=
pfs	d20PFSRD	cse.google.com/cse?cx=006680642033474972217:6zo0hx_wle8&q={s}
pfw pfwc portablefreeware	The Portable Freeware Collection	www.portablefreeware.com/index.php?q={s}
pfx	BrooksBaseball	www.brooksbaseball.net/search.php?name={s}
pgn	PlusGirot - Search PlusGiro number	kontoutdrag.plusgirot.se/ku/sokko002?SO_KTO={s}
pgp	MIT PGP public key server lookup	pgp.mit.edu/pks/lookup?search={s}
pgr	Perseus word study tool	www.perseus.tufts.edu/hopper/morph?l={s}&la=greek
phe	Phenom People	careers.phenompeople.com/us/en/search-results?keywords={s}
phi plt	PHI Latin Texts	latin.packhum.org/search?q={s}
pho photics	Photics.com	photics.com/?s={s}
php phpnet	PHP.net	www.php.net/manual-lookup.php?pattern={s}
phw	Pharmawiki	www.pharmawiki.ch/wiki/index.php?wiki={s}
phy	Physics Classroom	www.physicsclassroom.com/?q={s}
pic	picsearch	www.picsearch.com/index.cgi?q={s}
pin	Pinterest	pinterest.com/search/pins/?q={s}
pio	PlatformIO Libraries	platformio.org/lib/search?query={s}
pip pypa pypi	PyPI	pypi.org/search/?q={s}
piv vortaro	Plena Ilustrita Vortaro	vortaro.net/#{s}
pjm	PJ Media	pjmedia.com/search/?s={s}
pla latin	Latin Word Study tool	www.perseus.tufts.edu/hopper/morph?l={s}&la=la
plm	PDXpert	www.buyplm.com/general-info/pdxpert-plm-software-search.aspx?query={s}
plp	Playpilot	www.playpilot.com/se/en/search/?q={s}
pls	pluralsight	www.pluralsight.com/search?q={s}
plw wpl plwiki wikipl	Polish Wikipedia	pl.wikipedia.org/w/index.php?search={s}
plz	German Postal Codes	www.postdirekt.de/plzserver/PlzSearchServlet?finda=miniapp&city={s}
pmc planetmc	PlanetMinecraft	www.planetminecraft.com/resources/?keywords={s}
pmf palemoon	Pale Moon forum	forum.palemoon.org/search.php?keywords={s}
pmi	Project Management Institute	www.pmi.org/search#q={s}&sort=relevancy
pmk	Pimp My Keyboard	pimpmykeyboard.com/search.php?Search=&search_query={s}
pms postimees	Postimees	www.postimees.ee/search?query={s}
pnp	Pick n Pay	www.pnp.co.za/search/{s}
pnw psy pwiki psychonautwiki	PsychonautWiki	psychonautwiki.org/w/index.php?search={s}
pod cocoapods	Cocoapods	cocoapods.org/?q={s}
poe	Path of Exile Wiki	www.poewiki.net/index.php?search={s}
pok	Peter's of Kensington	www.petersofkensington.com.au/Public/Catalog/searchresults.aspx?search={s}&issearch=true
ppa	Personal Package Archives for Ubuntu	launchpad.net/ubuntu/+ppas?name_filter={s}
ppc	PocketPC.ch	www.pocketpc.ch/google.php?q={s}
ppg nvenkr	Naver Papago	papago.naver.com/?st={s}
ppl	Plymouth (Indiana) Public Library	plymouthpubliclibrary.bibliocommons.com/search?utf8=%E2%9C%93&t=smart&search_category=keyword&q={s}
ppx pplx perplexity	Perplexity AI	perplexity.ai/?q={s}
pr0	Pr0gramm	pr0gramm.com/top/{s}
prc	ProgressiveRC	www.progressiverc.com/catalogsearch/result/?q={s}
prd pathsrd	Pathfinder Reference Document	paizo.com/search?q={s}&what=prd
pro prog	programmers.stackexchange.com	programmers.stackexchange.com/search?q={s}
psa	Palmetto State Armory	palmettostatearmory.com/catalogsearch/result/?q={s}
pse esse physe physse	Earth Science Stack Exchange	physics.stackexchange.com/search?q={s}
psg	PowerShell Gallery	www.powershellgallery.com/packages?q={s}
psi	PSI Phonebook	www.psi.ch/search/telefonbuch-und-e-mail?q={s}
psn	Playstation Store	store.playstation.com/#!/en-us/search/q={s}
pso	Psoriasis-Netz	www.psoriasis-netz.de/?s={s}
pss	PlayStation Store	store.playstation.com/en-us/search/{s}
psu	The Pennsylvania State University	www.psu.edu/search/gss?query={s}
ptg	The Great Blog	the-ptg.blogspot.in/search?q={s}
pth	Plant Therapy	www.planttherapy.com/search?Store_Code=PT&q={s}
ptn prdb proton protondb	ProtonDB	www.protondb.com/search?q={s}
ptr	Pro Tool Reviews	www.protoolreviews.com/?s={s}
ptt	PTT	www.ptt.cc/bbs/{s}
ptv	PTV Victoria	www.ptv.vic.gov.au/search/getForm?Search={s}&action_getSearchResults=Go
pvz	Plants vs. Zombies Wiki	plantsvszombies.wiki.gg/wiki/Special:Search?search={s}
pwp wfa fawiki wikifa	Persian Wikipedia	fa.wikipedia.org/w/index.php?search={s}
pwv	Programador Web Valencia	programadorwebvalencia.com/blog/?search={s}
pxc	Phoenix Contact	www.phoenixcontact.com/online/portal/us?q={s}&uri=pxc-search:website&library=usen
pxv	Pixabay Vector Graphics	pixabay.com/en/photos/?q={s}&image_type=vector&cat=&min_width=&min_height=
py2 py27	Python 2.7.10 Documentation	docs.python.org/2.7/search.html?q={s}
pya	PrimiciasYA.com	www.primiciasya.com/search.html?q={s}
pzw	Project Zomboid Wiki	pzwiki.net/w/index.php?search={s}
qat	Quinapalus	quinapalus.com/cgi-bin/qat?pat={s}
qaz	Unicode Text Converter	qaz.wtf/u/convert.cgi?text={s}
qdb	Bash.org	www.bash.org/?search={s}
qme	quickmeme	m.quickmeme.com/search/?q={s}
qoq	Quest-O-Quora	questso.blogspot.com/search?q={s}
qrz	QRZ.com	www.qrz.com/db/?callsign={s}&cmd=Search
qso	Stack Overflow Quantitative Finance	quant.stackexchange.com/search?q={s}
qsr	Quick Service Restaurant Magazine	www.qsrmagazine.com/search/site/{s}
qt3	Quarter To Three Forums	forum.quartertothree.com/search?expanded=true&q={s}
qum	Qumran	www.qumran2.net/indice.php?parole={s}
qur quran	The Noble Qur'an	quran.com/search?q={s}
qvc	QVC	www.qvc.com/catalog/search.html?langId=-1&storeId=10251&catalogId=10151&keyword={s}
qwe	Qwant Junior Education	www.qwantjunior.com/?q={s}&t=education
qwi	Qwant Images	www.qwant.com/?q={s}&t=images
qwl	Qwant lite	lite.qwant.com/?q={s}
qwn	Qwant News	www.qwant.com/?q={s}&t=news
qws	Qwant Social	www.qwant.com/?q={s}&t=social
qwv	Qwant Videos	www.qwant.com/?q={s}&t=videos
qww	Qwant web	www.qwant.com/?q={s}&t=web
r10 rakuten	Rakuten Ichiba	search.rakuten.co.jp/search/mall/{s}/
r2r	Rome2rio	www.rome2rio.com/map/{s}
rad radio radiopaedia	Radiopaedia.org	radiopaedia.org/search?utf8=%E2%9C%93&q={s}&scope=all
raf	Richard's Animorphs Forum	animorphsforum.com/index.php?action=search;advanced;search={s}
rag	Real Academia Galega	academia.gal/dicionario/-/termo/busca/{s}
rah	Acheivement hunter	roosterteeth.com/channel/achievement-hunter#search?term={s}
rai	RaiPlay	www.raiplay.it/ricerca?q={s}
ral	rgb to	rgb.to/ral/{s}
ray	Ray Wenderlich	www.raywenderlich.com/?s={s}
rbb rbb24 rbbde	Rundfunk Berlin-Brandenburg	www.rbb24.de/suche/#searchform_q__{s}
rbc	RBC Royal Bank	www.rbcroyalbank.com/search-public/index.html?question={s}
rbl	RBL Lookup	www.dnswatch.info/dns/rbl-lookup?host={s}&submit=RBL+Lookup
rbn	rbnorway	rbnorway.org/?s={s}
rbt	RebeccaBlackTech	rbt.asia/_/search/text/{s}
rce	Rust Compiler Error Index	doc.rust-lang.org/error-index.html#E{s}
rcl	Craigslist - Raleigh, NC	raleigh.craigslist.org/search/?query={s}
rcp	RealClear Politics	www.realclearpolitics.com/search/?q={s}
rcw	Washington State Legislature: Revised Code of Washington	apps.leg.wa.gov/RCW/default.aspx?cite={s}
rdc	Rue du commerce	www.rueducommerce.fr/recherche/{s}
rdo rdocs rdocu rstats	RDocumentation	www.rdocumentation.org/search?q={s}
re3	Registry of Research Data Repositories	www.re3data.org/search?query={s}
ref	Reference.com	www.reference.com/web?q={s}
rei	REI	www.rei.com/search?q={s}
ren reen	Reverso English - Definition	dictionary.reverso.net/english-definition/{s}
rep	Replacements.com	www.replacements.com/search/?query={s}
reu	Reddit User	www.reddit.com/user/{s}
rfc	IETF RFC	tools.ietf.org/html/rfc{s}
rfd	Refind	refind.com/?q={s}
rfr	Reverso French Definition	dictionnaire.reverso.net/francais-definition/{s}
rfs	Radio Free Satan	www.radiofreesatan.com/?s={s}&submit=Submit
rgo csgo	reddit.com/r/GlobalOffensive	www.reddit.com/r/GlobalOffensive/search/?q={s}&restrict_sr=1
rhq	RuneHQ	www.runehq.com/search.php?q={s}
rht	Red Hat Customer Portal	access.redhat.com/search/#/?q={s}&p=1&srch=any&language=en&documentKind=Documentation
rim	Rimlexikon.com	rimlexikon.com/index.php?rim={s}
rip	Domaintools Reverse IP Lookup	reverseip.domaintools.com/search/?q={s}
ris	RIS	www.ris.bka.gv.at/Ergebnis.wxe?Suchworte={s}&x=0&y=0&Abfrage=Gesamtabfrage
rkt racket	Racket	docs.racket-lang.org/search/index.html?q={s}
rlp	Rugby League Project	www.rugbyleagueproject.org/search/?q={s}
rlr srrl	Rocket League Reddit	www.reddit.com/r/RocketLeague/search?q={s}&restrict_sr=on
rlw	Rocket League Wiki	rocketleague.fandom.com/wiki/Special:Search?query={s}
rmk	Reddit's Mechanical Keyboards Subreddit	www.reddit.com/r/MechanicalKeyboards/search?q={s}&sort=relevance&t=all
rmn	RetailMeNot	www.retailmenot.com/s/{s}
rmp rate ratemyprofessor	Rate My Professor	www.ratemyprofessors.com/search.jsp?query={s}
rmw rimwiki	Rimworld Wiki	rimworldwiki.com/index.php?search={s}
rnl r-nl ddgnl	DuckDuckGo (NL)	duckduckgo.com/?q={s}&kl=nl-nl
rnz	Radio New Zealand	www.radionz.co.nz/search/results?utf8=%E2%9C%93&q={s}&commit=Search
ros	RobotOS Package Index	index.ros.org/search/?term={s}
rpf	Reddit PublicFreakout	www.reddit.com/r/PublicFreakout/search/?q={s}&restrict_sr=1
rpg rpgsx	StackExchange RPG	rpg.stackexchange.com/search?q={s}
rpm rpmfind	RPMfind.net	rpmfind.net/linux/rpm2html/search.php?query={s}&submit=Search+...
rps rockpapershotgun	Rock Paper Shotgun	www.rockpapershotgun.com/?s={s}
rpy	Real Python	realpython.com/search?q={s}
rrc	Rainbow Resource Catalog	www.rainbowresource.com/searchspring.php?q={s}
rrw	Rick Riordan Wiki	riordan.fandom.com/wiki/Special:Search?query={s}
rs4	rs.4chan.org	rs.4chan.org/?s={s}&from=ALL
rsc	RS Components	uk.rs-online.com/web/c/?searchTerm={s}
rsg	Rockstar Games	www.rockstargames.com/search/?q={s}
rsk refseek	RefSeek	www.refseek.com/search?q={s}
rsn	Reddit (subreddit new)	www.reddit.com/r/{s}/new/
rso sor	R questions on Stack Overflow	stackoverflow.com/search?q=[r]+{s}
rsu runsignup	RunSignUp	runsignup.com/Races?name={s}
rsw rscape rswiki	RuneScape Wiki	runescape.wiki/?search={s}
rtd readthedocs	Read The Docs	readthedocs.org/search/?q={s}
rth	Rooster Teeth	roosterteeth.com/#search?term={s}
rtm	Remember the Milk	www.rememberthemilk.com/app/#search/{s}
rtt	Real Time Trains	www.realtimetrains.co.uk/search/handler?type=basic&qsearch={s}
rug	University of Groningen	www.rug.nl/search/?searchtext={s}
ruk	ruk.ca	ruk.ca/search/site/{s}
rvb	Red vs. Blue Wiki	rvb.wikia.com/wiki/Special:Search?query={s}
rvm	ReviewMeta	reviewmeta.com/search?q={s}
ryg rateyourgenre	Rate Your Music (genre)	rateyourmusic.com/genre/{s}
rym rateyourmusic	Rate Your Music	rateyourmusic.com/search?searchterm={s}
rzr razer	Razer	www.razer.com/search?text={s}
sal	Salidzini.lv	www.salidzini.lv/search.php?q={s}
sam	Samsung	www.samsung.com/au/search/?q={s}
sao	Sword Art Online Wiki	swordartonline.wikia.com/wiki/Special:Search?go&query={s}
sap	SAP Launchpad	launchpad.support.sap.com/#/solutions/notesv2/?q={s}
sas	SAS	support.sas.com/en/search.html?q={s}&fq=siteArea:"Documentation"
say	Merriam-Webster Pronunciation	www.merriam-webster.com/dictionary/{s}?pronunciation
sb2 scratch discussscratch	Scratch	scratch.mit.edu/search/projects?q={s}
sba	SBA	www.sba.gov/search/?q={s}
sbb	SBB	www.sbb.ch/de/kaufen/pages/fahrplan/fahrplan.xhtml?nach={s}&suche=false
sbn	OPAC SBN	opac.sbn.it/opacsbn/opac/iccu/free.jsp={s}
sbo sbopkg slackbuild slackbuilds	SlackBuilds.org	slackbuilds.org/result/?search={s}
sbs	SBS On Demand	www.sbs.com.au/ondemand/search/{s}
sbt	Socialblade twitter	socialblade.com/twitter/user/{s}
sbw	StopBadware	www.stopbadware.org/clearinghouse/search/?url={s}
sca	Reddit Skincare Addiction	www.reddit.com/r/skincareaddiction/search?q={s}&restrict_sr=on
scd sciencedaily	Science Daily	www.sciencedaily.com/search/?keyword={s}
scf	SyncFile	syncfile.co/{s}
scg	StarCityGames	sales.starcitygames.com/search.php?substring={s}
sch	Startpage (Switzerland)	startpage.com/do/search?cmd=process_search&query={s}&language=deutsch&with_region=countryCH
sck	sck.pm	api.sck.pm/shorten?{s}
scm	Smash Custom Music	www.smashcustommusic.com/index.php?song={s}
scn	SAP Community Network	search.sap.com/ui/scn#query={s}
sco slant	Slant.co	www.slant.co/search?query={s}
scq scri scritique senscritique	SensCritique	www.senscritique.com/recherche?query={s}
sdb	syntaxdb.com	syntaxdb.com/reference/search?utf8=%E2%9C%93&search={s}
sde	Startpage (deutsch)	startpage.com/do/search?cmd=process_search&query={s}&language=deutsch
sdl	Wiki LibSDL2	wiki.libsdl.org/CategoryAPI?action=fullsearch&context=180&value={s}&titlesearch=Titles
sdv svw stardew stardewvalley	Stardew Valley Wiki	stardewvalleywiki.com/mediawiki/index.php?search={s}
sea scode	Searchcode	searchcode.com/?q={s}
seb	Sebsauvage	sebsauvage.net/rhaa/index.php?q={s}
sec	SEC.gov	secsearch.sec.gov/search?utf8=?&affiliate=secsearch&query={s}
seg segdl	SEG Digital Library	library.seg.org/action/doSearch?AllField={s}
sen	Sony Entertainment Network	store.sonyentertainmentnetwork.com/#!/en-us/search/q={s}
sep plato	Stanford Encyclopedia of Philosophy	plato.stanford.edu/search/searcher.py?query={s}
seq	The Online Encyclopedia Of Integer Sequences	oeis.org/search?q={s}
ses	suomienglantisanakirja.fi	www.suomienglantisanakirja.fi/{s}
sf2 symfony	Symfony Framework	symfony.com/search?q={s}
sfe	Sparkfun Electronics	www.sparkfun.com/search/results?term={s}&what=products
sfi	Sci-Fi Interfaces	scifiinterfaces.com/?s={s}&submit=Search
sfs	stopforumspam.com	www.stopforumspam.com/search?q={s}
sfx	SFX Translations @ The JADED Network	thejadednetwork.com/sfx/search/?keyword={s}&submitSearch=
sgr seriesgraph	SeriesGraph	seriesgraph.com/show/search/{s}
shm shiki shikimori	Shikimori	shikimori.io/animes?search={s}
shs	SecondHandSongs	secondhandsongs.com/search?search_text={s}
shz	Shazam	www.shazam.com/de/search/{s}
sit	schoolido.lu	schoolido.lu/cards/?search={s}&name=&rarity=&attribute=&is_promo=&is_special=&is_event=&skill=&translated_collection=&collection=&main_unit=&sub_unit=&idol_school=&idol_year=&release_after=&release_before=&view=cards&albumbuilder_account=15585&account=&ordering=id&reverse_order=on
siw	Wikisimpsons	simpsonswiki.com/w/index.php?title=Special:Search&search={s}
sjr	Scimago Journal & Country Rank	www.scimagojr.com/journalsearch.php?q={s}
sk8	sk8park.de	sk8park.de/?s={s}
skk	Shabdkosh Kannada	shabdkosh.com/kn/translate/{s}/
sku	skUnity	docs.skunity.com/syntax/search/{s}
sky	Skysports	www.skysports.com/search?q={s}
slk slock	SearchLock	www.searchlock.com/search?q={s}
slo	Search Lotto	www.searchlotto.co.uk/yhs_search.php?q={s}
slq slqa	Sololearn Discuss	www.sololearn.com/Discuss?ordering=Trending&query={s}
smd sheetmusicdirect	sheetmusicdirect.com	www.sheetmusicdirect.com/Search.aspx?query={s}
smh	The Sydney Morning Herald	www.smh.com.au/search?text={s}
smn sms songmeanings	songmeanings	songmeanings.com/query/?query={s}
smv	SMV des OHG in KA	www.ohg-ka.de/smv/?s={s}
smw mario mariowiki	Super Mario Wiki	www.mariowiki.com/index.php?title=Special:Search&search={s}&go=Go
snc	ServiceNow	developer.servicenow.com/app.do#!/search?category=API&q={s}
snd	SnapDeal	www.snapdeal.com/search?noOfResults=20&keyword={s}
snf	Swiss National Science Foundation	www.snf.ch/en/Search/Pages/default.aspx?k={s}
snk	community.servicenow.com	community.servicenow.com/community?id=community_search&q={s}
snl	Store Norske Leksikon	snl.no/.search?e=snl&query={s}
snm	Skyrim NexusMods	www.nexusmods.com/skyrim/search/?gsearch={s}&gsearchtype=mods
snn	Sonic News Network	sonic.wikia.com/wiki/Special:Search?search={s}
sno	StartPage.com (Norwegian)	www.startpage.com/do/search?cmd=process_search&query={s}&with_region=countryNO
snp snopes	Snopes	www.snopes.com/?s={s}
sns	seaborn	seaborn.pydata.org/search.html?q={s}&check_keywords=yes&area=default
soc	Stack Overflow Careers	careers.stackoverflow.com/jobs?searchTerm={s}
sog	Stack Overflow via Google	www.google.com/search?q=site:stackoverflow.com+{s}
som	Spirit of Metal	www.spirit-of-metal.com/find.php?nom={s}
sos	Software OpenSuse	software.opensuse.org/search?q={s}&search_devel=false&search_unsupported=false
spb	Speiderbasen	speiderbasen.no/?searchWord={s}
spd	SpeeDee Delivery	packages.speedeedelivery.com/packageDetail.php?barcode={s}
spe spes	StartPage (ES)	startpage.com/do/dsearch?query={s}&cat=web&pl=opensearch&language=espanol
spf	MXToolbox	mxtoolbox.com/SuperTool.aspx?action=spf:{s}&run=toolpage
spg	Speed Guide	www.speedguide.net/search_rez.php?seek={s}&words=yes
spi startpageimages	Startpage Images	startpage.com/do/search?cat=pics&cmd=process_search&query={s}
spl	The Seattle Public Library	seattle.bibliocommons.com/search?utf8=%E2%9C%93&t=smart&search_category=keyword&commit=Search&q={s}
spm	Startpage Mobile	startpage.com/do/m/mobilesearch?&q={s}
spp	StartPage safeoff eng	startpage.com/do/search?prf=2cc506ab255c98e10570b7d50ef6b1c8&cat=web&query={s}
spr	SitePoint Reference	search.sitepoint.com/?q={s}&refinements[reference]=1
spt spy spotify spotifysearch	Spotify	open.spotify.com/search/{s}
spv	Startpage Videos	www.startpage.com/do/search?cat=video&cmd=process_search&query={s}
spx	Surplex	www.surplex.com/de/maschinen.html?tx_surplex_pi1[sword]={s}
sqa	SQA Past papers	www.sqa.org.uk/pastpapers/findpastpaper.htm?subject={s}
sqf	Bohemia Interactive Community Wiki	community.bistudio.com/wiki?search={s}
sra	SRA	www.ncbi.nlm.nih.gov/sra/?term={s}
srf	Schweizer Radio und Fernsehen	www.srf.ch/suche?q={s}
sri	SteamRep (by ID)	steamrep.com/id/{s}
srs subredditsearch	Reddit (subreddit)	www.reddit.com/search?q=subreddit:{s}
srv	Stuk Rood Vlees	stukroodvlees.nl/?s={s}
ssb	SmashWiki	www.ssbwiki.com/index.php?title=Special:Search&search={s}&go=Go
sse isec	Information Security Stack Exchange	security.stackexchange.com/search?q={s}
ssg	Sensagent	dictionnaire.sensagent.com/{s}/fr-fr/
ssl	SSL Labs	www.ssllabs.com/ssltest/analyze.html?d={s}&latest=true
ssp	Silverstripe	www.silverstripe.org/search/?q={s}
sss	SimilarSiteSearch	www.similarsitesearch.com/alternatives-to/{s}
sst	Steam Stash	csgostash.com/google-search?q={s}
ssv	Shutterstock Vector	www.shutterstock.com/search?searchterm={s}&image_type=vector
ste steam steme	Steam	store.steampowered.com/search/?term={s}
stf	Supremo Tribunal Federal	portal.stf.jus.br/processos/listarProcessos.asp?classe=&numeroProcesso={s}
stm	STM-Blog	stmblog.com/?s={s}
stp	Sierra Trading Post	www.sierratradingpost.com/s~{s}
sts	st-takla.org	st-takla.org/Coptic-Search-St-Takla.org/site_search.php?q={s}&op=and
stw	Singletrack World Forum	singletrackworld.com/forum/?wpfs={s}
stz	Stuttgarter Zeitung	www.stuttgarter-zeitung.de/suche?_charset_=UTF-8&searchText={s}
sun	Sunrise Sunset	sunrise-sunset.org/search?location={s}
sus	openSUSE	software.opensuse.org/search?utf8=%E2%9C%93&q={s}&search_devel=false&search_unsupported=false&baseproject=openSUSE:13.1
svb	Silicon Valley Bank	www.svb.com/searchresults.aspx?term={s}
svd	Svenska Dagbladet	www.svd.se/search.do?q={s}
svg	Mozilla Developer Network	developer.mozilla.org/en-US/search?q={s}&topic=svg
svr	Sveriges Radio	sverigesradio.se/sida/sok.aspx?q={s}
svs synonymer	Synonymer	www.synonymer.se/sv-syn/{s}
svt svtp	SVT Play	www.svtplay.se/sok?q={s}
swh	The Software Heritage Archive	archive.softwareheritage.org/browse/search/?q={s}
swi swipl	SWI-Prolog	www.swi-prolog.org/search?for={s}
syw shopyourway	Shop Your Way	www.shopyourway.com/search/products?q={s}
szn seznam	Seznam	search.seznam.cz/?q={s}
t-p	Telemark Pyrenees	www.telemark-pyrenees.com/en/search.php?keywords={s}
t2g	Time2Game	www.time2game.be/index.php?main_page=advanced_search_result&search_in_description=1&keyword={s}
t3n	t3n	t3n.de/search?q={s}
tab	911 Tabs	www.911tabs.com/search.php?search={s}
tal anarchistlib	The Anarchist Library	theanarchistlibrary.org/search?query={s}
tam	The Australian Markets	markets.theaustralian.com.au/shares/{s}
tan australian theaustralian	The Australian	www.theaustralian.com.au/search-results?q={s}
tap	Tappedout.net	tappedout.net/search/?q={s}
tar taringa	Taringa!	www.taringa.net/buscar/?q={s}
tas	TASVideos	tasvideos.org/Search.html?key={s}
taw	Tackle Warehouse	www.tacklewarehouse.com/searchresults.html#search=products&searchtext={s}
taz	taz.die tageszeitung	www.taz.de/!s={s}/
tba	The Blue Alliance	www.thebluealliance.com/search?q={s}
tbc tibia	Tibia	www.tibia.com/community/?subtopic=characters&name={s}
tbd bookdepository	The Book Depository	www.bookdepository.com/search?searchTerm={s}&search=Find+book
tbn	Trinity Broadcasting Network	www.tbn.org/search?s={s}
tce	The Canadian Encyclopedia	www.thecanadianencyclopedia.ca/en/search?search={s}
tch	Teaching Channel	www.teachingchannel.com/?ss360Query={s}
tcl	TCLers Wiki	wiki.tcl.tk/_/search?S={s}&_charset_=UTF-8
tcp	The Conservative Papers	conservativepapers.com/?s={s}
tcs	Texas Constitution and Statutes	www.statutes.legis.state.tx.us/SearchResults.aspx?CP=1&Code=ZZ&Phrase={s}
tcu	thecubicle.us	thecubicle.us/advanced_search_result.php?search_in_description=0&keywords={s}
tcv conv	The Conversation	theconversation.com/search?q={s}
tdb thdb	ThronesDB	thronesdb.com/find?q={s}
tdt	Tarot de Tiziana	tarotdetiziana.com/?s={s}
ted	TED	www.ted.com/search?q={s}
tei	TEI	www.tei-c.org/?s={s}
tek	Tektronix	www.tek.com/search?keywords={s}
ten trans	Google Translate (en)	translate.google.com/?hl=en&tab=TT#auto/en/{s}
teo	Teonanacatl	teonanacatl.org/search/1/?q={s}
ter	TYPO3 Extension repository	extensions.typo3.org/?L=0&id=1&tx_solr[q]={s}
tes	Google Translate to Spanish	translate.google.com/?hl=es&tab=TT#auto/es/{s}
teu	TEU	eur-lex.europa.eu/search.html?wh0=DN=12012M*&lbStatus=ALL&qid=1459001887262&DTS_DOM=EU_LAW&ARTICLE_NUM={s}&treatyStatus=ARTICLE_NUMBER&type=advanced&lang=en&SUBDOM_INIT=TREATIES&legalCelex=TEU_2012&DTS_SUBDOM=TREATIES
tex texse	tex.stackexchange	tex.stackexchange.com/search?q={s}
tf2 tf2wiki	TF2 Wiki	wiki.teamfortress.com/w/index.php?title=Special:Search&search={s}&go=Go
tfe	TickeForEvent	ticketforevent.com/events/?q={s}
tfl	Transport for London	www.tfl.gov.uk/tfl/search/?keywords={s}
tfs	Thermo Fisher Scientific	www.thermofisher.com/search/results?query={s}
tft fthes freethesaurus	The Free Dictionary (Thesaurus)	www.freethesaurus.com/{s}
tga	Theraputic Goods Administration	www.tga.gov.au/resources/artg?keywords={s}
tgc	The Great Courses	www.thegreatcourses.com/search/result/?q={s}
tgr	Tangorin Japanese Dictionary	tangorin.com/general/{s}
tgs	/tg/station 13 Wiki	tgstation13.org/wiki//index.php?search={s}&title=Special:Search
tgt target	Target	www.target.com/s?searchTerm={s}
thg thing thingy thingiverse	Thingiverse	www.thingiverse.com/search?q={s}&sa=
thj	ThULB Jena	suche.thulb.uni-jena.de/Search/Results?lookfor={s}
thm thomann	thomann.de	www.thomann.de/de/search_dir.html?sw={s}
thp	The Huffington Post	www.huffingtonpost.com/search.php/?q={s}
thw thwiki	Touhouwiki (English)	en.touhouwiki.net/index.php?title=Special:Search&search={s}
tia	Tech in Asia	www.techinasia.com/search?query={s}
tig tigsource	TIGSource	www.tigsource.com/?s={s}
tip	tipeee	www.tipeee.com/creators?search={s}
tis timeis	Time.is	time.is/{s}
tit	TradooIT	www.tradooit.com/info.php?q={s}&btn-recherche.x=0&btn-recherche.y=0&langFrom=en&langTo=fr
tjp	Tower Records Online	tower.jp/search/item/{s}
tki	Trakt IMDb	trakt.tv/search/imdb?query={s}
tkk	Tradukka Google Translate (to English)	tradukka.com/translate/en/{s}
tkm	Trakt Movies	trakt.tv/search/movies?q={s}
tks	Trakt Shows	trakt.tv/search/shows?q={s}
tkw	Thomas-Krenn-Wiki	www.thomas-krenn.com/de/wiki/Spezial:Suchergebnisseite?type=mediawiki_page&q={s}
tld dota2 ldota	Teamliquid Wiki	wiki.teamliquid.net/dota2/index.php?search={s}
tlf	The Ladies Finger	theladiesfinger.com/?s={s}
tlh	The Last Hunt	thelasthunt.com/search?type=product&q={s}
tli	The Logical Indian	thelogicalindian.com/?s={s}
tlk	tlk.io	tlk.io/{s}
tls thorlabs	Thorlabs	www.thorlabs.com/search/thorsearch.cfm?search={s}
tlw	Team Liquid Wiki	wiki.teamliquid.net/starcraft2/index.php?title=Special:Search&search={s}
tme	Transfer Multisort Elektronik	www.tme.eu/pl/katalog/?search={s}
tmg	Terraform Module Registry	registry.terraform.io/search?q={s}
tmn	TravelMath	www.travelmath.com/nearest-airport/{s}
tmr	rezeptwelt.de	www.rezeptwelt.de/search/?rec_all=0&search={s}
tmt	Tiny Mix Tapes	www.tinymixtapes.com/?search={s}
tmw	Techman's World	www.techmansworld.com/search?q={s}
tmz	TMZ	www.tmz.com/search/articles/{s}/1/
tna	The National Archives Discovery	discovery.nationalarchives.gov.uk/results/r?_q={s}
tns	The Nerdy Student	thenerdystudent.com/?s={s}
tnt	TNT	webtracker.tnt.com/webtracker/tracking.do?requestType=GEN&searchType=CON&respLang=en&respCountry=US&sourceID=1&sourceCountry=ww&cons={s}
tnw	The Next Web	thenextweb.com/?q={s}
toa	The Orange Alliance	theorangealliance.org/teams/{s}
tof	Tree Of Life Web Project	www.tolweb.org/tree/{s}
toi	The Times of India	timesofindia.indiatimes.com/topic/{s}
tok	Tome of Knowledge	tomeofknowledge.info/?q={s}
tol	Tree of Life Web Project	tolweb.org/tree/home.pages/search.html?q={s}&sa=Search
tom	The Tom Woods Show	tomwoods.com/search/{s}/
ton tonton	Tonton Roger	tontonroger.org/?q={s}
top	Techopedia	www.techopedia.com/search?q={s}&section=all
toy	ProTinkerToys.com	protinkertoys.com/search?type=product&q={s}
tpc	The People's Cube	thepeoplescube.com/searchGoogle.php?q={s}
tph	The Painted Heirloom	paintedheirloom.com/search?q={s}
tpl	Toronto Public Library	tpl.bibliocommons.com/v2/search?query={s}&searchType=smart
tpo	ThePostOnline	tpo.nl/?s={s}
tpt	Teachers Pay Teachers	www.teacherspayteachers.com/Browse/Search:{s}
tpw twpw pricewatch	Tweakers Pricewatch	tweakers.net/pricewatch/zoeken/?keyword={s}
trf	Rolex Forums	www.rolexforums.com/tags.php?tag={s}
trl	The Ring Lord	theringlord.com/cart/shopdisplayproducts.asp?Search=Yes&Keyword={s}
trn	The Real News	therealnews.com/?s={s}
trw	Traveller RPG	wiki.travellerrpg.com/index.php?title=Special:Search&search={s}
tsa	TechSupportAlert.com	www.techsupportalert.com/search/google?query={s}
tsc	The Shopping Channel	www.theshoppingchannel.com/search/{s}
tsg storygraph	Storygraph	app.thestorygraph.com/browse?search_term={s}
tsj	The Singles Jukebox	www.thesinglesjukebox.com/?s={s}
tsr	The Student Room	www.thestudentroom.co.uk/search/?tsr-search-query={s}
tsx	TSX	web.tmxmoney.com/company.php?qm_symbol={s}&locale=en
tti	Tutti ticino	www.tutti.ch/ticino?q={s}
ttr	Toontown Rewritten	toontownrewritten.wiki/index.php?search={s}
tts	Trieste Trasporti	www.triestetrasporti.it//?s={s}&lang=it
ttt	The Tech Terms	techterms.com/search?query={s}
ttv	Twitch	www.twitch.tv/search?term={s}
tty	DuckDuckGo TTY	duckduckgo.com/tty/#q={s}
tub	TUHH Library	katalog.tub.tuhh.de/Search/Results?lookfor={s}&type=AllFields&limit=20&sort=relevance
tud	Delft University of Technology	www.tudelft.nl/en/search/?q={s}
tug	Graz University of Technology	search.tugraz.at/search?q={s}&site=Alle&btnG=Suchen&client=tug_portal&output=xml_no_dtd&proxystylesheet=tug_portal&sitesearch=www.tugraz.at
tuj	Tuja Vortaro	www.tujavortaro.net/?vorto={s}
tum	Technical University of Munich	www.tum.de/en/spezialseiten/search/?q={s}&sites=all
tux	Linuxinthebox	linuxinthebox.company/?product_cat=&post_type=product&s={s}
tv2	TV2	search.tv2.dk/?query={s}&sort=relevance&page=1
tv3	TV3alacarta	www.ccma.cat/tv3/alacarta/cercador/?items_pagina=15&perfil=rellevancia&profile=videos&text={s}
tv5	TV5 Monde	www.tv5monde.com/?q={s}
tva	Tweakers Vraag & Aanbod	tweakers.net/aanbod/zoeken/?keyword={s}
tvd	The Vampire Diaries Wiki	vampirediaries.wikia.com/wiki/Special:Search?query={s}
tvi	tvi24	www.tvi24.iol.pt/pesquisa/{s}
tvl	TV LANGUEDOC	tvlanguedoc.com/search_gcse/?q={s}
tvp	TVP	www.tvp.pl/szukaj?query={s}
tvt trope tvtropes	TV Tropes	tvtropes.org/pmwiki/search_result.php?q={s}
twc	Wirecutter (A New York Times Company)	thewirecutter.com/?s={s}
twg twitchg	Twitch game search	www.twitch.tv/directory/game/{s}
twl	Twitter Latest	x.com/search?f=tweets&vertical=news&q={s}
twn wnetwork	The Weather Network	www.theweathernetwork.com/search?q={s}
twp wpost washingtonpost	The Washington Post	www.washingtonpost.com/newssearch/search.html?st={s}
tww	The Witcher Wiki	witcher.gamepedia.com/index.php?search={s}
txi	Texas Instruments	www.ti.com/sitesearch/docs/universalsearch.tsp?searchTerm={s}
tyd tyda	Tyda.se	tyda.se/search/{s}
u24	Urgente24	www.urgente24.com/search/node/{s}
ubh	YouBeHero	www.youbehero.com/gr/search/causes?loose_type=1&term={s}
ucd	UC Davis	www.ucdavis.edu/search/google/{s}
ucf	Unicode Character Finder	www.mclean.net.nz/ucf/?q={s}
uci	Union Cycliste Internationale	www.uci.org/search?q={s}
ucl	UCL	search2.ucl.ac.uk/s/search.html?query={s}&collection=website-meta&profile=_website&tab=websites&submit=Go
uct	unicode-table.com	unicode-table.com/search/?q={s}
ucv	Vancouver Unitarians	vancouverunitarians.ca/?s={s}
uea	Unreal Engine 4 Answerhub	answers.unrealengine.com/search.html?q={s}
ufc	Ultimate Fighting Championship	ufc.com/search?search={s}&sort_by=created
ugg u.gg	U.GG	u.gg/opensearch/?query={s}
ugr	Universidad de Granada	www.ugr.es/pages/search?query={s}
uif	Ultralingua	www.ultralingua.com/onlinedictionary/dictionary#src_lang=Italian&dest_lang=French&query={s}
uit uitm	Uitmuntend	www.uitmuntend.de/search.html?search={s}
ukn	University of Konstanz	www.uni-konstanz.de/suche/?q={s}
ukp ukparl	UK Parliament (Official Site)	www.parliament.uk/search/results/?q={s}
uku	Ukutabs	ukutabs.com/?s={s}
uma	Umamusume Wiki	umamusu.wiki/w/index.php?search={s}
umb	UMass Boston	www.umb.edu/search?q={s}
umd	University of Maryland	www.searchum.umd.edu/search?site=UMCP&client=UMCP&proxystylesheet=UMCP&output=xml_no_dtd&q={s}
umk	Biblioteka UMK	opac.bu.umk.pl/webpac-bin/B_horizonPL/wgbroker.exe?new+-access+top+search+open+CI+{s}
uml	University of Manitoba Library	primo-pmtna01.hosted.exlibrisgroup.com/primo-explore/search?institution=UMB&vid=UMB&tab=default_tab&search_scope=UManitoba&mode=basic&displayMode=full&bulkSize=10&highlight=true&dum=true&query=any,contains,{s}&displayField=all&pcAvailabiltyMode=true&sortby=rank&lang=en_US
umn	University of Minnesota	search.umn.edu/tc/index.php?q={s}
umo	Umart Online	www.umart.com.au/newsite/search.php?type=0&keywords={s}
une	University of New England (Australia)	www.une.edu.au/search?collection=une-meta&query={s}
uni	Search for character(s) in Unicode	unicode-search.net/unicode-namesearch.pl?term={s}
unm	University of New Mexico	search.unm.edu/search?q={s}
unp	UNP	www.unp.me/search/1/?q={s}
uns splash unspls	Unsplash	unsplash.com/search/photos/{s}
uoa	University of Auckland	search.auckland.ac.nz/search?site=All_university_websites&client=uoa_frontend&proxystylesheet=uoa_frontend&proxyreload=0&output=xml_no_dtd&q={s}
uod	University of Dallas	udallas.edu/searchresults.html?q={s}
uok	University of Kent	www.kent.ac.uk/search/?q={s}
uom	University of Manchester	www.manchester.ac.uk/search/?q={s}
uon	University of Nottingham	www.nottingham.ac.uk/search.aspx?q={s}:
uos	University of Surrey	www.surrey.ac.uk/search?query={s}
ups	UPS Tracking	wwwapps.ups.com/WebTracking/processInputRequest?tracknum={s}&
uql	University of Queensland Library	search.library.uq.edu.au/primo-explore/search?query=any,contains,{s}&tab=61uq_all&search_scope=61UQ_All&sortby=rank&vid=61UQ&offset=0
uqm	Ultranomicon	wiki.uqm.stack.nl/index.php?search={s}
usa	USA.gov	search.usa.gov/search?utf8=%E2%9C%93&affiliate=usagov&query={s}
usc uapps	Ubuntu Apps Directory	apps.ubuntu.com/cat/search/?q={s}
use	Unix & Linux (StackExchange)	unix.stackexchange.com/search?q={s}
usq	University of Southern Queensland	usq.summon.serialssolutions.com/search?s.q={s}
usr unitysr unityapi	Unity3D Scripting API	docs.unity3d.com/ScriptReference/30_search.html?q={s}
ust stylish ustyles	Stylish	userstyles.org/styles/browse?search_terms={s}
uta	University of Texas at Arlington	www.uta.edu/search/?q={s}
utk	UTK Library OneSearch	utk-almaprimo.hosted.exlibrisgroup.com/primo-explore/search?vid=01UTK&institution=01UTK&facet=rtype,exclude,reviews&facet=rtype,exclude,reference_entrys&search_scope=OneSearch&tab=default_tab&onCampus=false&group=GUEST&query=any,contains,{s}&lang=en_US
utl uoft	University of Toronto Library Onesearch	onesearch.library.utoronto.ca/onesearch/{s}
uva	University of Virginia	www.virginia.edu/search/site/{s}
uwd	The Daily of the University of Washington	www.dailyuw.com/search/?t=article&nsa=eedition&q=&x=17&y=23{s}:
uym	UnwrapYourMind	www.unwrapyourmind.com/?s={s}&submit=Search
uzh	University of Zurich	www.uzh.ch/de/search.html?q={s}
vag aowow	AoWoW VanillaGaming	db.vanillagaming.org/?search={s}
van	Vandal	vandal.elespanol.com/busqueda/{s}
vcm	Vision Christian Media	vision.org.au/site-search/?phrase={s}&cbi=1
vdb	Vanden Borre	www.vandenborre.be/zoekresultaat?query={s}&v2
vdc	Valve Developer Community	developer.valvesoftware.com/w/index.php?search={s}
vem	Vem ringde	vemringde.se/?q={s}
vex	Vexillology Wiki	vexillology.fandom.com/wiki/{s}
vft ar-15	Veriforce Tactical	veriforcetactical.com/?s={s}
vgd	v.gd	v.gd/create.php?url={s}
vgg	viagogo	www.viagogo.com/searchResults.aspx?SearchText={s}
vik	Viki.com	www.viki.com/search?q={s}
vim	Vim.org	www.google.com/cse?cx=partner-pub-3005259998294962:bvyni59kjr1&q={s}
vin	Decode This!	www.decodethis.com/VINdecoder/65/vin/{s}
vir	Virgilio	ricerca.virgilio.it/ricerca?qs={s}
vis	visuwords.com	visuwords.com/?q={s}
vla vlasisku	Vlasisku	vlasisku.lojban.org/vlasisku/{s}
vlh	Vereinigte Lohnsteuerhilfe	www.vlh.de/suche.html?q={s}
vml	ViaMichelin	www.viamichelin.com/web/Maps?address={s}
vol	Viva o Linux	www.vivaolinux.com.br/busca/?q={s}
vox	Vox.com	www.vox.com/search?q={s}
vpl	Vancouver Public Library	vpl.bibliocommons.com/search?q={s}&t=smart&search_category=keyword
vpn	VPNCompare	www.vpncompare.co.uk/?s={s}
vrv	VRV	vrv.co/?q={s}
vsb	Vancouver School District	www.vsb.bc.ca/search/node/{s}
vsc	Virgilio - Sinonimi e Contrari	sapere.virgilio.it/parole/sinonimi-e-contrari/{s}
vse	Vintage Synth Explorer	www.vintagesynth.com/google_results.php?q={s}
vsg	Value Stock Guide	valuestockguide.com/?s={s}
vtf	VTFC - vatefaireconjuguer.com	www.vatefaireconjuguer.com/conjugaison/verbe/{s}
vub	Bibliotheek van de Vrije Univesiteit Brussel	biblio.vub.ac.be/iguana/www.main.cls?sUrl=search&t=1729011946717&rtisearch=1&searchProfile=vubsearch#searchTerm={s}&searchFilter=
vue	Vue Docs	vuejs.org/v2/search/?q={s}
vuo	Vuo	vuo.org/search/site/{s}
vuw	Victoria University of Wellington	www.victoria.ac.nz/search?q={s}
vwe	VWE	www.vwe.nl/zoeken_resultaten.aspx?q={s}
vwr	VWR International	us.vwr.com/store/product?keyword={s}
w3d	WeLoveDevs	welovedevs.com/app/companies/search?query={s}&type=company
w3v validate	W3C Validator	validator.w3.org/check?uri={s}&charset=(detect+automatically)&doctype=Inline&group=0
w3w	what3words	map.what3words.com/{s}
wad	Wad Archive	www.wad-archive.com/search?o=d&q={s}
waf afwiki wikiaf	Afrikaans Wikipedia	af.wikipedia.org/w/index.php?search={s}
wai	W3C Web Accessibility Initiative	www.w3.org/WAI/search/?q={s}
wam	WolframAlpha Mobile	m.wolframalpha.com/input/?i={s}
wan anwiki wikian	Aragonese Wikipedia	an.wikipedia.org/w/index.php?search={s}
wap	Washington Apple Pi	www.wap.org/search?q={s}
war arwiki wikiar	Arabic Wikipedia	ar.wikipedia.org/w/index.php?search={s}
was aswiki wikias	Assamese Wikipedia	as.wikipedia.org/w/index.php?search={s}
waz azwiki wikiaz	Azerbaijani Wikipedia	az.wikipedia.org/w/index.php?search={s}
wb3	web3data	wb3.io/{s}
wba bawiki wikiba	Bashkir Wikipedia	ba.wikipedia.org/w/index.php?search={s}
wbd	r/worldbuilding	www.reddit.com/r/worldbuilding/?q={s}&restrict_sr=on&include_over_18=on&sort=relevance&t=all
wbe bewiki wikibe	Belarusian Wikipedia	be.wikipedia.org/w/index.php?search={s}
wbg bgwiki wikibg	Bulgarian Wikipedia	bg.wikipedia.org/w/index.php?search={s}
wbh bhwiki wikibh	Bhojpuri Wikipedia	bh.wikipedia.org/w/index.php?search={s}
wbi	Westside Boiler Invasion	boilerinvasion.org/search?search={s}
wbn bnwiki wikibn	Bengali Wikipedia	bn.wikipedia.org/w/index.php?search={s}
wbr brwiki wikibr	Breton Wikipedia	br.wikipedia.org/w/index.php?search={s}
wbs save saveback	Wayback Machine (save)	web.archive.org/save/{s}
wca wcat cawiki wikica viquipedia	Catalan Wikipedia	ca.wikipedia.org/w/index.php?search={s}
wce cewiki wikice	Chechen Wikipedia	ce.wikipedia.org/w/index.php?search={s}
wci	World Cat Identities	www.worldcat.org/identities/find?fullName={s}
wcl	Warcraftlogs	www.warcraftlogs.com/search/?term={s}
wcm	WhoCallsMe	whocallsme.com/nb/search.aspx?q={s}
wco cowiki wikico	Corsican Wikipedia	co.wikipedia.org/w/index.php?search={s}
wcs wcz cswiki wikics	Czech Wikipedia	cs.wikipedia.org/w/index.php?search={s}
wcu	Who Called Us	whocalled.us/lookup/{s}
wcv cvwiki wikicv	Chuvash Wikipedia	cv.wikipedia.org/w/index.php?search={s}
wcy cywiki wikicy	Welsh Wikipedia	cy.wikipedia.org/w/index.php?search={s}
wda wdk wikida	Danish Wikipedia	da.wikipedia.org/w/index.php?search={s}
wde wge w.de dewiki wikide wiki.de wikipediade	German Wikipedia	de.wikipedia.org/w/index.php?search={s}
wdg	Wikipedia Band Discography	en.wikipedia.org/w/index.php?title=Special:Search&search={s}+discography
wdr wrs wrensp wordreference	Wordreference (es)	www.wordreference.com/es/translation.asp?tranword={s}
wdx wkdx	Wikidex	www.wikidex.net/index.php?title=Especial:Buscar&search={s}
web webo	Webopedia	www.webopedia.com/sgsearch/results?q={s}
wer	werstreamt.es	www.werstreamt.es/filme-serien?q={s}&action_results=suchen
wes eswiki wikies	Spanish Wikipedia	es.wikipedia.org/w/index.php?search={s}
wet viki etwiki wikiet	Estonian Wikipedia	et.wikipedia.org/w/index.php?search={s}
weu euwiki wikieu	Basque Wikipedia	eu.wikipedia.org/w/index.php?search={s}
wfi wi-fi fiwiki wikifi	Finnish Wikipedia	fi.wikipedia.org/w/index.php?search={s}
wfm	Whole Foods Recipes	www.wholefoodsmarket.com/site_search/{s}
wfo wikifo	Faroese Wikipedia	fo.wikipedia.org/w/index.php?search={s}
wfr wikifr	French Wikipedia	fr.wikipedia.org/w/index.php?search={s}
wft	warframe.market	warframe.market/items/{s}
wfw wfen wframe wfwiki warframe	Warframe	wiki.warframe.com/?search={s}
wfy fywiki wikify	West Frisian Wikipedia	fy.wikipedia.org/w/index.php?search={s}
wga gawiki wikiga	Irish Wikipedia	ga.wikipedia.org/w/index.php?search={s}
wgl wgal wikigl	Galician Wikipedia	gl.wikipedia.org/w/index.php?search={s}
wgn gnwiki wikign	Guarani Wikipedia	gn.wikipedia.org/w/index.php?search={s}
wgr	Wikipedia (GR)	el.wikipedia.org/wiki/Special:Search?search={s}
wgs	Walgreens	www.walgreens.com/search/results.jsp?Ntt={s}&x=0&y=0
wgu guwiki wikigu	Gujarati Wikipedia	gu.wikipedia.org/w/index.php?search={s}
wgw wotwiki	Wargaming.net Wiki	wiki.wargaming.net/en/index.php?search={s}
wha hawiki wikiha	Hausa Wikipedia	ha.wikipedia.org/w/index.php?search={s}
whc cwow wowhc wowclassic	Wowhead Classic	classic.wowhead.com/search?q={s}
whh	Web Hosting Hub	www.webhostinghub.com/help/search?searchword={s}
whi hwiki hiwiki wikihi	Hindi Wikipedia	hi.wikipedia.org/w/index.php?search={s}
who	who.is	www.who.is/whois/{s}
whr wikihr	Croatian Wikipedia	hr.wikipedia.org/w/index.php?search={s}
wht	Who Hosts This	www.who-hosts-this.com/?s={s}
whu huwiki wikihu	Hungarian Wikipedia	hu.wikipedia.org/w/index.php?search={s}
why w-hy hywiki wikihy	Armenian Wikipedia	hy.wikipedia.org/w/index.php?search={s}
wia	WikiAventurica (de)	www.wiki-aventurica.de/index.php?title=Spezial:Suche&search={s}
wid idwiki wikiid	Indonesian Wikipedia	id.wikipedia.org/w/index.php?search={s}
wie	wie-sagt-man-noch.de	www.wie-sagt-man-noch.de/synonyme/{s}.html
wig igwiki wikiig	Igbo Wikipedia	ig.wikipedia.org/w/index.php?search={s}
wim wmc wikic commons	Wikimedia Commons	commons.wikimedia.org/w/index.php?search={s}
win	Microsoft Windows	windows.microsoft.com/en-US/windows/search#q={s}
wio iowiki wikiio	Ido Wikipedia	io.wikipedia.org/w/index.php?search={s}
wis iswiki wikiis	Icelandic Wikipedia	is.wikipedia.org/w/index.php?search={s}
wit itwiki wikiit wikipediait	Italian Wikipedia	it.wikipedia.org/w/index.php?search={s}
wja jawp jawiki wikija	Japanese Wikipedia	ja.wikipedia.org/w/index.php?search={s}
wjv jvwiki wikijv	Javanese Wikipedia	jv.wikipedia.org/w/index.php?search={s}
wka kawiki wikika	Georgian Wikipedia	ka.wikipedia.org/w/index.php?search={s}
wkb	WebKit Bugzilla	bugs.webkit.org/buglist.cgi?quicksearch={s}
wkk kkwiki wikikk	Kazakh Wikipedia	kk.wikipedia.org/w/index.php?search={s}
wkl wikiloc	Wikiloc	www.wikiloc.com/wikiloc/find.do?q={s}
wkm kmwiki wikikm	Khmer Wikipedia	km.wikipedia.org/w/index.php?search={s}
wkn knwiki wikikn	Kannada Wikipedia	kn.wikipedia.org/w/index.php?search={s}
wko kowiki wikiko	Korean Wikipedia	ko.wikipedia.org/w/index.php?search={s}
wks wksp wspec wikispecies	Wikispecies	species.wikimedia.org/w/index.php?search={s}
wku wvers wikiversity	Wikiversity	en.wikiversity.org/w/index.php?search={s}
wky kywiki wikiky	Kyrgyz Wikipedia	ky.wikipedia.org/w/index.php?search={s}
wla vici lawiki wikila	Latin Wikipedia	la.wikipedia.org/w/index.php?search={s}
wlb lbwiki wikilb	Luxembourgish Wikipedia	lb.wikipedia.org/w/index.php?search={s}
wln	WestlawNext	a.next.westlaw.com/Search/Results.html?query={s}&jurisdiction=ALLCASES
wlo lowiki wikilo	Lao Wikipedia	lo.wikipedia.org/w/index.php?search={s}
wlr mathematica	Mathematica	reference.wolfram.com/search/?q={s}
wlt ltwiki wikilt	Lithuanian Wikipedia	lt.wikipedia.org/w/index.php?search={s}
wlv lvwiki wikilv	Latvian Wikipedia	lv.wikipedia.org/w/index.php?search={s}
wlw	Wer liefert was	www.wlw.de/search?suchbegriff={s}
wme	Wolne Media	wolnemedia.net/?s={s}
wmg mgwiki wikimg	Malagasy Wikipedia	mg.wikipedia.org/w/index.php?search={s}
wmk mkwiki wikimk	Macedonian Wikipedia	mk.wikipedia.org/w/index.php?search={s}
wml mlwiki wikiml	Malayalam Wikipedia	ml.wikipedia.org/w/index.php?search={s}
wmn mnwiki wikimn	Mongolian Wikipedia	mn.wikipedia.org/w/index.php?search={s}
wmo	World Meteorological Organisation	public.wmo.int/en/search?search_api_views_fulltext={s}
wmr mrwiki wikimr	Marathi Wikipedia	mr.wikipedia.org/w/index.php?search={s}
wms mswiki wikims	Malay Wikipedia	ms.wikipedia.org/w/index.php?search={s}
wmt mtwiki wikimt	Maltese Wikipedia	mt.wikipedia.org/w/index.php?search={s}
wmv	meteovista	www.meteovista.com/Go/Search/SearchResults?searchCriteria={s}&pageIndex=0&searchAction=WeatherInformation
wmy mywiki wikimy	Burmese Wikipedia	my.wikipedia.org/w/index.php?search={s}
wnd	wandaloo	www.wandaloo.com/search-result.php?pg=1&q={s}&w=news&m=pertinence
wne newiki wikine	Nepali Wikipedia	ne.wikipedia.org/w/index.php?search={s}
wng	World News Group	world.wng.org/search/site/{s}
wnk wordnik	Wordnik	www.wordnik.com/words/?myWord={s}
wnl nlwi nlwiki wikinl	Dutch Wikipedia	nl.wikipedia.org/w/index.php?search={s}
wnn nnwiki wikinn	Norwegian (Nynorsk) Wikipedia	nn.wikipedia.org/w/index.php?search={s}
wno nowiki wikino	Norwegian Wikipedia	no.wikipedia.org/w/index.php?search={s}
wnp	WNP.pl	www.wnp.pl/wyszukiwanie.html?szukaj={s}
wnv	Waging Nonviolence	wagingnonviolence.org/?s={s}
woc ocwiki wikioc	Occitan Wikipedia	oc.wikipedia.org/w/index.php?search={s}
wol watchtower	Watchtower Online Library	wol.jw.org/en/wol/qt/r1/lp-e?q={s}
wor orwiki wikior	Odia Wikipedia	or.wikipedia.org/w/index.php?search={s}
wos worldofspectrum	World of Spectrum	www.worldofspectrum.org/infoseek.cgi?regexp={s}&model=any&loadpics=3&fast=on
wot mywot weboftrust	Web of Trust	www.mywot.com/en/scorecard/{s}
wow	World of Warcraft	worldofwarcraft.com/search?q={s}
wox	Woxicon	www.woxikon.com/?q={s}
wpa pawiki wikipa	Punjabi Wikipedia	pa.wikipedia.org/w/index.php?search={s}
wpd	WP Plugin Directory	wpplugindirectory.org/?s={s}
wpp wpplugs	wordpress.org	wordpress.org/plugins/search/{s}/
wps pswiki wikips	Pashto Wikipedia	ps.wikipedia.org/w/index.php?search={s}
wpt ptwiki wikipt	Portuguese Wikipedia	pt.wikipedia.org/w/index.php?search={s}
wqu quwiki wikiqu	Quechua Wikipedia	qu.wikipedia.org/w/index.php?search={s}
wra wolf alpha walpha wolfram wolframalpha	Wolfram|Alpha	www.wolframalpha.com/input/?i={s}
wrc wrcfr	Word Reference French Conjugate	www.wordreference.com/conj/FrVerbs.aspx?v={s}
wrd	Wire Grind	www.wiregrind.com/rhyming-dictionary/?word={s}
wre wres esdef wrdes	Word Reference Definicion	www.wordreference.com/definicion/{s}
wrh	What Really Happened	whatreallyhappened.com/search/node/{s}
wro wikiro	Romanian Wikipedia	ro.wikipedia.org/w/index.php?search={s}
wrw rwwiki wikirw	Kinyarwanda Wikipedia	rw.wikipedia.org/w/index.php?search={s}
wsa sawiki wikisa	Sanskrit Wikipedia	sa.wikipedia.org/w/index.php?search={s}
wsc scwiki wikisc	Sardinian Wikipedia	sc.wikipedia.org/w/index.php?search={s}
wsg	Winning Strategy Games	winningstrategy.games/search/{s}
wsh	WikiShia	en.wikishia.net/view/?search={s}
wsi siwiki wikisi	Sinhala Wikipedia	si.wikipedia.org/w/index.php?search={s}
wsj	The Wall Street Journal	www.wsj.com/search/term.html?KEYWORDS={s}&isAdvanced=true&daysback=90d&andor=AND&sort=date-desc&source=wsjarticle,wsjblogs,wsjvideo,interactivemedia,sitesearch,wsjpro
wsk skwiki wikisk	Slovak Wikipedia	sk.wikipedia.org/w/index.php?search={s}
wsl wikisl	Slovene Wikipedia	sl.wikipedia.org/w/index.php?search={s}
wso	Wall Street Oasis Forums	www.wallstreetoasis.com/search/apachesolr_search/{s}
wsq sqwiki wikisq	Albanian Wikipedia	sq.wikipedia.org/w/index.php?search={s}
wsr srwiki wikisr	Serbian Wikipedia	sr.wikipedia.org/w/index.php?search={s}
wsu wayne	Wayne State University	wayne.edu/search/?type=all&q={s}
wsv svwiki wikisv	Swedish Wikipedia	sv.wikipedia.org/w/index.php?search={s}
wsw wikisw	Swahili Wikipedia	sw.wikipedia.org/w/index.php?search={s}
wta	WTA Tennis	www.wtatennis.com/search/query/{s}
wte tewiki wikite	Telugu Wikipedia	te.wikipedia.org/w/index.php?search={s}
wtf	MirBSD Acronyms Database	www.mirbsd.org/wtf.cgi?q={s}
wth	Wiktionary (Hindi)	hi.wiktionary.org/w/index.php?search={s}
wtk tkwiki wikitk	Turkmen Wikipedia	tk.wikipedia.org/w/index.php?search={s}
wtl	What the fuck should I listen to right now	whatthefuckshouldilistentorightnow.com/artist.php?artist={s}
wtm	Wiktionary Mobile	en.m.wiktionary.org/wiki/{s}
wtn tnwiki wikitn	Tswana Wikipedia	tn.wikipedia.org/w/index.php?search={s}
wtr trwiki wikitr	Turkish Wikipedia	tr.wikipedia.org/w/index.php?search={s}
wtt ttwiki wikitt	Tatar Wikipedia	tt.wikipedia.org/w/index.php?search={s}
wtw	War Thunder Wiki	wiki.warthunder.com/index.php?search={s}
wuk ukwiki wikiuk	Ukrainian Wikipedia	uk.wikipedia.org/w/index.php?search={s}
wul wortschatz	Wortschatz	corpora.uni-leipzig.de/de/res?corpusId=deu_newscrawl_2011&word={s}
wur urwiki wikiur	Urdu Wikipedia	ur.wikipedia.org/w/index.php?search={s}
wus	Walmart US	www.walmart.com/search/?query={s}&country=US
wuz uzwiki wikiuz	Uzbek Wikipedia	uz.wikipedia.org/w/index.php?search={s}
wvd wvdsh wavedash	Wavedash	wavedash.com/browse?q={s}
wvi viwiki vnwiki wikivi wiki-vn	Vietnamese Wikipedia	vi.wikipedia.org/w/index.php?search={s}
wvl	WorldVectorLogo	worldvectorlogo.com/search/{s}
wvo	Wikipedia (VO)	vo.wikipedia.org/w/index.php?search={s}
wwe	WWE	www.wwe.com/search/all/relevance/{s}
wwf	WWF	www.worldwildlife.org/search?cx=003443374396369277624:v3nraqhmeyk&ie=UTF-8&x={s}&sa=
www	PublicWWW	publicwww.com/websites/{s}/
wxd woxikon	Woxikon	synonyme.woxikon.de/synonyme/{s}.php
wxf	WuxiaWorld Forums	forum.wuxiaworld.com/search?Search={s}
wxw	wxWidgets Documentation	docs.wxwidgets.org/trunk/search.php?query={s}
wyi wikiyi yiwiki	Yiddish Wikipedia	yi.wikipedia.org/w/index.php?search={s}
wyo wikiyo yowiki	Yoruba Wikipedia	yo.wikipedia.org/w/index.php?search={s}
wzh wizh wikizh zhwiki	Chinese Wikipedia	zh.wikipedia.org/w/index.php?search={s}
wzl	Weasyl	www.weasyl.com/search?q={s}
wzu wikizu zuwiki	Zulu Wikipedia	zu.wikipedia.org/w/index.php?search={s}
wzw	Warpzone Wiki	wiki.warpzone.ms/start?do=search&id={s}
x86	x86 Opcode & Instruction Reference	ref.x86asm.net/geek.html#{s}
xda xdaf xdadev	XDA Developers	forum.xda-developers.com/search/?query={s}
xen	Xenharmonic Wiki	en.xen.wiki/index.php?search={s}
xep	XMPP Extensions	xmpp.org/extensions/xep-{s}.html
xfe	IBM X-Force Exchange	exchange.xforce.ibmcloud.com/search/{s}
xgn	XGN	www.xgn.nl/zoeken/{s}
xiv xivdb	XIVDB	xivdb.com/?search={s}
xlm	StellarExpert	stellar.expert/explorer/public/account/{s}
xvr	arxiv vanity	www.arxiv-vanity.com/convert/?query={s}
xxl	XXL.no	xxl.no/search?q={s}
yam	Yammer	www.yammer.com/search?search={s}
yan yaen yandexen	Yandex (en)	yandex.com/search?text={s}
yat ytren	Yandex Translate (en)	translate.yandex.com/?text={s}
yay	YAY.BG	www.yay.bg/index.php?route=product/search&search={s}
ydd youdaod	Youdao Dict	dict.youdao.com/search?q={s}
yde	Yahoo German	de.yahoo.com/?q={s}
yep	Yep	yep.com/web?q={s}
yfc	Yahoo Finance Charts	finance.yahoo.com/chart/{s}
yfd	Yufid	yufid.com/result/?search={s}
yfp	Yahoo Finance (Company Profile)	finance.yahoo.com/quote/{s}/profile
ygo yugioh	Yu-Gi-Oh! Wikia	yugioh.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
yii	Yii Framework	www.yiiframework.com/search/?q={s}
yim yimages	Yahoo! Images	images.search.yahoo.com/search/images?p={s}&fr=alltheweb&ei=utf-8&n=30&x=wrt&y=Search
yjm	yahoo japan map	map.yahoo.co.jp/mapsearch/search?p={s}
yjr yrtjp	Yahoo! Japan Realtime	search.yahoo.co.jp/realtime/search?p={s}
yle	Yle	haku.yle.fi/?query={s}
ypp	Puzzle Pirates YPPedia	yppedia.puzzlepirates.com/Special:Search?search={s}
ypw	Yocto Project Wiki	wiki.yoctoproject.org/wiki/index.php?search={s}
ypy yippy	Yippy	www.yippy.com/search/?v:project=clusty-new&query={s}
yri	Yandex Reverse Image Search	yandex.com/images/search?url={s}&rpt=imageview
ytc	YouTube Channel	www.youtube.com/results?search_query={s}&sp=EgIQAg%253D%253D
ytd ytvideo	YouTube Video	www.youtube.com/watch?v={s}
ytg ytgaming	YouTube Gaming	gaming.youtube.com/results?search_query={s}
yth	YouTube History	www.youtube.com/feed/history?query={s}
yti	YouTube India	www.youtube.in/results?search_query={s}
ytj	Yahoo! Travel Japan	travel.yahoo.co.jp/dhotel/search/?qry={s}
ytl	YouTube - long	www.youtube.com/results?search_type=videos&search_query={s}&search_duration=long&uni=3
ytp	YouTube Playlists	www.youtube.com/results?q={s}&sp=EgIQAw==
ytv yourtv	yourTV.com.au	www.yourtv.com.au/guide/search.aspx?q={s}
ytw	Yahoo! Taiwan	tw.search.yahoo.com/search?p={s}
yum yummly	Yummly	www.yummly.com/recipes?q={s}
yvr	Vancouver Airport	www.yvr.ca/en/search#q={s}
yyh	Yu Yu Hakusho Wiki	yuyuhakusho.wikia.com/wiki/Special:Search?search={s}
z3s	Zaufana Trzecia Strona	zaufanatrzeciastrona.pl/?s={s}
zal	Zalando	www.zalando.de/katalog/?q={s}&qf=1
zap	Zap	www.zap.co.il/search.aspx?keyword={s}
zdf	ZDF	www.zdf.de/suche?q={s}
zds	ZesteDeSavoir	zestedesavoir.com/rechercher/?q={s}
zdw	Zelda Dungeon Wiki	www.zeldadungeon.net/wiki/Special:Search/{s}
zed	Zed Docs	zed.dev/docs/?search={s}
zff	Zurb Foundation Forum	foundation.zurb.com/forum/posts?utf8=%E2%9C%93&search={s}&button=
zic	ZeroInCondotta	www.zic.it/?s={s}
zig	Ziglang std docs	ziglang.org/documentation/master/std/#?{s}
zip	Zip-Codes.com	www.zip-codes.com/search.asp?srch-type=fuzzy&q={s}
zkb zkill zkillboard	zKillboard	zkillboard.com/search/{s}/
zpl	zakonyprolidi.cz	www.zakonyprolidi.cz/hledani?text={s}
zum	zum	search.zum.com/search.zum?query={s}
zxr	Zephyr Cross Reference	elixir.bootlin.com/zephyr/latest/ident/{s}
.net	DotNet Docs	www.searchdotnet.com/results.aspx?q={s}
1122	1122	1122.com.uy/buscar/{s}/todo-el-pais
1881	1881.no	www.1881.no/?query={s}
24au	24au.ru	krsk.au.ru/nextauction/?search={s}
2b2t	2b2t wiki	2b2t.miraheze.org/w/index.php?search={s}&title=Special:Search&go=Go
2eme	2ememain	www.2ememain.be/marche/2/{s}/
35c3	35C3 Wiki	events.ccc.de/congress/2018/wiki/index.php?search={s}
3gpp	3GPP Technical Specification	www.3gpp.org/DynaReport/{s}.htm
4cha	4chan /a/ board	boards.4chan.org/a/catalog#s={s}
4chc	4chan Catalog	boards.4chan.org/{s}/catalog
4chg	4chan technology board	boards.4chan.org/g/catalog#s={s}
4chv	4chan video games board	boards.4chan.org/v/catalog#s={s}
4cvg	4chan, /vg/	boards.4chan.org/vg/catalog#s={s}
4pda	4pda	4pda.to/forum/index.php?act=search&source=all&forums[]=all&query={s}&x=0&y=0
750g	750g	www.750g.com/recherche.htm?search={s}
8020	80/20	8020.net/freetextsearch/search/result/?keyword={s}
89.9	89.9 TheLight	thelight.com.au/?s={s}
911s	911 Tabs (Songs)	www.911tabs.com/search.php?search={s}&type=song
a.ae amazonae amazon_ae amazon.ae	Amazon UAE	www.amazon.ae/s?k={s}
aadl	Ann Arbor District Library	www.aadl.org/catalog/search/keyword/{s}
aakb	Aarhus Bibliotekerne	www.aakb.dk/search/ting/{s}?
aapt	Aptoide	www.aptoide.com/search/view?search_top={s}&x=0&y=0
aard	AardWiki	www.aardwolf.com/wiki/index.php/Site/Search?q={s}
aare	Estonian - English - Estonian Dictionary	aare.edu.ee/dictionary.html?query={s}&lang=ee
abbr standsfor	Abbreviations.com	www.abbreviations.com/{s}
abnb	Airbnb	www.airbnb.com/s/{s}/all
accc	Australian Competition and Consumer Commission	www.accc.gov.au/search?query={s}
acer	Acer	us.acer.com/ac/en/US/search?q={s}
aclu	American Civil Liberties Union	www.aclu.org/search/{s}?show_aff=1
acne	Acne.org	www.acne.org/search.php?i=&q={s}
acnl	Apple Coach	applecoach.nl/?s={s}
acro acronym acronyms	Acronyms	www.acronymfinder.com/~/search/af.aspx?string=exact&Acronym={s}
adev swift	Apple Developer	developer.apple.com/search/?q={s}
adoc ansible	Ansible Docs	docs.ansible.com/ansible/latest/search.html?q={s}
adom	ADOM Wiki	ancardia.wikia.com/wiki/Special:Search?search={s}
ador	Adorama	www.adorama.com/l/?searchinfo={s}
adsb	ADS-B Exchange	www.adsbexchange.com/?icao={s}
adsk	Autodesk Community	forums.autodesk.com/t5/forums/searchpage/tab/message?q={s}
adsr	ADSR Sounds	www.adsrsounds.com/?src={s}
ahdb	ArkhamDB	arkhamdb.com/find?q={s}
ahkd	AutoHotkey v2 Docs	www.autohotkey.com/docs/v2/search.htm?q={s}
aion	Aion Wiki	aion.wikia.com/wiki/index.php?search={s}&fulltext=0
air1	Air1	www.air1.com/search.aspx?searchterm={s}
airn airnav	AirNav	airnav.com/airport/{s}
aish	Aish	www.aish.com/search/?keywords={s}
algo	Algorithmia	algorithmia.com/search?q={s}
alib	Auckland Libraries	discover.aucklandlibraries.govt.nz/search?query={s}
alim	AliExpress Mobile	m.aliexpress.com/search.htm?keywords={s}
alko	Alko	www.alko.fi/INTERSHOP/web/WFS/Alko-OnlineShop-Site/fi_FI/-/EUR/ViewParametricSearchBySearchIndex-SimpleGenericSearch?SearchTerm={s}
alza	Alza.cz	www.alza.cz/search.htm?exps={s}
amkt	Atlassian Marketplace	marketplace.atlassian.com/search?q={s}
ammo	Ammo Depot	www.ammodepottx.com/#sthash.Bx8Cvh8l.dpbs={s}:
amp3 amazonmp3	Amazon MP3 Store	www.amazon.com/s?k={s}&i=digital-music
anag	Internet Anagram Server	new.wordsmith.org/anagram/anagram.cgi?anagram={s}&t=500&a=n
anau	Android Authority	www.androidauthority.com/?q={s}
anki	Ankiweb	ankiweb.net/shared/decks/{s}
anne	AnimeNewsNetwork Encyclopedia	www.animenewsnetwork.com/encyclopedia/search/name?only=anime&q={s}
ansa	Ansa	www.ansa.it/ricerca/ansait/search.shtml?any={s}
aops	Art of Problem Solving [Wiki]	artofproblemsolving.com/wiki/index.php?title=Special:Search&fulltext=Search&search={s}
aoty	Album of The Year	www.albumoftheyear.org/search?q={s}
apck apackages	ArchLinux Packages	www.archlinux.org/packages/?sort=&q={s}&maintainer=&last_update=&flagged=&limit=50
apin	Academic Progress India	academicprogress.in/library/search/?q={s}
apiv	Amazon Prime Instant Video	www.amazon.com/s?k={s}&i=prime-instant-video
apkd apkpure	ApkPure	apkpure.net/search?q={s}
apkm apkmirror	APKMirror	www.apkmirror.com/?s={s}
apln animeplanet anime-planet	Anime Planet	www.anime-planet.com/anime/all?name={s}
apod	NASA - Astronomy Picture of the Day	apod.nasa.gov/cgi-bin/apod/apod_search?tquery={s}
apro	aprohirdetesingyen.hu	aprohirdetesingyen.hu/osszes-hirdetes/kereses--{s}
arch	ArchLinux Wiki	wiki.archlinux.org/index.php?title=Special:Search&search={s}&go=Go
arcw arcwiki	ARC Raiders Wiki	arcraiders.wiki/w/index.php?search={s}
arda	The Encyclopedia of ARDA	www.glyphweb.com/arda/search.asp?search={s}
aria	Aria	www.aria.co.uk/Products?search={s}
arin	ARIN Whois	whois.arin.net/ui/?q={s}
arms	ARMS Institute	armswiki.org/wiki/index.php?search={s}&title=Special:Search&go=Go
artd artdiscount	ArtDiscount	www.artdiscount.co.uk/catalogsearch/result/?cat=0&q={s}
arte artefr	Arte (FR)	www.arte.tv/fr/search/?q={s}&page=1
ascl	ASCL.net - Astrophysics Source Code Library	ascl.net/code/search/{s}
asda	Asda Groceries	groceries.asda.com/asda-webstore/landing/home.shtml#/search/{s}
asee	Papers on Engineering Education Repository (ASEE PEER)	peer.asee.org/?q={s}
asha	Ashadidi	ashadidi.com/search/{s}
asin	Amazon (ASIN)	www.amazon.com/dp/{s}
asku askubnt aubuntu askubuntu	Ask Ubuntu	askubuntu.com/search?q={s}
asos	Asos.com	www.asos.com/search/?q={s}
astk astock	Adobe Stock	stock.adobe.com/search?k={s}
asus	Asus	www.asus.com/us/Search/?SearchKey={s}
at40	American Top 40	www.at40.com/?q={s}
atjs atmospherejs	Atmosphere	atmospherejs.com/?q={s}
atom movies	Atom Tickets	www.atomtickets.com/search?query={s}
audf	Audacity Forum	forum.audacityteam.org/search.php?keywords={s}
audi	Audi	www.audi.de/de/brand/de/tools/search.html#search={s}
aurp	Arch User Repository Package	aur.archlinux.org/packages/{s}
avis	applevis.com	www.applevis.com/search?search_api_views_fulltext={s}
avvo	avvo.com	www.avvo.com/search?query={s}&commit=Search
awad	A.Word.A.Day	wordsmith.org/awad/search.html?q={s}
away	Get Away Gear	www.getawaywear.com/search?q={s}
awde archde	wiki.archlinux.de	wiki.archlinux.de/index.php?search={s}
azol	Augsburger Allgemeine	azol.de/suche/?q={s}
b3ta	B3TA	b3ta.com/search/posts?q={s}
baba alibaba	Alibaba	www.alibaba.com/trade/search?SearchText={s}
babp	Bab.la Polish	en.bab.la/dictionary/polish-english/{s}
badi	Badi	badi.com/us/s/{s}
bahn	Deutsche Bahn Reiseauskunft	reiseauskunft.bahn.de/bin/query.exe/dn?S=&Z={s}
bang bangs heliumbangs	Helium Bangs	helium.computer/bangs#{s}
base	Base Search	www.base-search.net/Search/Results?lookfor={s}&type=all&oaboost=1&ling=1&name=&newsearch=1&refid=dcbasen
bato batoto	Batoto	bato.to/search?name={s}&name_cond=c
bbci iplayer	BBC iPlayer	www.bbc.co.uk/iplayer/search?q={s}
bbcm	BBC Mundo	www.bbc.co.uk/mundo/search/?q={s}
bbcr	BBC Resources	www.bbc.co.uk/search?q={s}
bbcs	Bitbucket Code Search	bitbucket.org/search?q={s}
bbcw	BBC Weather	www.bbc.co.uk/weather/search?s={s}
bbfc	British Board of Film Classification	www.bbfc.co.uk/search?q={s}
bbjs	Babylon.js documentation	doc.babylonjs.com/search/?bjsq={s}
bbus	Bitbucket User	bitbucket.org/{s}/
bbuy	Best Buy	www.bestbuy.com/site/Brands/Apple/pcmcat128500050005.c?id=pcmcat128500050005&pageType=REDIRECT&issolr=1&searchterm={s}
bbyc bestbuyca	Bestbuy.ca	www.bestbuy.ca/en-ca/search?search={s}
bcdb	The Big Cartoon Database	www.bcdb.com/bcdb/search.cgi?query={s}&amp;bool=and&amp;substring=1
bday	Bing (past day)	www.bing.com/search?q={s}&filters=ex1:""ez1""
bdbk	BaiduBaike	wapbaike.baidu.com/search/word?word={s}
bdgc	BitDegree Online Courses	www.bitdegree.org/search?q={s}&src=ukw
bdgl	BitDegree Learn	www.bitdegree.org/learn/search?query={s}
bdlp dblp	BDLP	dblp.uni-trier.de/search?q={s}
beam	BeamMachine.net	www.beammachine.net/de/qsearch.php?q={s}&strict=1
beck	beck-online	beck-online.beck.de/Search?words={s}
beet	Beets Documentation	beets.readthedocs.io/en/latest/search.html?q={s}
bell	Bell	www.bell.ca/Search?q={s}
bgea billygraham	Billy Graham	billygraham.org/?s={s}
bgkj bgkjv	BibleGateway: King James Version	www.biblegateway.com/quicksearch/?quicksearch={s}&qs_version=KJV
bgpt bgptools	bgp.tools	bgp.tools/search?q={s}
bich	BitInfoCharts	bitinfocharts.com/comparison/marketcap-{s}.html#log
bifr	Bioinfo-fr	bioinfo-fr.net/?s={s}
bigw	Big W	www.bigw.com.au/search/?text={s}&category=
bili blbl bilibili	bilibili	search.bilibili.com/all?keyword={s}
bioc	Bioconductor	bioconductor.org/help/search/index.html?q={s}
bird birds	All About Birds	www.allaboutbirds.org/news/search/?q={s}
bisa	Bisafans.de	www.bisafans.de/suchbisa.php?q={s}
bisp	Bisp-Surf	www.bisp-surf.de/Search/Results?type=AllFields&lookfor={s}&submit=Suchen&limit=20&sort=relevance
bitc bitch bitchute	BitChute	www.bitchute.com/search/?q={s}&sort=date_created+desc
blcy	BlockCypher	live.blockcypher.com/btc/address/{s}
blex	_ Blender Stack Exchange	blender.stackexchange.com/search?q={s}
blmb bloom	Bloomberg	www.bloomberg.com/search?query={s}
blms	British Library Explore Archives and Manuscripts	searcharchives.bl.uk/primo_library/libweb/action/search.do?fn=search&vl(freeText0)={s}
bmde	BrickMerge	www.brickmerge.de/?find={s}
bndc bcamp bandcamp	Bandcamp	bandcamp.com/search?q={s}
bnha	Boku no Hero Academia Wiki	bokunoheroacademia.wikia.com/wiki/Special:Search?go&query={s}
bnil	Bailey Nurseries	www.baileynurseries.com/imagelibrary/gallery/search/?name={s}&brand=All&plant_type=All&height_lo=&height=f&spread_lo=&spread=f&exposure=All&zone=All&foliage=&dosearch=Do+Search
bodo	bodo Verkehrsverbund	www.bodo.de/suche.html?tx_kesearch_pi1[sword]={s}
bola parawiki parabolaw	Parabola GNU/Linux Wiki	wiki.parabola.nu/index.php?title=Special:Search&search={s}&go=Go
bona	Bona	www.bona.co.za/?s={s}
book booking	Booking.com	www.booking.com/searchresults.html?ss={s}&si=ai
boot	Bootstrap	getbootstrap.com/docs/4.0/components/{s}/
botc	Blood on the Clocktower Wiki	wiki.bloodontheclocktower.com/index.php?search={s}
bpop brainpop	BrainPOP	www.brainpop.com/search/search.weml?keyword={s}
bppn	Bppn	katalog.bppn.waw.pl/F?func=find-b&request={s}&find_code=WRD&adjacent=N&local_base=PRA01&x=0&y=0&filter_code_1=WLN&filter_request_1=&filter_code_2=WYR&filter_request_2=&filter_code_3=WYR&filter_request_3=&filter_code_4=WFM&filter_request_4=&filter_code_5=WSL&filter_request_5=
bpro	Baseball Prospectus	legacy.baseballprospectus.com/player_search.php?search_name={s}
brde	Bayerischer Rundfunk	www.br.de/service/suche/index.html?query={s}
brim	Bricks in Motion	www.bricksinmotion.com/forums/search/?action=search&keywords={s}&search=Submit+search&show_as=topics
brly	Brainly	brainly.com/app/ask?entry=hero&q={s}
brst	Brawl Stars Wiki	brawlstars.fandom.com/wiki/Special:Search?query={s}
brtm umods	Urgence Mods	urgencesmods.fr/mods/?s={s}
bsky bluesky	Bluesky	bsky.app/search?q={s}
btcm	Bitcoinity Markets	bitcoinity.org/markets/{s}/USD
bttv	BetterTTV	betterttv.com/emotes/shared/search?query={s}
buej	BU Alumni Medical Library- E-Journals	buprimo.hosted.exlibrisgroup.com/primo-explore/search?query=any,contains,{s}&tab=default_tab&search_scope=default_scope&vid=BU&lang=en_US&offset=0
bugs	Bugs!	music.bugs.co.kr/search/integrated?q={s}
bunq	bunq Together	together.bunq.com/?q={s}
busa	Basket USA	www.basketusa.com/?s={s}
buzz	Playbuzz	www.playbuzz.com/search?query={s}
byte	BytePost	www.byte-post.com/?s={s}
byui	Brigham Young University - Idaho	www.byui.edu/search/result?q={s}
c3tv mccc mediaccc	C3TV	media.ccc.de/search/?q={s}
cabq	City of Albuquerque	www.cabq.gov/searchresults?q={s}
cact	Cactus2000 - Conjugation Table (German)	conjd.cactus2000.de/index.php?q={s}
cafr	Carrefour	www.carrefour.fr/?q={s}
caho	Cardhoarder	www.cardhoarder.com/cards?data[search]={s}
cake	CakePHP API	api.cakephp.org/search/{s}
cald cdic cambridge	Cambridge Dictionary	dictionary.cambridge.org/search/british/?q={s}
call	QRZCQ	qrzcq.com/?q={s}&action=search&page=search
cals	Calorie Count	www.caloriecount.com/search/foods?searchpro={s}
camd	Cambridge Dictionary (American English)	dictionary.cambridge.org/search/american-english/direct/?q={s}
camg	Cambridge Dictionary (British Grammar)	dictionary.cambridge.org/us/grammar/british-grammar/{s}
capp	CAPP/USA	www.cappusa.com/catalogsearch/result/?q={s}
cath	CATH database	www.cathdb.info/search?q={s}
cbbr	College Basketball Reference	www.sports-reference.com/cbb/search/search.fcgi?hint=&search={s}&pid=&idx=
ccel	Christian Classics Ethereal Library	www.ccel.org/search/fulltext/{s}
ccly	Color Coded Lyrics	colorcodedlyrics.com/?s={s}
ccst csstricks	CSS Tricks	css-tricks.com/search-results/?q={s}
cctv	CCTV	so.cntv.cn/language/english/?qtext={s}
cdda cddaw	Cataclysm: Dark Days Ahead wiki	cddawiki.chezzo.com/cdda_wiki/index.php?search={s}
cdev	Cloudflare Developer Documentation	developers.cloudflare.com//?q={s}
cdmn cdomain	Cloudflare Domains	www.cloudflare.com/domains/search?q={s}
cdon cdonse	CDON	cdon.se/search?q={s}
cerl	CERL Thesaurus	thesaurus.cerl.org/cgi-bin/search.pl?type=l&type=i&type=p&type=c&query={s}
cern	CERN Phonebook	phonebook.cern.ch/phonebook/#search/?query={s}
cfbr	College Football Reference	www.sports-reference.com/cfb/search/search.fcgi?search={s}
cgpt chatgpt	ChatGPT	chatgpt.com/?prompt={s}
char	charcod.es	charcodes.netlify.app/#{s}
chip	CHIP Online	suche.chip.de/?q={s}&it=1&submit.x=0&submit.y=0
choc	Chocolate Covered Katie	chocolatecoveredkatie.com/?s={s}
chow	Chowhound	www.chow.com/search?type=Topic&from_date=1+year+ago&query={s}
chuk	Companies House	beta.companieshouse.gov.uk/search?q={s}
ciao	Ciao.de	www.ciao.de/sr/q-{s}
cine	Cinemassacre	cinemassacre.com/?s={s}&search.x=0&search.y=0
citi	Citizendium	citizendium.org/wiki?search={s}&title=Special:Search&go=Go+To+Page
cjeu	Curia (eu)	curia.europa.eu/juris/liste.jsf?language=en&num={s}
ck12	cK-12.org	www.ck12.org/search/?q={s}&referrer=top_nav&autoComplete=false
cktl	1001cocktails	www.1001cocktails.com/cocktails/rechercheCocktailsNom.php?mot={s}
clas	Clas Ohlson	www.clasohlson.com/se/view/content/search?searchKey=All&search_prefix={s}
clfp charlotteslaw	Charlotte's Law & Fine Prints	www.charlotteslaw.nl/?s={s}
clhs	CommonLisp HyperSpec	www.lispworks.com/cgi-bin/search.cgi?q={s}&cmd=Search!&t=-D--HB-
clio	CLIO: Columbia University Library Catalog	clio.columbia.edu/catalog?q={s}
clwb	clwb	clwb.net/?post_type=event&s={s}
cmmm cmmmgr	CMM-Manager Forum	support.qxcmm.com/portal/en/community/search/{s}
cnba	Colegio Nacional de Buenos Aires	cnba.uba.ar/search/node/{s}
cnbc	CNBC	search.cnbc.com/main.do?target=all&keywords={s}
cnet	CNET	www.cnet.com/search/?searchQuery={s}
codw	Call of Duty Wiki	callofduty.wikia.com/wiki/Special:Search?search={s}
coho	Coho Books	bookmanager.com/760081x/index.php?q=h.tviewer&using_sb=status&qsb=keyword&so=oh&searchtype=keyword&qs={s}&x=0&y=0&qs_file=
comc	COMC	www.comc.com/Cards,={s}
coms	COMS (conference-service.com)	www.conference-service.com/conferences/conference-search.html?searchwords={s}
conj	Le conjugueur	leconjugueur.lefigaro.fr/conjugaison/verbe/{s}
cook cooks	Cooks.com	www.cooks.com/?/q={s}
cool	CoolJugator Lithuanian	cooljugator.com/lt/{s}
coop	Coop	www.coop.se/handla-online/sok/?q={s}
copr	Fedora Copr	copr.fedoraproject.org/coprs/fulltext/?fulltext={s}
core	CORE	core.ac.uk/search?q={s}
corp	opencorporates	opencorporates.com/companies?q={s}
coub	Coub	coub.com/search?q={s}
cpan cpan1 cpanm mcpan metacpan	MetaCPAN	metacpan.org/search?q={s}
cpap	CPAP.com	www.cpap.com/productSearch.php?q=1&query={s}
cpdl	Choral Public Domain Library	www1.cpdl.org/wiki/index.php/Special:Search?search={s}&fulltext=Keyword+search
cpen codepen	Codepen	codepen.io/search?q={s}&limit=all&depth=everything&show_forks=false
cppr cppreference	Cppreference	cppreference.com/w/?search={s}
cqrq	CQ Roll Call	www.rollcall.com/page/search?keyword={s}&advanced=false&sort=relevance
cram	Cram	www.cram.com/search?query={s}&submit=Search
cran	cran.r-project.org	finzi.psych.upenn.edu/cgi-bin/namazu.cgi?query={s}&max=100&result=normal&sort=score&idxname=functions&idxname=vignettes&idxname=views
crdb	CockroachDB Docs	www.cockroachlabs.com/docs/search.html?q={s}
crep creps consumer	Consumer Reports	www.consumerreports.org/search/?query={s}
cric	Criterion Channel	www.criterionchannel.com/search?q={s}
crol	CroL	www.crol.hr/index.php/search?searchword={s}&searchphrase=all
cron	Crontab.guru	crontab.guru/#{s}
crsh shards	Crystal Shards	shards.info/search?query={s}
crux	CRUX	crux.nu/portdb/?a=search&q={s}
csdb	The C64 Scene Database	noname.c64.org/csdb/search/?seinsel=all&search={s}
cslq lcsgo	Liquipedia Counter-Strike Wiki	wiki.teamliquid.net/counterstrike/index.php?title=Special:Search&search={s}&go=Go
csse	Computer Science - Stack Exchange	cs.stackexchange.com/search?q={s}
csst	CSS-Tricks	css-tricks.com/?s={s}
ctan	CTAN.org	ctan.org/search/?phrase={s}&x=1&PORTAL=on&PKG=on&AUTHORS=on&TOPICS=on&max=16
ctx7 context7	Context7	context7.com/?q={s}
cudl	Cambridge Digital Library	cudl.lib.cam.ac.uk/search?keyword={s}
culy	Culy	www.culy.nl/?s={s}
cved cvedtls	CVE Details	cvedetails.com/cve-details.php?t=1&cve_id={s}
cwde	Wikipedia - Zitierhilfe	de.wikipedia.org/w/index.php?title=Spezial:Zitierhilfe&page={s}
cyen	Google Translate - Welsh to English	translate.google.com/#cy/en/{s}
daen	Google Translate da-en	translate.google.com/#da/en/{s}
danm	Dragon Age NexusMods	www.nexusmods.com/dragonage/search/?gsearch={s}&gsearchtype=mods
dapi drupalapi	Drupal API	api.drupal.org/api/drupal/latest/search/{s}
darc	The Digital Archive	www.d-archive.org/?s={s}
dark	DuckDuckGo Dark Theme	duckduckgo.com/?q={s}&kae=d
dart	dartlang	www.dartlang.org/search.html?q={s}
daru	dic.academic.ru	dic.academic.ru/searchall.php?SWord={s}&from=xx&to=ru&did=&stype=0
dash	Digital Access to Scholarship at Harvard	dash.harvard.edu/search?scope=/&query={s}&rpp=10&sort_by=0&order=DESC
data datasearch	Google Dataset Search	toolbox.google.com/datasetsearch/search?query={s}
daum	Daum	search.daum.net/search?w=tot&q={s}
db2z	IBM DB2 for z/OS doc search	www.ibm.com/support/knowledgecenter/search/{s}?scope=SSEPEK_11.0.0
dbgb	BGB - dejure.org	dejure.org/gesetze/BGB/{s}.html
dbnf	Data Bnf	data.bnf.fr/search?term={s}
dbnl	Digitale Bibliotheek voor de Nederlandse Letteren	dbnl.nl/zoeken/zoekeninteksten/index.php?zoek={s}
dcnr	Pennsylvania Department of Conservation and Natural Resources	www.dcnr.pa.gov/pages/search.aspx?q={s}
dcss	Crawl Wiki	crawl.chaosforge.org/index.php?title=Special:Search&profile=default&search={s}&fulltext=Search
dcul	Dublin City University Library Catalogue	capitadiscovery.co.uk/dcu/items?query={s}
ddev	Debian Developer's pkgs overview	qa.debian.org/developer.php?login={s}
ddgc ddg-calc ddg-calculator	DuckDuckGo Calculator	duckduckgo.com/?q={s}&ia=calculator
ddgd	DuckDuckGo dictionary definitions	duckduckgo.com/?q={s}&ia=definition
ddgf	DuckDuckgo France	duckduckgo.com/?kl=fr-fr&q={s}
ddgm	DuckDuckGo Maps	duckduckgo.com/?q={s}&iaxm=maps
ddgn ddg-n ddg-news	DuckDuckGo news	duckduckgo.com/?q={s}&iar=news&ia=news
ddgv	DuckDuckGo Video Search	duckduckgo.com/?q={s}&iar=videos&iax=videos&ia=videos
ddjt	Digital DJ Tips	www.digitaldjtips.com/?s={s}
deal	DealBook	dealbook.nytimes.com/?s={s}
debg	Google Translate de-bg	translate.google.com/#view=home&op=translate&sl=de&tl=bg&text={s}
deeo	dict.cc: Esperanto-Deutsch	deeo.dict.cc/?s={s}
dees	Dict.cc Deutsch-Spanisch	dees.dict.cc/?s={s}
dehr	dict.cc DE <> HR	dehr.dict.cc/?s={s}
dehu	Google Translate de-hu	translate.google.com/#de/hu/{s}
deic	Deichmanske Biblotek	deichman.no/sok/{s}
deit	Dict CC DE <> IT	deit.dict.cc/?s={s}
dell	Dell	www.dell.com/en-us/search/{s}
deno	dict.cc (deno)	deno.dict.cc/?s={s}
denv	Dragen en Voeden Forum	forum.dragen-en-voeden.nl/search.php?keywords={s}&terms=all&author=&sc=1&sf=all&sr=posts&sk=t&sd=d&st=0&ch=300&t=0&submit=Zoek
depl	google translate de-pl	translate.google.com/#de/pl/{s}
deru	Google Translate (deru)	translate.google.com/#view=home&op=translate&sl=de&tl=ru&text={s}
desc	Descriptionari	descriptionari.com/q/{s}
desi desiclik	DesiClik	www.desiclik.com/_search.php?page=1&q={s}
desv	dict.cc (desv)	desv.dict.cc/?s={s}
devo	Dev.Opera	dev.opera.com/search?q={s}
dhlf	DHL Freight	activetracing.dhl.com/DatPublic/datSelection.do?search=consignmentId&at=cons_ordercode&valueShipmentOrderField={s}&focus=search2&searchConsignmentId=track
dibe	Difference Between	www.differencebetween.net/search/?q={s}
dibs	1st Dibs	www.1stdibs.com/search/?q={s}
dico	Dico des Ados	dicoado.org/wiki/index.php?search={s}
dict	Dict.org	www.dict.org/bin/Dict?Form=Dict2&Database=*&Query={s}
difm	Digitally Imported	www.di.fm/search?q={s}
digg	Digg	digg.com/search?q={s}
digi	Digi	www.digi.no/sok?query={s}
diki	diki.pl	www.diki.pl/slownik-angielskiego/?q={s}
dist	Distrelec	www.distrelec.de/search?q={s}
diva	DiVA - Digitala Vetenskapliga Arkivet	www.diva-portal.org/smash/resultList.jsf?dswid=8805&language=en&searchType=SIMPLE&query={s}&af=[]&aq=[[]]&aq2=[[]]&aqe=[]&noOfRows=50&sortOrder=author_sort_asc&sortOrder2=title_sort_asc&onlyFullText=false&sf=all
divi	Divi	www.elegantthemes.com/documentation/?s={s}&submit.x=0&submit.y=0
djay	Deejay.de	www.deejay.de/{s}
djtt	DJTechTools	www.djtechtools.com/?s={s}
dkes	Digikey ES	www.digikey.es/products/es?keywords={s}
dkfr	DigiKey.fr	www.digikey.fr/product-search/fr?keywords={s}
dkit	Digikey Italy	www.digikey.it/products/it?keywords={s}
dkwk	DokuWiki	www.dokuwiki.org/start?do=search&id={s}
dles	DeepL	www.deepl.com/translator#au/es/{s}
dlmf	NIST Digital Library of Mathematical Functions	dlmf.nist.gov/search/search?q={s}
dlpo priberam	Priberam	www.priberam.pt/dlpo/{s}
dman debman	Debian Manpages	dyn.manpages.debian.org/jump?q={s}
dmap kmap kamap	Kakao Map	map.kakao.com/?q={s}
dmde	DM.DE	www.dm.de/search?query={s}
dnab netapi dotnetapi	.NET API Browser	learn.microsoft.com/en-us/dotnet/api/?term={s}
dnde	Dict-Na'vi.com	dict-navi.com/de/dictionary/list/?type=search&search_term={s}
doaj	Directory of Open Access Journals	www.doaj.org/search?source={"query":{"query_string":{"query":"{s}","default_operator":"AND"}},"from":0,"size":10}
docc doccde	DocCheck	flexikon.doccheck.com/de/index.php?title=Spezial:Suche&q={s}
doco	DonationCoder	www.donationcoder.com/forum/index.php?action=search2&search={s}
docs scribd	Scribd.com	www.scribd.com/search?query={s}
dohp	D.O.H.P.	dohp.com/search?q={s}
doit	DoItYourself.com	www.doityourself.com/search?dsp=how-to&psearch={s}
domu	domu	www.domu.com/chicago/apartment-search2?domu_search={s}
domw	Dominion Strategy Wiki	wiki.dominionstrategy.com/index.php?search={s}&go=Go&title=Special:Search
doom	Doom Wiki	doomwiki.org/wiki/Special:Search?search={s}
dota	Dota 2 Wiki	liquipedia.net/dota2/index.php?search={s}
down isup dfeojm updown down4me downfor isitdown downforme	Down For Everyone Or Just Me	downforeveryoneorjustme.com/{s}
dpdt	DPD Online Tracking	tracking.dpd.de/cgi-bin/delistrack?typ=1&pknr={s}
dpla	Digital Public Library of America	dp.la/search?utf8=%E2%9C%93&q={s}
dplb	DPLB	www.dblp.org/search/index.php#query={s}
dpmt	Debian Python Modules Team git repo	anonscm.debian.org/git/python-modules/packages/{s}.git
dpub	Dartlang Packages	pub.dartlang.org/search?q={s}
drag	Dicionario da Real Academia Galega	academia.gal/dicionario_rag/searchNoun.do?nounTitle={s}
drdb dynamicrange	Dynamic Range Database	dr.loudness-war.info/album/list?artist={s}
drdk	Danmark Radio	www.dr.dk/search/Result?query={s}
dref pronounce dictionaryr	Dictionary (reference)	dictionary.reference.com/browse/{s}
dreg	Diario Registrado	www.diarioregistrado.com/search?text={s}
drly	Directlyrics	www.directlyrics.com/search/?q=direct+lyrics&ie=utf-8&q={s}
drop	MailDrop	www.maildrop.cc/inbox/{s}
drtv	DR Tv	www.dr.dk/tv/soeg/{s}
ds2w	Dark Souls 2 Wiki	darksouls2.wikidot.com/search:site/q/{s}
ds3w	Dark Souls 3 Wiki	darksouls3.wikidot.com/search:site/a/p/q/{s}
dsrt	Disroot Search	search.disroot.org/?q={s}
dste	D-Seite	www.d-seite.de/vis/vis.php?lemma={s}
dstr	Don't Sweat The Recipe	dontsweattherecipe.com/?s={s}
dtag	DebTags	debtags.debian.net/search/?q={s}
ducx	Fabasoft app.ducx Help	help.appducx.com/index.php?topic=doc/Search-Result/index_en.htm&q={s}
duet	Duet3D Documentation	duet3d.dozuki.com/Search?query={s}
duff dbuff dotabuff	Dotabuff	www.dotabuff.com/search?q={s}
duss	Dussmann das Kulturkaufhaus	kulturkaufhaus.buchhandlung.de/shop/quickSearch?searchString={s}
dwdl	DWDL	www.dwdl.de/features/suche/?suche={s}
dwds	DWDS	www.dwds.de/?qu={s}
dwru	Dark-World.ru	dark-world.ru/search/?q={s}
e.at ebat	Ebay Austria	www.ebay.at/sch/i.html?_nkw={s}
e.au	Ebay Australia	www.ebay.com.au/sch/?_nkw={s}&_sacat=0
e.de	Ebay Germany	www.ebay.de/sch/i.html?_nkw={s}
e.uk	Ebay UK	www.ebay.co.uk/sch/i.html?_nkw={s}
e926	e926	e926.net/posts?tags={s}
ebth	Everything But the House	www.ebth.com/search?q={s}
ecia	ECIA Authorized	www.eciaauthorized.com/search?pn={s}
ecli	Curia	curia.europa.eu/juris/liste.jsf?critereEcli={s}
ecob	ecobookstore.de/	www.ecobookstore.de/shop/quickSearch?searchString={s}
ecom	eSpirit Community	community.e-spirit.com/search.jspa?peopleEnabled=true&userID=&containerType=&container=&spotlight=true&q={s}
edbc	exploit-db.com	www.exploit-db.com/search/?action=search&text={s}
edut	Edutin	edutin.com/cursos/buscar/{s}
egdl	Eurographics Digital Library	diglib.eg.org/discover?query={s}&submit=Go
ehow	eHow	www.ehow.com/search.html?s={s}
ehri	European Holocaust Research Infrastructure	portal.ehri-project.eu/search?q={s}
eips	EIPs GitHub Issues	github.com/ethereum/EIPs/issues?q={s}
ejoy	Ejoy	ejoy-english.com/go/wordhunt?word={s}
ekac	ebay Kleinanzeigen Aachen	www.ebay-kleinanzeigen.de/s-aachen/{s}/k0l1921
ekhr	Kleinanzeigen Hannover	www.ebay-kleinanzeigen.de/s-hannover/{s}/k0l3155
ekwb	EK Water Blocks	www.ekwb.com/shop/catalogsearch/result/?q={s}
el19	El 19 Digital	www.el19digital.com/busqueda/articulos?q={s}
elen	Google translate el-en	translate.google.com/#el/en/{s}
eley	www.eleymcqueen.blogspot.in	eleymcqueen.blogspot.in/search?q={s}
elfa	Elfa Distrelec	www.elfa.se/elfa3~se_sv/elfa/init.do?sq={s}
eli5	Reddit ELI5	www.reddit.com/r/explainlikeimfive/search?q={s}&restrict_sr=on&sort=relevance&t=all
elix	Elix Dictionnaire LSF	www.elix-lsf.fr/spip.php?page=recherche_definitions&recherche={s}&lang=fr
emag	emag.ro	www.emag.ro/search/{s}
enar	Google Translate Englsih to Arabic	translate.google.com/#view=home&op=translate&sl=en&tl=ar&text={s}
enbn	English to Bangali Dictionary	www.english-bangla.com/dictionary/{s}
enbr enpt	Google Translator	translate.google.com/#en/pt/{s}
ency	Google Translate - English to Welsh	translate.google.com/#en/cy/{s}
enda en2da	Translate English to Danish	translate.google.com/#en/da/{s}
ende	Google Translate (en2de)	translate.google.com/#en/de/{s}
enel	Google translate en-el	translate.google.com/#en/el/{s}
enes gtsp	Google translate en-es	translate.google.com/#en/es/{s}
enfi	Google Translate to Finnish	translate.google.com/#en/fi/{s}
enfr en2fr gtenfr	Google Traduction	translate.google.com/#en/fr/{s}
engr engrxiv	Engineering Archive	engrxiv.org/search/search?query={s}
enhe	Google Translate (en2iw)	translate.google.com/#en/iw/{s}
enhu	Google Translate en-hu	translate.google.com/#en/hu/{s}
enid	Google Translate (en2id)	translate.google.com/translate#en/id/{s}
enig enigma	Enigma: Unpuzzling difficult Latin readings in medieval manuscripts	enigma.huma-num.fr/index.php?q=1&w={s}
enit gtenit	Google translate en-it	translate.google.com/#en/it/{s}
enkr	Google Translate English-Korean	translate.google.com/#en/ko/{s}
enlt	Google Translate English to Lithuanian	translate.google.com/#en/lt/{s}
enmu	Eastern New Mexico University	www.enmu.edu/search?q={s}
ennl en2nl	Google Translate en-nl	translate.google.com/#en/nl/{s}
enno	Google Translate en-no	translate.google.com/#view=home&op=translate&sl=en&tl=no&text={s}
enoj	The Ojibwe People's Dictionary (English)	ojibwe.lib.umn.edu/search?utf8=%E2%9C%93&q={s}&commit=Search&type=english
enpl	Google Translate (English to Polish)	translate.google.com/#en/pl/{s}
enru en2ru	Google Translate (en2ru)	translate.google.com/#en/ru/{s}
ensl	Google Translate en-sl	translate.google.com/#en/sl/{s}
ensv	Google Translator (English -> Swedish)	translate.google.com/#en/sv/{s}
enth trenth	Google Translate (EN-TH)	translate.google.com/#en/th/{s}
entr	Google Translate (en2tr)	translate.google.com/#en/tr/{s}
enum	enumquery.com	enumquery.com/lookup?e164={s}
enwn	English WIkinews	en.wikinews.org/w/index.php?search={s}
eoen	Google Translate (eo2en)	translate.google.com/#eo/en/{s}
epfl	EPFL	search.epfl.ch/web.action?q={s}
epic	Epic Games	www.epicgames.com/bing-search?keyword={s}
epmc europepmc	European Pubmed Central	europepmc.org/search?query={s}
eppl	El Paso Public Library	elpasopl.ent.sirsi.net/client/en_US/default/search/results?ln=en_US&q={s}
epsg	Spatial Reference	spatialreference.org/ref/?search=epsg:{s}
eric	Education Resources Information Center	eric.ed.gov/?q={s}
erlm	Erlang Module Documentation	erlang.org/doc/man/{s}.html
esde	Google Translate es - de	translate.google.de/#view=home&op=translate&sl=es&tl=de&text={s}
esea	ESEA	play.esea.net/index.php?s=search&query={s}
esen	Google translate es-en	translate.google.com/#es/en/{s}
eset	ESET Knownledge Base	support.eset.com/search/?search={s}
esfr	Google translate es-fr	translate.google.com/#es/fr/{s}
eshu	Google Translate es-hu	translate.google.hu/#es/hu/{s}
esit	Google translate es-it	translate.google.com/#es/it/{s}
esk8	Electric Skateboard Builders Forum	www.electric-skateboard.builders/search?q={s}
espn	ESPN.com	www.espn.com/search/results?q={s}
espt	Google Translate Spanish-Portuguese	translate.google.com/#es/pt/{s}
esrb	Entertainment Software Rating Board	www.esrb.org/search/?searchKeyword={s}
etde	Excel Translator [DE]	de.excel-translator.de/{s}/
eten	Excel Translator [EN]	en.excel-translator.de/{s}/
ethl	ETH Library	search.library.ethz.ch/primo-explore/search?query=any,contains,{s}&tab=default_tab&search_scope=default_scope&vid=DADS&lang=en_US&offset=0
ethz	Seminar for statistics	www.ethz.ch/en/utils/search.html?search={s}
etsy	Etsy	www.etsy.com/search?q={s}
euvd	European Vulnerability Database	euvd.enisa.europa.eu/search?text={s}
eveu	EVE University Wiki	wiki.eveuniversity.org/w/index.php?title=Special:Search&search={s}
eviq	eviQ	www.eviq.org.au/search?searchtext={s}
exex	Experts Exchange	www.experts-exchange.com/searchResults.jsp?searchTerms={s}&searchType=10
expo	Expo Documentation	docs.expo.io/versions/latest/sdk/{s}
f3nm	Fallout 3 NexusMods	www.nexusmods.com/fallout3/search/?gsearch={s}&gsearchtype=mods
fair	Fairness and Accuracy in Reporting	fair.org/?s={s}
fake fakespot	Fakespot	www.fakespot.com/analyze?url={s}
fark	Fark.com	www.fark.com/hlsearch?&qq={s}
farr	www.farrvintners.com	www.farrvintners.com/winelist.php?keywords={s}
fatv fanart	Fanart.tv	fanart.tv/?sect=all&s={s}
fbee frmb framabee	FramaBee	framabee.org/?q={s}
fccf	freeCodeCamp Forum	www.freecodecamp.org/forum/search?q={s}
fcit	Florida Center for Instructional Technology	fcit.usf.edu/search/index.php?searchWords={s}
fddb	fddb.info	fddb.info/db/de/suche/?udd=0&cat=site-de&search={s}
fdic	finedictionary	finedictionary.com/{s}.html
feet wfeet wikifeet	wikiFeet	www.wikifeet.com/search/{s}
fefe	Fefes Blog	blog.fefe.de/?q={s}
felo	Felo	felo.ai/search?q={s}
fgow	Fate/Grand Order Wikia	fategrandorder.wikia.com/wiki/Special:Search?query={s}
fhem	FHEM	wiki.fhem.de/w/index.php?search={s}
fhsu	Fort Hays State University	fhsu.edu/searchresults.aspx?query={s}
fhub fosshub	FossHub	www.fosshub.com/search/{s}
fide	Fide - World Chess Federation	ratings.fide.com/search.phtml?search={s}
fido	Fido	www.fido.ca/consumer/search?q={s}
fien	Google Translate (fi2en)	translate.google.com/#fi/en/{s}
fifa	FIFA	www.fifa.com/search/?q={s}
figs	Figura Documentation	applejuiceyy.github.io/figs/latest/search/?q={s}
film	filmaffinity	www.filmaffinity.com/es/search.php?stext={s}
fink	Fink Project	pdb.finkproject.org/pdb/browse.php?summary={s}
finn	Finn.no	www.finn.no/globalsearchlander?q={s}
fino	FinoFilipino	finofilipino.org/?s={s}
fish	fishshell.com	fishshell.com/docs/current/commands.html#{s}
flat fthub flathub	Flathub	flathub.org/apps/search?q={s}
flax	FLAX Docs	flax.readthedocs.io/en/latest/search.html?q={s}
flis	Military Part Lookup	www.webflis.us//webflis.aspx?All={s}
flix	Flixster	www.flixster.com/search/?search={s}
fman bsdman freebsdman	FreeBSD Man Pages	www.freebsd.org/cgi/man.cgi?query={s}
fmod factoriomods	Factorio Mods	mods.factorio.com/search?query={s}
fnac	fnac	recherche.fnac.com/SearchResult/ResultList.aspx?Search={s}
fnaf	FNAF Wiki	freddy-fazbears-pizza.fandom.com/search?query={s}
fnet finanzennet	finanzen.net	www.finanzen.net/suchergebnis.asp?_search={s}
fonq	fonq	www.fonq.be/nl_BE/search/?search_term={s}#s=2
font	Identifont	www.identifont.com/find?similar={s}
food	Food.com	www.food.com/recipe-finder/all/{s}
fool	Fool.com	www.fool.com/search/index.aspx?go=1&site=USMF&q={s}&source=ifltnvsnq0000001&mbbid=BoardID&mbmid=MessageID
fort	Fortnite Wiki	fortnite.gamepedia.com/index.php?search={s}
fotf	Focus on the Family	www.focusonthefamily.com/search-results#q={s}&t=FocusOnTheFamilyOnly&sort=relevancy
fowg	Force of Will German Database	www.fowsystem.com/de/Kartendatenbank?page=&CERCA=cerca&cardname={s}&block=ALL&edition=ALL&REGATT=or&cardnumber=&ABILITYTEXT=&ATKMIN=0&ATKMAX=2500&DEFMIN=0&DEFMAX=2500
fpop	Incendar funko pop search	incendar.com/funko_pop_search.php?search={s}
fr24 fr24f flightradar	Flightradar24	www.flightradar24.com/data/flights/{s}
frad	Friday Ad	www.friday-ad.co.uk/uk/search/?keywords={s}
fred	FRED Economic Data	research.stlouisfed.org/fred2/search?st={s}
fren fr2en	Google Translate fr-en	translate.google.com/#fr/en/{s}
fres	Google translate fr-es	translate.google.com/#fr/es/{s}
frge refrge	Reverso (frge)	dictionnaire.reverso.net/francais-allemand/{s}
frit	Google Translate French to Italian	translate.google.com/#fr/it/{s}
frjp	Reverse (frjp)	dictionnaire.reverso.net/francais-japonais/{s}
frpl	Reverso (frpl)	dictionnaire.reverso.net/francais-polonais/{s}
frru	Google Translate FR-RU	translate.google.com/#fr/ru/{s}
fsde	fernsehserien.de	www.fernsehserien.de/suche/{s}
fsfe	Free Software Foundation Europe	fsfe.org/cgi-bin/search.cgi?l=en&x=0&y=0&q={s}
ftln	futurelearn	www.futurelearn.com/search?q={s}
ftlr	DicE Magazine	www.dicemagazine.com/search?q={s}
ftnl	filmtotaal.nl	www.filmtotaal.nl/zoeken/?q={s}
fuji	Fuji TV	www.fujitv.co.jp/search/index.html?keyword={s}
funi	Funimation	www.funimation.com/search/?q={s}
fwcj	FoowWishes	foodwishes.blogspot.com/search?q={s}
fwtv	FWTV	www.fwtv.tv/buscar/{s}
fyyd	fyyd	fyyd.de/search?search={s}
g.at	Google Austria	www.google.at/#q={s}
g.de	Google Germany	www.google.de/#q={s}
gadv	G Adventures	www.gadventures.com/search/?q={s}
gaen	Google Translate (ga2en)	translate.google.com/#ga/en/{s}
gaia	Vila Nova de Gaia	www.vn-gaia.com/search?SearchForm[keyword]={s}&SearchForm[limitSpaceGuids]=
game	Game	www.game.co.uk/webapp/wcs/stores/servlet/AjaxCatalogSearch?storeId=10151&catalogId=10201&langId=44&pageSize=&beginIndex=0&sType=SimpleSearch&resultCatEntryType=2&showResultsPage=true&pageView=image&predictiveSearchURL=&searchTerm={s}&searchBtn=z
gawi	Gabler Wirtschaftslexikon	wirtschaftslexikon.gabler.de/search/content?keys={s}
gban gamebanana	GameBanana	gamebanana.com/skins/search?search={s}
gbat	GBAtemp	gbatemp.net/search/87708019/?q={s}
gbeo	Glosbe (eneo)	en.glosbe.com/en/eo/{s}
gbip	Global books in print	www.booksinprint.com/Search/Results?q=quicksearch-all:{s}&op=1&qs=1
gbks googlebooks	Google Books	books.google.com/books?q={s}&btnG=Search+Books
gcat	Google Catalan	www.google.cat/#q={s}
gcba	Gobierno de la Ciudad de Buenos Aires	www.buenosaires.gob.ar/bweb/search?keys={s}
gcro	Google Croatia	www.google.hr/#q={s}&*
gdef	Google define	www.google.com/search?hl=en&q=define+{s}
gdev	Gamedev Stackexchange	gamedev.stackexchange.com/search?q={s}
gdgt	gdgt	gdgt.com/search/{s}
gdlc	Gran diccionari de la llengua catalana	www.diccionari.cat/cgi-bin/AppDLC3.exe?APP=CERCADLC&GECART={s}&x=0&y=0
gdns	Google Public DNS	dns.google.com/query?name={s}&type=A&dnssec=true
ge-t getracker	GE-Trakcer	www.ge-tracker.com/names/{s}
gear	Gbase.com	www.gbase.com/gear?q={s}
geek	Geek's Curiosity	www.geeks-curiosity.net/?s={s}
geen	Google Translate German to English	translate.google.com/#ge/en/{s}
gefr regefr	Reverso (gefr)	dictionnaire.reverso.net/allemand-francais/{s}
geiz	Geizhals (eu)	geizhals.eu/?fs={s}
gene	NCBI Gene	www.ncbi.nlm.nih.gov/gene/?term={s}
gfaq	GameFAQs	www.gamefaqs.com/search/index.html?game={s}
gfbf	Geriafurch (brfr)	geriafurch.bzh/fr?q={s}&d=brfr
gffb	Geriafurch	geriafurch.bzh/fr?q={s}&d=frbr
ggca	GabGagnon.ca	gabgagnon.ca/?s={s}
ghat geizhalsat	Geizhals (at)	geizhals.at/?in=&fs={s}
ghde	Geizhals (de)	geizhals.de/?fs={s}
ghjs	GitHub JavaScript Code	github.com/search?l=JavaScript&o=desc&q={s}&s=indexed&type=Code
ghpr ghpull	GitHub Pull Requests	github.com/search?q={s}&type=pullrequests
ghus	GitHub User	github.com/{s}/
giau	Google Images Australia	www.google.com.au/search?tbm=isch&q={s}&tbs=imgo:1
gica	Google.ca Image Search	www.google.ca/search?q={s}&tbm=isch
giff	Gif Finder	gif-finder.com/?s={s}
gifl	Google: I'm Feeling Lucky	google.com/search?btnI=1&q={s}
giga gigablast	GIGABLAST	www.gigablast.org/search?q={s}
gist	GitHub Gists	gist.github.com/search?q={s}
git2	libgit2 documentation	libgit2.github.io/libgit2/#HEAD/search/{s}
giti	Google Maps (French)	www.google.fr/maps/dir/{s}
gitl	Google IT	www.google.it/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
giuk	Google Images UK	www.google.co.uk/search?tbm=isch&q={s}&tbs=imgo:1
give	Givero	www.givero.com/search?q={s}
glab gitlab	GitLab	gitlab.com/search?utf8=%E2%9C%93&search={s}
glse	German Language Stack Exchange	german.stackexchange.com/search?q={s}
gman gsupport	Google Support	support.google.com/search?q={s}
gmat	Google Maps Austria	www.google.at/maps/search/{s}
gmau	Google Maps Australia	www.google.com.au/maps/search/{s}
gmca	Google Maps Canada	www.google.ca/maps/?q={s}
gmcl	Google Maps Chile	www.google.cl/maps/place/{s}
gmde gmnl mapsde	Google Maps DE	www.google.de/maps/place/{s}
gmfr	maps.google.com	www.google.fr/maps/search/{s}
gmil	Google Maps Israel	www.google.co.il/maps/search/{s}/?hl=iw
gmit	Google Maps (it)	www.google.it/maps?q={s}
gmjp	Google Maps JP	www.google.co.jp/maps/place/{s}
gmob	Google (mobile site viewer)	www.google.com/gwt/x?u={s}
gmod	GMod wiki	wiki.garrysmod.com/page/Special:Search?search={s}&fulltext=Search
gmps	GeekMPS	geekmps.fr/component/search/?searchword={s}
gmsi	Google Maps SI	www.google.si/maps/search/{s}/
gmtw	Google map (Taiwan)	www.google.com.tw/maps?hl=zh-TW&q={s}
gmuk	Google Maps (uk)	www.google.co.uk/maps?q={s}
gnat	Google News Austria	www.google.at/#q={s}&tbm=nws
gnau	Google News Australia	news.google.com/search?q={s}&hl=en-AU&gl=AU&ceid=AU:en
gnca	Google News (Canada)	news.google.com/search?hl=en-CA&q={s}&gl=CA&ceid=CA:en
gncr	Google No Country Redirect	www.google.com/search?gws_rd=cr&gl=us&hl=en&num=20&q={s}
gnda	Google (In Depth Articles)	www.google.com/?gws_rd=ssl#q={s}&tbs=ida:1&gl=us
gnde	Google News Germany	news.google.com/news/search/section/q/{s}?hl=de&ned=de
gnfr	Google News French	www.google.fr/search?aq=f&hl=fr&gl=fr&tbm=nws&btnmeta_news_search=1&q={s}
gnit	Google News Italian	www.google.it/search?q={s}&hl=it&tbm=nws
gnlm	The Global New Light of Myanmar	globalnewlightofmyanmar.com/?s={s}
gnnl	Google News Nederland	www.google.com/search?hl=nl&gl=nl&tbm=nws&q={s}
gnse	Google News Sweden	news.google.com/search?q={s}&hl=sv&gl=SE&ceid=SE:sv
gnuk	Google News UK	www.google.co.uk/search?hl=en&gl=uk&tbm=nws&authuser=0&q={s}
goat	Goatbots	www.goatbots.com/search/{s}
gogo goodg	GoodGopher	www.goodgopher.com/SearchResults.asp?query={s}&pr=GG
goiw	Guns of Icarus Wiki	gunsoficarusonline.fandom.com/wiki/Special:Search?query={s}
gold	IUPAC Gold Book	goldbook.iupac.org/terms/search/{s}
good	Banggood	m.banggood.com/search/{s}.html
gooj	Goo Jisho	dictionary.goo.ne.jp/srch/all/{s}/m0u/
gosv googlesv	Google El Salvador	www.google.com.sv/#q={s}
goto	Goto Google link shortener	goto.google.com/{s}
gpat patent	Google Patents	patents.google.com/?oq={s}
gpau	Greenpeace Australia	www.greenpeace.org/australia/en/System-templates/Site-Settings-Pages/Search/?all={s}
gpdp	Garante Privacy	www.gpdp.it/home/ricerca/-/search/key/{s}
gpdr	gpodder.net	gpodder.net/search/?q={s}
gpea	Greenpeace East Asia	www.greenpeace.org/eastasia/system-templates/search-results/?all={s}
gpeu	Greenpeace EU Unit	www.greenpeace.org/eu-unit/en/System-templates/such-resultate/?all={s}
gpnz	Greenpeace New Zealand	www.greenpeace.org/new-zealand/en/System-templates/Search-results/?all={s}
gpuk	Greenpeace UK	www.greenpeace.org.uk/search/node/{s}
grav	learn.getgrav.org	learn.getgrav.org/search?q={s}
grcp	GRC Port Authority	www.grc.com/port_{s}.htm
grep	grep.app	grep.app/search?q={s}
grok	Grok	grok.com/?q={s}
grub	Grubhub	www.grubhub.com/search/?cuisine={s}
gsau	Google Shopping Australia	www.google.com.au/search?tbm=shop&q={s}
gsbr	Google Shopping (BR)	www.google.com.br/search?q={s}&hl=pt-BR&safe=off&prmd=imvns&tbm=shop&tbo=u
gsit	Google Shopping IT	www.google.it/search?hl=it&tbm=shop&q={s}
gsuk	Google Shopping UK	www.google.co.uk/search?q={s}&tbm=shop
gsus	Google Shopping US	www.google.com/search?tbm=shop&q={s}&gws_rd=cr
gtaf gtafrikaans gt-afrikaans	Google Translate (to Afrikaans)	translate.google.com/#auto/af/{s}
gtar gtarabic gt-arabic	Google Translate (to Arabic)	translate.google.com/#auto/ar/{s}
gtau gumau gumtreeau	Gumtree Australia	www.gumtree.com.au/s-{s}/k0
gtaz gtazerbaijani gt-azerbaijani	Google Translate (to Azerbaijani)	translate.google.com/#auto/az/{s}
gtbe gtbelarusian gt-belarusian	Google Translate (to Belarusian)	translate.google.com/#auto/be/{s}
gtbg gtbulgarian gt-bulgarian	Google Translate (to Bulgarian)	translate.google.com/#auto/bg/{s}
gtbn gtbengali gt-bengali	Google Translate (to Bengali)	translate.google.com/#auto/bn/{s}
gtbs gtbosnian gt-bosnian	Google Translate (to Bosnian)	translate.google.com/#auto/bs/{s}
gtca gtcatalan gt-catalan	Google Translate (to Catalan)	translate.google.com/#auto/ca/{s}
gtcs gtcz gtczech gt-czech	Google Translate (to Czech)	translate.google.com/#auto/cs/{s}
gtcy gtwelsh gt-welsh	Google Translate (to Welsh)	translate.google.com/#auto/cy/{s}
gtda gtdanish gt-danish	Google Translate (to Danish)	translate.google.com/#auto/da/{s}
gtdb	Grimtools	www.grimtools.com/db/search?query={s}
gtde gtgerman gt-german translatede	Google Translate (to German)	translate.google.com/#auto/de/{s}
gtel gtgr gtgreek gt-greek	Google Translate (greek)	translate.google.com/#auto/el/{s}
gteo gtesperanto gt-esperanto	Google Translate (to Esperanto)	translate.google.com/#auto/eo/{s}
gtes gtspanish gt-spanish	Google Translate (to Spanish)	translate.google.com/#auto/es/{s}
gtet gtestonian gt-estonian	Google Translate (to Estonian)	translate.google.com/#auto/et/{s}
gteu gtbasque gt-basque	Google Translate (to Basque)	translate.google.com/#auto/eu/{s}
gtfa gtpersian gt-persian	Google Translate (to Persian)	translate.google.com/#auto/fa/{s}
gtfi gtfinnish gt-finnish	Google Translate (to Finnish)	translate.google.com/#auto/fi/{s}
gtfr gtrad gtfrench gt-french	Google Translate (to French)	translate.google.com/#auto/fr/{s}
gtga gtirish gt-irish	Google Translate (to Irish)	translate.google.com/#auto/ga/{s}
gtgl gtgalician gt-galician	Google Translate (to Galician)	translate.google.com/#auto/gl/{s}
gtgu gtgujarati gt-gujarati	Google Translate (to Gujarati)	translate.google.com/#auto/gu/{s}
gtha gthausa gt-hausa	Google Translate (to Hausa)	translate.google.com/#auto/ha/{s}
gthi gthindi gt-hindi	Google Translate (to Hindi)	translate.google.com/#auto/hi/{s}
gthr gtcroatian gt-croatian	Google Translate (to Croatian)	translate.google.com/#auto/hr/{s}
gtht gthaitiancreole	Google Translate (to Haitian Creole)	translate.google.com/#auto/ht/{s}
gthu gthungarian gt-hungarian	Google Translate (to Hungarian)	translate.google.com/#auto/hu/{s}
gthy gtarmenian gt-armenian	Google Translate (to Armenian)	translate.google.com/#auto/hy/{s}
gtid gtindonesian gt-indonesian	Google Translate (to Indonesian)	translate.google.com/#auto/id/{s}
gtig gtigbo gt-igbo	Google Translate (to Igbo)	translate.google.com/#auto/ig/{s}
gtis gticelandic gt-icelandic	Google Translate (to Icelandic)	translate.google.com/#auto/is/{s}
gtit gtitalian gt-italian	Google Translate (to Italian)	translate.google.com/#auto/it/{s}
gtiw gthebrew gt-hebrew	Google Translate (to Hebrew)	translate.google.com/#auto/iw/{s}
gtja gtjp gtjapanese gt-japanese	Google Translate (to Japanese)	translate.google.com/#auto/ja/{s}
gtjw gtjavanese gt-javanese	Google Translate (to Javanese)	translate.google.com/#auto/jw/{s}
gtk4	GTK 4 Documentation	docs.gtk.org/gtk4/index.html?q={s}
gtka gtgeorgian gt-georgian	Google Translate (to Georgian)	translate.google.com/#auto/ka/{s}
gtkk gtkazakh gt-kazakh	Google Translate (to Kazakh)	translate.google.com/#auto/kk/{s}
gtkm gtkhmer gt-khmer	Google Translate (to Khmer)	translate.google.com/#auto/km/{s}
gtkn gtkannada gt-kannada	Google Translate (to Kannada)	translate.google.com/#auto/kn/{s}
gtko gtkr gtkorean gt-korean	Google Translate (to Korean)	translate.google.com/#auto/ko/{s}
gtla gtlatin gt-latin	Google Translate (to Latin)	translate.google.com/#auto/la/{s}
gtlt gtlithuanian gt-lithuanian	Google Translate (to Lithuanian)	translate.google.com/#auto/lt/{s}
gtlv gtlatvian gt-latvian	Google Translate (to Latvian)	translate.google.com/#auto/lv/{s}
gtmg gtmalagasy gt-malagasy	Google Translate (to Malagasy)	translate.google.com/#auto/mg/{s}
gtmi gtmaori gt-maori	Google Translate (to Maori)	translate.google.com/#auto/mi/{s}
gtmk gtmacedonian gt-macedonian	Google Translate (to Macedonian)	translate.google.com/#auto/mk/{s}
gtml gtmalayalam gt-malayalam	Google Translate (to Malayalam)	translate.google.com/#auto/ml/{s}
gtmn gtmongolian gt-mongolian	Google Translate (to Mongolian)	translate.google.com/#auto/mn/{s}
gtmr gtmarathi gt-marathi	Google Translate (to Marathi)	translate.google.com/#auto/mr/{s}
gtms gtmalay gt-malay	Google Translate (to Malay)	translate.google.com/#auto/ms/{s}
gtmt gtmaltese gt-maltese	Google Translate (to Maltese)	translate.google.com/#auto/mt/{s}
gtmy gtmyanmar gt-myanmar	Google Translate (to Myanmar (Burmese))	translate.google.com/#auto/my/{s}
gtmz	GeekTimes	geektimes.ru/search/?q={s}
gtne gtnepali gt-nepali	Google Translate (to Nepali)	translate.google.com/#auto/ne/{s}
gtnl trnl gtdutch transnl gt-dutch translatenl	Google Translate (to Dutch)	translate.google.com/#auto/nl/{s}
gtno gtnorwegian gt-norwegian	Google Translate (to Norwegian)	translate.google.com/#auto/no/{s}
gtny gtchichewa gt-chichewa	Google Translate (to Chichewa)	translate.google.com/#auto/ny/{s}
gtpa gtpunjabi gt-punjabi	Google Translate (to Punjabi)	translate.google.com/#auto/pa/{s}
gtpl gtpolish gt-polish	Google Translate (to Polish)	translate.google.com/#auto/pl/{s}
gtpt gtportuguese gt-portuguese	Google Translate (to Portuguese)	translate.google.com/#auto/pt/{s}
gtro gtromanian gt-romanian	Google Translate (to Romanian)	translate.google.com/#auto/ro/{s}
gtru gtrussian gt-russian	Google Translate (to Russian)	translate.google.com/#auto/ru/{s}
gtsi gtsinhala gt-sinhala	Google Translate (to Sinhala)	translate.google.com/#auto/si/{s}
gtsk gtslovak gt-slovak	Google Translate (to Slovak)	translate.google.com/#auto/sk/{s}
gtsl gtslovenian gt-slovenian	Google Translate (to Slovenian)	translate.google.com/#auto/sl/{s}
gtso gtsomali gt-somali	Google Translate (to Somali)	translate.google.com/#auto/so/{s}
gtsq gtalbanian gt-albanian	Google Translate (to Albanian)	translate.google.com/#auto/sq/{s}
gtsr gtserbian gt-serbian	Google Translate (to Serbian)	translate.google.com/#auto/sr/{s}
gtst gtsesotho gt-sesotho	Google Translate (to Sesotho)	translate.google.com/#auto/st/{s}
gtsu gtsundanese gt-sundanese	Google Translate (to Sundanese)	translate.google.com/#auto/su/{s}
gtsv gtswedish gt-swedish	Google Translate (to Swedish)	translate.google.com/#auto/sv/{s}
gtsw gtswahili gt-swahili	Google Translate (to Swahili)	translate.google.com/#auto/sw/{s}
gtta gttamil gt-tamil	Google Translate (to Tamil)	translate.google.com/#auto/ta/{s}
gtte gttelugu gt-telugu	Google Translate (to Telugu)	translate.google.com/#auto/te/{s}
gttg gttajik gt-tajik	Google Translate (to Tajik)	translate.google.com/#auto/tg/{s}
gtth gtthai gt-thai	Google Translate (to Thai)	translate.google.com/#auto/th/{s}
gttl gtfilipino gt-filipino	Google Translate (to Filipino)	translate.google.com/#auto/tl/{s}
gttr gtturkish gt-turkish	Google Translate (to Turkish)	translate.google.com/#auto/tr/{s}
gttw	Google translate (Taiwan)	translate.google.com.tw/#auto/zh-TW/{s}
gtuk gtukrainian gt-ukrainian	Google Translate (to Ukrainian)	translate.google.com/#auto/uk/{s}
gtur gturdu gt-urdu	Google Translate (to Urdu)	translate.google.com/#auto/ur/{s}
gtuz gtuzbek gt-uzbek	Google Translate (to Uzbek)	translate.google.com/#auto/uz/{s}
gtvi gtvietnamese gt-vietnamese	Google Translate (to Vietnamese)	translate.google.com/#auto/vi/{s}
gtyi gtyiddish gt-yiddish	Google Translate (to Yiddish)	translate.google.com/#auto/yi/{s}
gtyo gtyoruba gt-yoruba	Google Translate (to Yoruba)	translate.google.com/#auto/yo/{s}
gtzu gtzulu gt-zulu	Google Translate (to Zulu)	translate.google.com/#auto/zu/{s}
gubf	Goethe Uni Bib FRA	hds.hebis.de/ubffm/Search/Results?lookfor={s}&type=allfields&submit=Suchen
gvau	Google Videos Australia	www.google.com.au/search?tbm=vid&q={s}
gvrl	Gale Virtual Reference Library	go.galegroup.com/ps/headerQuickSearch.do?quickSearchTerm={s}&inputFieldNames[0]=OQE&searchType=BasicSearchForm&userGroupName=mlin_m_newtnsh&nwf=y&prodId=GVRL&stw.option=&ebook=&quicksearchIndex=OQE&spellCheck=true&hasCoProduct=false
gw2e	Gw2 Efficiency	gw2efficiency.com/account/overview?filter.name={s}
gwct	Game & Wildlife Conservation Trust	www.gwct.org.uk/search?keywords={s}
gwen	GlyphWiki English	en.glyphwiki.org/wiki/Special:Search?search={s}
h2g2	h2g2	www.h2g2.com/search?search_type=article_quick_search&searchstring={s}&approved_entries_only_chk=1
hack	ROMhacking	www.romhacking.net/?page=hacks&genre=&platform=&game=&category=&perpage=30&order=Date&dir=1&title={s}&author=&hacksearch=Go
hadd handmadeadd	Handmade Add	handmade-add.com/index.php?route=product/search&search={s}
hak5	Hak5	hak5.org/?s={s}
haze	Haze Guitars	hazeguitars.com/search?q={s}
hbat	Hornbach.at	www.hornbach.at/shop/suche/sortiment/{s}
hblb hubermanlab	Huberman Lab	www.hubermanlab.com/search-results?q={s}
hcrl heliumlinux	Helium Linux Code	github.com/search?type=code&q=repo:imputnet/helium-linux+{s}
hcrm heliummac	Helium macOS Code	github.com/search?type=code&q=repo:imputnet/helium-macos+{s}
hcrw heliumwindows	Helium Windows Code	github.com/search?type=code&q=repo:imputnet/helium-windows+{s}
hcum historicum	historicum	historicum.net/historicumsearch/Blender/Results?lookfor={s}
hdyc	How did you contribute to OpenStreetMap?	hdyc.neis-one.org/?{s}
helm	Helm	www.helm.nu/Pages/Search.aspx?search={s}
hema	HEMA	www.hema.nl/search?q={s}&lang=nl_NL
here	Here WeGo	wego.here.com/search/{s}
hgnc	HUGO Gene Nomenclature Committee (HGNC)	www.genenames.org/cgi-bin/quick_search.pl?submit=Submit&search={s}
hgpu	hgpu.org	hgpu.org/?s={s}
hibp pwned amipwned	Have I Been Pwned?	haveibeenpwned.com/account/{s}
hikr	Hikr.org	www.hikr.org/cse.php?q={s}
hive	Hive	www.hive.co.uk/Search/Keyword?keyword={s}
hkfp	Hong Kong Free Press	www.hongkongfp.com/?s={s}
hltv	HLTV.org	www.hltv.org/search?query={s}
hndk	Harald Nyborg (Denmark/Danmark)	www.harald-nyborg.dk/search?q={s}
hnse	Harald Nyborg (Sweden/Sverige)	www.harald-nyborg.se/search?q={s}
hoi3	Hearts of Iron 3 Wiki	www.hoi3wiki.com/index.php?search={s}
hoi4	Hearts of Iron IV wiki	hoi4.paradoxwikis.com/index.php?search={s}
home	Home Advisor	www.homeadvisor.com/sitesearch/searchQuery?action=SEARCH&searchType=SiteTaskSearch&useExtSearch=false&initialSearch=true&query={s}
hood	Hood.de - Auktionen und Online Shopping	www.hood.de/suchergebnisse.htm?q={s}
hort	Hortipedia	en.hortipedia.com/index.php?search={s}&title=Special:Search&go=Go
hosm	OpenStreetMap Help	help.openstreetmap.org/search/?q={s}
hotn	Hotnews.ro	www.hotnews.ro/cauta/{s}/1
hott	Homotopy Type Theory	homotopytypetheory.org/?s={s}
hrde	Hessischer Rundfunk	www.hr.de/suche/index.nc.html?query={s}
hsdb	ADL Hate Symbols Database	www.adl.org/education-and-resources/resource-knowledge-base/hate-symbols?keys={s}
hsts	HSTS preload list	hstspreload.org/?domain={s}
hsun heraldsun	Herald Sun	www.heraldsun.com.au/?s={s}
htel	Herold - Telefon	www.herold.at/telefonbuch/telefon_{s}/
http	HTTP Status Codes	httpstatuses.com/{s}
htwb	HTW Berlin	www.htw-berlin.de/suche/?domain=www.htw-berlin.de&query={s}
huco	European Court of human right	hudoc.echr.coe.int/sites/eng/Pages/search.aspx#{"fulltext":["{s}"],"documentcollectionid2":["GRANDCHAMBER","CHAMBER"]}
hude	Google Translate hu-de	translate.google.com/#hu/de/{s}
huen	Google Translate hu-en	translate.google.com/#hu/en/{s}
hues	Google Translate hu-es	translate.google.hu/#hu/es/{s}
huge	Huge Thinking	hugethinking.com/?s={s}
hugo	Code with Hugo	codewithhugo.com/search/?q={s}
huit	Google Translate hu-it	translate.google.com/#hu/it/{s}
hukd hotukdeals	Hotukdeals	www.hotukdeals.com/search?action=search&keywords={s}
hulu	Hulu	www.hulu.com/search?query={s}
husr	Google Translate: Hungarian to Serbian	translate.google.com/#hu/sr/{s}
hymn hymnse	HYMN	hymn.se/?s={s}
hysb	Hypixel Skyblock Wiki	hypixelskyblock.minecraft.wiki/?search={s}&title=Special:Search
hyts	Hytive : Strains	www.hytiva.com/strains?searchString={s}
iacr	IACR	www.iacr.org/search/?q={s}
iata	IATA Airport Code	airportcodes.aero/{s}
ibdb	Internet Broadway Database	www.ibdb.com/search.asp?SearchFor={s}&SearchBy=All
ibge	IBGE	www.ibge.gov.br/busca.html?searchword={s}&searchphrase=all
icd9	ICD9Data.com	www.icd9data.com/Search/?q={s}
ices	International Council for the Exploration of the Sea	www.ices.dk/Searchcenter/Pages/default.aspx?k={s}
icon icons iconfinder	IconFinder	www.iconfinder.com/search/?q={s}
icpl	Iowa City Public Library	search.icpl.org/Search/Results?lookfor={s}
idee	Idee Shop	www.idee-shop.com/search?sSearch={s}
ides idealoes	Idealo.es	www.idealo.es/resultados.html?q={s}
idfr	Idealo France	www.idealo.fr/prechcat.html?q={s}
idos	Idos	jizdnirady.idnes.cz/vlakyautobusymhdvse/spojeni/?f={s}
ieee	IEEE Xplore	ieeexplore.ieee.org/search/searchresult.jsp?newsearch=true&queryText={s}
ielw	IndustriaEnLaWeb	industriaenlaweb.com.ar/buscador?name={s}
iens	IENS	www.iens.nl/restaurant?q={s}
ietf	The IETF	datatracker.ietf.org/doc/search/?name={s}&activeDrafts=on&rfcs=on
ifab	The IFAB	theifab.com/search/{s}
ifdb	Interactive Fiction Database	ifdb.tads.org/search?searchbar={s}
ifht	Institue For High-Voltage Technology	www.ifht.rwth-aachen.de/ca/be/ovbs/?lidx=&search={s}
ifun	ifun	www.ifun.de/suche/{s}
igdb	IGDB - Internet Game Database	www.igdb.com/search?q={s}
igem	parts.igem.org	parts.igem.org/Special:Search?search={s}
igra	igra-apple	igra-apple.ru/?s={s}
ihep inspire	InspireHEP	inspirehep.net/search?p={s}
iiba	IIBA	www.iiba.org/search/?q={s}
ikea	Ikea	www.ikea.com/us/en/search/?query={s}
imag	IndieMag	www.indiemag.fr/search/node/{s}
imas imaswiki idolmawiki	Project iM@S Wiki	project-imas.wiki/index.php?search={s}&title=Special%3ASearch
imdb	IMDB	www.imdb.com/find?s=all&q={s}
inab	INeedaBargain.com	www.ineedabargain.com/deals/search?q={s}
inat	iNaturalist	www.inaturalist.org/search?q={s}
inci	incisozluk	inci.sozlukspot.com/w/{s}
inet	Inet	www.inet.se/hitta?q={s}
inha	INHA	inha-fr.primo.exlibrisgroup.com/discovery/search?query=any,contains,{s}&tab=Livres_et_revues&search_scope=Livres_et_revues&vid=33INHA_INST:33INHA_INST&offset=0
inkb	InkBunny	inkbunny.net/submissionsviewall.php?rid=&mode=search&page=1&orderby=create_datetime&text={s}&stringtype=and&keywords=yes&title=yes&description=no&artist=&favsby=&type=&sale=&days=&keyword_id=&user_id=&random=&md5=
inrs	INRS	www.inrs.fr/header/recherche.html?queryStr={s}
intl internazionale	Internazionale	www.internazionale.it/search/?q={s}
inwx	InterNetworX	www.inwx.com/en/domain/check#search={s}#region=DEFAULT
iops imgops	ImgOps	imgops.com/{s}
ipdb	Internet Pinball Database	www.ipdb.org/search.pl?any={s}&sortby=name&search=Search+Database&searchtype=quick
ipfs	InterPlanetary File System	ipfs.io/ipfs/{s}
ipns	InterPlanetary Naming System	ipfs.io/ipns/{s}
ipro	iProfesional.com	www.iprofesional.com/index.php?p=buscadorProfesional&texto={s}
ipv6	chair6.net	ready.chair6.net/?url={s}
iqdb	iqdb	iqdb.org/?url={s}
ires	imaging-resource.com	www.imaging-resource.com/search.html?q={s}
iris	Iris Documentation	scitools-iris.readthedocs.io/en/latest/search.html?q={s}
isbn	ISBNdb	isbndb.com/search/books/{s}
isgd	is.gd	is.gd/create.php?url={s}
ishr	ishr.ch	www.ishr.ch/advanced-search?term={s}
ismu	Information system of Masaryk University	is.muni.cz/auth/vyhledavani/?search={s}
isni	International Standard Name Identifier	isni.oclc.org/xslt/CMD?ACT=SRCH&IKT=8006&TRM={s}
itad isthereanydeal	IsThereAnyDeal	isthereanydeal.com/search/?q={s}
itch	itch.io	itch.io/search?q={s}
iten gtiten	Google Translate it->en	translate.google.com/#it/en/{s}
ites	Google translate it-es	translate.google.com/#it/es/{s}
itfr	Reverso it-fr	context.reverso.net/traduction/italien-francais/{s}
ithu	Google Translate it-hu	translate.google.com/#it/hu/{s}
ithy	Ithy	ithy.com/?query={s}
iukb	Indiana University Knowledge Base	kb.iu.edu/search?q={s}
ivst invest investopedia	Investopedia	www.investopedia.com/search?q={s}
iwmn iwantmyname	iwantmyname	iwantmyname.com/?domain={s}
jade	BarNet Jade	jade.io/search/{s}
jadi	jadi.net	jadi.net/?s={s}
jamf	Jamf Nation	www.jamf.com/jamf-nation/search?query={s}
java	Oracle Java Docs	docs.oracle.com/apps/search/search.jsp?q={s}&category=java
jawb	Japanese Wikibooks	ja.wikibooks.org/w/index.php?search={s}
jawq	Japanese Wikiquote	ja.wikiquote.org/w/index.php?search={s}
jaws	Japanese Wikisource	ja.wikisource.org/w/index.php?search={s}
jawt	Japanese Wiktionary	ja.wiktionary.org/w/index.php?search={s}
jawv	Japanese Wikiversity	ja.wikiversity.org/w/index.php?search={s}
jdca	JustDial Canada	ca.justdial.com/allus/{s}
jdin	JustDial India	www.justdial.com/National-Search/{s}
jedi	Jedipedia.net	www.jedipedia.net/w/index.php?search={s}
jegs	Jegs	www.jegs.com/webapp/wcs/stores/servlet/SearchResultsPageCmd?Ntt={s}
jion	JioNews	jionews.com/search?query={s}
jlse	Japanese Language Stack Exchange	japanese.stackexchange.com/search?q={s}
jobs indeed	Indeed	www.indeed.com/jobs?q={s}
jocb	Just One Cookbook	www.justonecookbook.com/?s={s}
joco	JoCopedia	www.jonathancoulton.com/mediawiki/index.php?search={s}
jojo	JoJo's Bizarre Encyclopedia	jojowiki.com/index.php?search={s}
joom	Joom	www.joom.com/en/search/q.{s}
jove	Jove	www.jove.com/search?q={s}
jpdb	jpdb japanese dictionary	jpdb.io/search?q={s}
jqui	JQuery UI	api.jqueryui.com/?s={s}
jsbf bundle bundlephobia	BundlePhobia	bundlephobia.com/result?p={s}
jtut	Java Tutorial (Oracle)	search.oracle.com/search/search?search_p_main_operator=all&group=Documentation&q={s}+url:/javase/tutorial
juju	Juju Charm Store	jujucharms.com/q/{s}
jula	Jula	www.jula.se/search/?query={s}
juno	juno.co.uk	www.juno.co.uk/search/?q[all][]={s}
jwit	JustWatch Italy	www.justwatch.com/it/cerca?q={s}
jwse	JustWatch Sweden	www.justwatch.com/se/search?q={s}
k-on	K-ON! Wiki	k-on.wikia.com/wiki/Special:Search?query={s}
kali	kali linux	www.kali.org/?s={s}
kaos	KaOS website search	forum.kaosx.us/?q={s}
kapi	KDE API Reference	api.kde.org/mapsearcher.php?class={s}&module=ALL&version=ALL&go=Go
kart	FINN kart	kart.finn.no/?q={s}
kbbi	Kamus Besar Bahasa Indonesia	kbbi.kemendikdasmen.go.id/entri/{s}
kcls	King County Library System	kcls.bibliocommons.com/search?t=smart&search_category=keyword&q={s}&commit=Search
kcmm	KittyCorp: MeowMix	kc-mm.com/?s={s}
kcpl	Kenton County Public Library	catalog.kentonlibrary.org/eg/opac/results?query={s}
kika	KiKa von ARD und ZDF	www.kika.de/suche/suche104.html?q={s}
kivy kivyapi	Kivy API docs	kivy.org/docs/search.html?check_keywords=yes&area=default&q={s}
kkbb kissbb	KissKissBankBank	www.kisskissbankbank.com/search?q={s}
kmjy	Kaomojiya	kaomojiya.jp/keyword/{s}/?search_flg=1
knmi	Koninklijk Nederlands Meterologisch Instituut	knmi.nl/zoeken?q={s}
kobo	Kobo	www.kobo.com/us/en/search?Query={s}
kobv	KOBV.de	portal.kobv.de/simpleSearch.do?query={s}
kodi	Kodi Wiki	kodi.wiki/index.php?search={s}&title=Special:Search
koei	Koei Tecmo Wiki	koeitecmo.wiki/w/index.php?search={s}
koha	Koha Bugzilla	bugs.koha-community.org/bugzilla3/buglist.cgi?quicksearch={s}
kong kongregate	Kongregate	www.kongregate.com/search?q={s}
konj	Reverso Konjugator	de.bab.la/konjugieren/deutsch/{s}
kped	Kpedia	www.kpedia.jp/w/{s}
kpop	allkpop	www.allkpop.com/search/articles/{s}
krak	Krak	www.krak.dk/search?searchQuery={s}
kslc	ksl.com Classifieds	www.ksl.com/classifieds/search/?keyword={s}
kspf	Ksp forums	forum.kerbalspaceprogram.com/search.php?s={s}
ktcz	KaraokeTexty.cz	www.karaoketexty.cz/search?q={s}
kthb	KTH Library	kth-primo.hosted.exlibrisgroup.com/primo-explore/search?query=any,contains,{s}&vid=46KTH_VU1_L&search_scope=default_scope&sortby=rank&tab=default_tab&lang=en_US&mode=simple&fromRedirectFilter=true
kunu kununu	kununu.com	www.kununu.com/de/search#/?q={s}&country=COUNTRY_DE
l1sp	Lisp Docs	l1sp.org/search?q={s}
l365	Live365	www.live365.com/cgi-bin/directory.cgi?searchdesc={s}
laby	Laby	laby.net/@{s}
lang	LanguageTool	LanguageTool.org/?text={s}
lapa	lapatilla	lapatilla.com/?s={s}
lapl	Los Angeles Public Library	ls2pac.lapl.org/?section=search&term={s}
laut	laut.de	www.laut.de/Suche?q={s}
laws	Global-Regulation.com	www.global-regulation.com/search.php?year&country&province&d=1&start&q={s}&advanced=false
lc++ lcpp	legacy cplusplus.com	legacy.cplusplus.com/search.do?q={s}
lcbs	Luftfahrt Club Braunschweig	www.luftfahrtclubbraunschweig.de/suchen.php?such={s}
lccn	Library of Congress LCCN search	lccn.loc.gov/{s}
lcid	Library of Congress Linked Data	id.loc.gov/search/?q={s}&q=
lcsc	LCSC	lcsc.com/search?q={s}
lddb	LaserDisc Database	www.lddb.com/search.php?search={s}
ldlc	LDLC	www.ldlc.com/navigation/{s}/
ldss	LDS Scriptures	www.lds.org/scriptures/search?lang=eng&query={s}
leel	clsfyd - The Free Classifieds	www.clsfyd.com/search-results/?ad_title={s}
lego	LEGO.com	www.lego.com/en-us/search?q={s}
leka	Varusteleka	www.varusteleka.com/fi/search?q={s}
lemo	Lebendiges Museum Online	dhm.de/lemo/search?q={s}
leoc	LEO Dictionary Chinese	dict.leo.org/chde?lp=chde&search={s}
leoe	LEO Dictionary English	dict.leo.org/ende?lp=ende&search={s}
leoi	LEO Dictionary Italian	dict.leo.org/itde?lp=itde&search={s}
leop	Leo	dict.leo.org/ptde/?lp=ende&lang=de&searchLoc=0&cmpType=relaxed&sectHdr=on&spellToler=&search={s}
leos	LEO Dictionary Spanish	dict.leo.org/esde?lp=esde&search={s}
leto	Letonika.lv	letonika.lv/default.aspx?q={s}
levi	Levi D. Smith Games	levidsmith.com/?s={s}
lexp	lexparency.org	lexparency.org/eu/EN/search?deep=True&search_words={s}
lext dictgr eldict	Portal for The Greek Language	www.greek-language.gr/greekLang/modern_greek/tools/lexica/triantafyllides/search.html?lq={s}
lfpl	Louisville Free Public Library	pac.lfpl.org/polaris/search/searchresults.aspx?&type=Default&by=KW&sort=RELEVANCE&term={s}
lhvl	Le Hollandais Volant : au fil du web	lehollandaisvolant.net/?mode=links&q={s}
libg genesis	Library Genesis (Non-Fiction)	libgen.is/search.php?req={s}
lide linguee	Linguee (Deutsch/Englisch)	www.linguee.de/deutsch-englisch/search?source=auto&query={s}
lidi	Linguee De-Ita	www.linguee.de/deutsch-italienisch/search?query={s}
lied	linguee.com German - English	www.linguee.de/deutsch-englisch/search?source=englisch&query={s}
life	LifeSite	www.lifesitenews.com/archives/search/?q={s}
lifo	Lifo	www.lifo.gr/search?q={s}
lihu	Linguee (Hungarian - English)	www.linguee.com/english-hungarian/search?source=auto&query={s}
lilo	Lilo	search.lilo.org/searchweb.php?q={s}
ling	Ling.pl Angielsko-Polski	ling.pl/slownik/angielsko-polski/{s}
lite	DuckDuckGo Lite	duckduckgo.com/lite?q={s}
lluk	Liverpool Libraries catalogue	capitadiscovery.co.uk/liverpool/items?query={s}
lmec	Leventhal Map & Education Center Digital Collections	collections.leventhalmap.org/search?&q={s}
lmms	lmms wiki	lmms.io/wiki/index.php?title=Special:Search&profile=default&search={s}&fulltext=Search
lndb	The Light Novel Database	lndb.info/search?text={s}
logh	Gineipaedia	gineipaedia.com/w/index.php?title=Special:Search&search={s}&go=Go
logo	logopond	logopond.com/search/?search={s}
lolw	League of Legends Wiki	wiki.leagueoflegends.com/en-us/?search={s}
loop frontiers	Frontiers	www.frontiersin.org/SearchData.aspx?sq={s}
loot	Loot.co.za	www.loot.co.za/search?cat=b&terms={s}
lost	Lostpedia	lostpedia.wikia.com/wiki/Special:Search?search={s}
lotr tgate tolkien tolkiengateway	Tolkien Gateway	tolkiengateway.net/wiki/Special:Search?search={s}&go=Go
lqdn	La Quadrature du Net	www.laquadrature.net/fr/search/apachesolr_search/{s}
ltfr	Larousse	www.larousse.fr/dictionnaires/italien-francais/{s}
luch	Lush	de.lush.com/search/site/{s}
ludo ludopedia	Ludopedia	ludopedia.com.br/search?search={s}
lulu	Lulu	www.lulu.com/shop/search.ep?keyWords={s}
lumo protonlumo	Lumo	lumo.proton.me/?q={s}
lvdl	lavocedellelotte.it	www.lavocedellelotte.it/it/?s={s}
lxle	LXLE Linux	lxle.net/forum/#/search?Search={s}
lxml	MARC Linux Kernel	marc.info/?l=linux-kernel&w=2&r=1&s={s}&q=b
macg	MacGeneration	www.macg.co/search/site/{s}
macq	Macquarie Dictionary	www.macquariedictionary.com.au/features/word/search/?word={s}&search_word_type=Dictionary
made	Made.com	www.made.com/catalogsearch/result/?q={s}
mail	Google Mail	mail.google.com/mail/u/0/#inbox{s}:
make makezine	Make	makezine.com/?s={s}
maku	Maku.fi	www.maku.fi/haku/recipe?q={s}
mall	Mall.cz	www.mall.cz/hledej?s={s}
man1	Linux Die.net Manual Page 1	linux.die.net/man/1/{s}
mapp	ACME Mapper 2.0	mapper.acme.com/?q={s}
mari	Supreme Court of Indonesia	putusan3.mahkamahagung.go.id/search.html?q={s}
mash	mashable	mashable.com/follow/search/?q={s}
math mathworld	Wolfram MathWorld	mathworld.wolfram.com/search/?query={s}&x=0&y=0
matl matw matweb	MatWeb	www.matweb.com/search/QuickText.aspx?SearchText={s}
mayo	Mayo Clinic	www.mayoclinic.org/search/search-results?q={s}
mbfc mediabias	Media Bias/Fact Check	mediabiasfactcheck.com/?s={s}
mbph	Manila Bulletin	mb.com.ph/?s={s}
mbrc mbrecording	MusicBrainz Recordings	musicbrainz.org/search?query={s}&type=recording
mbrg	MusicBrainz Release Group	musicbrainz.org/search?query={s}&type=release_group&method=indexed
mcat monstercat	Monstercat	www.monstercat.com/search?term={s}
mcde	Minecraft Wiki (deutsch)	de.minecraft.wiki/?search={s}
mcfr	Minecraft.fr	minecraft.fr/?s={s}
mcpc	Minecraft PC Wiki	minecraft-computer.wikia.com/wiki/Special:Search?search={s}
mcpl	Middle Country Public Library	mcpac.mcpl.lib.ny.us/search/t?{s}
mcwm	Minecraft World Map	www.minecraftworldmap.com/search?ss={s}
mdbg	MDBG Dictionary	www.mdbg.net/chinese/dictionary?page=worddict&wdrst=0&wdqb={s}
mdcc	Dict.cc	m.dict.cc/?s={s}
mdmz	Madmoizelle	www.madmoizelle.com/?s={s}
mdtz	Mediatize	www.mediatize.info/search?q={s}
meco	MetaloChimice Online	www.metalochimice.ro/?s={s}&post_type=product
medb	Medbullets	www.medbullets.com/search?q={s}
mefi metafilter	MetaFilter	www.metafilter.com/contribute/search.mefi?site=mefi&q={s}
memx memoryexpress	Memory Express	www.memoryexpress.com/Search/Products?Search={s}
meny	Meny	meny.no/sok/?query={s}
mesh	Medical Subject Headings	www.ncbi.nlm.nih.gov/mesh/?term={s}
mewe	Mewe	mewe.com/profile/{s}
mfac mfde mindf mindfactory	Mindfactory	www.mindfactory.de/search_result.php?select_search=0&search_query={s}
mgdb macgaming macgamingdb	MacGamingDB	macgamingdb.app/?q={s}
mhlo	Mental Health Law Online	www.mentalhealthlaw.co.uk/index.php?search={s}
midi	freemidi.org	freemidi.org/search?q={s}
mill	Million Short	millionshort.com/search?keywords={s}&remove=1000000
mime	Mime Types Database	mimeapplication.net/search?q={s}
mint	LinuxMint	linuxmint.com/search.php?query={s}&search=1
mkrw	Mario Kart Racing Wiki	mariokart.wikia.com/wiki/Special:Search?search={s}
mktw wsjmw	MarketWatch	www.marketwatch.com/search?q={s}
mlar mercadolibre mercadolibrear	MercadoLibre	mercadolibre.com/?q={s}
mlat	Corpus Corporum: repositorium operum latinorum apud universitatem Turicensem	www.mlat.uzh.ch/MLS/advsuchergebnis.php?suchbegriff={s}&mode=SPH_MATCH_EXTENDED2&corpus=all
mlbp	MLB Player Search	espn.go.com/mlb/players?=1&search={s}
mlbr mlivre mercadolivre	Mercado Livre	lista.mercadolivre.com.br/{s}
mlcl mercadolibrecl	Mercadolibre.cl	listado.mercadolibre.cl/{s}
mlco mlibreco	Mercado Libre Colombia	listado.mercadolibre.com.co/{s}
mlcr	Mercado Libre Costa Rica	listado.mercadolibre.co.cr/{s}
mldb	The Music Lyrics Database	www.mldb.org/search?mq={s}
mldo	Mercado Libre Dominicana	listado.mercadolibre.com.do/{s}
mlec	Mercado Libre Ecuador	listado.mercadolibre.com.ec/{s}
mlgb	Medieval Libraries of Great Britain	mlgb3.bodleian.ox.ac.uk/mlgb/?search_term={s}
mlpa	Mercado Libre Panama	listado.mercadolibre.com.pa/{s}
mlpe	Mercado Libre Peru	listado.mercadolibre.com.pe/{s}
mlpf	My Little Pony Forums	mlpforums.com/search/?q={s}
mluy	Mercado Libre	listado.mercadolibre.com.uy/{s}
mlve	Mercado Libre Venezuela	listado.mercadolibre.com.ve/{s}
mmnl moviemeter	MovieMeter	www.moviemeter.nl/site/search?q={s}
mmol	Medieval Manuscripts in Oxford Libraries	medieval.bodleian.ox.ac.uk/?q={s}
mmoz musicmoz	MusicMoz	musicmoz.org/search/search.cgi?search={s}
moby	MobyGames	www.mobygames.com/search/quick?q={s}
modx	MODX	docs.modx.org/current/en/search?q={s}
moex	Moscow Exchange	www.moex.com/en/issue.aspx?code={s}
molw	WebQC.org	www.webqc.org/mmcalc.php?compound={s}
moly	Moly.hu	moly.hu/kereses?q={s}
mooc cctrl moocs	Class Central	www.class-central.com/search?q={s}
mopi moviepilot	moviepilot	www.moviepilot.de/suche?utf8=%E2%9C%93&q={s}
movl	MovieLens	movielens.org/explore?q={s}
mpbo	MenuPages (Boston)	boston.menupages.com/restaurants/text/{s}/all-areas/all-neighborhoods/all-cuisines/
mpch	MenuPages (Chicago)	chicago.menupages.com/restaurants/text/{s}/all-areas/all-neighborhoods/all-cuisines/
mpdc	MenuPages (Washington DC)	washingtondc.menupages.com/restaurants/text/{s}/all-areas/all-neighborhoods/all-cuisines/
mpfl	MenuPages (South Florida)	southflorida.menupages.com/restaurants/text/{s}/all-areas/all-neighborhoods/all-cuisines/
mpla	MenuPages (Los Angeles)	losangeles.menupages.com/restaurants/text/{s}/all-areas/all-neighborhoods/all-cuisines/
mpph	MenuPages (Philadelphia)	philadelphia.menupages.com/restaurants/text/{s}/all-areas/all-neighborhoods/all-cuisines/
mpsf	MenuPages (San Francisco)	sanfrancisco.menupages.com/restaurants/text/{s}/all-areas/all-neighborhoods/all-cuisines/
mref	ams mathscinet mref	mathscinet.ams.org/mathscinet-mref?ref={s}
mrqe	the Movie Review Query Engine	www.mrqe.com/search?utf8=%E2%9C%93&q={s}
msac msacademic	Microsoft Research Search	www.microsoft.com/en-us/research/search/?q={s}
msdn	MSDN	learn.microsoft.com/en-us/search?terms={s}
msds	ScienceLab MSDS Database	www.sciencelab.com/search.php?q={s}
mskb	Microsoft Knowledge Base	support.microsoft.com/en-us/search?query={s}
mspa mspawiki	MS Paint Adventures Wiki	mspaintadventures.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
mspu	MS Power User	mspoweruser.com/?s={s}
msrd	MusicRadar	www.musicradar.com/search?searchTerm={s}:
msui	Meteo Suisse / Schweiz	www.meteoswiss.admin.ch/search.html#query={s}
mtcn	Mandarin Tools Chinese-English Dictionary (Chinese/Pinyin)	www.mandarintools.com/cgi-bin/wordlook.pl?word={s}&where=whole
mten	Mandarin Tools Chinese-English Dictionary (English)	www.mandarintools.com/cgi-bin/wordlook.pl?word={s}&searchtype=english&where=whole
mtgg magic gatherer	Gatherer	gatherer.wizards.com/Pages/Search/Default.aspx?name=+[{s}]
mtgh	MTG-Hunter	mtg-hunter.com/?q={s}
mtgs	MTG Salvation Wiki	mtgsalvation.gamepedia.com/?search={s}
mtgw mtgwtf	MTG WTF	mtg.wtf/card?q={s}
mtrl	Material.io	material.io/search.html?q={s}
mubi	Mubi	mubi.com/search/results?q={s}
muff	Muff Wiggler Forum	www.muffwiggler.com/forum/search.php?search_keywords={s}&search_terms=extended&search_author=&search_forum=-1&search_time=0&search_fields=all&sort_by=0&sort_dir=desc&show_results=topics&return_chars=200
murl	murlengine	murlengine.com/api/en/search.php?q={s}
mvdb	mvdbase	www.mvdbase.com/index.php?term={s}&field=vid&page=results
mybb	MyBroadband	mybroadband.co.za/news/?s={s}
myer	Myer	www.myer.com.au/search?query={s}
myfl	MyFlorida.com	www.myflorida.com/search_results.html?q={s}#gsc.tab=0&gsc.q=dmv&gsc.page=1
naeb	Native American Ethnobotany	naeb.brit.org/uses/search/?string={s}
name	Name.com	www.name.com/name?&domain={s}
namu	namuwiki	namu.wiki/Go?q={s}
nano	Timini	www.timini.no/search/q/{s}
nasa	NASA	nasasearch.nasa.gov/search?query={s}&affiliate=nasa&utf8=%E2%9C%93
nasb	New American Standard Bible	www.biblegateway.com/quicksearch/?quicksearch={s}&qs_version=NASB
nasp	Naver Shopping	search.shopping.naver.com/search/all.nhn?query={s}&cat_id=&frm=NVSHATC
nava	Naval Action Wiki	www.navalactionwiki.com/index.php?title=Special:Search&search={s}&go=Go
navm nmap	Naver Map	map.naver.com/?query={s}
nbam	Nba Maniacs	www.nbamaniacs.com/?s={s}
ncbc	NoCoastBestCoast	www.nocoastbestcoast.com/search.php?search={s}
ncbi	NCBI	www.ncbi.nlm.nih.gov/gquery/?term={s}
ncsc	Nationaal Cyber Security Centrum	www.ncsc.nl/zoeken?trefwoord={s}
ncvi	Nicovideo jp	www.nicovideo.jp/search/{s}?track=nicouni_search_keyword
ndic	Naver English Dictionary	endic.naver.com/search.nhn?query={s}
ndla	NDLA	ndla.no/search?query={s}
ndpr	Notre Dame Philosophical Reviews	ndpr.nd.edu/search/?search_keyword=&as_sitesearch=ndpr.nd.edu&q={s}
ndtv	NDTV	ndtv.com/topic/{s}
neca neweggca	Newegg Canada	www.newegg.ca/Product/ProductList.aspx?Submit=ENE&DEPA=0&Order=BESTMATCH&Description={s}&N=-1&isNodeId=1
necy	Necyklopedie CZ	necyklopedie.wikia.com/wiki/{s}
nejm	New England Journal Of Medicine	www.nejm.org/search?q={s}&asug=
neos	Neos.io	www.neos.io/download-and-extend/packages.html?search={s}
nepu	Hyperdimension Neptunia Wiki	neptunia.wikia.com/wiki/Special:Search?search={s}
neti	NETI	www.neti.ee/cgi-bin/otsing?src=web&query={s}
nexo	Nexo Jornal	www.nexojornal.com.br/utility/search/?q={s}
next	Next-Episode.net	next-episode.net/site-search-{s}.html
nfib	National Federation of Independent Business	www.nfib.com/search/?query={s}
nfsw	Need for Speed Wiki	nfs.wikia.com/wiki/Special:Search?search={s}
nice	NICE - National Institute for Health and Care Excellence	www.nice.org.uk/search?q={s}
nico niconico	Nico Nico Douga	www.nicovideo.jp/search/{s}
nifs	NI Ferry Site	www.niferry.co.uk/?s={s}
niif	NIIF Institute	www.niif.hu/search/node/{s}
nina	Narodowy Instytut Audiowizualny (nina.gov.pl)	www.nina.gov.pl/searchresult?query={s}
nivl	NASA Image and Video Library	images.nasa.gov/search-results?searchInput={s}
nlab ncatlab	nLab	ncatlab.org/nlab/search?query={s}
nlde	Google Translate (nl2de)	translate.google.com/#view=home&op=translate&sl=nl&tl=de&text={s}
nlen ja2en	Google Translate (ja2en)	translate.google.com/#ja/en/{s}
nltk	Natural Language ToolKit	www.nltk.org/search.html?q={s}
nlwc	Llyfrgell Genedlaethol Cymru = The National Library of Wales	discover.library.wales/discovery/search?query=any,contains,{s}&tab=In_The_Library&search_scope=In_The_Library&vid=44WHELF_NLW:44WHELF_NLW_NUI&offset=0
nmsu	New Mexico State University	www.nmsu.edu/search_results.html?q={s}
nndb	NNDB	search.nndb.com/search/nndb.cgi?nndb=1&omenu=unspecified&query={s}
node	node.js docs	nodejs.org/api/{s}.html
noel	Noel Leeming	www.noelleeming.co.nz/search.html?q={s}
noen	Google Translate no-en	translate.google.com/#no/en/{s}
nohu	Google Translate no-hu	translate.google.hu/#view=home&op=translate&sl=no&tl=hu&text={s}
nolo	Nolo.com	www.nolo.com/search2?type=all&query={s}&location=
nook	Nookipedia	nookipedia.com/w/index.php?title=Special:Search&search={s}
note	note	note.mu/search?context=note&mode=search&q={s}
npat	Nationalparks Austria Datenzentrum	www.parcs.at/npa/mmd_data_by.php?q={s}&btnG=Suche+starten&searchval=30000
npmd	NPM Direct	npmjs.com/package/{s}
npms	npms.io	npms.io/search?q={s}
npmx	NPMX	npmx.dev/search?q={s}
npoz	Nacionalni portal odprte znanosti	openscience.si/NaprednoIskanje.aspx?t=s&q=1:0:{s};
nrdb netrunner	NetrunnerDB	netrunnerdb.com/find/?q={s}
nrkr	NRK Radio	radio.nrk.no/sok?q={s}
nrtq nasdaq	NASDAQ	www.nasdaq.com/symbol/{s}/real-time
nsfw	DuckDuckGo Safe Off	duckduckgo.com/?q={s}&kp=-2&ia=web
ntel	numeroinconnu	www.numeroinconnu.fr/numero/{s}
nthp	New Theatre History Project	history.newtheatre.org.uk/search/?q={s}
ntnu	Norwegian University of Science and Technology	www.ntnu.edu/sok?query={s}
nvde	Naver german-korean dictionary	dict.naver.com/dekodict/#/search?query={s}
nxim	Next Inpact Mobile	m.nextinpact.com/rechercher?term={s}
nypl	New York Public Library	browse.nypl.org/iii/encore/search/C__S{s}__Orightresult__U?lang=eng
nyrb	New York Review of Books	www.nybooks.com/search/?s={s}&option_match=&year_after=1963&year_before=2017&type=all&orderby=relevance
nyse	New York Stock Exchange	www.nyse.com/quote/XNYS:{s}
nytc cooking	NYT Cooking	cooking.nytimes.com/search?q={s}
nzqa	New Zealand Qualifications Authority	search.nzqa.govt.nz/apps/search/?q={s}
oaad olad	Oxford Advanced American Dictionary	www.oxfordlearnersdictionaries.com/definition/american_english/{s}
oald	Oxford Advanced Learner's Dictionary	www.oxfordlearnersdictionaries.com/search/english/?q={s}
oapi	OverAPI Cheatsheet	overapi.com/{s}
ocat	o.v.e.r.clockers.at	www.overclockers.at/search.php?action=simplesearch&query={s}
oclc	OCLC Worldcat	www.worldcat.org/search?q={s}
ocna	Opencaching NA	www.opencaching.us/search.php?searchto=searchbyname&showresult=1&expert=0&output=HTML&sort=bydistance&f_inactive=0&f_ignored=0&f_userfound=0&f_userowner=0&f_watched=0&f_geokret=0&cachename=https://www.opencaching.us/search.php?searchto=searchbyname&showresult=1&expert=0&output=HTML&sort=bydistance&f_inactive=0&f_ignored=0&f_userfound=0&f_userowner=0&f_watched=0&f_geokret=0&cachename={s}&submit=Search&submit=Search
octo octopart	Octopart	octopart.com/search?q={s}
ocuk	OverclockersUK	overclockers.co.uk/search_results.php?keywords={s}
odeu	European Open Data Portal	data.europa.eu/euodp/en/data/dataset?q={s}
odic oxed oxforddictionaries	Oxford Dictionaries	en.oxforddictionaries.com/search?utf8=%E2%9C%93&filter=dictionary&query={s}
odnb	Oxford Dictionary of National Biography	www.oxforddnb.com/search?q={s}
odoo	Odoo Apps	www.odoo.com/apps?search={s}
oeis	The On-Line Encyclopedia of Integer Sequences	oeis.org/search?q={s}&language=english&go=Search
ofdb	Online Film Datenbank	www.ofdb.de/view.php?SText={s}&Kat=All&page=suchergebnis
ogdb	Online Games-Datenbank	ogdb.eu/index.php?section=simplesearchresults&searchstring={s}
ogjs oilandgas	Oil and Gas Job Search	www.oilandgasjobsearch.com/Oil-and-Gas-Jobs/Search/{s}
ogol	OGol	www.ogol.com.br/search.php?inputString={s}
ojad	OJAD - Online Japanese Accent Dictionary	www.gavo.t.u-tokyo.ac.jp/ojad/search/index/word:{s}
ojen	The Ojibwe People's Dictionary	ojibwe.lib.umn.edu/search?utf8=%E2%9C%93&q={s}&commit=Search&type=ojibwe
olam	Olam	olam.in/Dictionary/en_ml/{s}
oldv oldversion	OldVersion	www.oldversion.com/search?query={s}
olib openlibrary	Open Library	openlibrary.org/search?q={s}
olth revd onelookth	Onelook Reverse Dictionary	www.onelook.com/reverse-dictionary.shtml?s={s}
omdb	Open Media Database	www.omdb.org/search?search[text]={s}
omgc omgchrome	OMG! Chrome!	www.omgchrome.com/?s={s}
omgh	OMG Hackers	omghackers.com/?s={s}
omgv omgvoice	OMGvoice	omgvoice.com/search?term={s}
omim	OMIM Search	omim.org/search?index=entry&sort=score+desc,+prefix_sort+desc&start=1&limit=10&search={s}
omni	Omni	omni.se/sok?q={s}
ootl	r/OutOfTheLoop	www.reddit.com/r/OutOfTheLoop/search?q={s}&restrict_sr=on
ootv	L5R: Oracle of the Void	www.imperialassembly.com/oracle/?quicksearch=1&search_13={s}
opbr	OP.GG Brazil - League of Legends Summoners statistics and MMR	br.op.gg/summoner/userName={s}
open	Yelp Open Search	www.yelp.com/search?find_desc={s}&ns=1#start=0&open_now=2510
opgg op.gg	OP.GG	www.op.gg/summoner/userName={s}
opna na.op naopgg opggna	opgg	na.op.gg/summoner/userName={s}
opru	OP.GG Russia - League of Legends Summoners statistics and MMR	ru.op.gg/summoner/userName={s}
optr	OP.GG Turkey - League of Legends Summoners statistics and MMR	tr.op.gg/summoner/userName={s}
ored	old reddit	old.reddit.com/search?q={s}&sort=relevance&t=all
orfd	Orion Feedback (Discussions)	orionfeedback.org/?q={s}
orfo orfoqrafiya	Orfoqrafiya	www.orfoqrafiya.az/aze/{s}
orly oreilly	O'Reilly	www.oreilly.com/search/?q={s}&rows=100
orms	Orms Direct	www.ormsdirect.co.za/catalogsearch/result/index/?q={s}
osdn	OSDN	osdn.net/search/?iq={s}
oslo	Oslo kommune	www.oslo.kommune.no/sokeresultater/?q={s}
osmc	OSMC	discourse.osmc.tv/search?q={s}
osmw wosm osmwiki openstreetmapwiki	OpenStreetMap Wiki	wiki.openstreetmap.org/w/index.php?title=Special:Search&search={s}
osrm	Open Source Routing Machine	map.project-osrm.org/?dest={s}
osrs rs07 wosrs	Old School RuneScape Wiki	oldschool.runescape.wiki/?search={s}&title=Special:Search
osta	osta.ee	www.osta.ee/index.php?q[q]={s}&fuseaction=search.search&q[show_items]=1&q[show_shop]=1&q[cat]=1000&search=OTSI
osuf	Osu! Forums	osu.ppy.sh/forum/search.php?keywords={s}&terms=all&author=&sc=1&sd=d&sr=posts&ch=300&t=0&submit=Search
osus	osu!search	osusearch.com/search/?title={s}
osuu	osu.ppy.sh	osu.ppy.sh/u/{s}
otrd	OneLook Thesaurus	onelook.com/thesaurus/?s={s}
otto	OTTO	www.otto.de/suche/{s}/
owid	Online-Wortschatz-Informationssystem Deutsch	www.owid.de/suche/wort?wort={s}
owrt	OpenWrt	openwrt.org/doku.php?do=search&id=start&q={s}
owsr	Overwatch subreddit	www.reddit.com/r/Overwatch/search?q={s}&restrict_sr=on
ozer	Outdoorzer	outdoorzer.com/s={s}
pabn	Prothom Alo (Bangla)	www.prothomalo.com/search/?q={s}
pack packagist	Packagist	packagist.org/search/?q={s}
paco	Paco Games	www.pacogames.com/search?q={s}
pao1	Pseudomonas Genome Database	www.pseudomonas.com/searchAnnotation.do?strain_ids=107&field1=commonNameFields&input1={s}
pass	passwird.com	www.passwird.com/search?query={s}
patg	patents.google.com	patents.google.com/?q={s}
patm	pauker.at Dictionary (Mobile)	www.pauker.at/app.php/DE_DE/?s={s}#suche
pc24	PChome 24h	ecshweb.pchome.com.tw/search/?q={s}
pcat	Princeton University Library Catalog	catalog.princeton.edu/catalog?utf8=%E2%9C%93&search_field=all_fields&q={s}
pccg	PCCaseGear	www.pccasegear.com/search?query={s}
pcco pcomp pccomponentes	PcComponentes	www.pccomponentes.com/buscar/?query={s}
pcgn	PCGamesN	www.pcgamesn.com/search/{s}
pcgw pcgamingwiki	PCGamingWiki	pcgamingwiki.com/w/index.php?search={s}
pcio pctrl	Package Control Sublime Text Package Manager	packagecontrol.io/search/{s}
pcks	Peacocks UK	www.peacocks.co.uk/catalogsearch/result/?q={s}
pclo parcello	Parcello Sendungsverfolgung - Parcel Tracking	www.parcello.org/tracking?tid={s}
pcmr	Reddit PC Master Race	www.reddit.com/r/pcmasterrace/search?q={s}&restrict_sr=on&sort=relevance&t=all
pcpp pcpartpicker	PCPartPicker	pcpartpicker.com/search/?q={s}
pdbe	PDB Europe	www.ebi.ac.uk/pdbe/entry/search/index/?searchParams={""text"":[{""value"":""{s}"",""condition1"":""AND"",""condition2"":""Contains""}]}
pear	PEAR - PHP Extension and Application Repository	pear.php.net/search.php?in=packages&x=0&y=0&q={s}
pecl	PECL :: The PHP Extension Community Library	pecl.php.net/package-search.php?pkg_name={s}
pegi	PEGI	pegi.info/search-pegi?q={s}
peri	Periscope	www.periscope.tv/search?q={s}
perl perlmod	p3rl.org	p3rl.org/{s}
pfss	pfSense Doc	www.netgate.com/docs/pfsense/search.html?q={s}&check_keywords=yes&area=default
pgde	Projekt Gutenberg-DE	gutenberg.spiegel.de/suche?q={s}
pgfr	Projet Gutenberg Fr	www.gutenberg.org/ebooks/search/?query=l.fr+{s}
pgkb pharmgkb	PharmGKB	www.pharmgkb.org/search?query={s}
pgno	Prisguiden.no	prisguiden.no/sok?q={s}
pgri	pgri	www.pgri.or.id/?s={s}
phet	phet	phet.colorado.edu/en/search?q={s}
phun	PHUN Forum	phun.freeforums.org/search.php?keywords={s}
pigu	Pigu	pigu.lt/search?q={s}
pils	UK Patient Information Leaflets	patient.info/Search.asp?searchTerm={s}&collections=Condition_Leaflets
pimo pimoroni	Pimoroni	shop.pimoroni.com/search?q={s}
pina	pinboard.in	pinboard.in/search/?query={s}&all=Search+All
ping	DomainTools.com	dns-tools.domaintools.com/?method=ping&query={s}
pink	PinkNews	www.pinknews.co.uk/?s={s}
pipl	Pipl	pipl.com/search/?q={s}&l=&sloc=&in=5
pito	Pisa Today	www.pisatoday.it/search/query/{s}
pjdk prisjagt	Prisjagt	www.prisjagt.dk/search?query={s}
pjno	Prisjakt (Norway)	www.prisjakt.no/search?query={s}
pkgs	Linux Packages Search	pkgs.org/search/?q={s}
plab	Public Lab	publiclab.org/search/{s}
plde	google translate pl-de	translate.google.com/#view=home&op=translate&sl=pl&tl=de&text={s}
plen	Google Translate: pl-en	translate.google.com/#pl/en/{s}
plex	Plex	app.plex.tv/desktop/#!/search?pivot=top&query={s}
plfr	Reverse (plfr)	dictionnaire.reverso.net/polonais-francais/{s}
plos	PLOS	journals.plos.org/plosone/search?unformattedQuery=everything:"{s}"
plug	pluggedin	www.pluggedin.com/search?q={s}
plus	Plus.codes	plus.codes/map/{s}
pmcb	Planet Minecraft - banners	www.planetminecraft.com/banners/?keywords={s}
pmcc	Planet Minecraft - collections	www.planetminecraft.com/collections/?keywords={s}
pmcd	Planet Minecraft - data packs	www.planetminecraft.com/resources/mods/data-pack/?keywords={s}
pmck	Planet Minecraft - skins	www.planetminecraft.com/resources/skins/?keywords={s}
pmcm	Planet Minecraft - mods	www.planetminecraft.com/resources/mods/?keywords={s}
pmcp	Planet Minecraft - projects	www.planetminecraft.com/resources/projects/?keywords={s}
pmcr	Planet Minecraft - resource packs	www.planetminecraft.com/resources/texture_packs/?keywords={s}
pmcs	Planet Minecraft - servers	www.planetminecraft.com/resources/servers/?keywords={s}
pmmm	Puella Magi Madoka Magica Wiki	wiki.puella-magi.net/index.php?title=Special:Search&search={s}
pmon	Pixelmon Wiki	pixelmon.wikia.com/wiki/Special:Search?search={s}&fulltext=Search&ns0=1&ns14=1
pnas	Proceedings of the National Academy of Sciences	www.pnas.org/action/doSearch?AllField={s}
pnde	Amazon PrimeNow DE	primenow.amazon.de/search?k={s}
pndr pandora	Pandora	www.pandora.com/search/{s}
pnuk	Amazon Prime Now UK	primenow.amazon.co.uk/search?k={s}
poal	Poal	poal.co/search/{s}
poem	PoemHunter	www.poemhunter.com/search/?q={s}
poer	Path of Exile Subreddit	www.reddit.com/r/pathofexile/search?q={s}&restrict_sr=on
polk	Polk Audio	www.polkaudio.com/search/products?q={s}
poly	Poly	poly.google.com/search/{s}
poma postmates	Postmates	postmates.com/search?q={s}
pons	pons.eu	en.pons.com/translate?q={s}
pony	Pony Standard Library	stdlib.ponylang.org/search.html?q={s}
port service	IANA Service Name and Transport Protocol Port Number Registry	www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml?search={s}
powt	Power Thesaurus	www.powerthesaurus.org/{s}/synonyms
ppcg	Programming Puzzles & Code Golf Stack Exchange	codegolf.stackexchange.com/search?q={s}
ppin pinpin	Pin Pin Chinese Dictionary	dictionary.pinpinchinese.com/search/t/{s}
prab	prabhasakshi	www.prabhasakshi.com/topics/{s}
prdl	The Post-Reformation Digital Library	www.prdl.org/search.php?q={s}
pred	Predecessor Official Wiki	predecessor.wiki.gg/index.php?search={s}&title=Special:Search&go=Go
prel	Internet Archive - Prelinger Archives	archive.org/details/prelinger?and[]={s}
prfc	Pretty-RFC	pretty-rfc.herokuapp.com/search?q={s}
pro7	ProSieben	www.prosieben.de/suche?q={s}
prom	Prom	prom.ua/search?search_term={s}
proz	Proz.com Forums	www.proz.com/search/?term={s}
prpl	Poudre River Public Library	discover.poudrelibraries.org/iii/encore/search/C__S{s}__Orightresult__U?lang=eng
prpm kamus	Pusat Rujukan Persuratan Melayu	prpm.dbp.gov.my/Search.aspx?k={s}
psci	Podcast Science	www.podcastscience.fm/?s={s}
psmb	PowerShell Module Browser	docs.microsoft.com/en-us/powershell/module/?term={s}
psnz pricespy	pricespy.co.nz	pricespy.co.nz/search?query={s}
psql postgres	Postgres	www.postgresql.org/search/?q={s}&a=1&submit=Search
psuk	pricespyuk	pricespy.co.uk/search?query={s}
ptax	Pentax Cameras	jp.search.app.ricoh/en_imaging/search.x?q={s}
ptcg	PkmnCards	pkmncards.com/?s={s}&display=card&sort=date
pten	Google Translate - pt-en	translate.google.com/#pt/en/{s}
ptes	Google Translate Portuguese-Spanish	translate.google.com/#pt/es/{s}
pubs	Pubs Galore	www.pubsgalore.co.uk/search.php?search={s}
puid	PRONOM technical registry (The National Archives)	nationalarchives.gov.uk/PRONOM/{s}
purs pursuit	Pursuit	pursuit.purescript.org/search?q={s}
pxvg	Pixabay vector graphics	pixabay.com/en/photos/?image_type=vector&cat=&min_width=&min_height=&q={s}&order=latest
py34	Python Documentation	docs.python.org/3.4/search.html?q={s}
py35	Python 3.5 Documentation	docs.python.org/3.5/search.html?q={s}
pylm	PyLint Messages	pylint-messages.wikidot.com/messages:{s}
pyqt	PyQt	pyqt.sourceforge.net/Docs/PyQt5/search.html?q={s}
qpon	Qpongo	qpongo.com/ddgsearch.aspx?q={s}
qssl	Qualys SSL Labs	www.ssllabs.com/ssldb/analyze.html?d={s}&hideResults=on
qstu	QS Top Universities	www.topuniversities.com/search/site/{s}
qual	Qualtrics Support	www.qualtrics.com/support/search/?q={s}
quay	Quay	quay.io/search?q={s}
r-es	duckduckgo spain	duckduckgo.com/?q={s}&kl=es-es
r-us	DuckDuckGo US	duckduckgo.com/?q={s}&kl=us-en
racv	RACV	www.racv.com.au/search-results.html?q={s}
rain raindrop	Raindrop	app.raindrop.io/my/0/{s}
rapm nbarapm	nbarapm.com	nbarapm.com/player/{s}
ratp	RATP	www.ratp.fr/itineraires?start={s}&lieu_depart=station&
rawg	RAWG	rawg.io/search?query={s}
rbbg	Rete Bibliotecaria Bergamasca	www.rbbg.it/opac/search/lst?q={s}
rbde radiobremen	Radiobremen	www.radiobremen.de/service/suche/suche-112.html?term={s}
rblx	Roblox Marketplace	www.roblox.com/catalog?Keyword={s}
rbtb	The Ruby Toolbox	www.ruby-toolbox.com/?q={s}
rbtc	Convert BRL to BTC	www.metric-conversions.org/pt/moeda/bitcoin-em-real.htm?val={s}
rbtg	rbt.asia - /g/	rbt.asia/g/search/text/{s}
rcdb	Roller Coaster Database	rcdb.com/qs.htm?qs={s}
rcef	Reverso Context English to French	context.reverso.net/translation/english-french/{s}
rcfe	Reverso Context French-English	context.reverso.net/translation/french-english/{s}
rcfr	Ricardo Cuisine	www.ricardocuisine.com/recherche/mot-cle/{s}
rcsb	RCSB	rcsb.org/pdb/explore/explore.do?structureId={s}
rcss superstore	Real Canadian Superstore	www.realcanadiansuperstore.ca/search/?search-bar={s}
rdap	RDAP	client.rdap.org/?object={s}
rdkj romajidesukanji	Romajidesu Kanji	www.romajidesu.com/kanji/{s}
rdns	MXToolbox (dns ptr)	mxtoolbox.com/SuperTool.aspx?action=ptr:{s}&run=toolpage
rdoc	RubyDoc.info	www.rubydoc.info/find/gems?q={s}
rdrr	rdrr.io	rdrr.io/search?q={s}
reed	reed.co.uk	www.reed.co.uk/job/searchresults.aspx?k={s}
rees	Reverso Spanish - Definition	dictionary.reverso.net/spanish-definition/{s}
refr	Reverso French - Definition	dictionary.reverso.net/french-definition/{s}
rege	Reverso German - Definition	dictionary.reverso.net/german-definition/{s}
remy remywiki	RemyWiki	remywiki.com/index.php?title=Special:Search&search={s}
repl	repl.it	repl.it/languages/{s}
repm	Represent	represent.com/search?q={s}
resi	Cekresi	cekresi.com/?noresi={s}
resp	Respaper	www.respaper.com/s?q={s}
reuq reuters	Reuters	www.reuters.com/site-search/?query={s}
revo reta-vortaro	Reta Vortaro	www.reta-vortaro.de/cgi-bin/sercxu.pl?sercxata={s}&kadroj=1
rewe	REWE Lieferservice	www.rewe.de/suche/?search={s}
rfck	IETF RFC Keyword Search	www.rfc-editor.org/search/rfc_search_detail.php?title={s}
rfcr	Online RFC Reader	www.rfcreader.com/#rfc{s}
rhbz rbugs	Redhat Bugzilla	bugzilla.redhat.com/buglist.cgi?quicksearch={s}
rhsa	Red Hat Security Advisory	rhn.redhat.com/errata/RHSA-{s}.html
rhtt sotd	State of the DApps	www.stateofthedapps.com/dapps?text={s}
ridi	Ridibooks	ridibooks.com/search/?q={s}
rima	Cerca Rime	www.cercarime.it/?rima={s}
rime	Rimessolides.com	www.rimessolides.com/rime.aspx?m={s}
rinf	RINF Alternative news	www.rinf.com/?q={s}
ripe ripestat	RIPEstat	stat.ripe.net/{s}
rmit	RMIT University	www.rmit.edu.au/search?q={s}
rn24	RocketNews24	en.rocketnews24.com/?s={s}
rock luarocks	LuaRocks	luarocks.org/search?q={s}
rodo	GDPR PL	gdpr.pl/?s={s}
rofi	Dictionar roman-finlandez-roman	www.dictionar-finlandez.net/online/?word={s}
rold oldred oldreddit redditold	Old Reddit	old.reddit.com/search?q={s}
root	ROOT	root.cern.ch/drupal/search/node/{s}
ror2	Risk of Rain 2 Wiki	riskofrain2.wiki.gg/index.php?search={s}
rosw	ROS Wiki	wiki.ros.org/{s}
roto	Rotoworld	www.rotoworld.com/search#query={s}
rpad	riseUp networks Etherpad	pad.riseup.net/p/{s}
rpms	Fedora Package Sources	src.fedoraproject.org/rpms/{s}
rsar	Rolling Stone Argentina	www.rollingstone.com.ar/buscador-r30-{s}
rsca	Royal Society Collections Catalogues, archives	catalogues.royalsociety.org/CalmView/Overview.aspx?src=CalmView.Catalog&r=((((text)='{s}')))
rscf	Royal Society Collections Catalogues, past Fellows by surname	catalogues.royalsociety.org/CalmView/Overview.aspx?src=CalmView.Persons&r=(((Surname='{s}')))
rsci	Reddit Ask Science	www.reddit.com/r/askscience/search?q={s}&restrict_sr=1
rscp	Royal Society Collections Catalogues, printed works	catalogues.royalsociety.org/CalmView/Overview.aspx?src=CalmView.CatalogL&r=((((text)='{s}')))
rsde	RS Components (DE)	de.rs-online.com/web/c/?searchTerm={s}
rses	RS Component (ES)	es.rs-online.com/web/c/?sra=oss&r=t&searchTerm={s}
rsfr	RS Component (FR)	radiospares-fr.rs-online.com/web/c/?searchTerm={s}
rsge	The RuneScape Grand Exchange	services.runescape.com/m=itemdb_rs/results?query={s}
rsit	RS Components Italy	it.rs-online.com/web/c/?searchTerm={s}
rsnl	RS Components (NL)	nl.rs-online.com/web/c/?searchTerm={s}
rsnz	RS Components NZ	nz.rs-online.com/web/c/?sra=oss&r=t&searchTerm={s}
rspb	RSPB	www.rspb.org.uk/search/?q={s}
rsph	RS Components Philippines	ph.rs-online.com/web/c/?searchTerm={s}
rspt roblox robloxg	Roblox Games	www.roblox.com/discover/?Keyword={s}
rstc rosettacode	RosettaCode.org	rosettacode.org/w/index.php?search={s}&title=Special:Search&wprov=acrw1
rsuk	RadioSpare UK	uk.rs-online.com/web/c/?sra=oss&r=t&searchTerm={s}
rsza	RS Components South Africa	za.rs-online.com/web/c/?sra=oss&r=t&searchTerm={s}
rtbf	RTBF Info	www.rtbf.be/info/recherche?q={s}
rtfr	Rakuten France	fr.shopping.rakuten.com/s/{s}
rusr	Reddit Users	www.reddit.com/user/{s}/
rust rustd rustdoc ruststd	RustDocs	doc.rust-lang.org/std/?search={s}
ruth	Ruth's Attic	www.billygrahambookstore.org/catalogsearch/result/?q={s}
rvcc	Raritan Valley Community College	raritanval.edu/rvcc/search.aspx?searchtext={s}
rwth	RWTH Aachen University	www.rwth-aachen.de/ca/be/hx/?lidx=&institution=RWTH+Aachen+University&search={s}
rymf rymfilms rateyourfilms	Rate Your Music (films)	rateyourmusic.com/search?searchtype=F&searchterm={s}
rymr	Rate Your Music (All releases)	rateyourmusic.com/search?searchtype=l&searchterm={s}
rztk	Rozetka.com.ua	rozetka.com.ua/ua/search/?text={s}
s-on sson	DuckDuckGo Safe Search: On	duckduckgo.com/?q={s}&kp=1
sacl	SA Country Life	www.countrylife.co.za/?s={s}
saki	Suomi Sanakirja	www.suomisanakirja.fi/{s}
salt	SaltStack	cse.google.com/cse?cx=011515552685726825874:ht0p8miksrm&q={s}
sana sanakirja	Sanakirja.org	www.sanakirja.org/search.php?q={s}
saol svao	Svenska akademieons ordlista	svenska.se/tre/?sok={s}
sapo	SAPO	pesquisa.sapo.pt/?barra=&q={s}
saxo	SAXO.com	www.saxo.com/dk/products/search?query={s}
sbbb	SBB StationBoard	dev.eoils.de/contents/b/index.php?station={s}
sbit	Spend a Bit	spendabit.co/go?q={s}
sbyt	Socialblade YouTube	socialblade.com/youtube/user/{s}
scan	Scan	www.scan.co.uk/search.aspx?q={s}
sccl	Sana Clara County Library District	sccl.bibliocommons.com/search/?t=smart&searchOpt=catalogue&q={s}&search_category=keyword
schp	Scholarpedia	scholarpedia.org/w/index.php?search={s}
scid scidir sdirect scdirect scidirect sciencedirect	ScienceDirect	www.sciencedirect.com/search?qs={s}
scin	Scinapse	scinapse.io/search?query={s}
scmp	South China Morning Post	www.scmp.com/content/search/{s}
sdcl ensdcl	San Diego County Library (EN)	sdcl.bibliocommons.com/v2/search?query={s}
sdl2	SDL2 Wiki	wiki.libsdl.org/FrontPage?action=fullsearch&context=180&value={s}&titlesearch=Titles
sdnf	Student Doctor Network forums	forums.studentdoctor.net/search/86811885/?q={s}
se.w	Simple English Wikipedia (short bang)	simple.wikipedia.org/wiki/{s}
se80	SAP Development Objects	www.se80.co.uk/action/search_results.htm?q={s}
sech	Search.ch	www.search.ch/?q={s}
seda	SnapEDA	www.snapeda.com/search/?q={s}&search-type=parts
sedo	Sedo	sedo.com/search/?keyword={s}
seek	Seek	www.seek.com.au/JobSearch?SearchFrom=quick&Keywords={s}
seen	SeenThis	seenthis.net/spip.php?page=recherche&recherche={s}
sega	SegaRetro	segaretro.org/index.php?search={s}
senc encrypt	Search Encrypt	www.searchencrypt.com/search?eq={s}
seur	Seur	www.seur.com/seguimiento-online.do?segOnlineIdentificador={s}
sfcl	Craigslist - SF bay area	sfbay.craigslist.org/search/sss?query={s}
sfpl	San Francisco Public Library	sfpl.bibliocommons.com/v2/search?searchType=smart&query={s}
sfse	Salesforce Stack Exchange	salesforce.stackexchange.com/search?q={s}
sgdb	SteamGridDB	www.steamgriddb.com/search/grids?term={s}
shaw	Shaw	www.shaw.ca/store/search/search.jsp?q={s}
shbd	Shabdkosh	www.shabdkosh.com/translate/{s}/
shbf	SHBF:s bryggarforum	shbf.se/bryggaren/search.php?keywords={s}&sid=7fb2bed909445b5497565d97ea00eb62
shmf	SHM Forum	forum.shmakerspace.org/search?q={s}
shop	Yahoo! Shopping	shopping.yahoo.com/search?p={s}
shsh	TSS Saver	stor.tsssaver.1conan.com/shsh/{s}/
shtm	Shoptimate	www.shoptimate.com/search?q={s}
shub	ScribbleHub	www.scribblehub.com/?s={s}
sice	staticICE	www.staticice.com.au/cgi-bin/search.cgi?q={s}
siri	Should I remove It?	www.shouldiremoveit.com/programs.aspx?q={s}
sk24	sportkopf24	www.sportkopf24.de/?ActionCall=WebActionArticleSearch&Params[SearchParam]={s}
sktr	sketchappsources	www.sketchappsources.com/search_{s}.html
slaw	Slaw	www.slaw.ca/?s={s}
slcl	St. Louis County Library	www.slcl.org/bento/search/{s}
slds	Salesforce Lightning Design System	www.lightningdesignsystem.com/components/{s}
slnl strategischlui	Strategisch Lui	strategischlui.nl/?s={s}
slub	SLUB Katalog	katalogbeta.slub-dresden.de/?tx_find_find[q][default]={s}
smag	sciencemag	science.sciencemag.org/search/{s}
smap	Streetmap	streetmap.co.uk/postcode/{s}
smdb	Svensk Mediedatabas	smdb.kb.se/catalog/search?q={s}
smhi	SMHI - Swedish Meteorological and Hydrological Institute	www.smhi.se/sok?query={s}
smog	Smogon University	www.smogon.com/search/?q={s}
smpl	Santa Monica Public Library	smpl.bibliocommons.com/search?t=smart&search_category=keyword&q={s}
smre	swissmilk - Rezepte	www.swissmilk.ch/de/alle-rezepte/suche/?qt={s}&cat=Rezept+Suche&qd=1
snap	Snapzu.com	snapzu.com/find/{s}
sncr snaps snappy snapcraft	Snapcraft	snapcraft.io/search?q={s}
snih	StartPage Web Search(Japanese)	www.startpage.com/do/search?q={s}&l=nihongo
snit	Sinonimi - Contrari	www.sinonimi-contrari.it/{s}/
snrt	snort.org	www.snort.org/search?query={s}&submit_search=
socp	Stack Overflow Careers (Company Pages)	careers.stackoverflow.com/companies?searchTerm={s}
soff	DuckDuckGo SafeOff	duckduckgo.com/?kp=-2&q={s}
sojs	Stack Overflow JavaScript	stackoverflow.com/search?q=[javascript]+{s}
solo	SOLO: Search Oxford Libraries Online	solo.bodleian.ox.ac.uk/primo-explore/search?query=any,contains,{s}&tab=local&search_scope=LSCOP_ALL&vid=SOLO&lang=en_US&offset=0
some	someecards	www.someecards.com/search?q={s}
soop	SOOP	www.sooplive.com/search?szKeyword={s}
soph	Sophos	www.sophos.com/en-us/search-results.aspx?search={s}
sopy	Stack Overflow Python	stackoverflow.com/search?q=[python]+{s}
soso	Soso	www.soso.com/q?pid=s.idx&w={s}
souq	Souq	uae.souq.com/ae-en/{s}/s/?as=1
soxl	Stack Overflow MS Excel Search	stackoverflow.com/search?q=[excel]+{s}
spen	StartPage (EN)	startpage.com/do/dsearch?query={s}&cat=web&pl=opensearch&language=english
spin	Spin.de	www.spin.de/search?q={s}
spit	Startpage (IT)	startpage.com/do/search?cat=web&cmd=process_search&language=italiano&engine0=v1all&query={s}&abp=-1&prf=ab8a0a99ccae7d38fd1f9b31e845ce7e&SuggestOn=1
splc	The Southern Poverty Law Center	www.splcenter.org/resources?keyword={s}
spnl	Startpage NL	startpage.com/do/search?l=nederlands&q={s}
spon spiegel	www.spiegel.de	www.spiegel.de/suche/index.html?suchbegriff={s}
sppl	Startpage (PL)	www.startpage.com/do/dsearch?query={s}&cat=web&pl=opensearch&language=polski
sprd spreadshirt	Spreadshirt	www.spreadshirt.com/{s}
sptv	Samaritan Purse TV	video.samaritanspurse.org/?s={s}
srch	admin.ch - Systematische Rechtssammlung	www.admin.ch/opc/search/?lang=de&language[]=de&product[]=fg&product[]=oc&product[]=cc&product[]=ba&product[]=jcd&date_range_min=&date_range_max=&d_compilation=both&d_is_in_force=yes&text={s}
srd5	Hypertext D20 SRD (5th Edition)	5e.d20srd.org/search.htm?q={s}
srec	Software Recommendations	softwarerecs.stackexchange.com/search?q={s}
srfi	Scheme Request for Implementation	srfi.schemers.org/?q={s}
srhu	Google Translate (srhu)	translate.google.com/#sr/hu/{s}
sskj	Bos.zrs-sazu.si	bos.zrc-sazu.si/cgi/a03.exe?name=sskj_testa&expression={s}&hs=1
stan	Stan	play.stan.com.au/programs{s}
stax	Stax Trade Centers	www.staxtradecentres.co.uk/search/?keys={s}
stcm steamsc steamcommunity	Steam Community	steamcommunity.com/actions/Search?K={s}
stib	STIB MIVB	www.stib-mivb.be/horaires-dienstregeling2.html?l=en&linecode={s}
stlf	STLFinder	www.stlfinder.com/?search={s}
strm	The Stream	stream.org/?s={s}
stsw	Slay the Spire Wiki	slaythespire.wiki.gg/wiki/Special:Search?search={s}
stws	Super Teacher Worksheets	www.superteacherworksheets.com/search-results.html?srch_words={s}
sumc	Shared-Use Mobility Center (SUMC) Mobility on Demand Learning Center	learn.sharedusemobilitycenter.org/search/?keyword={s}
susi	Susi	susi.at/suche/{s}/
susy	Susy	susydocs.oddbird.net/en/latest/?q={s}
svde	Google Translate	translate.google.com/#sv/de/{s}
sven	Google Translate (Swedish to English)	translate.google.com/#sv/en/{s}
svgl	svgl	svgl.app/?search={s}
svpt	Google Translate - Swedish to Portoguese	translate.google.se/#sv/pt/{s}
svtn	Svt Nyheter	www.svt.se/search/?q={s}
swag	Shopware Forum	forum.shopware.com/search?Search={s}
swap swappa	Swappa	swappa.com/search?q={s}
swdb	The Spaghetti Western Database	www.spaghetti-western.net/index.php?title=Special:Search&search={s}&go=Go
swtl	Switch Technology	swtl.pt/web/index.php?route=product/isearch&search={s}
swtr sweetwater	Sweetwater	www.sweetwater.com/store/search.php?s={s}
sxsw	SXSW Schedule	schedule.sxsw.com/2019/search?q={s}
syfr	Synonymes.com	www.synonymes.com/resultats.php?mot={s}
symb symolab symbolab	Symbolab	www.symbolab.com/solver/step-by-step/{s}
synf crisco synonyme	CRISCO Dictionnaire Electronique des Synonymes	www.crisco.unicaen.fr/des/synonymes/{s}
syno	Synonymo.fr	www.synonymo.fr/syno/{s}
sysk	Stuff You Should Know	www.stuffyoushouldknow.com/search.php?terms={s}
szns	slovnik.seznam.cz	slovnik.seznam.cz/?q={s}
taal taaladvies	Taaladvies.net	taaladvies.net/taal/advies/zoek.php?q={s}
tagi	tagesanzeiger	www.tagesanzeiger.ch/service/suche/suche.html?date=alle&order=date&key={s}
taid	Therapist Aid	www.therapistaid.com/search?query={s}
tain	Tripadvisor.in	www.tripadvisor.in/Search?q={s}
tait	Tripadvisor.it	www.tripadvisor.it/Search?q={s}
tako takoboto	TAKOBOTO	takoboto.jp/?q={s}
talg	Tiger Algebra	tiger-algebra.com/drill/{s}/
tato tatoeba tatoebla	Tatoeba	tatoeba.org/sentences/search?query={s}
tauk	TripAdvisor (UK)	www.tripadvisor.co.uk/Search?q={s}
tawk tawiki wikita	Tamil Wikipedia	ta.wikipedia.org/w/index.php?search={s}
taxi	Taxi.it	www.taxi.it/?s={s}
tbde	Tesberichte.de	www.testberichte.de/d/search.php?searchstr={s}
tbio	Treccani Biografie	www.treccani.it/biografie/?q={s}
tcdb	The Trading Card Database	www.tradingcarddb.com/Search.cfm?q={s}
tcgp tcgplayer	TCGPlayer	shop.tcgplayer.com/productcatalog/product/show?newSearch=false&ProductType=All&IsProductNameExact=false&ProductName={s}
tchi	Tchibo	www.tchibo.de/search?query={s}
tcol	todocoleccion	www.todocoleccion.net/buscador?bu={s}
tcrf	The Cutting Room Floor	tcrf.net/index.php?search={s}
temu	Temu	www.temu.com/search_result.html?search_key={s}
tena	Tennis abstract	www.tennisabstract.com/cgi-bin/player.cgi?p={s}
tera	Tera Wiki	tera.wikia.com/wiki/Special:Search?query={s}
terp	BrettTerpstra.com	brettterpstra.com/search/?q={s}
tf2r	Team Fortress 2 subreddit	www.reddit.com/r/tf2/search?q={s}&restrict_sr=on
tf3d	Free3d	free3d.com/3d-models/{s}
tfes	The Flat Earth Society forum	forum.tfes.org/index.php?action=search2;search={s}
tftv	TeamFortress.tv	www.teamfortress.tv/search?q={s}
tgdb	TheGamesDB	thegamesdb.net/search/?string={s}&function=Search
thai	thai-language.com	www.thai-language.com/default.aspx?search={s}
then	Google Translate (TH-EN)	translate.google.com/#th/en/{s}
thgw	Tony Hawk Games Wiki	tonyhawkgames.wikia.com/wiki/Special:Search?search={s}
tiho	TiHo-OPAC	opac.tib.uni-hannover.de/DB=5/LNG=DU/SID=40343eab-1/CMD?ACT=SRCHA&IKT=1016&SRT=YOP&TRM={s}
tiki	Tiki	tiki.vn/search?q={s}
time timestamp	Unix Timestamp	unixtimestamp.com/?unixTimestampInput={s}
tine	Tine	www.tine.no/sok?q={s}
tink	Tinkercad	www.tinkercad.com/search?q={s}
tiss	tiss.tuwien.ac.at	tiss.tuwien.ac.at/adressbuch/adressbuch/suche?suchtext={s}
tivi	Tivi	www.tivi.fi/haku/?q={s}
tkpd toped tokopedia	Tokopedia	www.tokopedia.com/search?q={s}
tldp	The Linux Documentation Project	www.google.com/cse?cx=017644269519104757279:gm62gtzaoky&q={s}
tldr	Tldr	tldr.inbrowser.app/search?query={s}
tlfi cnrtl cntrl cnrtld	Centre national de ressources textuelles et lexicales	www.cnrtl.fr/definition/{s}
tlib toolslib	ToolsLib	toolslib.net/search/projects/?q={s}
tlld	Trainline Live Departures	www.thetrainline.com/live/departures/{s}
tlni	Translink NI	www.translink.co.uk/timetables?Name={s}
tman	Trello help	help.trello.com/search?query={s}
tmbw	This MIght Be a Wiki	tmbw.net/wiki/Special:Search?search={s}&x=0&y=0
tmdb themoviedb	TheMovieDB.org	www.themoviedb.org/search?query={s}
tmen	Transfermarkt.com	www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query={s}
tmuk trfuk	Transfermarkt	www.transfermarkt.co.uk/schnellsuche/ergebnis/schnellsuche?query={s}&x=0&y=0
tome	Tales of Maj'Eyal	te4.org/w/index.php?search={s}
topl babpl	Bab.la	pl.bab.la/slownik/angielski-polski/{s}
tori	Tori	www.tori.fi/recommerce/forsale/search?q={s}
tost	Toster	toster.ru/search?q={s}
trad refreb	Reverso French - English	dictionary.reverso.net/french-english/{s}
trap trapper trapping	Trapper's Report	www.trappersreport.com/?q={s}
trep timerep timerepublik	Timerepublik	timerepublik.com/?q={s}
trip	Trip Database	www.tripdatabase.com/search?criteria={s}
trpl	Translatica	translatica.pl/szukaj/{s}
true	Truecaller India	www.truecaller.com/search/in/{s}
ts21	teeshirt21	teeshirt21.com/shop/{s}
tsbb ttbi sinonim tesaurus	Tesaurus Tematis Badan Bahasa Indonesia	tesaurus.kemendikdasmen.go.id/tematis/lema/{s}
tsco	Tractor Supply Co	www.tractorsupply.com/tsc/search/{s}
tsin	Treccani Sinonimi e Contrari	www.treccani.it/sinonimi/?q={s}
tube	BitTube	bit.tube/results?term={s}
tuda	TU Darmstadt	www.tu-darmstadt.de/suche.de.jsp?q={s}
tuhh	tuhh.de	www.tuhh.de/tuhh/suche/suchergebnis.html?cx=013498366615220259019:ljc1ircsxvi&ie=utf8&hl=de&q={s}
tuts	Tuts+	hub.tutsplus.com/search?utf8=%E2%9C%93&view=grid&search[keywords]={s}
tvdb	TheTVDB.com	www.thetvdb.com/search?query={s}&l=en
tvnz	TVNZ OnDemand	www.tvnz.co.nz/search?q={s}
tvoc	Treccani Vocabolario	www.treccani.it/vocabolario/tag/{s}/
tvst	TVShow Time	www.tvshowtime.com/en/search?q={s}
twfy theyworkforyou	TheyWorkForYou	www.theyworkforyou.com/search/?q={s}
twig	Twig	twig.symfony.com/{s}
twlb	Tweak Library	tweaklibrary.com/?s={s}
twrv	The Wandering RV	www.thewanderingrv.com/search/{s}
uaar	UAAR	www.uaar.it/news/?s={s}
ucfl	University of Central Florida	search.ucf.edu/#?q={s}
ucsc	UCSC Genome Browser (GRCH38)	genome.ucsc.edu/cgi-bin/hgTracks?db=hg38&position={s}
udev	Ubuntu Developer	developer.ubuntu.com/en/search/?q={s}
uesp teswiki elderwiki	The Unofficial Elder Scrolls Pages	en.uesp.net/w/index.php?title=Special%3ASearch&search={s}
ufrj	Universidade Federal do Rio de Janeiro	www.ufrj.br/buscagoogle2.php?q={s}
uiba	Uiba	uiba.co/?s={s}
ukgr	UK Grid Reference	gridreferencefinder.com/bing.php?gr={s}
ulbh ulbda	ULB TU Darmstadt	hds.hebis.de/ulbda/Search/Results?lookfor={s}&service=catalog
ulta	Ulta	www.ulta.com/ulta/a/_/Ntt-{s}/Nty-1?Dy=1&ciSelector=searchResults
uman	Ubuntu Manpage	manpages.ubuntu.com/cgi-bin/search.py?q={s}
uncg	University of North Caroline at Greensboro	search.uncg.edu/search?q={s}&site=default_collection&client=default_frontend&output=xml_no_dtd&proxystylesheet=default_frontend
unic unicodetable	Unicode Table	unicode-table.com/en/search/?q={s}
unix	The Unix Tree	minnie.tuhs.org/cgi-bin/utree.pl?filesearch={s}&submit=Go
uoal	University of Alberta Library	search.library.ualberta.ca/symphony?q={s}
uoel	University of Edinburgh Libraries DiscoverEd Catalogue	discovered.ed.ac.uk/discovery/search?query=any,contains,{s}&tab=Everything&search_scope=UoE&vid=44UOE_INST:44UOE_VU2&offset=0
upkg	Ubuntu Launchpad Package Page	launchpad.net/ubuntu/+source/{s}
upng	University of Papua New Guinea	www.upng.ac.pg/site/component/search/?searchword={s}&searchphrase=all&Itemid=101
usal	usal	www.usal.es/webusal/usal_buscador?query={s}
used	Machineseeker.com - Used machinery search engine	www.machineseeker.com/fy/inserat/inseratliste/index?stichwort={s}&submit=
usps	USPS	tools.usps.com/go/TrackConfirmAction?qtc_tLabels1={s}
usyd	The University of Sydney	sydney.edu.au/s/search.html?collection=Usyd&query={s}
utf8 unicode	Unicode Character Search	www.fileformat.info/info/unicode/char/search.htm?q={s}&preview=entity
utno	UT.no - Outdoors for all	ut.no/finn?search={s}
utos	OpenStore	open-store.io/?sort=relevance&search={s}
uvac uvalib	University of Virginia Library Catalog	search.lib.virginia.edu/search?q=keyword:+{{s}}&pool=uva_library&sort=SortRelevance_desc
uvic	The University of Victoria	www.uvic.ca/search/q/web.php?q={s}&t=4&p=1&g=true
uwmc	Unlimitedworld	unlimitedworld.de/search/1786851/?q={s}
vagw	Vagonweb	www.vagonweb.cz/razeni/razeni.php?jmeno={s}&najit=Suchen
vani	Vanilla WoW DB	vanillawowdb.com/?search={s}
vans	Vans	www.vans.com/webapp/wcs/stores/servlet/VFSearchDisplay?storeId=10153&catalogId=10703&langId=-1&beginIndex=0&searchSource=Q&sType=SimpleSearch&searchTerm={s}
vape	www.vapeoildirect.co.uk	www.vapeoildirect.co.uk/?s={s}
vcru	vc.ru	vc.ru/search/{s}
vdnf	Vandale	www.vandale.nl/opzoeken?pattern={s}&lang=nf
vemo	Vemo.it forniture alberghiere	www.vemo.it/cerca.php?prodotto={s}
verb conjen verbomatic	conjugator.reverso.net	conjugator.reverso.net/conjugation-english-verb-{s}.html
verk verkkis verkkokauppa	Verkkokauppa.com	www.verkkokauppa.com/fi/search/?query={s}
vevo	Vevo	www.youtube.com/user/VEVO/search?query={s}
vgpc	Video Game Price Charts	www.pricecharting.com/search-products?type=prices&q={s}&sort=popularity&broad-category=video-games&console-uid=&exclude-variants=false&region-name=all&show-images=true
vhck	victorhckinthefreeworld	victorhckinthefreeworld.wordpress.com/?s={s}
viaf	VIAF (Virtual Internet Authority File)	viaf.org/en/viaf/search?field=local%2Cnames&index=VIAF&searchTerms={s}
vibe	Vibe	vibe.naver.com/search?query={s}
vic2	Victoria 2 Wiki	vic2.paradoxwikis.com/index.php?search={s}
vice	Vice	www.vice.com/en_us/search?q={s}
vimw	Vim Tips wiki	vim.wikia.com/wiki/Special:Search?query={s}
ving	Ving	www.ving.no/websearchresult?q={s}
viso	Vi @ stackExchange	vi.stackexchange.com/search?q={s}
viul	Vancouver Island University Library	viu.summon.serialssolutions.com/search?s.q={s}
vivo	Vikia Vortaro	www.kono.be/cgi-bin/vivo/ViVo.cgi?lingvo=eo&esprimo={s}
vmkb	VMware Knowledge Base	kb.vmware.com/s/global-search/@uri#q={s}
vndb	VNDB	vndb.org/v/all?sq={s}
voan	Voice of America News	www.voanews.com/s?k={s}&tab=all&pi=1&r=any&pp=10
voda	Vodafone.it	www.vodafone.it/area-utente/appmanager/fai-da-te/Common?_nfpb=true&_pageLabel=P5000626721379247340997&categoryId=&pageNumber=&slideNumber=&defaultView=true&searchQuery={s}
void voidwiki	Void GNU/Linux	wiki.voidlinux.org/index.php?search={s}
vote	Vote	vote.us.org/search/?q={s}
vsun	vancouversun.com	www.vancouversun.com/search/search.html?q={s}
vtfc	Va te faire conjuguer	www.vatefaireconjuguer.com/search?verb={s}
vtip	VirusTotal IP	www.virustotal.com/gui/ip-address/{s}
vtmb	Vampire: The Masquerade - Blooslines wiki	vtmb.wikia.com/wiki/Special:Search?query={s}
vudu	Vudu	www.vudu.com/content/movies/search?searchString={s}
w.br	Wikipedia (BR)	pt.wikipedia.org/wiki/{s}
w2fr	WIKI2 Fr	fr.wiki2.org/w/index.php?search={s}
wals alswiki wikials	Alemannic Wikipedia	als.wikipedia.org/w/index.php?search={s}
wang angwiki wikiang	Old English Wikipedia	ang.wikipedia.org/w/index.php?search={s}
wapf	Weston A Price Foundation	www.westonaprice.org/?s={s}
wapp	WhatsApp	api.whatsapp.com/send?phone={s}&text=
wary arywiki wikiary	Moroccan Arabic Wikipedia	ary.wikipedia.org/w/index.php?search={s}
warz arzwiki wikiarz	Egyptian Arabic Wikipedia	arz.wikipedia.org/w/index.php?search={s}
wast astwiki wikiast	Asturian Wikipedia	ast.wikipedia.org/w/index.php?search={s}
wave	WAVE	wave.webaim.org/report#/{s}
wazb azbwiki wikiazb	South Azerbaijani Wikipedia	azb.wikipedia.org/w/index.php?search={s}
wban banwiki wikiban	Balinese Wikipedia	ban.wikipedia.org/w/index.php?search={s}
wbar barwiki wikibar	Bavarian Wikipedia	bar.wikipedia.org/w/index.php?search={s}
wbcl bclwiki wikibcl	Central Bikol Wikipedia	bcl.wikipedia.org/w/index.php?search={s}
wbde	Wikibooks De	de.wikibooks.org/w/index.php?search={s}
wbgw	Wooledge - Greg's Wiki	mywiki.wooledge.org/EnglishFrontPage?action=fullsearch&context=180&value={s}&titlesearch=Titles
wbml	Wikibooks Malayalam	ml.wikibooks.org/wiki/special:search/{s}
wbmp	Webmasterparadies.de	webmasterparadies.de/?s={s}
wbur	WBUR	www.wbur.org/search?q={s}
wceb cebwiki wikiceb	Cebuano Wikipedia	ceb.wikipedia.org/w/index.php?search={s}
wckb ckbwiki wikickb	Sorani Kurdish Wikipedia	ckb.wikipedia.org/w/index.php?search={s}
wcme pyspark	PySpark documentation	spark.apache.org/docs/latest/api/python/search.html?q={s}
wcrh crhwiki wikicrh	Crimean Tatar Wikipedia	crh.wikipedia.org/w/index.php?search={s}
wdag dagwiki wikidag	Dagbani Wikipedia	dag.wikipedia.org/w/index.php?search={s}
wdex	Pokemon Wiki	es.pokemon.wikia.com/wiki/Especial:Buscar?query={s}
wdtk	What Do They Know	www.whatdotheyknow.com/search/{s}/all
wes1 weslib	Wesleyan Library OneSearch	wesleyan.summon.serialssolutions.com/search?utf8=%E2%9C%93&s.q={s}
wesu	Wesleyan University	www.wesleyan.edu/search/search-results.html?q={s}
weus	Wikipedia Euskaraz (in Basque)	eu.wikipedia.org/wiki/Special:Search?search={s}
wfde	Warframe Wiki (DE)	de.warframe.wikia.com/wiki/Spezial:Suche?search={s}
wgbh	WGBH News	wgbhnews.org/search/google/{s}
wguc gucwiki wikiguc	Wayuu Wikipedia	guc.wikipedia.org/w/index.php?search={s}
whde	Wikihow DE	de.wikihow.com/wikiHowTo?search={s}:
whfr	wikiHow France	fr.wikihow.com/wikiHowTo?search={s}
whif hifwiki wikihif	Fiji Hindi Wikipedia	hif.wikipedia.org/w/index.php?search={s}
whip wordhippo	Wordhippo	www.wordhippo.com/what-is/another-word-for/{s}.html
whlp whirlpool	Whirlpool Forums	forums.whirlpool.net.au/forum/?action=search&q={s}
whnl	wikiHow Dutch	nl.wikihow.com/wikiHowTo?search={s}
wiby	Wiby	wiby.me/?q={s}
wiht hosting whohosts	WhoIsHostingThis	www.whoishostingthis.com/?q={s}
wikt wten wtla wikten wiktionary	Wiktionary Search	en.wiktionary.org/wiki/Special:Search?search={s}&go=Define
wimp	wimp.com	www.wimp.com/search/{s}
winc	Wikimedia Incubator	incubator.wikimedia.org/w/index.php?title=Special:Search&search={s}
wind	Wind	www.wind.gr/search?_dyncharset=utf-8&Dy=1&Ntt={s}
wine	Wine AppDB	winehq.org/search?q={s}
wion	WION	www.wionews.com/search?q={s}
wire	The Wire	www.thewire.co.uk/search/?q={s}
wish	Wish	www.wish.com/search/{s}
wjec	WJEC	www.wjec.co.uk/search/pf_search.php?q={s}
wkaa kaawiki wikikaa	Karakalpak Wikipedia	kaa.wikipedia.org/w/index.php?search={s}
wkan	Wikisage nl	nl.wikisage.org/w/index.php?search={s}&title=Speciaal:Zoeken&go=OK
wkit	Wiktionary (Italian)	it.wiktionary.org/w/index.php?search={s}
wlde	TV Wunschliste	www.wunschliste.de/suche/{s}
wlfr	Wikiloc French	fr.wikiloc.com/wikiloc/find.do?q={s}
wlhb willhaben	Willhaben	www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz?keyword={s}&x=0&y=0
wlmo lmowiki wikilmo	Lombard Wikipedia	lmo.wikipedia.org/w/index.php?search={s}
wmai maiwiki wikimai	Maithili Wikipedia	mai.wikipedia.org/w/index.php?search={s}
wmcc	Wikimedia Commons Category	commons.wikimedia.org/w/index.php?search={s}&ns14=1
wmde	Wikipedia Deutsch Mobile	de.m.wikipedia.org/w/index.php?search={s}
wmfr	Wikipedia French mobile	fr.m.wikipedia.org/w/index.php?search={s}
wmid	WebMoney Transfer	passport.webmoney.ru/asp/CertView.asp?wmid={s}
wmin minwiki wikimin	Minangkabau Wikipedia	min.wikipedia.org/w/index.php?search={s}
wmse	Mathematica Stack Exchange	mathematica.stackexchange.com/search?q={s}
wmsr	Wikipedia Mobile (Serbia)	sr.m.wikipedia.org/wiki/{s}
wmwl mwlwiki wikimwl	Mirandese Wikipedia	mwl.wikipedia.org/w/index.php?search={s}
wmzn mznwiki wikimzn	Mazanderani Wikipedia	mzn.wikipedia.org/w/index.php?search={s}
wnds ndswiki wikinds	Low German Wikipedia	nds.wikipedia.org/w/index.php?search={s}
wnyc	WNYC	www.wnyc.org/search/?q={s}
wobs arcanum	Words of Brandon (WoBs)	wob.coppermind.net/adv_search/?query={s}
wolw	West of Loathing Wiki	westofloathing.gamepedia.com/index.php?search={s}
wood	The Wood Database	www.wood-database.com/?s={s}
wook	Wook	www.wook.pt/pesquisa/{s}
worm	Wormbase	www.wormbase.org/species/c_elegans/gene/{s}
wort	Wort suchen	www.wort-suchen.de/kreuzwortraetsel-hilfe/loesungen/{s}/
wosc	Web of Science	gateway.webofknowledge.com/gateway/Gateway.cgi?GWVersion=2&SrcApp=WEB&SrcAuth=ProQuest&DestApp=UA&DestLinkType=GeneralSearchSummary&topic={s}
wowh wowhead	WowHead	www.wowhead.com/search?q={s}
wpfr	Wikipedia (FR)	fr.wikipedia.org/wiki/{s}
wpms pmswiki wikipms	Piedmontese Wikipedia	pms.wikipedia.org/w/index.php?search={s}
wpnb pnbwiki wikipnb	Western Punjabi Wikipedia	pnb.wikipedia.org/w/index.php?search={s}
wppl	Wirtualn Polska	szukaj.wp.pl/szukaj.html?q={s}
wpse	WordPress StackExchange	wordpress.stackexchange.com/search?q={s}
wptf wpts wptfyi	wpt.fyi	wpt.fyi/results/?q={s}
wqde	Wikiquote German	de.wikiquote.org/w/index.php?search={s}&title=Spezial:Suche
wqit	WikiQuote Italian	it.wikiquote.org/?q={s}:
wref wenfr wrenfr	Wordreference (en-fr)	www.wordreference.com/enfr/{s}
wrei wrenit	Word Reference EN-IT	www.wordreference.com/enit/{s}
wrep wrpten	Word Reference English to Portuguese	www.wordreference.com/pten/{s}
wrfe wfren wrfren	Wordreference (fren)	www.wordreference.com/fren/{s}
wrie writen writes	Word Reference IT-EN	www.wordreference.com/iten/{s}
writ	WordReference (IT definition)	www.wordreference.com/definizione/{s}
wrpe wrenpt	WordReference (enpt)	www.wordreference.com/enpt/{s}
wrro	White Rose Research Online	eprints.whiterose.ac.uk/cgi/search/simple?full={s}&_action_search=Search&_order=bytitle&basic_srchtype=ALL&_satisfyall=ALL
wrse	Wordreference (en-es)	www.wordreference.com/enes/{s}
wrsf wresfr	WordReference (esfr)	www.wordreference.com/esfr/{s}
wrss essin wressin sinonimo	Word Reference Sinonimos	www.wordreference.com/sinonimos/{s}
wrue ruewiki wikirue	Rusyn Wikipedia	rue.wikipedia.org/w/index.php?search={s}
wrze	WordReference (zh-en)	www.wordreference.com/zhen/{s}
wsah sahwiki wikisah	Yakut Wikipedia	sah.wikipedia.org/w/index.php?search={s}
wsat satwiki wikisat	Santali Wikipedia	sat.wikipedia.org/w/index.php?search={s}
wscn scnwiki wikiscn	Sicilian Wikipedia	scn.wikipedia.org/w/index.php?search={s}
wsco scowiki wikisco	Scots Wikipedia	sco.wikipedia.org/w/index.php?search={s}
wsde	Wikisource Deutsch	de.wikisource.org/w/index.php?search={s}
wsem	Wesley Theological Seminary	www.wesleyseminary.edu/?s={s}
wsgf	Widescreen Gaming Forum	www.wsgf.org/mgl?title_op=contains&game_name={s}
wsws	Word Socialist Web Site	www.wsws.org/en/search.html?sectionId=&maxResults=100&phrase={s}&submit=Search
wszh	Wikisource (ZH)	zh.wikisource.org/wiki/Special:Search?search={s}
wszl szlwiki wikiszl	Silesian Wikipedia	szl.wikipedia.org/w/index.php?search={s}
wtbr	Wiktkionary e brezhoneg	br.wiktionary.org/wiki/{s}
wtca	Wiktionary Catalan	ca.wiktionary.org/wiki/{s}
wtcz	Wiktionary (Czech)	cs.wiktionary.org/wiki/{s}
wtde wktde	Wiktionary German	de.wiktionary.org/w/index.php?search={s}
wtel	Wiktionary (Greek)	el.wiktionary.org/wiki/{s}
wteo wikteo	Vikivortaro	eo.wiktionary.org/w/index.php?search={s}
wtes wiktes	Wikcionario	es.wiktionary.org/w/index.php?search={s}
wtfi	Wiktionary (Finnish)	fi.wiktionary.org/w/index.php?search={s}&title=Toiminnot:Haku
wtit wiktit	Wikizionario	it.wiktionary.org/w/index.php?search={s}&title=Speciale:Ricerca
wtja wiktja	Wiktionary (Japan)	ja.wiktionary.org/wiki/{s}
wtnl	WikiWoordenboek	nl.wiktionary.org/w/index.php?search={s}
wtno	Wiktionary (Norwegian)	no.wiktionary.org/wiki/index.php?title=Special:Search&search={s}
wtpl	Wiktionary (PL)	pl.wiktionary.org/w/index.php?search={s}
wtro	Wiktionary (RO)	ro.wiktionary.org/wiki/{s}
wtru	ru.wiktionary.org	ru.wiktionary.org/wiki/Special:Search?search={s}&go=Go
wttr wttr.in	wttr.in	wttr.in/{s}
wtzh	Wiktionary (Chinese)	zh.wiktionary.org/w/index.php?search={s}
wurm	Wurmpedia	wurmpedia.com/index.php?search={s}&fulltext=Search&title=Special:Search
wvde	Wikivoyage Deutsch	de.wikivoyage.org/w/index.php?search={s}
wvec vecwiki wikivec	Venetian Wikipedia	vec.wikipedia.org/w/index.php?search={s}
wven wikivoyageen	Wikivoyage (English)	en.wikivoyage.org/w/index.php?search={s}&title=Special:Search&go=Go
wvit	Wikivoyage Italiano	it.wikivoyage.org/w/index.php?search={s}
wvnl	Wikivoyage Nederlands	nl.wikivoyage.org/w/index.php?search={s}
wvru	Wikivoyage Russian	ru.wikivoyage.org/w/index.php?search={s}
wvsv	Wikivoyage Svenska	sv.wikivoyage.org/w/index.php?search={s}
wwar warwiki wikiwar	Waray Wikipedia	war.wikipedia.org/w/index.php?search={s}
wwbw	WoodwindsBrasswinds	www.wwbw.com/Search/Default.aspx?src={s}
wwdc	ASCIIwwdc	asciiwwdc.com/search?q={s}
wwde	Wikiwand in Deutsch	www.wikiwand.com/de/{s}
wwfr	Wikiwand	www.wikiwand.com/fr/{s}
wwnl	WikiWand in Dutch	www.wikiwand.com/nl/{s}
wwuu wikiwuu wuuwiki	Wu Wikipedia	wuu.wikipedia.org/w/index.php?search={s}
wwzh	WikiWand in Chinese	www.wikiwand.com/zh/{s}
wxmp	search wechat miniprogram documents	developers.weixin.qq.com/doc/search.html?query={s}
wynn	Wynncraft Wiki	wynncraft.wiki.gg/index.php?search={s}
wzgh wikizgh zghwiki	Moroccan Amazigh Wikipedia	zgh.wikipedia.org/w/index.php?search={s}
xbox	Xbox	www.xbox.com/en-GB/Search?q={s}#All
xbps	Void Packages	github.com/void-linux/void-packages/search?q[]=filename:template+path:/srcpkgs&q[]={s}&s=indexed
xgau	Robert Christgau	www.robertchristgau.com/get_artist.php?name={s}
xing	Xing.de	www.xing.com/app/search?op=combined;keywords={s}
xiny lxiny learnxiny	Learn X in Y minutes	learnxinyminutes.com/docs/{s}/
xkom	x-kom.pl	www.x-kom.pl/szukaj?q={s}
xorp	Xorp Blog	blog.xorp.hu/?s={s}
xref crossref	crossref	search.crossref.org/?q={s}
yad2	Yad2- Search Second hand items (Hebrew)	www.yad2.co.il/products/all?info={s}
yajp	Yahoo! Auctions Japan	auctions.search.yahoo.co.jp/search?p={s}
yarn yarnpkg	Yarn	yarnpkg.com/en/packages?q={s}
yatr	Yandex Turkey	www.yandex.com.tr/search/?text={s}
yatu	YouTube Belgium	www.youtube.be/results?search_query={s}
yelp	Yelp	www.yelp.com/search?find_desc={s}&ns=1&rpp=10&find_loc=
yjtv	Yahoo! Japan TV	tv.yahoo.co.jp/search/?q={s}
ymgn	Youmagine	www.youmagine.com/search/designs?search={s}
ynfr	Yahoo news france	fr.news.search.yahoo.com/search?p={s}
yopi	Yopi Tests und Preise	www.yopi.de/search?search_str={s}
yout	yout.com	yout.com/search?terms={s}
yt24 ytday	YouTube (past day)	www.youtube.com/results?search_query={s}&sp=EgIIAg==
ytcc	YouTube (Creative Commons)	www.youtube.com/results?search_query={s}&sp=EgIwAQ==
ytch	YouTube CH	www.youtube.ch/results?search_query={s}
ytcv	YouTube Channel Videos	www.youtube.com/user/{s}/videos
ytde	YouTube (DE)	www.youtube.com/results?search_query={s}&gl=DE&hl=de
ytes	YouTube Spain	www.youtube.es/results?search_query={s}
ytfr	YouTube France	www.youtube.fr/results?search_query={s}
ytmx	YouTube Mexico	www.youtube.mx/results?search_query={s}
ytus	YouTube United States	www.youtube.com/results?search_query={s}&gl=US
z100	Z100	www.z100.com/main.html/?q={s}
zara	Zara	www.zara.com/webapp/wcs/stores/servlet/ItxSolrSearchingDataCmd?storeId=10701&langId=-5&searchTerm={s}
zeit	Zeit Online	www.zeit.de/suche/index?q={s}
zeno	zeno.org	www.zeno.org/Zeno/0/Suche?q={s}&k=Bibliothek
zero	Zero	www.zero.eu/?s={s}
zmp3	ZING MP3	mp3.zing.vn/tim-kiem/bai-hat.html?q={s}
zoho	Zoho	search.zoho.com/searchresult?query={s}&search_type=all&index_key=-1&embed=false
zoom zoombr	Zoom	www.zoom.com.br/search?q={s}
zumi	Mapy Zumi	www.zumi.pl/{s},namapie.html
zvab	ZVAB	www.zvab.com/basicSearch.do?anyWords={s}
zvon	ZVON.org	zvon.org/comp/m/{s}.html
01net	01net	www.01net.com/recherche/recherche.php?searchstring={s}&chaine=home
02faq	BMW 2002 FAQ	www.bmw2002faq.com/search/?q={s}
15min	15min naujienos	www.15min.lt/paieska?q={s}
1und1	1und1	www.1und1.de/suche?query={s}
4chfa	4chan fashion board	boards.4chan.org/fa/catalog#s={s}
4chmu	4chan music board	boards.4chan.org/mu/catalog#s={s}
5mods	GTA 5 Mods	www.gta5-mods.com/search/{s}
95mac	9to5Mac	9to5mac.com/?s={s}
ab-er	Abbyy Dictionary En-Ru	www.lingvolive.com/en/translate/en-ru/{s}
abbuc	Abbuc e.V.	www.abbuc.de/component/search/?searchword={s}
abcam	Abcam	www.abcam.com/products?keywords={s}
abcau	ABC Australia	search.abc.net.au/s/search.html?query={s}&collection=abcall_meta&form=simple
abcya	abcya	www.abcya.com/search/?term={s}&type=all
abeuk	abebooks uk	www.abebooks.co.uk/servlet/SearchResults?kn={s}
abyss	Wallpaper Abyss	wall.alphacoders.com/search.php?search={s}
acfun	AcFun	www.acfun.cn/search/?#query={s}
ackuc	Amar Chitra Katha Complete Collection	www.amarchitrakatha.com/us/catalogsearch/result/?cat=0&q={s}
acmdl	ACM Digital Library	dl.acm.org/results.cfm?query={s}
adobe	Adobe	www.adobe.com/cfusion/search/index.cfm?loc=en_us&term={s}
advfn	ADVFN UK	uk.advfn.com/p.php?pid=qkquote&symbol={s}
aeiou	Austria Forum	austria-forum.org/Search.jsp?category=Austria-Forum&sname=name,suchbegriff&query={s}+&searchType=default&useShortcuts=y&useSynonyms=n&doFuzzy=y&minResults=15
aemet	AEMET	www.aemet.es/es/buscador?modo=and&orden=n&tipo=sta&str={s}
afpls	Atlanta-Fulton Public Library System	afpl.ent.sirsi.net/client/default/search/results?qu={s}&te=ILS
agame	Agame	www.agame.com/search?searchTerm={s}
agoga arturogoga	arturogoga	blog.arturogoga.com/?s={s}
ahmia	Ahmia.fi	ahmia.fi/search/?q={s}
aiden	Aiden Promotions	aidenpromotions.com/blog/?s=phones{s}
aifit	Arlington Industries	www.aifittings.com/searchResults?q={s}
aihit	aihit	www.aihitdata.com/search/companies?i={s}
airmo	Air Mozilla	air.mozilla.org/search/?q={s}
alaus	Atlas of Living Australia	bie.ala.org.au/search?q={s}
album albums	AllMusic Albums	www.allmusic.com/search/albums/{s}
alert	BiznesAlert	biznesalert.pl/?s={s}
alexa	Alexa	alexa.com/search?q={s}
alobg	alo.bg	www.alo.bg/searchq/?q={s}
altex	Altex	altex.ro/cauta/?q={s}
altro	Altroconsumo	www.altroconsumo.it/Serp/ShowResults?keyword={s}
amanz	Amanz	amanz.my/?s={s}
amegy	Amegy Bank Careers	careers.amegybank.com/search-results?keywords={s}
amguy angry	Angry Metal Guy	www.angrymetalguy.com/?s={s}
amvid	Amazon Instant Video	www.amazon.com/s/url=search-alias=instant-video&field-keywords={s}
amway	Amway.com	www.amway.com/Shop/Search/SearchResults.aspx?searchkeyword={s}
an101	Anarchy101	anarchy101.org/search?q={s}
andar	Android Arsenal	android-arsenal.com/search?q={s}
andce	Android Central	www.androidcentral.com/search/{s}
andev android	Android Developers	developer.android.com/s/results/?q={s}
anidb anime	AniDB	anidb.net/perl-bin/animedb.pl?show=animelist&adb.search={s}
anlaf	Apertium (Dutch to Afrikaans)	www.apertium.org/index.eng.html?dir=nld-afr&q={s}
annie	App Annie	www.appannie.com/search/?q={s}
aoe2r	AOE 2 Reddit Page	www.reddit.com/r/aoe2/search?q={s}&restrict_sr=1
apinc	Activision Careers	careers.activision.com/search-results?keywords={s}
aplib	Austin Public Library	austin.bibliocommons.com/v2/search?query={s}&searchType=smart
apmex	APMEX	www.apmex.com/search?q={s}
apnic	APNIC Whois	wq.apnic.net/static/search.html?query={s}
appdb winehq	WineHQ AppDB	www.winehq.org/search?q={s}
appex	Salesforce.com AppExchange	appexchange.salesforce.com/results?keywords={s}
apple	Apple	www.apple.com/search/{s}
appnr	appnr	appnr.com/search/{s}
april	April	www.april.org/search/node/{s}
apvde amvidde	Amazon.de Instant Video	www.amazon.de/s?k={s}&i=instant-video
aqicn	Real-time Air Quality Index (AQI)	aqicn.org/city/{s}
ar-ar almaanyar	almaany	www.almaany.com/ar/dict/ar-ar/{s}
ar-en	Almaany English-Arabic	www.almaany.com/ar/dict/ar-en/{s}
ar2en	Google Translate (Arabic to English)	translate.google.com/#ar/en/{s}
arena	Are.na	www.are.na/search/{s}
argos	Argos UK	www.argos.co.uk/search/{s}
argot sslang spanslang	Speaking Latino	www.speakinglatino.com/?s={s}&advanced=0&search_type=&posts_country=&posts_category=&words_country=&words_category=&words_letter=CHOOSE+A+STARTING+LETTER&all_country=&all_letter=CHOOSE+A+STARTING+LETTER
arrow	Arrow Electronics	www.arrow.com/en/products/search?q={s}
arsuk arstechnicauk	Ars Technica UK	arstechnica.co.uk/search/?query={s}
aruba	Aruba Airheads Community	community.arubanetworks.com/t5/forums/searchpage/tab/message?q={s}
asana	Asana	app.asana.com/0/search/{s}
asics	asics	www.asics.com/us/en-us/search?text={s}
askf5	AskF5 (my.f5.com)	my.f5.com/manage/s/global-search/@uri#q={s}&aq=@f5_archived
askvg	AskVG	www.askvg.com/?s={s}
atlas toratlas	Atlas	atlas.torproject.org/#search/{s}
aukro	Aukro	aukro.cz/listing.php/search?string={s}
auone	au one Web Portal	search.auone.jp/?q={s}
autos	Autocosmos	www.autocosmos.com.mx/search?q={s}
avgkb	AVG Knowledge Base	kb.avg.com/pkb_Home?q={s}
aware	flightaware	flightaware.com/live/airport/{s}
awiki	Augsburgwiki	www.augsburgwiki.de/index.php/AugsburgWiki/Suchergebnisse?q={s}
awimg	Yahoo Images	images.search.yahoo.com/search/images;_ylt=A0PDoS1.milPyVkAh7OJzbkF?p={s}&fr=alltheweb&ei=utf-8&n=30&x=wrt&y=Search
azure	Azure Documentation	azure.microsoft.com/en-us/search/?q={s}
babcs	bab.la English-Czech dictionary	en.bab.la/dictionary/english-czech/{s}
babel	Bab.la NL	nl.bab.la/woordenboek/nederlands-engels/{s}
babsv	bab.la	sv.bab.la/lexikon/engelsk-svensk/{s}
bacon	Oracle of Bacon	oracleofbacon.org/cgi-bin/movielinks?a=Kevin+Bacon&b={s}
baidu	Baidu	www.baidu.com/s?wd={s}&cl=3
bandq	B&Q	www.diy.com/search?Ntt={s}
bazar	CafeBazaar	cafebazaar.ir/search/?l=&q={s}
bazel	bazel documentation	docs.bazel.build/search.html?q={s}
bbart breitbart	Breitbart	www.breitbart.com/search/?s={s}
bbcgf	BBC Good Food	www.bbcgoodfood.com/search/recipes?q={s}
bbdev	BlackBerry Developer	developer.blackberry.com/native/search/?search={s}&searchaction=Search
bbqpb	BBQ Pit Boys	bbqpitboys.com/?s={s}&post_type=post
bbref baseball	Baseball Reference	www.baseball-reference.com/search/search.fcgi?hint=&search={s}
bbsfr	BBS Consultant	www.bbs-consultant.net/search/node/{s}
bcmoe because	because.moe	because.moe/?q={s}
bctag	Bandcamp tags	bandcamp.com/discover/{s}
bdica	Boa Dica	www.boadica.com.br/busca-resultado?q={s}
becho	Bournemouth Echo	www.bournemouthecho.co.uk/search/?search={s}
ben10	Ben 10 Wiki	ben10.wikia.com/wiki/Special:Search?query={s}
beoes	Beolingus De-es	dict.tu-chemnitz.de/dings.cgi?service=dees&query={s}
beopt	Beolingus De-pt	dict.tu-chemnitz.de/dings.cgi?service=dept&query={s}
besch	Bescherelle	conjugueur.bescherelle.com/ConjugueurWeb/index.jsf?term={s}
bever	Bever	www.bever.nl/lister.html?q={s}
bevmo	BevMo	bevmo.com/search?q={s}
bevvy	Bevvy	bevvy.co/search?q={s}
bgggm	na	boardgamegeek.com/geekmarket/search?q={s}
bgpuk boardgameprices	BoardGamePrices	boardgameprices.co.uk/item/search?search={s}
bhive	beehive.org	www.beehive.org/?s={s}
biben	BibleStudyTools Encyclopedias	www.biblestudytools.com/search/?s=references&q={s}&rc=ENC&rc2=
bisbn	BookPrice	bookprice.co/isbn/{s}
bitly	Bitly	bitly.com/?url={s}
bivol	bivol.bg	bivol.bg/?s={s}
bkref bballref basketballreference	Basketball Reference	www.basketball-reference.com/search/search.fcgi?search={s}
bland	Bland.is	bland.is/classified/default.aspx?q={s}
blaze	The Blaze	www.theblaze.com/?s={s}
bleep	Bleep	bleep.com/search/query?q={s}
bmjbp	BMJ Best Practice	bestpractice.bmj.com/search?q={s}
bnews	Bing News	www.bing.com/news/search?q={s}
bogle	Bogleheads Wiki	www.bogleheads.org/w/index.php?search={s}
bokus	Bokus	www.bokus.com/cgi-bin/product_search.cgi?ac_used=no&search_word={s}
bolha	Bolha	www.bolha.com/iskanje?q={s}
bolor	bolor-toli	www.bolor-toli.com/dictionary/word?search={s}
booko	Booko	booko.com.au/books/search?q={s}
books amzbks	Amazon Books	www.amazon.com/s?k={s}&i=stripbooks
boto3	Boto 3 Docs	boto3.readthedocs.io/en/latest/search.html?q={s}&check_keywords=yes&area=default
bower	bower	libraries.io/search?q={s}&platforms=Bower&sort=rank&sort=rank
bpost	BPost	track.bpost.be/btr/web/#/search?itemCode={s}
brack	Brack	www.brack.ch/search?active_search=true&query={s}
brave	Brave Search	search.brave.com/search?q={s}
brewc	Homebrew Cask	formulae.brew.sh/cask/{s}
brewf	Homebrew Formula	formulae.brew.sh/formula/{s}
brook	Brookings Institution	www.brookings.edu/search/?s={s}
brown brownlib	Brown University Library	bruknow.library.brown.edu/discovery/search?query=any,contains,{s}&tab=Everything&search_scope=MyInst_and_CI&vid=01BU_INST:BROWN&offset=0
bstar	Biostars	www.biostars.org/local/search/page/?q={s}
btabs	UltimateGuitar.com	www.ultimate-guitar.com/search.php?s={s}&w=songs
btrfs	Btrfs wiki	btrfs.wiki.kernel.org/index.php?title=Special:Search&search={s}
buch7	Buch7	www.buch7.de/store/simple_search_results?utf8=%E2%9C%93&navkat=&search={s}&commit.x=0&commit.y=0
buffy	Buffyverse Wiki	buffy.wikia.com/wiki/Special:Search?search={s}&go=Go
buien	Buienalarm	www.buienalarm.nl/location/{s}
build	Build.com	www.build.com/index.cfm?page=search:browse&term={s}
built builtwith	BuiltWith	builtwith.com/?{s}
burst	Shopify Photos	www.shopify.com/stock-photos/photos/search?q={s}
buyee	buyee	buyee.jp/item/search?query={s}
byond	Byond	www.byond.com/games/?text={s}
bztch	yadda.icm.edu	yadda.icm.edu.pl/baztech/search/page.action?q=sc.general*c_0all_0eq.{s}*l_0&qt=SEARCH
c1024	Dem Commander1024 sein Blog	www.commander1024.de/wordpress/?s={s}
cairn	Cairn	www.cairn.info/resultats_recherche.php?searchTerm={s}
cake2 cake2book	Cakephp 2 Book	book.cakephp.org/2.0/en/search.html?q={s}
campl	Cambridge PL	dictionary.cambridge.org/dictionary/english-polish/{s}
camtw	Cambridge Traditional Chinese	dictionary.cambridge.org/dictionary/english-chinese-traditional/{s}
canon	Canon USA	www.usa.canon.com/internet/portal/us/home/searchresults?query={s}&searchTab=products
canoo	canoonet	www.canoonet.eu/services/Controller?input={s}
canto	CC-Canto - A Cantonese Dictionary	cantonese.org/search.php?q={s}
cargo crates	Cargo	crates.io/search?q={s}
cbase	ComputerBase	www.computerbase.de/suche/?q={s}
cblue coolblue coolbluenl	Coolblue	www.coolblue.nl/zoeken?query={s}
cccca	CamelCamelCamel (Canada)	ca.camelcamelcamel.com/search?sq={s}
cccde camelde	CamelCamelCamel (German)	de.camelcamelcamel.com/search?sq={s}
cccuk	Camelcamelcamel	uk.camelcamelcamel.com/search?sq={s}
ccook	CyberCook	www.cybercook.com.br/receitas/{s}
cdeen	Collins Dictionary (English German)	www.collinsdictionary.com/spellcheck/english-german?q={s}
cdict	Chinese-English Dictionary/Calculator	cdict.net/?q={s}
cdnjs	cdnjs	cdnjs.com/#q={s}
cdown	Currently Down	currentlydown.com/{s}
cdwca	CDW.ca	www.cdw.ca/shop/search/result.aspx?key={s}}&wclsscat=&b=&p=&ctlgfilter=&searchscope=all&sr=1
ceneo	Ceneo	www.ceneo.pl/;szukaj-{s}
cenes	Collins Dictionary (English - Spanish)	www.collinsdictionary.com/dictionary/english-spanish/{s}
cenfr	Collins French Dictionary (to French)	www.collinsdictionary.com/dictionary/english-french/{s}
cfren	Collins French Dictionary (to English)	www.collinsdictionary.com/dictionary/french-english/{s}
chapo	r/ChapoTrapHouse	www.reddit.com/r/ChapoTrapHouse/search?q={s}&restrict_sr=1
chart helmh	Helm Charts	hub.helm.sh/charts?q={s}
cheat devhints	Devhints	devhints.io/?q={s}
chegg	Chegg	www.chegg.com/search/{s}
chess	Chess.com	www.chess.com/topic/{s}
chewy	chewy.com	www.chewy.com/s?dept=all&query={s}
chief	Chief Delphi	www.chiefdelphi.com/search?expanded=true&q={s}
chlib	Chalmers Library	chalmers.summon.serialssolutions.com/en/search?ho=t&q={s}
chmod	Chmod Calculator	chmodcommand.com/chmod-{s}/
choco cinst chocolatey	Chocolatey	chocolatey.org/packages?q={s}
chtsh	cheat.sh	cheat.sh/{s}
chuck	Chuck Wiki	chuck-nbc.wikia.com/wiki/Special:Search?search={s}
chzzk	CHZZK	chzzk.naver.com/search?query={s}
cinta	Lirikcinta.com	www.lirikcinta.com/result/?q={s}
cisco	Cisco	search.cisco.com/search?query={s}
clark	Clark Howard	clark.com/search/?q={s}
clien	Clien	www.clien.net/service/search?q={s}
cliki	Cliki	cliki.net/site/search?query={s}
clker	Clker	www.clker.com/search/{s}
cmake	CMake documentation	cmake.org/cmake/help/latest/search.html?q={s}&check_keywords=yes&area=default
cmpeu	compare.eu	compare.eu/?fs={s}
cmssw	CMSSW Software Cross-Reference	cmssdt.cern.ch/lxr/search?_filestring=&_string={s}
cndic	Naver Chinese Dictionary	cndic.naver.com/search/all?q={s}
cnplx	Cineplex	www.cineplex.com/search-2015?search-query={s}
cntrp	Counterpunch	www.counterpunch.org/search-results/?q={s}
codat	Coda Template	coda.io/templates/productivity?search={s}
codex	WordPress Codex	codex.wordpress.org/?search={s}
coins	London Coins	www.londoncoins.co.uk/?page=Pastresults&searchterm={s}&searchtype=1
coles	Coles	shop.coles.com.au/a/a-national/everything/search/{s}?pageNumber=1
comfy	Comfy	comfy.ua/catalogsearch/result?q={s}
comix	Comixology	www.comixology.com/search?search={s}
conda anaconda	Anaconda Cloud	anaconda.org/search?q={s}
confi	El Confidencial	www.elconfidencial.com/buscar/2-6-1-3/0/1/10/desc/{s}/
copac libraryhub	Library Hub Discover	discover.libraryhub.jisc.ac.uk/search?q={s}
coptr	Community Owned digital Preservation Tool Registry (COPTR)	coptr.digipres.org/index.php?search={s}
couch	Couchsurfing	www.couchsurfing.org/?q={s}
coveo	Coveo	www.coveo.com/en/search#q={s}
covot	Covot Dictionary	www.covot.net/dictionary?search={s}
cpost	Czech post	www.postaonline.cz/trackandtrace/-/zasilka/cislo?parcelNumbers={s}
cppde	cppreference	de.cppreference.com/mwiki/index.php?title=Spezial:Suche&search={s}
cproj	Code Project	www.codeproject.com/search.aspx?q={s}
cptdb	Canadian Public Transit Discussion Board	cptdb.ca/search/?q={s}&quick=1
cpten	Collins Dictionary (Portuguese - English)	www.collinsdictionary.com/dictionary/portuguese-english/{s}
crate	crate.io	crate.io/docs/stable/search.html?check_keywords=yes&area=default&q={s}
crawl	CrawlWiki	crawl.chaosforge.org/index.php?title=Special:Search&search={s}&go=Go
crbug crissue	Chromium Issues	issues.chromium.org/issues?q={s}
crcom	CloudRetails	www.cloudretails.com/search?q={s}
crdoc	Crystal Language	crystal-lang.org/docs/?q={s}
crush	crushwineco.com	www.crushwineco.com/catalogsearch/result/?q={s}
csbno	Consorzio Sistema Bibliotecario Nord Ovest	webopac.csbno.net/opac/search/lst?q={s}
cspan	C-SPAN	www.c-span.org/search/basic/?query={s}
cspen	Collins Dictionary (Spanish English)	www.collinsdictionary.com/dictionary/spanish-english/{s}
csurf	Couchsurfing.org	www.couchsurfing.com/?q={s}
ctgov	ClinicalTrials.gov	clinicaltrials.gov/ct2/results?term={s}
culib	Cornell Library Catalog	newcatalog.library.cornell.edu/catalog?q={s}
curia	InfoCuria	curia.europa.eu/juris/liste.jsf?&num={s}
curse	WoW Curseforge	www.curseforge.com/wow/addons/search?search={s}
cyber	Cyberscoop	www.cyberscoop.com/?s={s}
cyg64	Cygwin Package Search	cygwin.com/cgi-bin2/package-grep.cgi?grep={s}&arch=x86_64
d1pkg	Devuan Package information	pkginfo.devuan.org/cgi-bin/d1pkgweb-query?search={s}&release=any
dagen	Dagen	www.dagen.se/search-7.157994?sortby=date&q={s}
dalla	Diccionariu de l'Academia de la Llingua Asturiana	www.diccionariu.alladixital.org/index.php?pallabra={s}
danas	Danas.rs	www.danas.rs/?s={s}
daria	Daria Wiki	www.dariawiki.org/wiki/index.php?search={s}&title=Special:Search&go=Go
darty	Darty	www.darty.com/nav/recherche?text={s}
datev	DATEV	www.datev.de/web/de/suche/?query={s}
dbasx	DBA StackExchange	dba.stackexchange.com/search?q={s}
dbgap	dbGaP	www.ncbi.nlm.nih.gov/gap/?term={s}
dbots	Discord Bots	discord.bots.gg/search?q={s}
dbsnp	NCBI dbSNP	www.ncbi.nlm.nih.gov/snp?term={s}
dbuch	diebuchsuche.de	diebuchsuche.de/r.php?q={s}
dbyte	Darkbyte	int.darkbyte.ru/{s}
ddg-v ddg-vids ddg-video	DuckDuckGo video search	duckduckgo.com/?q={s}&ia=videos&iax=videos
ddgar	DuckDuckGo Argentina con Pale Moon	duckduckgo.com/?t=palemoon&kl=ar-es&ko=1&k1=1&q={s}
ddgbr	DuckDuckGo Brazilian Portuguese Search	duckduckgo.com/?q={s}&kp=-1&kl=br-pt
ddgee	DuckDuckGo Estonia	duckduckgo.com/?kl=ee-et&q={s}
ddghu	DuckDuckGo Hungary	duckduckgo.com/?kl=hu-hu&q={s}
ddgja	DuckDuckGo in Japan	duckduckgo.com/?q={s}&kl=jp-jp&kp=-1
ddgno	DuckDuckGo Norway	duckduckgo.com/?kl=no-no&q={s}
ddgpd	DuckDuckGo Past Day	duckduckgo.com/?df=d&q={s}
ddnet	DDrace Network	ddnet.tw/players/{s}
ddwrt	DD-WRT Wiki	www.dd-wrt.com/wiki/index.php/Special:Search?search={s}
de2fr	Google Translate (de2fr)	translate.google.com/#de/fr/{s}
deals	r/deals	www.reddit.com/r/deals/search/?q={s}&restrict_sr=1
debml	Debian Mailing Lists	lists.debian.org/cgi-bin/search?query={s}&DEFAULTOP=and&author=&sort=relevance&HITSPERPAGE=10&language=en
debpc	Debian Popularity Contest Statistics	qa.debian.org/popcon.php?package={s}
decde	Decathlon Deutschland	www.decathlon.de/search?Ntt={s}
decks	Decks Vinyl Shop	www.decks.de/decks/workfloor/search_db.php?such={s}
delfi delflt	Delfi	www.delfi.lt/paieska/?q={s}
delib	Delaware Library Search	dlc.lib.de.us/client/default/search/results?qu={s}&te=
denru	Deepl English to Russian	www.deepl.com/translator#en/ru/{s}
depop	Depop	www.depop.com/search/?q={s}
detfd	The Free Dictionary Deutsch (German)	de.tfd.com/{s}
detik	Detik	www.detik.com/search/searchall?query={s}
devto dev.to	dev.to	dev.to/search?q={s}
dex6g	Pokdex Pokebip	www.pokebip.com/pokedex/index.php?phppage=recherche&req={s}
dfman	DragonFly BSD manual pages	leaf.dragonflybsd.org/cgi/web-man?command={s}&section=ANY
dfren	dict.cc Dictionary French-English	enfr.dict.cc/?s={s}
dhlde	DHL German	nolp.dhl.de/nextt-online-public/set_identcodes.do?lang=de&idc={s}&rfn=&extendedSearch=true
dhlgm	DHL Global Mail Tracking	webtrack.dhlglobalmail.com/?trackingnumber={s}
dicoz	Dicoz	www.dicoz.fr/?s={s}
dictn	Dict-Na'vi (English)	dict-navi.com/en/dictionary/list/?type=search&search_term={s}
digra	Udruga Igranje	igranje.hr/?s={s}
diigo	Diigo	www.diigo.com/search/my?q={s}
diigt	Diigo (tags)	www.diigo.com/tag/{s}?year=2
diplo	Le Monde Diplomatique	www.monde-diplomatique.fr/recherche?s={s}
dirae	Dirae	dirae.es/palabras/?q={s}
dirpy	Dirpy	www.dirpy.com/studio?url={s}
disco	Discovery Wiki	discoverygc.com/wiki/index.php?title=Special:Search&search={s}&go=Go
discu	Discu.eu	discu.eu/?q={s}
divii	Divii	www.divii.org/search?q={s}
djent	DjentMag	www.djentmag.com/?s={s}
djlts djangodoc	Django Documentation	docs.djangoproject.com/en/2.2/search/?q={s}
dlcat	Diccionari de la llengua catalana	mdlc.iec.cat/results.asp?txtEntrada={s}&operEntrada=0
dlive	dlive	dlive.tv/s/search/{s}
dlock dlwiki deadlock	Deadlock Wiki	deadlock.wiki/index.php?search={s}
dlpoc	Priberam - Conjugar	www.priberam.pt/dlpo/Conjugar/{s}
dmarc	MXToolbox DMARC	mxtoolbox.com/SuperTool.aspx?action=dmarc:{s}&run=networktools
dofus	Dofus Wiki	dofuswiki.wikia.com/wiki/Special:Search?query={s}
dogob	DOGO books	www.dogobooks.com/search/{s}
dogom	DOGO movies	www.dogomovies.com/search/{s}
douga	niconico douga bypass	en.niconico.sarashi.com/?{s}
dover	Dover Publications	search.doverpublications.com/search?keywords={s}
downd	Downdetector	downdetector.com/status/{s}
dptbr dic-ptbr	Michaelis Online	michaelis.uol.com.br/moderno-portugues/busca/portugues-brasileiro/{s}
draxe	Dr. Axe	draxe.com/?s={s}
drdba dynamicrangea	Dynamic Range Database (album)	dr.loudness-war.info/album/list?album={s}
dream	DreamMoods	dreammoods.com/cgibin/dreamdictionarysearch.pl?method=exact&header=dreamsymbol&search={s}
dreye	Dreye	yun.dreye.com/dict_new/dict.php?w={s}
drill	Drill Source	www.drillsource.com/?s={s}
drugs	Drugs	www.drugs.com/search.php?&searchterm={s}
drupp	drupal	drupal.org/project/{s}
dsarw	DSA Regel Wiki	www.ulisses-regelwiki.de/index.php/suche.html?keywords={s}
dsbin debsnap	snapshot.debian.org (binary)	snapshot.debian.org/binary/{s}/
dsgvo	Datenschutz-Wiki.de (DSGVO)	www.datenschutz-wiki.de/index.php?search={s}&ns3000=1
dsmcz	DSM Components	dsmcz.com/prestashop/en/search?controller=search&orderby=position&orderway=desc&search_query={s}&submit_search=
dspse	StackExchange Signal Processing	dsp.stackexchange.com/search?q={s}
dssrc	snapshot.debian.org	snapshot.debian.org/package/?src={s}
dstgb	StGB - dejure.org	dejure.org/gesetze/StGB/{s}.html
dtrpg	DriveThruRPG	www.drivethrurpg.com/browse.php?keywords={s}
dtube	DTube	d.tube/#!/s/{s}
dualb	Dual Universe Forums	board.dualthegame.com/index.php?/search/&q={s}
duden	Duden	www.duden.de/suchen/dudenonline/{s}
dummi dummies	dummies	www.dummies.com/search?pq={s}
durhg dejure	Dejure	dejure.org/cgi-bin/suche?Suchenach={s}
dv247	DV247	www.dv247.com/search/0/0/Relevance/Descending/{s}/1/
dvdfr	DVDFr	www.dvdfr.com/search/search.php?produit=all&title={s}
dwell	Dwell	www.dwell.com/query/{s}
dwiki daviswiki	DavisWiki	daviswiki.org/_rsearch/?q={s}
ebert rogerebert	Roger Ebert	www.rogerebert.com/search?utf8=%E2%9C%93&q={s}
eccpd	Encyclopedie	www.encyclo.nl/zoek.php?woord={s}
ecolo	ECOLO	www.ecolo.be/spip.php?recherche={s}&page=recherche
edgar	EDGAR	www.sec.gov/cgi-bin/browse-edgar?company={s}&CIK=&filenum=&State=&SIC=&owner=include&action=getcompany
edweb	El Destape Web	www.eldestapeweb.com/{s}-s
eecms	ExpressionEngine User Guide	docs.expressionengine.com/search/latest/?q={s}
eeggs	Easter Eggs	www.eeggs.com/php/search.php?q={s}
egear	e-Gear	e-gear.se/catalogsearch/result/?q={s}
egged	Egged	mslworld.egged.co.il/?state=3&language=he&freelang={s}&width=1280#/search
elite elitepr	EliteProspects	www.eliteprospects.com/search/player?q={s}
ellos	Ellos	www.ellos.se/search?SearchTerm={s}
elobs	El Observador	www.elobservador.com.uy/{s}-s
elreg register theregister	The Register	search.theregister.co.uk/?q={s}
eluta	Eluta	www.eluta.ca/search?q={s}
emacu	E-Maculation	emaculation.com/doku.php/mac_emulation?do=search&id=mac_emulation&q={s}
emich	Eastern Michigan University	www.emich.edu/search/?q={s}
emoji	emojipedia	emojipedia.org/search/?q={s}
empik	Empik	www.empik.com/szukaj/produkt?q={s}
en2ar	Google Translate (en2ar)	translate.google.com/#en/ar/{s}
en2de	Google Translate - En to De	translate.google.com/#view=home&op=translate&sl=en&tl=de&text={s}
en2el	Google Translate (en2el)	translate.google.gr/#en/el/{s}
en2fa	Google translate En to Fa	translate.google.com/#en/fa/{s}
en2hi	Google Translate English to Hindi	translate.google.com/#view=home&op=translate&sl=en&tl=hi&text={s}
en2tl	Google Translate English to Tagalog	translate.google.com/#view=home&op=translate&sl=en&tl=tl&text={s}
en2ua	translate.google.com	translate.google.com/?source=osdd#view=home&op=translate&sl=auto&tl=uk&text={s}
en2zh	Google Translate (en2zh)	translate.google.com/#en/zh-CN/{s}
encom	Encyclopedia.com	www.encyclopedia.com/searchresults.aspx?q={s}
encyc	encyc	encyc.org/wiki/{s}
endic	endic.naver.com	endic.naver.com/search.nhn?sLn=en&isOnlyViewEE=N&query={s}
enews	Eternity News	www.eternitynews.com.au/?s={s}
engtb	Engineering Toolbox	cse.google.com/cse?cx=partner-pub-3176996020956223:6582549258&q={s}&og=_l=partner-generic.3...19628.24-generic..0.0.0.
eniro gulasidorna	Eniro	www.eniro.se/query?what=all&search_word={s}
enlat	Latdict (English)	latin-dictionary.net/search/english/{s}
eorde	Eorzea-Datenbank	de.finalfantasyxiv.com/lodestone/playguide/db/search/?q={s}
epflp	EPFL Plan	plan.epfl.ch/?room={s}
epicg	Epic UserWeb	galaxy.epic.com/?#Search/version=8200&searchWord={s}&lastUpdate=
epwin	Economic Political Weekly	www.epw.in/search/site/{s}
erste	Das Erste	www.daserste.de/search/index.jsp?searchText={s}
esdoc	ESDoc	doc.esdoc.org/-/search.html?keyword={s}
etf2l	ETF2L	etf2l.org/search/{s}/
etimo	Dizionario Etimologico	etimo.it/?term={s}
etynl	Etymologiebank	etymologiebank.nl/trefwoord/{s}
evans	Evans Cycles	www.evanscycles.com/search?query={s}&x=0&y=0
evawk	evageeks wiki	wiki.evageeks.org/Special:Search?search={s}
evirt	Estante Virtual (all)	www.estantevirtual.com.br/qt/{s}
exite	Excite	msxml.excite.com/search/web?q={s}
exkcd expxkcd	Explain xkcd	www.explainxkcd.com/wiki/index.php?search={s}&title=Special:Search
extra	Extra Saudi Arabia	www.extrastores.com/en-sa/search?q={s}
eyeem	EyeEm	www.eyeem.com/search?q={s}&sort=relevance
fa2en	Google translate Fa to En	translate.google.com/#fa/en/{s}
fanch	Quick Troll Hosted	www.qth.fr/?s={s}
fancy	TheFancy	www.thefancy.com/search?q={s}
farnl	Farnell (NL)	nl.farnell.com/webapp/wcs/stores/servlet/Search?&st={s}
fbugs	FreeBSD Bugs	bugs.freebsd.org/bugzilla/buglist.cgi?quicksearch={s}
fcbar	FC Bayern Munich (ar)	www.fcbayern.de/ar/search#search={s}&chronology=chrono
fcben	FC Bayern Munich (en)	www.fcbayern.de/en/search#search={s}&chronology=chrono
fcbes	FC Bayern Munich (es)	www.fcbayern.de/es/search#search={s}&chronology=chrono
fcbjp	FC Bayern Munich (jp)	www.fcbayern.de/jp/search#search={s}&chronology=chrono
fcbru	FC Bayern Munich (ru)	www.fcbayern.de/ru/search#search={s}&chronology=chrono
fcbus	FC Bayern Munich	www.fcbayernmunich.com/us/search#search={s}&chronology=chrono
fcode	freeCodeCamp	search.freecodecamp.org/?q={s}
fconj wrfrconj	WordReference (fr-conj)	www.wordreference.com/conj/FRverbs.aspx?v={s}
fdbpl	fdb.pl	fdb.pl/szukaj?utf8=%E2%9C%93&query={s}
fedex	FedEx	www.fedex.com/fedextrack/?trknbr={s}
feser	Edward Feser	edwardfeser.blogspot.com/search?q={s}
ffxiv	Final Fantasy XIV A Realm Reborn Wiki	ffxiv.consolegameswiki.com/mediawiki/index.php?search={s}
ficly	ficly	ficly.com/search?query={s}
finfo	France Info	www.francetvinfo.fr/recherche/?request={s}
finna	Finna.fi	finna.fi/Search/Results?lookfor={s}
firmy	Firmy.cz	www.firmy.cz/?q={s}
fixyt	FixYT	fixyt.com/search?q={s}
flask	Flask WebFramework	flask.pocoo.org/search/?q={s}
flyer	Flyer Hunters	flyerhunters.com/?s={s}
fmekb	Safe.com knowledge center	knowledge.safe.com/search.html?f=&type=question+OR+idea+OR+kbentry&c=&redirect=search/search&sort=relevance&q={s}:
fnite	Reddit Fortnite BR	www.reddit.com/r/FortNiteBR/search/?q={s}&restrict_sr=1
fnova	Fashion Nova	www.fashionnova.com/pages/search-results?q={s}
fnvnm	Fallout New Vegas NexusMods	www.nexusmods.com/newvegas/search/?gsearch={s}&gsearchtype=mods
folha	Folha de S. Paulo	search.folha.com.br/search?q={s}
fonts fontsq	Font Squirrel	www.fontsquirrel.com/fonts/list/find_fonts?q[term]={s}&q[search_check]=Y
fooby	Fooby	fooby.ch/de/suche.html?query={s}&treffertyp=rezepte
foody	foody.vn	www.foody.vn/ho-chi-minh/dia-diem?q={s}&ss=header_search_form
forvo	Forvo	forvo.com/search/{s}/
fossd fossdroid	Fossdroid	fossdroid.com/s.html?q={s}
found	Foundland	foundland.shop/search?query={s}
fr2de	Google Translate (fr2de)	translate.google.com/#view=home&op=translate&sl=fr&tl=de&text={s}
frack	Frack.nl Hackerspace	frack.nl/w/index.php?title=Special:Search&search={s}
freeg freegroup	freeGROUP	free.com.tw/?s={s}
freep	Freerepublic	www.freerepublic.com/tag/{s}/index?tab=articles
fresh	Amazon Fresh	www.amazon.com/s?url=search-alias=amazonfresh&field-keywords={s}
frida	Frida fooddata.dk	frida.fooddata.dk/food/search?lang=en&q={s}
frink	Frink Web Interface	www.futureboy.us/fsp/frink.fsp?fromVal={s}
friss	fressnapf.de	www.fressnapf.de/s/search?text={s}
frith	Francis Frith	www.francisfrith.com/search?q={s}
ft-db	Fischertechnik Datenbank	ft-datenbank.de/tickets?fulltext={s}
fubib	Katalogsuche UB FU Hagen	fub-hagen.digibib.net/search/katalog/list?q-al={s}
funda	Funda	www.funda.nl/koop/{s}
funky	Funkytime.tv	funkytime.tv/search?q={s}
furet	Furet du Nord	www.furet.com/catalogsearch/result/?q={s}
fwiki	Fortran Wiki	fortranwiki.org/fortran/search?query={s}
fwpkg	Frugalware packages	frugalware.org/packages?op=pkg&arch=all&ver=current&srch={s}
gaana	Gaana	gaana.com/search/{s}
games	Games	www.crazygames.com/search?q={s}
gamma	Gamma	www.gamma.nl/assortiment/zoeken?text={s}
gandi	Gandi.net	www.gandi.net/domain/suggest?domain_list={s}
garen	Glosbe (Arabic-English)	glosbe.com/ar/en/{s}
garoa	Garoa Hacker Clube	garoa.net.br/w/index.php?search={s}
gbugs	Gentoo's Bugzilla	bugs.gentoo.org/buglist.cgi?quicksearch={s}
gcide	GCIDE	gcide.gnu.org.ua/?q={s}&define=Define&strategy=.
gcode	Google Code	code.google.com/hosting/search?q={s}
gdeen	Google Translate de->en	translate.google.com/#de/en/{s}
gdevs	Google Developers	developers.google.com/s/results/?q={s}
gdiag	Google Safe Browsing Diagnostic Page	google.com/safebrowsing/diagnostic?site={s}
gdoms gdomains	Google Domains	domains.google.com/registrar?s={s}
gecko coingecko	CoinGecko	www.coingecko.com/en/search/bang?query={s}
geecr	GEECR	geecr.com/search/{s}
geeku	GeekUnivers	www.geekunivers.com/?s={s}
gemug	GeMUG	www.gemug.ge/?s={s}
genea	Genealogie Online	www.genealogieonline.nl/en/zoeken/?q={s}
genhu	Glosbe (enhu)	en.glosbe.com/en/hu/{s}
genie	Genie	www.genie.co.kr/search/searchMain?query={s}
geoip	InfoSniper	www.infosniper.net/index.php?ip_address={s}
getfi	glosbe (estonian - finnish)	glosbe.com/et/fi/{s}
getty gettyimages	Getty Images	www.gettyimages.com/photos/{s}
gfaqs gamefaqs	GameFAQs.com	www.gamefaqs.com/search/index.html?game={s}&platform=0
gfiet	glosbe (finnish - estonian)	glosbe.com/fi/et/{s}
gfont gfonts googlefonts	Google Fonts	fonts.google.com/?query={s}
gfork greasyfork	Greasy Fork	greasyfork.org/en/scripts?q={s}
ggnet	GameGator	gamegator.net/search.php?q={s}
ghour	Google Past Hour Search	www.google.com/search?q={s}&tbs=qdr:h
ghuen	Glosbe (huen)	en.glosbe.com/hu/en/{s}
giant	Giant	www.giant-bicycles.com/global/search?keyword={s}
giphy	Giphy	giphy.com/search/{s}
gisse gisstackexchange	GIS Stack Exchange	gis.stackexchange.com/search?q={s}
glink	Google (link)	www.google.com/search?as_lq={s}&hl=en&btnG=Search
glyde	Glyde	glyde.com/stores/glyde#!display_as=2&s_query={s}
gmail	GMail.com	mail.google.com/mail/#search/{s}
gmdir	Google Maps Directions	www.google.com/maps/dir//{s}
gnavi	Gurunavi	r.gnavi.co.jp/area/jp/rs/?fwr={s}
gnome	GNOME Live	live.gnome.org/Home?action=fullsearch&context=180&value={s}&titlesearch=Titles
godoc	GoDoc	godoc.org/?q={s}
gogdb	GOG Database	www.gogdb.org/products?search={s}
golem	Golem.de	suche.golem.de/search.php?l=10&q={s}
goood	The Goood Shop	thegooodshop.com/?s={s}&post_type=product
goosh	Goosh	goosh.org/#{s}
govuk gov.uk	GOV.UK	www.gov.uk/search?q={s}
gpcan	Greenpeace Canada	www.greenpeace.org/canada/en/System-templates/Site-Settings-Pages/Search/?all={s}
gpens	The Goulet Pen Company	www.gouletpens.com/pages/search-results?q={s}
gquil	en Guayaquil	enguayaquil.com/?s={s}
grave	Find A Grave	www.findagrave.com/php/famous.php?globalSearchCriteria={s}
greco	Greco olivetti	www.grecoantico.com/dizionario-greco-antico.php?parola={s}
greek	Greek Word Studies	www.perseus.tufts.edu/hopper/morph?l={s}&la=greek#lexicon
green	Green Technology News	www.greentech-news.org/?s={s}
grimd	Grimdawn Wikia	grimdawn.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
gs.es	Google Shopping ES	www.google.es/search?tbm=shop&q={s}
gsafe	Google (all&safe)	www.google.com/search?hl=all&safe=on&pws=0&q={s}
gtceb gtcebuano gt-cebuano	Google Translate (to Cebuano)	translate.google.com/#auto/ceb/{s}
gthmn gthmong gt-hmong	Google Translate (to Hmong)	translate.google.com/#auto/hmn/{s}
gtlao gt-lao	Google Translate (to Lao)	translate.google.com/#auto/lo/{s}
gtlib	Georgia Tech Library	gatech-primo.hosted.exlibrisgroup.com/primo-explore/search?vid=01GALI_GIT&search_scope=Everything&query=any,contains,{s}
gturl	Google Translate URL	translate.google.com/translate?sl=auto&tl=en&u={s}
gucci	Gucci	www.gucci.com/fr/fr/st/newsearchpage?searchString={s}
gv100	Google Search Verbatim 100 Results	www.google.com/search?q={s}&tbo=1&num=100&tbs=li:1
gw2de	Guild Wars 2 Wiki Deutsch	wiki-de.guildwars2.com/index.php?search={s}&go=Seite
gw2tp	GW2TP	www.gw2tp.com/search?name={s}
gweek	Google (Past Week)	www.google.com/search?q={s}&tbs=qdr:w
gwlib	George Washington University Libraries	library.gwu.edu/search-all?query={s}
gwpde	Google de.Wikipedia	www.google.de/search?ie=UTF-8&gfns=1&q=site:de.wikipedia.org+{s}
gyazo	Gyazo	gyazo.com/search/{s}
gzric giallozafferano	Giallo Zafferano	www.giallozafferano.it/ricerca-ricette/{s}
habra	habrahabr.ru	habrahabr.ru/search/?q={s}
hak5f	Hak5 Forums	forums.hak5.org/index.php?app=core&module=search&do=search&fromMainBar=1&search_term={s}
hanja	Naver Hanja Dictionary	hanja.naver.com/search?query={s}
hanze	Hanze Hogeschool	www.hanze.nl/nld/zoeken?k={s}
happi	www.happi.com	www.happi.com/contents/searchcontent/all/{s}/
hathi	HathiTrust	babel.hathitrust.org/cgi/ls?field1=ocr;q1={s};a=srchls
haven	Haven	havenmaine.wikia.com/wiki/Special:Search?search={s}
hclib	Hennepin County Library	hclib.bibliocommons.com/v2/search?query={s}&searchType=smart
hcpcs	FindACode.com	www.findacode.com/code.php?set=HCPCS&c={s}
hdict	Hyperdictionary	hyperdictionary.com/search.aspx?define={s}
heeza	HEEZA - L'Univers du Cartoon	www.heeza.fr/fr/recherche?orderby=position&orderway=desc&search_query={s}&submit_search=Rechercher
heise	heise online	www.heise.de/suche/?q={s}&rm=search
helka	Helka	helka.finna.fi/Search/Results?lookfor={s}
henna	Henna Boy	www.henna-boy.co.uk/index.php?route=product/search&search={s}
henry henrysphoto	Henrys	www.henrys.com/search?q={s}
heute	ZDF heute	www.zdf.de/suche?q={s}&synth=true&sender=heute.de&from=&to=&attrs=
hg101	HardcoreGaming101	www.hardcoregaming101.net/?s={s}
hi2en	Google translate English to Hindi	translate.google.com/#view=home&op=translate&sl=hi&tl=en&text={s}
hindu thehindu	The Hindu	www.thehindu.com/search/?q={s}
hinta	Hintaseuranta	hintaseuranta.fi/haku/{s}
hklii	HKLII	www.hklii.hk/cgi-bin/sinosrch.cgi?query={s}&results=50&submit=Search&mask_world=&mask_path=&callback=on&method=auto&meta=/hklii
hkref hockeyref	Hockey Reference	www.hockey-reference.com/search/search.fcgi?hint=&search={s}
hmcpl	Huntsville-Madison County Public Library	catalog.hmcpl.org/cgi-bin/koha/opac-search.pl?q={s}
hooph	Hoops Hype	hoopshype.com/?s={s}
hopac	hessen.OPAC	opac.hebib.de/search?scope=R1&q={s}
hotel hotels	Hotels	hotels.com/search.do?q-destination={s}
hotud	Home of the Underdogs	www.homeoftheunderdogs.net/search.php?search_game={s}
houzz	Houzz	www.houzz.com/photos/query/{s}
hover	Hover	www.hover.com/domains/results?q={s}
hplus	Hpluspedia	hpluspedia.org/index.php?title=Special:Search&search={s}
htcat httpcat	HTTP Cats	http.cat/{s}
hubpg	Hubpages	hubpages.com/search/?s={s}
huuto	Huuto	www.huuto.net/hakutulos?words={s}
hymns	hymnal.net	www.hymnal.net/en/search/all/all/{s}
hypem	The Hype Machine	hypem.com/#!/search/{s}/1/
hyper	hyperbola.info	www.hyperbola.info/packages/?q={s}
hyvee	Hy-Vee	www.hy-vee.com/grocery/search?search={s}
hyves	Hyves	www.hyves.nl/search/hyver/?searchterms={s}
iacac	Airport Chapels and Chaplaincies	iacac.aero/?s={s}
ialoc	ialoc bucuresti	ialoc.ro/restaurante-bucuresti?search={s}
iaven	IAV Automotive Engineering (en)	www.iav.com/en/search/site/{s}
ibmkc	IBM Knowledge Center	www.ibm.com/support/knowledgecenter/en/search/{s}
icann	ICANN	www.icann.org/search/#!/?searchText={s}
icd10	ICD10Data.com	www.icd10data.com/Search.aspx?search={s}
icomp	i-Comparateur	www.i-comparateur.com/search.aspx?q={s}
ideal	IdealWorld.tv	www.idealworld.tv/navigation/?q={s}
ideas	RePEc IDEAS	ideas.repec.org/cgi-bin/htsearch?q={s}&cmd=Search!
idiom tfdidioms	Idioms The Free Dictionary	idioms.thefreedictionary.com/{s}
idris	Idris Dcoumentation	docs.idris-lang.org/en/latest/search.html?q={s}&check_keywords=yes&area=default
idrop	iDropNEWS	www.idropnews.com/?s={s}
ieees	IEEE spectrum	spectrum.ieee.org/searchContent?q={s}
ifttt	IFTTT	ifttt.com/search/query/{s}
iherb	iHerb	iherb.com/search?kw={s}
ikman	Ikman	ikman.lk/en/ads?query={s}
ilstu	Illinois State University	search.illinoisstate.edu/?q={s}
imdba	IMDb (Internet Movie Database)	www.imdb.com/find?q={s}&s=nm
imdbk	IMDb Keywords	www.imdb.com/find?s=kw&q={s}
imdbm	IMDb Mobile	m.imdb.com/find?q={s}
imdbn	IMDB name	www.imdb.com/find?s=nm&q={s}
imdbp	IMDB pro	pro-labs.imdb.com/find?q={s}
imdbs	IMDB Showtimes	imdb.com/showtimes/US/{s}
imfdb	Internet Movie Firearms Database	www.imfdb.org/w/index.php?title=Special:Search&search={s}&go=Go
imgur	Imgur	imgur.com/search?q={s}
imore	iMore	www.imore.com/search?searchTerm={s}
impdb	Internet Movie Plane Database	impdb.org/index.php?search={s}
imslp	IMSLP	imslp.org/index.php?title=Special:Search&search={s}
in2p3	Annuaire in2p3 - CNRS	annuaire.in2p3.fr/search/{s}
indol	Indolio | Informasi Terbaru | Informasi Hari ini | Kabar Online	www.indolio.com/search?q={s}
infog	infogalactic.com	infogalactic.com/info/{s}
infoq	InfoQ	www.infoq.com/search.action?queryString={s}
insas	INSA de Strasbourg	www.insa-strasbourg.fr/fr/?s={s}
intel	Intel	www.intel.com/content/www/us/en/search.html?keyword={s}
inter	Interencheres	www.interencheres.com/recherche/lots?search={s}&area=france
invak	INVAK.INFO	invak.info/?s={s}
ipapi	IP-API.com	ip-api.com/#{s}
iploc iplocation	IP Location	www.iplocation.net/?query={s}
isaca	ISACA.org	www.isaca.org/Search/Pages/DefaultResults.aspx?k=Test&s={s}
iserv	iservfr	www.iserv.fr/?s={s}
itrig	ITrig	www.itrig.de/index.php?serendipity[action]=search&serendipity[fullentry]=1&serendipity[searchTerm]={s}
iupac	International Union of Pure and Applied Chemistry	iupac.org/?s={s}
ivoox	ivoox	www.ivoox.com/{s}_sb.html
iwant	iWantMyName	iwantmyname.com/search?domain={s}
iwiki	The iPhone Wiki	www.theiphonewiki.com/w/index.php?search={s}&title=Special:Search&go=Go
iwoot	I Want One Of Those	www.iwoot.com/elysium.search?search={s}
ixigo	ixigo	ixigo.com/q/{s}
izneo	izneo	www.izneo.com/search.html?pattern={s}
jalop jalopnik	Jalopnik	jalopnik.com/search?q={s}
jamie	Jamie Oliver	www.jamieoliver.com/search/?s={s}
janus	Cambridge ArchiveSearch	archivesearch.lib.cam.ac.uk/search?utf8=%E2%9C%93&op[]=&q[]={s}
java4	Java4 Docs	search.oracle.com/search/search?tzoffset=420&default=true&q={s}+url:/javase/1.4.2/docs&start=1&nodeid=&fid=&showSimilarDoc=true&group=Documentation&keyword=&x=0&y=0
java5	Java5 Docs	search.oracle.com/search/search?tzoffset=420&default=true&q={s}+url:/javase/1.5.0/docs&start=1&nodeid=&fid=&showSimilarDoc=true&group=Documentation&keyword=&x=0&y=0
java6	Java6 Docs	search.oracle.com/search/search?tzoffset=420&default=true&q={s}+url:/javase/6/docs&start=1&nodeid=&fid=&showSimilarDoc=true&group=Documentation&keyword=&x=0&y=0
java7	Oracle Help Center	docs.oracle.com/apps/search/search.jsp?q={s}&category=java&product=e17409-01
jedis	https://www.jedisjeux.net/	www.jedisjeux.net/search_results.php?search={s}&button_search=Ok
jimms	Jimm's	www.jimms.fi/fi/Product/Search?q={s}
joann	Joann	www.joann.com/search?q={s}
joker	Joker	www.joker.be/nl/groepsreizen/{s}
jolla	Jolla Questions	together.jolla.com/questions/scope:all/sort:activity-desc/page:1/query:{s}/
jpdic	Naver Japanese Dictionary	jpdic.naver.com/search.nhn?query={s}
jpost	Japan Post Tracking	trackings.post.japanpost.jp/services/srv/search/direct?searchKind=S004&locale=en&reqCodeNo1={s}
jstor	JSTOR	www.jstor.org/action/doBasicSearch?Query={s}
juick	juick.com	juick.com/?search={s}
julia	Julia language documentation	docs.julialang.org/en/latest/search?q={s}
jumps	Jumping Spectacles	www.jumps.nl/index.php/component/finder/search?q={s}&Itemid=106
junat	Junat.net	www.junat.net/en/{s}
jusbr jusbrasil	JusBrasil	www.jusbrasil.com.br/busca?q={s}
kabum	KaBuM	www.kabum.com.br/cgi-local/site/listagem/listagem.cgi?string={s}&btnG=
kafto	Kafto	www.kafto.gr/?s={s}
kahta	Kahta Haber	www.kahtahaber.com/search?q={s}
kanji	Kanji Alive	app.kanjialive.com/search/{s}
kayak	KAYAK	www.kayak.com/sherlock/opensearch/search?q={s}
kbugs kdebugs	KDE Bugtracking System	bugs.kde.org/buglist.cgi?quicksearch={s}
keepa	Keepa	keepa.com/#search/x-{s}
keras	Keras Documentation	keras.io/search.html?q={s}
kirby	Kirby	getkirby.com/search?q={s}
kjell	Kjell & Company	www.kjell.com/Sok?query={s}
kkbox	KKBOX	www.kkbox.com/search.php?search=mix&word={s}
kktix	KKTIX	kktix.com/events?search={s}
klein	eBay Kleinanzeigen	www.ebay-kleinanzeigen.de/{s}/k0
klipy	KLIPY	klipy.com/search/{s}
kmart	Kmart	www.kmart.com/shc/s/search_10151_10104?keyword={s}
kogan	Kogan.com	www.kogan.com/au/shop/?q={s}
kohls	Kohl's	www.kohls.com/search.jsp?search={s}
kolli	Posten AB	www.postnord.se/sv/verktyg/sok/Sidor/spara-brev-paket-och-pall.aspx?view=item&itemid={s}
konga	Konga	www.konga.com/catalogsearch/result/?cat=0&q={s}
krebs	Krebs On Security	krebsonsecurity.com/?s={s}
krita	Krita Docs	docs.krita.org/index.php?search={s}
ksppc	KSP	ksp.co.il/index.php?txt_search={s}
kulib	University of Kansas Library Catalog	catalog.lib.ku.edu/cgi-bin/Pwebrecon.cgi?Search_Arg={s}&SL=None&Search_Code=FT*&PID=vT8gNN42qqUs0JjgNd8tssHev&SEQ=20180430021422&CNT=25&HIST=1&kujSubmitButtonName=Search
kuran	Kuran Ara	kuranara.com/ara?q={s}
kvkde	Karlsruher Virtueller Katalog (DE, Titel)	kvk.bibliothek.kit.edu/hylib-bin/kvk/nph-kvk2.cgi?maske=kvk-redesign&lang=de&title=KIT-Bibliothek:+Karlsruher+Virtueller+Katalog+KVK+:+Ergebnisanzeige&head=//kvk.bibliothek.kit.edu/asset/html/head.html&header=//kvk.bibliothek.kit.edu/asset/html/header.html&spacer=//kvk.bibliothek.kit.edu/asset/html/spacer.html&footer=//kvk.bibliothek.kit.edu/asset/html/footer.html&css=none&input-charset=utf-8&ALL=&TI={s}&AU=&CI=&ST=&PY=&SB=&SS=&PU=&kataloge=SWB&kataloge=BVB&kataloge=NRW&kataloge=HEBIS&kataloge=HEBIS_RETRO&kataloge=KOBV_SOLR&kataloge=GBV&kataloge=DDB&kataloge=STABI_BERLIN&kataloge=TIB&kataloge=OEVK_GBV&kataloge=VD16&kataloge=VD17&kataloge=VD18&kataloge=VOE&kataloge=ZDB&ref=direct&client-js=yes
kyobo	Kyobo Book Centre	search.kyobobook.co.kr/web/search?vPstrKeyWord={s}
lamps	Lamps.com	www.lamps.com/catalogsearch/result?q={s}
laser lasership	LaserShip	lasership.com/track/{s}
lawtw	Laws & Regulations Database of The Republic of China	law.moj.gov.tw/Law/LawSearchResult.aspx?ty=ONEBAR&kw={s}
lazth lzdth	Lazada Thailand	www.lazada.co.th/catalog/?q={s}
lbcra	Le Bon Coin Rhone-Alpes	www.leboncoin.fr/recherche/?text={s}&regions=22
lconj	Larousse Conjugaison	www.larousse.fr/conjugaison/francais/{s}
ldsdk	Lav-det-selv.dk	www.lav-det-selv.dk/find?q={s}
learn	Learningapps	learningapps.org/index.php?s={s}
legal	Google Scholar - Legal Opinion Section	scholar.google.com/scholar?hl=en&q={s}&btnG=Search&as_sdt=2,5&as_ylo=&as_vis=0
leifi	Leifi Physik	www.leifiphysik.de/suche?search_api_fulltext={s}
lenfr linfe	Linguee (fr2en)	www.linguee.fr/francais-anglais/search?query={s}
leons	Leon's Furniture	www.leons.ca/pages/search-results?limit=48&q={s}
leopl	Leo (Polski-Deutsch)	dict.leo.org/plde/?search={s}
leopt	LEO Dictionary Portuguese	dict.leo.org/portugiesisch-deutsch/{s}
lesfr	linguee Es-Fr	www.linguee.fr/francais-espagnol/search?source=espagnol&query={s}
letra	Letras.top	letras.top/results/?q={s}
lexin	Lexin (Norsk Ordbok)	lexin.udir.no/?search={s}&dict=nbo-maxi&ui-lang=NBO&startingfrom=&count=10&checked-languages=E&checked-languages=N
lexml	LexML Brasil	www.lexml.gov.br/busca/search?keyword={s}&f1-tipoDocumento=
libby	Libby, By Overdrive	libbyapp.com/library/reads/search/query-{s}/page-1
libro	Libro.fm	libro.fm/search?utf8=%E2%9C%93&q={s}
librs	lib.rs	lib.rs/search?q={s}
libth	Municipal Library of Thessaloniki	lib.thessaloniki.gr/ipac20/ipac.jsp?session=14048C549F1N5.44906&menu=search&aspect=subtab37&npp=10&ipp=20&spp=20&profile=central--1&ri=&term={s}&index=.GW&x=0&y=0&aspect=subtab37
libuv	Libuv API Docs	docs.libuv.org/en/latest/search.html?q={s}&check_keywords=yes&area=default
lihkg	Lihkg	lihkg.com/search?q={s}
linbr	Linguee (pt2en)	www.linguee.com.br/portugues-ingles/search?source=auto&query={s}
lindp lingp	Linguee (de2pt)	www.linguee.de/deutsch-portugiesisch/search?source=auto&query={s}
lineg liende tlenge	Linguee (en2de)	www.linguee.com/english-german/search?source=auto&query={s}
linei	Linguee (it2en)	www.linguee.it/italiano-inglese/search?query={s}
linen	Linguee English - Dutch	www.linguee.com/english-dutch/search?source=auto&query={s}
linep linpe	Linguee (en2pt)	www.linguee.com/english-portuguese/?query={s}
lines	Linguee (en2es)	www.linguee.com/english-spanish/?query={s}
linge	linguee	www.linguee.com/deutsch-englisch/search?source=auto&query={s}
lingo netlingo	NetLingo	www.netlingo.com/search.php?searchtxt={s}
linkl	LinkLocker	linklocker.co/search?query={s}
linse	Linguee Swedish	www.linguee.com/english-swedish/search?query={s}
linsv	Linguee English-Swedish	www.linguee.com/english-swedish/search?source=auto&query={s}
linux	Explicativo Linux	explicativolinux.wordpress.com/?s={s}
lipad	Linked Parliamentary Data: Canadian Hansard Dataset	www.lipad.ca/search/?q={s}
lirik	Lirik	lirik.web.id/results/?q={s}
litfl	LITFL	litfl.com/?s={s}
livec	LiveChart.me	www.livechart.me/search?q={s}
loask	Ask LibreOffice	ask.libreoffice.org/en/questions/scope:all/sort:activity-desc/page:1/query:={s}/
local glocal	Google Local	local.google.com/maps?f=q&source=s_q&geocode=&q={s}
locfr	Local.ch	tel.local.ch/fr/q?what={s}
logos instantlogo	Instant Logo Search	instantlogosearch.com/?q={s}
lowes	Lowes	www.lowes.com/SearchCatalogDisplay?Ntt={s}#!
lpbug	Launchpad Bugs	bugs.launchpad.net/bugs/+bugs?field.searchtext={s}
lqpcs	Liquipedia	liquipedia.net/counterstrike/index.php?search={s}
ls.sv	Langenscheid dictionary Swedish-German	de.langenscheidt.com/schwedisch-deutsch/search?term={s}&q_cat=/schwedisch-deutsch/
lukol	Lukol	www.lukol.com/s.php?q={s}
lumas	Lumas	www.lumas.de/search/?q={s}
lumen	LumenDatabase	lumendatabase.org/notices/search?utf8=%E2%9C%93&term={s}
luzme	Luzme	luzme.com/search_all?keyword={s}
lvmag	Linux Voice	www.linuxvoice.com/?s={s}
lycos	Lycos	search.lycos.com/web?q={s}
lynda	Lynda.com	www.lynda.com/search?q={s}
lzdmy	Lazada Malaysia	www.lazada.com.my/catalog/?q={s}
maany almaanyen	Almaany	www.almaany.com/ar/dict/ar-en/{s}/
macid everymac	EveryMac.com	www.everymac.com/ultimate-mac-lookup/?search_keywords={s}
macys	Macy's	www.macys.com/shop/featured/{s}
mafia mafiasi	Mafiasi Wiki	www2.informatik.uni-hamburg.de/fachschaft/wiki/index.php?search={s}
magma	Magma	magma.maths.usyd.edu.au/magma/handbook/search?query={s}&intrinsics=1
magpi	MagPi	www.raspberrypi.org/magpi/?s={s}
makro	Makro.cz	www.makro.cz/vyhledavani?q={s}
mamma	Mamma	www.mamma.com/result.php?q={s}&type=web
man-k	man-k.org	man-k.org/search?q={s}&dist=NetBSD-current
mands	Marks & Spencer	www.marksandspencer.com/gp/search?field-keywords={s}
manjf	Manjaro Forum	forum.manjaro.org/search?expanded=true&q={s}
manjw manjaro	Manjaro Wiki	wiki.manjaro.org/index.php?search={s}&title=Special:Search
manta	Manta	www.manta.com/mb?search={s}
mappy	Mappy FR	fr.mappy.com/#/TSearch/S{s}
marca	Marca	cgi.marca.com/buscador/archivo_marca.html?q={s}
march metal maband metallum metalarch	Metal Archives	www.metal-archives.com/search?searchString={s}&type=band_name
markt	Markt.de	www.markt.de/muenchen/keywords,{s}/suche.htm
matpl	Forum Matematyka.pl	www.matematyka.pl/search.php?keywords={s}
maven	Maven Central Repository	central.sonatype.com/search?q={s}&smo=true
mavin	Mavin Price Guide	mavin.io/search?q={s}
mbdoc	MusicBrainz documentation	musicbrainz.org/search?query={s}&type=doc
mblue meteoblue	meteoblue	www.meteoblue.com/?q={s}
mbrec	MusicBrainz	musicbrainz.org/search?query={s}&type=recording&method=indexed
mbtag	MusicBrainz tags	musicbrainz.org/search?query={s}&type=tag
mdash	The M Dash	mmlafleur.com/mdash/search/{s}
mdbgt	MDBG	www.mdbg.net/chindict/chindict.php?page=worddict&wdrst=1&wdqb={s}
mdnio	mdn.io	mdn.io/{s}
mdona	Mercadona	tienda.mercadona.es/search-results?query={s}
melon	Melon	www.melon.com/search/total/index.htm?q={s}
melpa	MELPA	melpa.org/#/?q={s}
merit meritbadge	MeritBadgeDotOrg	meritbadge.org/wiki/index.php/Special:Search?search={s}
metar	AV-WX (Aviation Weather)	av-wx.com/?search={s}&mode=metar
metro	Metro Grocery Store	www.metro.ca/en/search?free-text={s}
mgtbk	Managementboek.nl	www.managementboek.nl/zoeken?c=&q={s}
milog	Milog	milog.co.il/{s}
minds	Minds.com	www.minds.com/search;q={s}
mises	Mises Institute	mises.org/search/site/{s}
mlpes	Medline plus in spanish	vsearch.nlm.nih.gov/vivisimo/cgi-bin/query-meta?v:project=medlineplus-spanish&v:sources=medlineplus-spanish-bundle&query={s}
mlpit	Multiplayer.it	multiplayer.it/ricerca/?q={s}
mmoga	MMOGA	www.mmoga.de/advanced_search.php?keywords={s}
mobce	Mobile Centre	mobilecentre.am/search/?searchData={s}
moddb	ModDB	moddb.com/search?q={s}
monde lemonde	Le Monde	www.lemonde.fr/recherche/?search_keywords={s}
money	Money Badger by StockTwits	moneybadger.stocktwits.com/?s={s}
mongo mongodb	MongoDB	docs.mongodb.org/search/?q={s}
mooji	Mooji TV	mooji.tv/freemedia/?_fm_s={s}
morbo morbotron	Morbotron	morbotron.com/?q={s}
mozpb	Mozilla Phonebook	phonebook.mozilla.org/?search/{s}
mozsf	Mozilla Searchfox	searchfox.org/mozilla-central/search?q={s}
mpora	MPORA	mpora.com/search/videos?q={s}
mscpp	Microsoft Docs C++	docs.microsoft.com/en-us/search/index?search={s}&scope=C++
msnbc	MSNBC	www.msnbc.com/search/{s}
mssql	Microsoft TechNet SQL Server	social.technet.microsoft.com/Search/en-US/sqlserver?query={s}&Refinement=30&ac=4
mtggf	mtgGoldfish	www.mtggoldfish.com/q?query_string={s}
mtmod	Minetest ContentDB	content.minetest.net/packages/?q={s}
mudah	Mudah.my	m.mudah.my/list?q={s}&ca=9_3_s&sa=&cg=&catname=All+Categories&o=1&f=p&srch=1&so=1
muzli	Muzli Search	search.muz.li/search/{s}
mwave	MWAVE	www.mwave.com.au/searchresult?w={s}
mycom	MyCom	mycom.nl/search/{s}
mydns	My Privat DNS	mypdns.org/trac/search?q={s}
myrec	MyRecipes	www.myrecipes.com/search?q={s}
mysku	Mysku.ru	mysku.ru/search/topics/?q={s}
nabre	BibleGateway NABRE	www.biblegateway.com/passage/?search={s}&version=NABRE
najdi	Najdi.si	www.najdi.si/search.jsp?q={s}
nbang	Kagi Bangs repo	github.com/search?q=repo:kagisearch/bangs+{s}&type=code
nbcde	Notebookcheck(DE)	www.notebookcheck.com/Notebook-Suche.1095.0.html?&manufacturer=&model={s}
nciku	Nciku.com	www.nciku.com/search/all/{s}
neo4j	Neo4j	neo4j.com/?s={s}
newsh	NewsHub	us.newshub.org/search/{s}/us/all/p1
nflps	NFL Player Search	www.nfl.com/players/search?category=name&filter={s}
nginx	Nginx Docs	docs.nginx.com/search.html#q={s}&sort=relevancy
ngram ngrams	Google Ngram Viewer	books.google.com/ngrams/graph?content={s}&year_start=1800&year_end=2000&corpus=15&smoothing=3
niche	Niche	www.niche.com/search/?q={s}
niice	niice.co	niice.co/?search={s}
nikon	Nikon USA	www.nikonusa.com/en/about-nikon/search.page?searchCollection=SEARCH_ALL&q={s}
nitrc	NITRC	www.nitrc.org/search/?type_of_search=group&term[]={s}
nlife ninlife nintendolife	Nintendo Life	www.nintendolife.com/search?q={s}&submit=Go
nofap	NoFap	www.reddit.com/r/NoFap/search/?q={s}&restrict_sr=1
noita	Noita Wiki	noita.wiki.gg/index.php?search={s}
nomad	Nomad List	nomadlist.com/?q={s}
norid	Norid	www.norid.no/?s={s}
nrktv	NRK TV	tv.nrk.no/sok?q={s}
nsuns	Dr Workout	www.drworkout.fitness/?s={s}
nuget	nuget gallery	nuget.org/packages?q={s}&sortOrder=package-download-count
numpy	numpy	docs.scipy.org/doc/numpy/search.html?q={s}&check_keywords=yes&area=default
nzqas	NZQA Standards	www.nzqa.govt.nz/ncea/assessment/view-detailed.do?standardNumber={s}
obiat	Obi Austria	www.obi.at/searchresult/?isi=true&searchTerm={s}
obspy	Obspy documentation	docs.obspy.org/search.html?q={s}
ocado	Ocado	www.ocado.com/webshop/getSearchProducts.do?entry={s}
ocaml	OCaml Lib Ref	caml.inria.fr/pub/docs/manual-ocaml/libref/{s}.html
ocdoc	Official documentation of OpenComputers	ocdoc.cil.li/doku.php?id=start&do=search&q={s}
odota opendota	OpenDota	www.opendota.com/search?q={s}
olxbg	OLX Bulgaria	www.olx.bg/ads/?q={s}
olxbr	OLX.com.br	www.olx.com.br/brasil?q={s}
olxin	Olx India	www.olx.in/items/q-{s}?isSearchCall=true
olxpl olxpoland	OLX.pl	olx.pl/oferty/q-{s}/
olxpt	OLX Portugal	www.olx.pt/ads/q-{s}
olxro	OLX Romania	www.olx.ro/ads/?q={s}
olxua	OLX Ukraine	olx.ua/uk/list/q-{s}/
omaps	World of O	omaps.worldofo.com/index.php?st={s}
omeka	Omeka Forums	forum.omeka.org/search?q={s}
onbit	Onbit	www.onbit.pt/catalogsearch/result/?q={s}
onion theonion	The Onion	www.theonion.com/search/?q={s}
opera	Opera Extension	addons.opera.com/addons/extensions/?query={s}
opeuw euw.op opggeuw	op.gg	euw.op.gg/summoner/userName={s}
oplas	OP.GG LAS - League of Legends Summoners statistics and MMR	las.op.gg/summoner/userName={s}
opoce	OP.GG Oceania - League of Legends Summoners statistics and MMR	oce.op.gg/summoner/userName={s}
opood	oomipood	www.oomipood.ee/product/search?q={s}
optus	Optus	www.optus.com.au/customercentre/search?query={s}
orcid	ORCID	orcid.org/orcid-search/quick-search?searchQuery={s}
ordfr	Ord.se FR	www.ord.se/oversattning/franska/?s={s}&l=FRASVE
ordsv	Ord.se SV	www.ord.se/oversattning/Svenska/?s={s}&l=SVESVE
oring	The O-Ring Store LLC	www.theoringstore.com/index.php?main_page=advanced_search_result&search_in_description=1&keyword={s}
osalt	Open Source Alternative	osalt.com/search?q={s}
osdev	OSDev Wiki	wiki.osdev.org/index.php?title=Special:Search&search={s}&fulltext=Search
oslri	Ocean State (Rhode Island) Libraries	catalog.oslri.net/Union/Search?view=list&lookfor={s}&searchIndex=Keyword&searchSource=local
osmfr	OpenStreetMap-fr	tile.openstreetmap.fr/?q={s}
osrsw osrswiki	Old School Runescape Wiki	oldschool.runescape.wiki/?search={s}
othde othesa thesaurusde deopenthesaurus	OpenThesaurus-de	www.openthesaurus.de/synonyme/{s}
owasp	OWASP	www.owasp.org/index.php?search={s}
owler	Owler	www.owler.com/iaApp/browsecompanyprofiles.htm?searchTerm={s}
oxbib	Oxford Bibliographies	www.oxfordbibliographies.com/search?q={s}
ozdic	OZDIC	ozdic.com/collocation/{s}
p6mod perlmod6	Perl 6 Modules Directory	modules.perl6.org/search/?q={s}
packt	Packt	www.packtpub.com/all/?search={s}
paleo	Paleo Hacks	www.paleohacks.com/searches?utf8=%E2%9C%93&query={s}&commit=Search
palio	Archivio del Palio di Siena	www.ilpalio.siena.it/5/cerca.aspx?q={s}
panda	Pandalook	pandalook.com/search?controller=search&search_query={s}
paper	Paperity - first open science aggregator	paperity.org/search/?q={s}
papps portableapps	PortableApps.com	portableapps.com/search/node/{s}
parts	Parts.io	parts.io/search/term-{s}
pathe	Pathe	www.pathe.nl/Zoek?q={s}
pauly	Der Neue Pauly (Brill)	referenceworks.brillonline.com/search?s.q={s}&s.f.s2_parent=s.f.book.der-neue-pauly&search-go=Search
paytm	PayTM	paytm.com/shop/search/?q={s}
pbolo	PBolo	pbolo.com/?s={s}
pbone	RPM.pbone.net	rpm.pbone.net/index.php3?stat=3&search={s}&Search.x=0&Search.y=0&simple=1&srodzaj=1
pbtag	Pinboard.in (Tag)	pinboard.in/t:{s}
pcmag	PCMag	www.pcmag.com/search_redirect/?qry={s}&searchSection=0&site=3
pcper	PC Perspective	www.pcper.com/search/node/{s}
pcsx2	PCSX2	wiki.pcsx2.net/index.php?search={s}
pdsls	PDSls	pds.ls/?q={s}
peixe	Peixeurbano	www.peixeurbano.com.br/#q={s}
perch	Perch Forum	forum.grabaperch.com/forum/search?query={s}
petco	Petco	www.petco.com/shop/en/petcostore/search?query={s}
phind	Phind	www.phind.com/search?q={s}
phish	Phish.Net	phish.net/song/?s={s}
phone rphone	Whitepages	www.whitepages.com/phone/{s}
phset	phish.net	phi.sh/{s}
pier1	Pier1 Imports	www.pier1.com/on/demandware.store/Sites-pier1_us-Site/default/Search-ShowContent?q={s}
pirsa	Perimeter Institute Recorded Seminar Archive	pirsa.org/index.php?p=speaker&name={s}
pixel	Official Pixelmon Wiki	pixelmonmod.com/wiki/index.php?title={s}
pixiv	Pixiv	www.pixiv.net/search.php?word={s}
pkgrd	PackageRadar	packageradar.com/form?tracking_form[tracking_number]={s}
pkgtr	Package Trackr	www.packagetrackr.com/track/{s}
plane	planespotters.net	www.planespotters.net/search.php?q={s}
plase	Plase.Net	plase.net/?s={s}&post_type=product
plone	Plone	plone.org/@@search?SearchableText={s}
plurk	Plurk	www.plurk.com/search?q={s}
pmuse	Project Muse	muse.jhu.edu/search?action=search&query=content:{s}:and&min=1&max=10&t=header
podio	Podio	podio.com/search#/query/{s}
poedb	Path of Exile Database	poedb.tw/us/search.php?Search={s}
poems poetry	The Poetry Foundation	www.poetryfoundation.org/search?query={s}
poets	Academy of American Poets	www.poets.org/search/node/{s}
polet vinmonopolet	Vinmonopolet	www.vinmonopolet.no/search?q={s}
pond5	Pond5	www.pond5.com/stock-video-footage/1/{s}.html
poppy	Poppypedia	poppy.fandom.com/wiki/Special:Search?query={s}
ports	Speedguide.net Port Lookup	www.speedguide.net/port.php?port={s}
poser	EvilInnocence	www.evilinnocence.com/shop/catalogsearch/result/?q={s}
posix	The Open Group Base Specifications	pubs.opengroup.org/cgi/kman5.cgi?value={s}
poste	Poste Italiane	www.poste.it/cerca/index.html#/risultati-spedizioni/{s}
potco	Pirates Online Wiki	piratesonline.fandom.com/wiki/Special:Search?query={s}
pouet	Pouet	pouet.net/search.php?what={s}&type=prod
poycp	Put on Your Cake Pants	putonyourcakepants.com/?s={s}
ppdev	PayPal Developer	developer.paypal.com/search/?q={s}
press	PR Wire Pro	prwirepro.com/?s={s}
prezi	Prezi	prezi.com/explore/search/?search={s}
primo	Bibliothekskatalog Primo der FU Berlin	fu-berlin.hosted.exlibrisgroup.com/primo-explore/search?query=any,contains,{s}&tab=fub&search_scope=FUB_ALL&vid=FUB&lang=de_DE&offset=0
proll	Precision Roller	www.precisionroller.com/search.php?q={s}
proof	Proof Wiki	proofwiki.org/w/index.php?search={s}
psgca	PlayStation Store Games Canada	store.playstation.com/en-ca/grid/search-game/1?query={s}
psnde	PlayStation Store Deutschland	store.playstation.com/de-de/search/{s}
psnjp	Playstation Store JP	store.playstation.com/ja-jp/search/{s}
psnnz	Playstation Store NZ	store.playstation.com/en-nz/grid/search-game/1?query={s}
psnuk	Playstation Store UK	store.playstation.com/#!/en-gb/search/q={s}
psudc dailycollegian	The Daily Collegian	www.collegian.psu.edu/search/?f=html&q={s}
psych	American Psychiatric Association	psychiatry.org/home/search-results?k={s}
ptube	PeerTube	peer.tube/search?search={s}
publc	PUBLC	publc.com/{s}
py3fr	Python3 Documentation (French)	docs.python.org/fr/3/search.html?q={s}
pymel	Maya PyMEL documentation	help.autodesk.com/cloudhelp/2018/ENU/Maya-Tech-Docs/PyMel/search.html?q={s}&check_keywords=yes
pyqt5	PyQt5	www.riverbankcomputing.com/static/Docs/PyQt5/search.html?q={s}&check_keywords=yes&area=default
qiita	Qiita	qiita.com/search?q={s}
qmaps	Qwant Maps	www.qwant.com/maps/?q={s}
qobuz	Qobuz	www.qobuz.com/recherche?q={s}
r/leb	r/leb	www.reddit.com/r/lebanon/search?q={s}
radhd	r/ADHD	www.reddit.com/r/ADHD/search/?q={s}&restrict_sr=1
rails	Rails API	api.rubyonrails.org/?q={s}
rakde	Rakuten.de	www.rakuten.de/suchen/{s}?category=0
ralit	Rockwell Automation Literature	search.rockwellautomation.com/search?q={s}&client=literature&filter=0&ie=UTF-8&oe=UTF-8&output=xml_no_dtd&proxystylesheet=literature&site=literature&getfields=*&lang=en&hl=en&num=20&requiredfields=xlanguage:MU|xlanguage:EN
ramda	Ramda Javascript library	ramdajs.com/docs/#{s}
randt roadandtrack	Road & Track	www.roadandtrack.com/search/?q={s}
ratko	Ratkojat	www.ratkojat.fi/hae?s={s}
rblxg robloxu	Roblox Users	www.roblox.com/search/users?keyword={s}
rbndx	Reverse Beacon Network - DX station	www.reversebeacon.net/dxsd1/dxsd1.php?f=0&c={s}&t=dx
rbtag	radio-browser.info	www.radio-browser.info/gui/#!/bytag/{s}
rbtmu	rbtmu	rbt.asia/mu/search/text/{s}/
rdvcb romajidesuvcb	Romajidesu Vocabulary	www.romajidesu.com/?m=dictionary&a=lookup&w={s}
realo	Realo	realo.com/search?q={s}
rebel	REBEL.pl	www.rebel.pl/e4u.php/1,ModProducts/Search?search[submit]=1&search[phrase]={s}
rebuy	reBuy.de Kaufen	www.rebuy.de/kaufen/suchen?q={s}
recon	Watch Recon	www.watchrecon.com/?query={s}
redis	Redis Command Reference	redis.io/commands/{s}
regex	Regular Expression Library	www.regexlib.com/Search.aspx?k={s}
repum	Repositorium University of Minho	repositorium.sdum.uminho.pt/simple-search?query={s}
resow resowiki resonitewiki	Resonite Wiki	wiki.resonite.com/index.php?search={s}
retro	RetroPie	retropie.org.uk/forum/search?term={s}&in=titlesposts&matchWords=all&sortBy=relevance&sortDirection=desc&showAs=posts
retty	Retty	retty.me/restaurant-search/search-result/?free_word_category={s}
revau	Reverse Australia	www.reverseaustralia.com/search.php?search={s}
revef reenfr reversoenfr reversofren	Reverso English - French	dictionary.reverso.net/english-french/{s}
revgf	Reverso (German-French)	dictionary.reverso.net/german-french/{s}
rexel	Rexel	www.rexel.de/search/?text={s}
rgate researchgate	ResearchGate	www.researchgate.net/search/publications?q={s}
rhino	Food4Rhino	www.food4rhino.com/browse?searchText={s}
rhydo	rhydoLABZ	www.rhydolabz.com/advanced_search_result.html?keyword={s}
right	rightrelevance	www.rightrelevance.com/search/articles?query={s}
riten reviten	Reverso Context (iten)	context.reverso.net/translation/italian-english/{s}
ritru	Reverso Context	context.reverso.net/translation/italian-russian/{s}
rmail	Royal mail tracking ID	www.royalmail.com/track-your-item#/tracking-results/{s}
rmelb	r/Melbourne	www.reddit.com/r/melbourne/search?q={s}&restrict_sr=on&sort=relevance&t=all
roget	Roget's Hyperlinked Thesaurus	www.roget.org/scripts/qq.php?seekword={s}
rostr	Disney Rostr	rostr.disney.com/search_results?query={s}
rot13	Decode	decode.org/?q={s}
rozet	Rozet Haber	rozethaber.com/search/{s}
rpcs3	RPCS3 Wiki	wiki.rpcs3.net/index.php?title=Special%3ASearch&search={s}
rseek	RSeek	www.rseek.org/?q={s}
rsssh	RSSsearchhub	www.rsssearchhub.com/feeds/?search={s}
rsvce	BibleGateway: Revised Standard Version Catholic Edition	www.biblegateway.com/passage/?search={s}&version=RSVCE
rtboi	Binding of Isaac subreddit	www.reddit.com/r/bindingofisaac/search?q={s}&restrict_sr=on
rtikb	RTI Knowledge Base	community.rti.com/search/kb/{s}
rusta	Rusta	www.rusta.com/se/Sok/{s}/
rustn	Rust Nightly Standard Library Documentation	doc.rust-lang.org/nightly/std/?search={s}
ruten	ruten	find.ruten.com.tw/search/s000.php?enc=u&searchfrom=searchf&k={s}&t=0
rwiki	The Reader Wiki	thereaderwiki.com/en/{s}
ryans	Ryans Computers	ryanscomputers.com/catalogsearch/result/?q={s}
ryear	Reddit (past year (and more))	www.reddit.com/search?q={s}&t=year
ryfma	Ryfma	ryfma.com/search/{s}
s-off ssoff	DuckDuckGo Safe Search Off	duckduckgo.com/?q={s}&kp=-2
saavn	Saavn	www.jiosaavn.com/search/{s}
salam	Salam	salamtm.blogspot.com/search/?term={s}
salix	SalixOS	www.salixos.org/wiki/index.php/Special:Search?search={s}
salon	Salon.com	www.salon.com/search/{s}
salsa	Debian Salsa	salsa.debian.org/search?search={s}
samba	Samba Wiki	wiki.samba.org/index.php?title=Special:Search&search={s}&go=Go
sapdl	SAP Downloads	launchpad.support.sap.com/#/softwarecenter/search/{s}
sapna	SapnaOnline	sapnaonline.com/general-search?searchkey={s}
sarna	Sarna	www.sarna.net/wiki/index.php?search={s}
scala scaladoc scalalang	Scala doc	www.scala-lang.org/api/current/?search={s}
schuh	Schuh	www.schuh.co.uk/results.aspx#st={s}
scifi wwend	Worlds Without End	www.worldswithoutend.com/searchwwe.asp?st={s}
scipy	SciPy	docs.scipy.org/doc/scipy/search.html?q={s}&check_keywords=yes&area=default
sconj conjes	SpanishDict - Conjugate	www.spanishdict.com/conjugate/{s}
scoop	Scoop	scoop.sh/#/apps?q={s}
score	IMSLP (Petrucci Music Library)	imslp.org/index.php?search={s}
scots	scots dictionary	www.dsl.ac.uk/results/{s}
scout	scout.com	www.scout.com/news?query={s}
scuba	Scuba.com	www.scuba.com/resources/search1.aspx?Action=Search&Search={s}
sdict spanish spandict spanishd spanishdict	SpanishDict	www.spanishdict.com/translate/{s}
sears	Sears	www.sears.com/shc/s/search_10153_12605?keyword={s}
senta sentireascoltare	Sentire Ascoltare	sentireascoltare.com/?s={s}
sfbok	Science Fiction Bokhandeln	www.sfbok.se/search?keys={s}
shout	ShoutMeLoud	www.shoutmeloud.com/?s={s}
shura	Sheffield Hallam University Research Archive (SHURA)	shura.shu.ac.uk/cgi/facet/simple2?q={s}
siabr	Devo Atender?	br.shouldianswer.net/numero-de-telefone/?q={s}
sigma	Sigma Aldritch Catalog	www.sigmaaldrich.com/catalog/search?interface=All&term={s}
simpl	Simply Recipes	www.simplyrecipes.com/?s={s}
singa	Singa	singa.com/search/results/{s}
sisku sutysisku	la sutysisku	la-lojban.github.io/sutysisku/en/#sisku/{s}
sitag	SITAG - swiss style at work	www.sitag.ch/suchen/?tx_indexedsearch[sword]={s}
sjcpl	St. Joeseph Co. Public Library	stjos.sjcpl.lib.in.us/search/?searchtype=X&SORT=D&searcharg={s}
sk98q	sk98q	wiki.sk89q.com/w/index.php?title=Special:Search&profile=default&search={s}&fulltext=Search
skill skillshare	Skillshare	www.skillshare.com/search?query={s}
slang	The Online Slang Dictionary	onlineslangdictionary.com/definition+of/{s}
slate	Slate	www.slate.com/search.html#search={s}
slcpl	Salt Lake City Public Library	catalog.slcpl.org/search/searchresults.aspx?term={s}
slink springer springerfree springerlink	Springer Link	link.springer.com/search?query={s}
smart	Smarticular	www.smarticular.net/?s={s}
smgsm smogon	Smogon Dex Sun and Moon	www.smogon.com/dex/sm/pokemon/{s}
smime	Posteo S/MIME Certificate Search	api.posteo.de/v1/public-keys/{s}?type=smime
smite	Smite Wiki	smite.gamepedia.com/index.php?search={s}&title=Special:Search&go=Go
sniff	Websniffer	websniffer.cc/?url={s}
snort	Snort	www.snort.org/search?query={s}
snotr	Snotr	www.snotr.com/search/?search={s}
socvi	stackoverflow.com	stackoverflow.com/search?q=[labwindows]+{s}
sojob	StackOverflow Jobs	stackoverflow.com/jobs?q={s}
soloj	SOLO journals	solo.bodleian.ox.ac.uk/primo-explore/search?query=any,contains,{s}&tab=local&search_scope=LSCOP_ALL&vid=SOLO&facet=rtype,include,journals&lang=en_US&offset=0
sonet	So-net	www.so-net.ne.jp/search/web/?query={s}
spare	SpareRoom	www.spareroom.co.uk/flatshare/flatshare_detail.pl?flatshare_id={s}
spele	spele.nl	spele.nl/zoeken/?q={s}
speur	Speurders	www.speurders.nl/overzicht/?query={s}
spice	Spiceworks Community	community.spiceworks.com/search?query={s}
spics	Site Pictures	site.pictures/search/images/?q={s}
sppit	Startpage safeoff ita	startpage.com/do/search?prf=77fe802d54508e9ee48b88624be6da56&cat=web&query={s}
sprkr	Spreaker	www.spreaker.com/search?query={s}
sqlsh	SQL.sh	sql.sh/?s={s}&submit=Rechercher
srtop	Subreddit sorted top/ all time	www.reddit.com/r/{s}/top/?sort=top&t=all
ssaft	Strange Stuff And Funky Things	ssaft.com/Blog/dotclear/?q={s}
ssbno	Statistisk Sentralby - Statistics Norway	www.ssb.no/sok?sok={s}
ssnap	Soundsnap	www.soundsnap.com/search/audio/{s}/score
ssoar	SSOAR	www.ssoar.info/ssoar/discover?query={s}
ssptv	SSPTV	www.ssptv.com/?s={s}
ssses	SimilarSiteSearch (es)	www.similarsitesearch.com/es/sitio/{s}
stabs songsterr	Songsterr	www.songsterr.com/a/wa/search?pattern={s}
start	startpage.com	www.startpage.com/do/dsearch?query={s}
stats	Statistics By Jim	statisticsbyjim.com/?s={s}
stdoc	Stata 14 help	www.stata.com/help.cgi?{s}
steal	StealEngine	www.stealengine.com/?q={s}
stern	Stern	www.stern.de/action/3000116/search?query={s}
streg steamkey	Steam Key Redemption	store.steampowered.com/account/registerkey?key={s}
strib	Star Tribune	www.startribune.com/search/?q={s}
stsde	Spreadthesign	www.spreadthesign.com/de.de/search/?q={s}
stupi	Stupidedia	www.stupidedia.org/stupi?title=Spezial:Suche&search={s}
su.me	Serial Updates	www.serialupdates.me/?s={s}
sudoc	Sudoc	www.sudoc.abes.fr//DB=2.1/TTL=1/CMD?ACT=SRCHA&IKT=1016&SRT=RLV&TRM={s}
super coobook	Chef Supermarket	supermarket.chef.io/cookbooks?utf8=%E2%9C%93&q={s}
swars	Summonerswar	summonerswar.wikia.com/wiki/Special:Search?query={s}
swoop swoopge	Swoop.ge discounts in Georgia	www.swoop.ge/search?query={s}
syear	Startpage (this year)	startpage.com/do/metasearch.pl?query={s}&with_date=y
sympy	SymPy Gamma	www.sympygamma.com/input/?i={s}
synde	Synonyme.de	synonyme.de/{s}/
synpl	Synonimy.pl	www.synonimy.pl/synonim/{s}
sysef	Systranet English-French	www.systranet.com/fr/fr/dictionary/english-french/{s}?
sysfe	Systranet French-English	www.systranet.com/fr/fr/dictionary/french-english/{s}?
tab4u	tab4u	www.tab4u.com/resultsSimple?tab=songs&type=song&q={s}
tabsb	Ultimate Guitar (band)	www.ultimate-guitar.com/search.php?search_type=band&value={s}
tails	Tails - The Amnesic Incognito Live System	tails.boum.org/ikiwiki.cgi?P={s}
talky	Talky.io	talky.io/{s}
tanks	Tank Encyclopedia	www.tanks-encyclopedia.com/?s={s}
tanum	Tanum	www.tanum.no/tanum/search/search.action?query={s}
tapas	Tapas	tapas.io/search?q={s}
taste	Taste.com.au	www.taste.com.au/search-recipes/?q={s}
tayda	Tayda Electronics	www.taydaelectronics.com/catalogsearch/result/?q={s}
tbuff	TechnoBuffalo	www.technobuffalo.com/search-results/?q={s}
tcnet	TedCurran.net	tedcurran.net/?s={s}
tcode	TCodeSearch	www.tcodesearch.com/tcodes/search?q={s}
tdegr	TDE Game Reference	www.ulisses-regelwiki.de/index.php/search.html?keywords={s}
teded	TedEd	ed.ted.com/search?utf8=%E2%9C%93&qs={s}
tekno	Teknosains	teknosains.com/search?q={s}:
telch	Search.ch Phonebook (Switzerland)	tel.search.ch/?q={s}
telsu	Telsu.fi	www.telsu.fi/{s}
tenor	tenor	tenor.com/search/{s}
terat	teratail	teratail.com/questions/search?q={s}&conditions=and
tesco	Tesco UK	www.tesco.com/groceries/product/search/default.aspx?searchBox={s}
tf2bp backpack	BackPack.tf	backpack.tf/id/{s}
tfdde	The Free Dictionary DE	de.thefreedictionary.com/{s}
tfopr	Terraform Openstack Resource Docs	www.terraform.io/docs/providers/openstack/r/{s}.html
tgtau targetau	Target Australia	www.target.com.au/search?text={s}
three	Three	www.three.co.uk/Search/?q={s}
tibub	TIBUB OPAC Hannover	opac.tib.uni-hannover.de/DB=1/SET=1/TTL=1/CMD?ACT=SRCHA&IKT=1016&SRT=YOP&TRM={s}
tidal	Tidal	tidal.com/search/?q={s}
tilde	Lleva Tilde	llevatilde.es/palabra/{s}
tlgrm	Telegram	web.telegram.org/#/im?p={s}
tmark	Justia.com trademarks	trademarks.justia.com/search.php?q={s}
torob	Torob	torob.com/search/?query={s}
tosdr	Terms of Service; Didn't Read	tosdr.org/search/{s}
touts	Touts	www.touts.com.br/arts?search={s}
toxif	ToxIf, Instagram Online Web Viewer	www.toxif.com/tags/{s}
trail	Trail And Mountain	www.trailandmountain.co.uk/search?q={s}
trakt	Trakt	app.trakt.tv/search?m=media&q={s}
tranz	Website Tranzizzle	gizoogle.net/tranzizzle.php?search={s}&se=Go+Git+Dis+Shiznit
trash	Trashmail	www.trashmail.de/?search={s}
trfde transfermarkt	transfermarkt.de	www.transfermarkt.de/schnellsuche/ergebnis/schnellsuche?query={s}&x=0&y=0
troll	Troll And Toad	www.trollandtoad.com/products/search.php?searchmode=basic&search_words={s}
trome	Trome	trome.pe/buscar/?query={s}
trove	Trove - National Library of Australia	trove.nla.gov.au/result?q={s}
tunef tunefind	Tunefind	www.tunefind.com/search/site?q={s}
turbo	The Turbo Forums	www.theturboforums.com/search/153518/?q={s}
tutti	www.tutti.ch	www.tutti.ch/de/li/ganze-schweiz?q={s}
tuxdb	TuxDB	tuxdb.com/section/db&page=0&search={s}
tvart	iTunes TV Artwork Finder	bendodson.com/projects/itunes-artwork-finder/index.html?entity=tvSeason&country=us&query={s}
tview tradingview	TradingView	www.tradingview.com/chart/?symbol={s}
tweak	Tweakers	tweakers.net/zoeken/?keyword={s}
twich	Twitch TV	www.twitch.tv/search?query={s}
twiki	Trove Wikia	trove.wikia.com/wiki/Special:Search?query={s}
twmet	Twitchmetrics	www.twitchmetrics.net/search?q={s}
typo3	typo3.org	typo3.org/search/?tx_solr[q]={s}
tyurl	TinyUrl	tinyurl.com/create.php?source=indexpage&url={s}&submit=Make+TinyURL!&alias=
ucern	uCern	search.ucern.com/search?cp=connect&q={s}
ucpjp uncyc unwiki uncyclopedia	Uncyclopedia	en.uncyclopedia.co/w/index.php?search={s}
udemy	Udemy	www.udemy.com/courses/search/?q={s}
uembb	Blackboard UEM	uem.blackboard.com/{s}
ukeys	Ubuntu keyserver	keyserver.ubuntu.com/pks/lookup?search={s}&fingerprint=on&hash=on&op=vindex
ukiki	Ukikipedia	ukikipedia.net/mediawiki/index.php?search={s}
uklaw	UK Legislation (Official Archive)	www.legislation.gov.uk/all?title={s}
ukppp	uk.pcpartpicker.com	uk.pcpartpicker.com/search/?cc=uk&q={s}
uline	Uline	www.uline.com/Product/AdvSearchResult?keywords={s}
um3bd	Um3bd	um3bd.free.fr/?s={s}
umass	UMass Amherst	www.umass.edu/search/#stq={s}&stp=1
umelb	University of Melbourne	search.unimelb.edu.au/?q={s}
umich	University of Michigan	umich.edu/search/keywords/{s}/
unfpa	unfpa.org	www.unfpa.org/search/node/{s}
unima	Uni Mannheim	www.uni-mannheim.de/suche/?tx_solr[q]={s}
unity	Unity	unity3d.com/search?gq={s}
unogs	uNoGS	unogs.com/search/?q={s}
unpkg	unpkg	unpkg.com/{s}
unspl unsplash	unsplash.com	unsplash.com/search?utf8=%E2%9C%93&keyword={s}
upses	UPS Spain	www.ups.com/track?loc=es_ES&tracknum={s}
ureka	Ureka: Earth Heart Communityure	www.ureka.org/search?loader=1&q={s}
usite	Usite.hu	usite.hu/{s}
usydl	Usyd Library	usyd.summon.serialssolutions.com/search?q={s}
utdol uptodate	UpToDate	www.uptodate.com/contents/search?search={s}
utleg	Utah State Legislature	le.utah.gov/solrsearch.jsp?request={s}
utlib uoftlib	University of Toronto Libraries	onesearch.library.utoronto.ca/onesearch/{s}//
uwiki	Ubuntu Wiki	wiki.ubuntu.com/Home?action=fullsearch&context=180&value={s}
uwlib	University of Wisconsin Libraries	search.library.wisc.edu/search/catalog?q={s}
vagas	VAGAS.com.br	www.vagas.com.br/vagas-de-{s}?
vajeh	Vajehyab	vajehyab.com/?q={s}
vajje	Vajje	www.vajje.com/vajje/search/index?query={s}
valve	Valve Developer Wiki	developer.valvesoftware.com/w/index.php?title=Special:Search&search={s}
vaski	Vaski-kirjastot	vaski.finna.fi/Search/Results?lookfor={s}
vat19	Vat19	www.vat19.com/products/search?q={s}
vault falloutlore	The Vault Fallout Wiki	fallout.gamepedia.com/index.php?search={s}
vbox7	Vbox7	www.vbox7.com/search/?q={s}
veloz	Diario Veloz	www.diarioveloz.com/contenidos/resultado.html?text={s}
verbs verbcat	Verbs.cat	www.verbs.cat/ca/conjugacio.html?infinitive={s}
verge theverge	The Verge	www.theverge.com/search?q={s}
verse biblecom youversion	Bible YouVersion	www.bible.com/search/bible?q={s}
vggde	viagogo.de	www.viagogo.de/searchResults.aspx?SearchText={s}
vgguk	viagogo.co.uk	www.viagogo.co.uk/searchResults.aspx?SearchText={s}
vgmdb	Vgmdb	vgmdb.net/search?q={s}
vhunt visualh	visualhunt.com	visualhunt.com/search/instant/?q={s}
vibed	vibe.d Documentation	vibed.org/api/search?q={s}
vidal	VIDAL	www.vidal.fr/recherche.html?query={s}/
videa	Seznam Videa	videa.seznam.cz/?q={s}
viden	Videnskab.dk	videnskab.dk/search/+{s}
vimeo	Vimeo	vimeo.com/search?q={s}
vipon	Vipon	www.vipon.com/promotion/index?search={s}
vlive	V LIVE	www.vlive.tv/search/all?query={s}
vocab whats vocabulary	Vocabulary	www.vocabulary.com/dictionary/{s}
voced	VOCED	www.voced.edu.au/search/apachesolr_search/{s}
vogue	Vogue.com	www.vogue.com/?s={s}
voice gvoice	Google Voice	www.google.com/voice#search/{s}
voicy	Voicy Network	www.voicy.network/clips/search?search={s}
vrtnu	VRT NU	www.vrt.be/vrtnu/zoeken/#query={s}
vtech	Virginia Tech	search.vt.edu/search/pages.html;sa=Search&q={s}
vtkcd	Visualization Toolkit (VTK) class documentation (devel)	www.vtk.org/doc/nightly/html/class{s}.html
walky	Walkypedia	walkypedia.wikia.com/wiki/Special:Search?query={s}
walla wallh wallbase wallhaven wallheaven	Wallhaven Alpha	wallhaven.cc/search?q={s}
wbafc	West Bromwich Albion F.C.	www.wba.co.uk/search/?q={s}
wcach	World Cube Association Championships	www.worldcubeassociation.org/competitions?utf8=%E2%9C%93&region={s}&search=&state=present&year=all+years&display=list
wccls	Washington County Cooperative Library Services	catalog.wccls.org/polaris/search/searchresults.aspx?term={s}
wdrde	Westdeutscher Rundfunk	www1.wdr.de/suche/index.jsp?q={s}
webmd	WebMD	www.webmd.com/search/search_results/default.aspx?query={s}
webst	WebstaurantStore	www.webstaurantstore.com/search/{s}.html
weibo	Sina Weibo	s.weibo.com/weibo/{s}?frm=opensearch
wfdep	weltfussball.de (trainer)	www.weltfussball.de/suche/?q={s}&kind=1
wfdet	weltfussball.de	www.weltfussball.de/suche/?q={s}&kind=2
whale	Whale browser Store	store.whale.naver.com/search/{s}
which	Which	www.which.co.uk/search?asug=&mainresult=mainresult:yes&intcmp=GNH-Search&w={s}
whois	Domaintools Whois	whois.domaintools.com/{s}
wikia	Wikia	community-search.fandom.com/wiki/Special:Search?search={s}
wikit wikitravel	Wikitravel	wikitravel.org/en/Special:Search?search={s}&go=Go
wiley	Wiley Online Library	www.onlinelibrary.wiley.com/action/doSearch?AllField={s}
wilko	wilko	www.wilko.com/search?q={s}
willh	The Will Will Web	blog.miniasp.com/search.aspx?q={s}
winfu	WinFuture	winfuture.de/suche/?q={s}
wired	Wired	www.wired.com/search/?q={s}&page=1&sort=score
witpl	wiktionary pl	pl.wiktionary.org/wiki/{s}
wmdns	What's My DNS	www.whatsmydns.net/#A/{s}
wmeta	Wikimedia Meta-Wiki	meta.wikimedia.org/w/index.php?title=Special:Search&search={s}
wogch	World of Games	www.wog.ch/index.cfm/search/type/Games/term/{s}
wolsv	Watchtower Online Library (Swedish)	wol.jw.org/wol/finder?wtlocale=Z&q={s}
woord	Woorden.org	www.woorden.org/woord/{s}
worms	Worms Knowledge Base	worms2d.info/?title=Special:Search&search={s}&go=Go
wotif	Wotif	www.wotif.com/search/TextSearch?searchTerms={s}
wowch	World of Whisky	www.worldofwhisky.ch/suche?controller=search&orderby=position&orderway=desc&search_query={s}&submit_search=Search
wowdb	Word of Warcraft Database - WOWDB	www.wowdb.com/search?search={s}
wowfr wowheadfr	Wowhead	fr.wowhead.com/search?q={s}
wowhr	Wowhead Russian	ru.wowhead.com/search?q={s}
wpacf	Advanced Custom Fields (WordPress)	support.advancedcustomfields.com/forums/search?bbp_search={s}
wpbeg	WP Beginner	www.wpbeginner.com/search/?q={s}
wpdev	WordPress Code Reference	developer.wordpress.org/?s={s}
wpvip	WordPress VIP	vip.wordpress.com/?s={s}
wpzen	WPzen	wpzen.pl/?s={s}
wrand	Wikipedia Random in Category	en.wikipedia.org/wiki/Special:RandomInCategory/{s}
wrden wrdeen	WordReference (deen)	www.wordreference.com/deen/{s}
wshfa	Farsi WikiShia	fa.wikishia.net/index.php?search={s}
wtest	Stiftung Warentest	www.test.de/suche/?q={s}
wtoon webtoon webtoons	WEBTOON	www.webtoons.com/search?keyword={s}
wuage	wuage	s.wuage.com/product/search?keywords={s}
wwiki	Wegenwiki	www.wegenwiki.nl/index.php?search={s}&title=Speciaal:Zoeken
wwoof	Wwoof.net	www.wwoof.net/?s={s}
xende	Xenharmonie-Wiki	de.xen.wiki/index.php?search={s}
xiami	Xiami	www.xiami.com/search?key={s}
xkcdb	XKCDB: The #xkcd quotes database	www.xkcdb.com/?search={s}
xkcdn	XKCD Number	xkcd.com/{s}/
xuser twitters twitteruser	Twitter User	x.com/{s}
xwiki	XWiki	www.xwiki.org/xwiki/bin/view/Main/Search?text={s}
yabla	Yabla Chinese	chinese.yabla.com/chinese-english-pinyin-dictionary.php?define={s}
yamgo	Yamgo TV	yamgo.com/search?q={s}
yeggi	Yeggi	www.yeggi.com/q/{s}/
yidio	Yidio	www.yidio.com/{s}
ymail	Yahoo Mail	mail.yahoo.com/d/search/keyword={s}
ynews	Yahoo! News	news.search.yahoo.com/news/search?ei=UTF-8&fr=news-us-ss&c=&p={s}
youai	You.com	you.com/search?q={s}
youku	Youku	www.soku.com/search_video/q_{s}
yours	yours.org	www.yours.org/search?q={s}
youtv	YouTV	www.youtv.de/suche?search[q]={s}
ytmnd	YTMND	ytmnd.com/search?q={s}
zameq	ZAM - EQ	everquest.allakhazam.com/search.html?q={s}
zavvi	Zavvi	www.zavvi.com/elysium.search?search={s}
zdnet	ZDNet	www.zdnet.com/search?q={s}
zdoom	ZDoom Wiki	zdoom.org/w/index.php?search={s}
zedat	ZEDAT	www.zedat.fu-berlin.de/FAQ?q={s}
zehrs	Zehrs Markets	www.zehrs.ca/search/?search-bar={s}
zetax	Zetax.net	zetax.net/search/?q={s}
zurbf zurbfoundation	Zurb Foundation	foundation.zurb.com/docs//?q={s}:
0to255	0to255	0to255.com/{s}
1gabba	1gabba	1gabba.net/frontpage?title={s}
3dbrew	3DBrew	3dbrew.org/wiki/Special:Search?search={s}&go=Go
3druck	3Druck.com	3druck.com/?s={s}
3dware	Sketchup 3D Warehouse	3dwarehouse.sketchup.com/search.html?q={s}
4chanb	4chan Boards	4chan.org/b/{s}
4chint	4chan international board	boards.4chan.org/int/catalog#s={s}
4chr9k	4chan robot board	boards.4chan.org/r9k/catalog#s={s}
4plebs	4plebs Archive	archive.4plebs.org/_/search/text/{s}/
4sound	4Sound	www.4sound.dk/search/{s}
abbott	Abbott	www.jobs.abbott/us/en/search-results?keywords={s}
actuly	actuly	www.actuly.fr/?s={s}
acwiki	Assassin's Creed Wiki	assassinscreed.fandom.com/wiki/Special:Search?query={s}
adagio	Adagio Teas	www.adagio.com/search/index.html?query={s}
addons	PrestaShop Addons	addons.prestashop.com/fr/recherche?search_query={s}
adidas	adidas	www.adidas.fr/search?q={s}
adsabs	SAO/NASA Astrophysics Data System	adsabs.harvard.edu//cgi-bin/basic_connect?qsearch={s}
adsref	NASA ADS Bibliographical reference search	adsabs.harvard.edu/cgi-bin/nph-abs_connect?db_key=ALL&bibcode={s}
adzuna	Adzuna	www.adzuna.co.uk/jobs/search?q={s}
afcind	AFC Industries	www.afcindustries.com/products/search.aspx?search={s}
afinna	aalto.finna.fi	aalto.finna.fi/Search/Results?lookfor={s}
afpubs	U.S. Air Force Forms and Publications	www.e-publishing.af.mil/index.asp?txtSearchWord={s}&rdoFormPub=rdoPub
agames	AnaitGames	www.anaitgames.com/buscador.php?search={s}
ahrefs	ahrefs	ahrefs.com/site-explorer/overview/v2/subdomains/recent?target={s}
aijobs	ai-jobs.net	ai-jobs.net/?search_keywords={s}
airbnb	airbnb	www.airbnb.com/s/{s}
aladin	aladin	www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=All&SearchWord={s}
alfred	Alfred	www.alfredapp.com/search/?q={s}
alight	Alight	careers.alight.com/search-results?keywords={s}
allbiz	AllBiz	www.all.biz/search/goods/?q={s}
alpine	Alpine packages	pkgs.alpinelinux.org/packages?name={s}
altium	Altium	techdocs.altium.com/search/wikinode/{s}
alugha	alugha	alugha.com/search?q={s}
alzask	Alza.sk	www.alza.sk/search.htm?exps={s}
ameblo	Ameblo	search.ameba.jp/search.html?q={s}
amiami	Amiami	www.amiami.com/eng/search/list/?s_keywords={s}
aminet	Aminet	aminet.net/search?query={s}
amoeba	Ameoba music	www.amoeba.com/search/all/?s={s}
ampnet	Auto-Medienportal.Net	www.auto-medienportal.net/artikel/quicksearch/?searchterm={s}
amusic	Amazon Music	music.amazon.com/search/{s}
amwiki wikiam	Amharic Wikipedia	am.wikipedia.org/w/index.php?search={s}
anaped anarchopedia	Anarchopedia	anarchopedia.org/Special:Search?search={s}
andpol	Android Police	www.androidpolice.com/search/?q={s}
anevry	Anevry	www.anevry.com/?s={s}
anibin	anibin	anibin.blogspot.com/search?q={s}
anifit	Die Katzothek | Gesundes und artgerechtes Katzenfutter von Anifit	katzothek.provital.com/content/partners/katzothek/futtershop/de/article_search?article_name={s}
anobii	anobii	www.anobii.com/search?s=1&keyword={s}
anulib	The Australian National University Library	anu.summon.serialssolutions.com/search?q={s}
aparat	Aparat	www.aparat.com/result/{s}
appcel	Appcelerator API Docs	developer.appcelerator.com/apidoc/search/mobile/latest?q={s}
aprsfi	aprs.fi	aprs.fi/#!mt=roadmap&z=11&call=a/{s}&timerange=3600&tail=3600
aqasha	aqasha	aqasha.com/search?q={s}
arabic	Arabic dictionary	www.perseus.tufts.edu/hopper/morph?l={s}&la=ar
aramex	Aramex Tracking	www.aramex.com/track-results-multiple.aspx?ShipmentNumber={s}
arcdev	Arcgis Developers	developers.arcgis.com/search/?q={s}
arcdoc	ArcGIS Documentation	doc.arcgis.com/search/?q={s}
arcgis	ArcGIS Online	www.arcgis.com/home/search.html?q={s}
archjp	ArchWikiJP	wiki.archlinux.jp/index.php?search={s}
archpl	archlinux wiki pl	wiki.archlinux.org/index.php/{s}_(Polski)
area51	Area51	discuss.area51.stackexchange.com/search?q={s}
areena	Yle Areena	areena.yle.fi/hae?q={s}&service=tv
artede	Arte (DE)	www.arte.tv/de/search/?q={s}&page=1
artist	artcyclopedia.com (artists)	www.artcyclopedia.com/scripts/tsearch.pl?type=1&t={s}
ascent	Ascent	www.ascent.co.nz/search.aspx?query={s}&sortBy=products
askmen	AskMen	ca.askmen.com/search?q={s}
asoiaf awoiaf	A Wiki of Ice and Fire	awoiaf.westeros.org/index.php?search={s}
astray	Astray Recipes	www.astray.com/recipes/?search={s}
atcomp	AT Computers	www.atcmarket.cz/zbozi?hledani=true&zb={s}
atlaso	Atlas Obscura	www.atlasobscura.com/search?q={s}&kind=keyword
atlona	Atlona	atlona.com/?s={s}
atomio	atom.io	atom.io/packages/search?utf8=%E2%9C%93&q={s}
aurdel deltaco	aurdel	aurdel.com/se/en/catalogsearch/result/?q={s}
ausgov	australia.gov.au	australia.gov.au/search?collection=gov_all&coverage=all&num_ranks=3&extra_all_num_ranks=3&form=simple&query={s}
ausmed	Ausmed Education	www.ausmed.com.au/sitesearch?q={s}
avanza	Avanza	www.avanza.se/sok.html?q={s}
avatar	Avatar Wiki	avatar.wikia.com/wiki/Special:Search?query={s}
avechi	Avechi	avechi.com/catalogsearch/result/?q={s}
azlane	Azur Lane Wiki	azurlane.koumakan.jp/w/index.php?search={s}
b4kids	Biology4kids	www.biology4kids.com/search.html?q={s}
bailii	British and Irish Legal Information Institute	www.bailii.org/cgi-bin/sino_search_1.cgi?sort=rank&query={s}
ballot	ballotpedia.org	ballotpedia.org/wiki/index.php?search={s}
banned	banned.video	banned.video/?q={s}
batman	Batman Wiki	batman.wikia.com/wiki/{s}
baygel	Baygel	www.baygel.de/baygel.php?query={s}
bcbsla	Blue Cross and Blue Shield of Louisiana	www.bcbsla.com/searchresults?q={s}
bchain	blockchain.info	blockchain.info/address/{s}
bcsite	BlueCoat Sitereview	sitereview.bluecoat.com/sitereview.jsp#/?search={s}
bcspca	BC SPCA	www.spca.bc.ca/search.html?q={s}
bcwiki	Bitcoin Wiki	en.bitcoin.it/w/index.php?title=Special:Search&search={s}
bdeals	Brad's Deals	www.bradsdeals.com/search?query={s}
beebom	Beebom	beebom.com/?s={s}
beezer	Beezer	www.beezer.com.au/search?type=product&q={s}
begeek	Begeek	www.begeek.fr/?s={s}
belkin	Belkin	www.belkin.com/us/search?text={s}
bfm899	BFM: The Business Radio Station	www.bfm.my/podcast.html?qseaid={s}&pseaid=latest&iseaid=all&dsseaid=&deseaid=&tag=&prg=
biblio	Biblio	biblio.com/search.php?keyisbn={s}
bibnet	BiblioNet	www.biblionet.gr/main.asp?page=results&key={s}
bijbel	De Bijbel	www.debijbel.nl/zoeken/?q={s}&v=NBV&t=bible
bike24	Bike24	www.bike24.com/1.php?content=13&search={s}
binguk	Bing UK	bing.co.uk/?q={s}
binnys	Binny's Beverage Depot	www.binnys.com/all/{s}
bitaps	Bitaps	bitaps.com/{s}
bitref	bitref	bitref.com/{s}
biznar	Biznar	www.biznar.com/biznar/result-list/fullRecord:{s}
bkadda	BookAdda	www.bookadda.com/general-search?searchkey={s}
bleach	Bleach Wiki	bleach.wikia.com/wiki/Special:Search?query={s}
bluray	Blu-ray.com	www.blu-ray.com/search/?quicksearch=1&quicksearch_country=all&quicksearch_keyword={s}&section=bluraymovies
bmonth	Bing (past month)	www.bing.com/search?q={s}&filters=ex1:""ez3""
boards	Boards.ie	www.boards.ie/search/submit/?query={s}
bodeka	bodeka.org	bodeka.org/?s={s}
bonnus	Bonnus	bonnus.ulb.uni-bonn.de/Summon/Search?lookfor={s}&type=AllFields&submit=Suchen
boulet	bouletcorp	www.bouletcorp.com/?s={s}
bpanda	Bored Panda	www.boredpanda.com/?s={s}
brands	Brands of the world	www.brandsoftheworld.com/search/logo?search_api_views_fulltext={s}
bronco	Bronco Wine Company	broncowine.com/woocommerce-search/?cat_in=&rs={s}&search_in=product&search_other=product
bsaber	BeastSaber	bsaber.com/?s={s}
bstars bundles	Bundle Stars	www.bundlestars.com/en/games?search={s}
bswiki wikibs	Bosnian Wikipedia	bs.wikipedia.org/w/index.php?search={s}
btname behindthename	Behind the Name	www.behindthename.com/names/search.php?terms={s}&type=
bukkit	Bukkit Plugins Search	www.curseforge.com/minecraft/bukkit-plugins/search?search={s}
c64wde	C64-Wiki (de)	www.c64-wiki.de/index.php?title=Spezial:Suche&go=Seite&search={s}
camaro	Camaro Forums @ Z28.com	www.z28.com/search/search?keywords={s}&order=relevance
camlib	University of Cambridge Libraries iDiscover	idiscover.lib.cam.ac.uk/primo-explore/search?query=any,contains,{s}&tab=cam_lib_coll&search_scope=SCOP_CAM_ALL&vid=44CAM_PROD&lang=en_US&offset=0
campus	AccuCampus	accucampus.net/search?q={s}
canlii	CanLII	www.canlii.ca/en/search/search.do?all={s}
capost	Canada Post	www.canadapost.ca//cpotools/apps/track/personal/findByTrackNumber?trackingNumber={s}
carjam	CarJam	carjam.co.nz/car/?plate={s}
carmax	CarMax	www.carmax.com/search#FreeText={s}
carrot	Carrot2 Clustering Engine	search.carrot2.org/stable/search?source=web&view=folders&skin=fancy-compact&query={s}&results=100&algorithm=lingo
caschy	Caschys Blog	stadt-bremerhaven.de/?s={s}
cbdoil	CBD Oil Canada	cbd-oil-canada.ca/?s=/{s}
ccheck	Codecheck	www.codecheck.info/product.search?q={s}&OK=Suchen
cconst	Conseil Constitutionnel	recherche.conseil-constitutionnel.fr/?q={s}
ccwiki	ComputerCraft Wiki	computercraft.info/wiki/index.php?title=Special:Search&search={s}&go=Go
cdende	Cambridge Dictionary English-German	dictionary.cambridge.org/dictionary/english-german/{s}
cdenes	Cambridge Dictionary English-Spanish	dictionary.cambridge.org/dictionary/english-spanish/{s}
cdgdic	Cambridge Dictionaries Online	dictionary.cambridge.org/spellcheck/learner-english/?q={s}
cdiver	ChronoDiver.com	chronodivers.com/?s={s}
cdkeys	CDKeys	www.cdkeys.com/catalogsearch/result/?q={s}
cdondk	CDON.com (Denmark/Danmark)	cdon.dk/search?q={s}
cdonfi	CDON.com (Finland/Suomi)	cdon.fi/search?q={s}
cdonno	CDON.com (Norway/Norge)	cdon.no/search?q={s}
cecmed	CECMED	www.cecmed.cu/search/node?keys={s}
ceekjp	ceek.jp	www.ceek.jp/search.cgi?q={s}
ceneje	Ceneje.si	www.ceneje.si/Iskanje/Izdelki?q={s}
censys	Censys	www.censys.io/ipv4?q={s}
chabad	Chabad.org	www.chabad.org/search/results.asp?searchWord={s}
change	Change.org	www.change.org/search?q={s}
charge	Initial Charge	initialcharge.net/?s={s}
cheese	Cheese	www.cheese.com/?q={s}
chefio chefdoc	Chef Docs	docs.chef.io/search.html#stq={s}&stp=1
chemse	Chemistry StackExchange	chemistry.stackexchange.com/search?q={s}
chipdb	msarnoff.org ChipDB	www.msarnoff.org/chipdb/{s}
choice	Choice	www.choice.com.au/search?q={s}
chollo	chollometro	www.chollometro.com/search?q={s}
chosun	The Chosun Ilbo	www.chosun.com/nsearch/?query={s}
citeul	CikeULike	www.citeulike.org/search/all?q={s}
ciupy3	Can I Use Python 3?	caniusepython3.com/project/{s}
clamps	Clamps	www.encole.com/search/{s}
clarks	Clarks	www.clarks.co.uk/search/?text={s}
clasfi	Clas Ohlson Finland	www.clasohlson.com/se/search?text={s}
clasno	Clas Ohlson Norge	www.clasohlson.com/no/view/content/search?searchKey=All&search_prefix={s}
claude	Claude	claude.ai/new?q={s}
cljdoc	cljdoc	cljdoc.org/search?q={s}
clubic	Clubic	www.clubic.com/r/{s}
cnrtla	CNRTL	www.cnrtl.fr/antonymie/{s}
cnrtlc	cnrtl concordance	www.cnrtl.fr/concordance/{s}
cnrtlm	cnrtl morphologie	www.cnrtl.fr/morphologie/{s}
cnrtlp	cnrtl proxemie	www.cnrtl.fr/proxemie/{s}
cnrtls	cnrtl synonymie	www.cnrtl.fr/synonymie/{s}
codata	NIST Fundamental Physical Constants	physics.nist.gov/cgi-bin/cuu/Results?search_for={s}
code42	Code42	support.code42.com/Special:Search?search={s}
colloq	Colloq.io	colloq.io/search?query={s}
conaff	Consumer Affairs	www.consumeraffairs.com/search.html?q={s}&cat=homepage
conjfr	conjugueur.reverso.net	conjugueur.reverso.net/conjugaison-francais-verbe-{s}.html
conrad	Conrad	www.conrad.de/ce/de/Search.html?search={s}
cooksc	Cook's Country	www.cookscountry.com/search/?type=&q={s}
cooksi	Cook's Illustrated	www.cooksillustrated.com/search/results.asp?query={s}
corona	Corona	coronalabs.com/?s={s}
cosdna	CosDNA (english)	www.cosdna.com/eng/product.php?q={s}
costco	Costco.com	www.costco.com/CatalogSearch?storeId=10301&catalogId=10701&langId=-1&keyword={s}
crafty	Crafty	crafty.gg/players?search={s}
crcode chromium	Chromium Code	source.chromium.org/search?q={s}&ss=chromium/chromium/src
crunch	Crunchbase	www.crunchbase.com/textsearch/?q={s}
crypto	Crypto Stack Exchange	crypto.stackexchange.com/search?q={s}
csharp	C# MSDN	social.msdn.microsoft.com/Search/en-US?query={s}&Refinement=126&ac=8
csinfo	Cipher Suite Info	ciphersuite.info/search/?q={s}
csound	csounds	www.csounds.com/manual/html/{s}.html
ctextd	Chinese Text Project Dictionary	ctext.org/dictionary.pl?if=en&char={s}
ctimes	Collegiate Times	www.collegiatetimes.com/search/?q={s}
curiac	Curia (Case number)	curia.europa.eu/juris/liste.jsf?pro=&lgrec=en&nat=&oqp=&dates=&lg=&language=en&jur=C,T,F&cit=none,C,CJ,R,2008E,,,,,,,,,,true,false,false&num={s}&td=ALL&pcs=O&avg=&page=1&mat=or&jge=&for=&cid=114819
curian	Curia (Name of the parties)	curia.europa.eu/juris/liste.jsf?pro=&nat=&oqp=&dates=&lg=&language=en&jur=C,T,F&cit=none,C,CJ,R,2008E,,,,,,,,,,true,false,false&td=ALL&pcs=O&avg=&page=1&mat=or&parties={s}&jge=&for=&cid=114819
cursos	Ges Formacion	www.gesformacion.es/buscar?controller=search&search_query={s}
cvmcia	Consulta de Documentos de Companhias Abertas (CVM)	cvmweb.cvm.gov.br/SWB/Sistemas/SCW/CPublica/CiaAb/ResultBuscaParticCiaAb.aspx?CNPJNome={s}&TipoConsult=C
cymath	Cymath	www.cymath.com/answer.php?q={s}
daccaa	DACCAA	daccaa.com/results/?q={s}
dafont	DaFont	www.dafont.com/search.php?psize=m&q={s}
dawiki	Dragon Age wiki	dragonage.fandom.com/wiki/Special:Search?query={s}
dbbook	Douban (book)	book.douban.com/subject_search?search_text={s}&cat=1001
dbread	read.douban	read.douban.com/search?q={s}
dbwiki	DEATH BATTLE Wiki	deathbattle.miraheze.org/w/index.php?title=Special:Search&search={s}
dcwiki	DC Wiki	dc.wikia.com/wiki/Special:Search?search={s}
ddg-ai ddg-chat	DuckDuckGo AI Chat	duckduckgo.com/?q={s}&ia=chat&bang=true
ddg-es	duckduckgo	duckduckgo.com/?q={s}&kl=xl-es&kad=es_ES&ia=about
ddg-il	DuckDuckGo Large Images	duckduckgo.com/?q={s}&ia=images&iax=images&iaf=size:imagesize-large
ddg-it	DuckDuckGo Italy	duckduckgo.com/?q={s}&kl=it-it
ddgeue	DuckDuckGo Estados Unidos	duckduckgo.com/?kl=ue-es&q={s}
ddwiki	Official Darkest Dungeon Wiki	darkestdungeon.wiki.gg/index.php?search={s}
deakin	Deakin University Library	library.deakin.edu.au/search/?searchtype=X&SORT=D&searcharg={s}&searchscope=1
debian	Debian	search.debian.org/cgi-bin/omega?DB=en&P={s}
debmla	Debian mailing list archives	lists.debian.org/debian-{s}/
decode	UrlDecode.org	urldecode.org/?text={s}&mode=decode
defkey	defkey	defkey.com/search?irq={s}
delcat	DELCAT Discovery	delcat.worldcat.org/search?qt=wc_org_delcat&q={s}&scope=0&oldscope=0&wcsbtn2w=Search&fq=&dblist=1461,1542,638
delijn	De Lijn	www.delijn.be/nl/zoekresultaten/index.html?searchtext={s}
dellsp	Dell Support Search	www.dell.com/support/search/us/en/19#q={s}&sort=relevancy
dellst	Dell Support Service Tag	www.dell.com/support/home/us/en/19/product-support/servicetag/{s}
delluk	Dell UK	www.dell.com/en-uk/search/{s}
delphi	Delphi Basics	www.delphibasics.co.uk/RTL.asp?Name={s}
dfiles	Debian file search	packages.debian.org/search?section=all&arch=any&searchon=contents&keywords={s}
dhdocs	Dockerhub docs	docs.docker.com/search/?q={s}
dhgate	DHGate	www.dhgate.com/wholesale/search.do?act=search&supplierid=&isfactory=&sus=&searchkey={s}&catalog=#search
diablo	Diablo Wiki	diablo.wikia.com/wiki/Special:Search?query={s}
dictpl	Dict.pl	dict.pl/dict?word={s}
dictre	dict.org	www.dict.org/bin/Dict?Form=Dict1&Database=*&Strategy=re&Query=^{s}$
digi24	Digi24	www.digi24.ro/cautare?q={s}
dikide	diki.pl/slownik-niemieckiego	www.diki.pl/slownik-niemieckiego?q={s}
dirble	Dirble	dirble.com/search?q={s}
discme	Discord Me	discord.me/servers/1/{s}
disney	Disney.com	search.disney.go.com/?q={s}
distch	Distrelec Schweiz	www.distrelec.ch/search?q={s}
dizint	Internazionale.it	dizionario.internazionale.it/cerca/{s}
djones	David Jones	www.davidjones.com/search?q={s}
dlenes deeples deeplenes	Deepl en-es	www.deepl.com/translator#en/es/{s}
dobber	DobberHockey	dobberhockey.com/?s={s}&orderby=post_date
docsrs docs.rs	Docs.rs	docs.rs/releases/search?query={s}
docubu	Ubuntu Documentation	help.ubuntu.com/search.html?q={s}
domain ncheap	NameCheap	www.namecheap.com/domains/domain-name-search/results.aspx?domain={s}
domein	Domeinwinkel	domeinwinkel.hosting/?domain={s}
dorfor	Dorico forum	www.steinberg.net/forums/search.php?keywords={s}&fid[0]=246
dotlan	Dotlan EVE Maps	evemaps.dotlan.net/search?q={s}
dradio	dradio.de	www.deutschlandradio.de/text-und-audio-suche.287.de.html?search[submit]=1&search[word]={s}
dremio	dremio community	community.dremio.com/search?q={s}
drudge	Drudge Report	www.drudgereportarchives.com/dsp/search.htm?searchFor={s}
drupal	Drupal	drupal.org/search/apachesolr_search/{s}
dscsrv	Discord Servers	discordservers.com/?term={s}
dswiki	Datenschutz-Wiki.de	www.datenschutz-wiki.de/index.php?search={s}
duckco duck.co	duck.co	duck.co/search/{s}
duedil	Duedil	www.duedil.com/companies/search?query={s}&op=Companies
dustin	Dustin.se	www.dustin.se/search/{s}
dvdupc	Disc to Digital UPC	www.dvdupc.com/find?find={s}
easybi	Easy-BI	easy-bi.org/blog/?s={s}
ebates	Rakuten	www.rakuten.com/search?term={s}&type=suggest
ebooki	ebooki.swiatczytnikow.pl	ebooki.swiatczytnikow.pl/szukaj/{s}
ebooko	Booko (eBooks)	booko.com.au/products/search?product_type=3&q={s}
ebrary	ebrary	site.ebrary.com/lib/alltitles/search.action?p00={s}
ebsold	eBay Sold	ebay.com/sch/i.html?isRefine=true&_nkw={s}&LH_Sold=1
ebuyer	eBuyer	www.ebuyer.com/search?q={s}
ebyrec	eBay Records	www.ebay.com/sch/176985/i.html?_nkw={s}
eclair	Eclair.md	eclair.md/search?type=product&q={s}
ecolab	Ecolab	www.ecolab.com/search/#q={s}&sort=relevancy
ecomes	ecomes.org	ecomes.org/?s={s}
edgart	Edgar	www.sec.gov/cgi-bin/browse-edgar?company=&match=&CIK={s}&filenum=&State=&Country=&SIC=&owner=exclude&Find=Find+Companies&action=getcompany
edhrec	EDHREC	edhrec.com/cards/{s}
editus	editus.lu	www.editus.lu/ed/fr/recherche.html?q={s}
edweek	Education Week	www.edweek.org/search.html?q={s}
eguias	Elite Guias	www.eliteguias.com/buscar.php?q={s}
ejumbo	Jumbo	www.e-jumbo.gr/pages/searchProducts.aspx?lang=el&search-for={s}
elbaul	El Baul del Programador	elbauldelprogramador.com/?s={s}
elgoog	elgooG	elgoog.im/search/?q={s}
elinux	eLinux	elinux.org/index.php?search={s}
elixir	Elixir Documentation	hexdocs.pm/elixir/search.html?q={s}
elpais	El Pais	elpais.com/buscador/?qt={s}
emagbg	emag.bg	www.emag.bg/search/{s}?ref=effective_search
empire	Empire	www.empireonline.com/search/default.asp?search={s}
emploi	Jobillico	www.jobillico.com/recherche-emploi?skwd={s}
emusic	eMusic	www.emusic.com/search/{s}
encode	ENCODE	www.encodeproject.org/search/?searchTerm={s}
endole	Endole	www.endole.co.uk/search/?search={s}
engfor	English Forums	www.englishforward.com/questionlist?q={s}
entrez	Entrez	www.ncbi.nlm.nih.gov/sites/gquery?term={s}
eporeg	European Patent Register	register.epo.org/smartSearch?searchMode=smart&query={s}
eroexp	Erowid Experience Reports	www.erowid.org/experiences/exp.cgi?S1=0&S2=-1&C1=-1&Str={s}
escape	RSA Games	rsagames.com/?s={s}
eslint	ESLint	eslint.org/docs/rules/{s}
essefn	ESSEF (nl)	www.essef.be/ndl/cataloog/index.search.asp?zoek={s}
ethrev	Ethical Revolution	ethicalrevolution.co.uk/?s={s}
etools	eTools	www.etools.ch/searchSubmit.do?query={s}
etrans	TriTrans (Englesk)	www.tritrans.net/cgibin/translate.cgi?spraak=Engelsk&Fra={s}
eurlex	EUR-Lex	eur-lex.europa.eu/search.html?text={s}&scope=EURLEX&type=quick
eveuni	Eve University Wiki	wiki.eveuniversity.org/index.php?title=Special:Search&search={s}
export	Weltexporte	www.weltexporte.de/?s={s}
ezydvd	EzyDVD	www.ezydvd.com.au/search?q={s}&t=all
fabric	Fabric.com	www.fabric.com/SearchResults2.aspx?SearchText={s}
factly	Factly	factly.in/?s={s}
factor	Factor Number Calculator	www.calculator.net/factor-calculator.html?cvar={s}&x=Calculate
fandom	Fandom	www.fandom.com/?s={s}
farnes	Farnell ES	es.farnell.com/search?st={s}
fastai	fast.ai forums	forums.fast.ai/search?q={s}
faucet	Faucet.com	www.faucet.com/index.cfm?page=search:browse&term={s}
fauser	FurAffinity User	furaffinity.net/user/{s}
fblite	Facebook Lite	mbasic.facebook.com/search/?refid=46&search=people&search_source=search_bar&query={s}
fdblog	Freshdesk blog	blog.freshdesk.com/?s={s}
fdrlst	www.thefederalist.com	thefederalist.com/?s={s}
fdroid	F-Droid search	search.f-droid.org/?q={s}
fedman	Fedora Manuals	linuxmanpages.net/search.py?q={s}
fedora	Fedora wiki	fedoraproject.org/wiki/Special:Search?search={s}
fedreg	Federal Register	www.federalregister.gov/documents/search?conditions[term]={s}
ffwiki finalfantasy	Final Fantasy Wiki	finalfantasy.wikia.com/wiki/Special:Search?query={s}
figura	FiguraMC Wiki	wiki.figuramc.org/index.php?search={s}
figuya	Figuya	figuya.com/en/products?q[query]={s}
filmnl	Film.nl	www.film.nl/?q={s}
filmon	FilmOn	www.filmon.tv/search/?term={s}
filmow	Filmow	filmow.com/buscar/?q={s}
filmtv	FilmTV.it	www.filmtv.it/cerca/?q={s}
fineli	Fineli	fineli.fi/fineli/fi/elintarvikkeet?q={s}
finlex	Finlex	finlex.fi/fi/laki/haku/?search[type]=pika&search[pika]={s}
fiueds	FIU Libraries EDS	search.ebscohost.com.ezproxy.fiu.edu/login.aspx?direct=true&scope=site&type=0&site=eds-live&lang=en&bquery=[{s}]
flattr	Flattr	flattr.com/q/{s}
flicks	Flicks.co.nz	www.flicks.co.nz/search/?q={s}
flight	SpotterLead Flights	spotterlead.net/flights/{s}
flower	Wildflower Center	www.wildflower.org/plants/search.php?search_field={s}&newsearch=true
fmedoc	Safe software FME documentation	www.safe.com/search/?site-search={s}&site=docs.safe.com
fnaces	Fnac.es	busqueda.fnac.es/Search/SearchResult.aspx?SCat=0!1&Search={s}&sft=1&submitbtn=OK
foldoc	FOLDOC (Free On-line Dictionary of Computing)	foldoc.org/{s}
follow	Follow That Page	www.followthatpage.com/?url={s}
fonqnl	Fonq	www.fonq.nl/zoek/?fq={s}
forbes	Forbes	www.forbes.com/search/?q={s}
fosdem	FOSDEM	fosdem.org/2026/search/?q={s}
fossil	Fossil	www.fossil.com/uk/en/search.{s}.html
fowiki fallout-wikia	Fallout Wikia	fallout.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
foyles	Foyles	www.foyles.co.uk/qsearch/All/All?term={s}
fports freebsd	FreeBSD Ports	www.freebsd.org/cgi/ports.cgi?query={s}&stype=all
framal	Framalibre	framalibre.org/recherche-par-crit-res?keys={s}
framat	FramaTube	framatube.org/search?search={s}
french	French Language and Usage	french.stackexchange.com/search?q={s}
fright	FrightFind	frightfind.com/?s={s}
frisky	FRISKY Radio	www.friskyradio.com/search/?q={s}
frtech	TechDico FR	fr.techdico.com/traduction/francais-anglais/{s}
frutke	Frutke	frutke.com/?s={s}
frwiki	Forgotten Realms Wiki	forgottenrealms.fandom.com/wiki/Special:Search?query={s}
funtoo	Funtoo	www.funtoo.org/index.php?search={s}
futbin	Futbin	www.futbin.com/players?search={s}
fyndiq	Fyndiq	fyndiq.se/search/?q={s}
g100en	Google Search 100 English Results	www.google.com/search?q={s}&tbo=1&num=100&lr=lang_en
g2year	Google ( Past 2 Years)	www.google.com/search?tbs=qdr:y2&q={s}&safe=off&ie=utf-8&oe=utf-8
galaxy ansible-galaxy	Ansible Galaxy	galaxy.ansible.com/ui/search/?keywords={s}
gameza	Game South Africa	www.game.co.za/game-za/en/search/?text={s}
gaming	Arqade	gaming.stackexchange.com/search?q={s}
garden	Garden-en.com	www.garden-en.com/s/en/?type=sfd&query={s}
gazeta	Gazeta do Povo	www.gazetadopovo.com.br/busca/?q={s}
gblast	Gigablast	gigablast.org/search?q={s}
gcubed	gCubed	cse.google.com/cse/publicurl?cx=007995818864770319293:3weihy1amkc&q={s}
geller	Bienenzuchtbedarf Geller	bienenzuchtbedarf-geller.de/shop/search?sSearch={s}
gender	Gender Wiki	gender.wikia.com/search?query={s}
geouri	openstreetmap.org	www.openstreetmap.org/search?query={s}#map=7/0.000/-60.000
getchu	Getchu.com	www.getchu.com/php/nsearch.phtml?search_keyword={s}
gfguru gfstock	Gurufocus	www.gurufocus.com/guru/{s}/stock-picks
gfwiki	Girls' Frontline Wiki	iopwiki.com/index.php?search={s}
ghacks	Ghacks	www.ghacks.net/?s={s}
ghuser	GitHub User Search	github.com/search?type=Users&q={s}
gibert	Gibert	www.gibert.com/catalogsearch/result/?q={s}
gigaom	GigaOM	gigaom.com/?s={s}
gisoff gisafeoff	Google Images (Safe Off)	www.google.com/images?safe=off&q={s}
glitch	Glitch	glitch.com/search?q={s}
glmail globeandmail	The Globe and Mail	www.theglobeandmail.com/search/?q={s}
global	Global Research	www.globalresearch.ca/search?q={s}
glotnl	Interglot (NL->EN)	interglot.com/dictionary/nl/en/search?q={s}
glwiki openglwiki	OpenGL Wiki	www.khronos.org/opengl/wiki_opengl/index.php?search={s}
gmonth	Google (Past Month)	www.google.com/search?q={s}&tbs=qdr:m
gocafe	Golang Cafe	golang.cafe/Golang-{s}-Jobs
godotl	Godot Engine Documentation	docs.godotengine.org/en/latest/search.html?q={s}&check_keywords=yes&area=default
gokifu	gokifu.com	gokifu.com/index.php?q={s}
golden	golden.com	golden.com/search/{s}
gopher	Floodgap Gopher Proxy	gopher.floodgap.com/gopher/gw?ss=gopher://gopher.floodgap.com:70/7/v2/vs&sq={s}
gorafi	Le Gorafi	www.legorafi.fr/?s={s}
gorila	Gorila	www.gorila.sk/vyhladavanie?q={s}
gossip	Number Gossip	www.numbergossip.com/?number={s}
gothic	Gothic-Almanach	almanach.worldofgothic.de/index.php/Spezial:Suche?search={s}
goulet gouletpens	Goulet Pen Company	www.gouletpens.com/pages/search-results?limit=24&q={s}
gowifi	Go Wireless NZ	www.gowifi.co.nz/product-search.html?keyword={s}
gphelp	Gamepedia Help Wiki	help.gamepedia.com/index.php?search={s}
gpsies	GPSies.de	gpsies.de/?q={s}
grabar	Classical Armenian to Modern Armenian Dictionary	www.nayiri.com/imagedDictionaryBrowser.jsp?dictionaryId=28&dt=HY_HY&query={s}
greads	goodreads	www.goodreads.com/search?utf8=%E2%9C%93&query={s}
grillo	Blog di Beppe Grillo	www.beppegrillo.it/google_cse.html?q={s}&x=-1208&y=-9
grumps	Game Grumps	www.youtube.com/user/GameGrumps/search?query={s}
gspace	gspace	glammingspace.blogspot.com/search?q={s}
gsport	G-Sport	www.gsport.no/magento/sok?q={s}
gstore	Google Store	store.google.com/search?q={s}
gtenga	Google Translate en-ga	translate.google.com/#en/ga/{s}
gtlanl	Google Translate (lanl)	translate.google.com/#la/nl/{s}
gtwiki	GrowTopia Wikia	growtopia.wikia.com/wiki/Special:Search?query={s}
gufolm	Guide for Lords Mobile	guideforlm.com/search/?q={s}
guitaa	Guitaa.com	www.guitaa.com/search?q={s}
gundam	Gundam Wikia	gundam.wikia.com/wiki/Special:Search?search={s}
gunmag	Gun Magazine Warehouse	gunmagwarehouse.com/catalogsearch/result/?q={s}
hack42	Hack42	hack42.nl/mediawiki/index.php?search={s}
hadoop	Search-Hadoop	search-hadoop.com/?q={s}
hahwul	HAHWUL	www.hahwul.com/search?max-results=7&q={s}
harney	Harney & Sons Fine Teas	www.harney.com/pages/search-results?findify_q={s}
hatebu	Hatena Bookmark	b.hatena.ne.jp/search/text?q={s}
hdblog	Hdblog	www.hdblog.it/?sName={s}
headfi head-fi	Head-Fi	www.head-fi.org/search.php?search={s}
helmet	HelMet	haku.helmet.fi/iii/encore/search/C__S{s}
hendon	thehendonmob.com	www.thehendonmob.com/search/?q={s}
hepsib hepsiburada	Hepsi Burada	www.hepsiburada.com/ara?q={s}
hermes	Hermes Sendungsverfolgung	www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation/#{s}
heroku	Heroku Devcenter	devcenter.heroku.com/articles?q={s}
herold	Herold	www.herold.at/telefonbuch/{s}/
hesari	Helsingin Sanomat	hs.fi/haku/?search-term={s}
hfqpdb	Harbor Freight Tools Coupon Database	www.hfqpdb.com/search/{s}
hideme	Hide.me proxy	nl.hideproxy.me/go.php?u={s}
hillel	Hillel College Guide	www.hillel.org/college-guide/search#keyword={s}&radius=10
hkeleg	Hong Kong e-Legislation	www.elegislation.gov.hk/results?SEARCH_OPTION=K&keyword.SEARCH_FIELD=E&keyword.SEARCH_KEYWORD={s}
hollis	HOLLIS	hollis.harvard.edu/primo-explore/search?query=any,contains,{s}&tab=everything&search_scope=everything&vid=HVD2&lang=en_US&offset=0
honkai	Honkai: Star Rail Wiki	honkai-star-rail.fandom.com/wiki/Special:Search?query={s}
hotbot	HotBot Web	www.hotbot.com/search/web?q={s}
hotsar hotstar	Hotstar	www.hotstar.com/search?q={s}
howard	Howard Piano Industries	www.howardpianoindustries.com/search.php?search_query={s}
hpecas	hpecas	hpecas.com/pesquisa?controller=search&orderby=position&orderway=desc&search_query={s}&submit_search=
hpwiki	Harry Potter Wikia	harrypotter.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
hrwiki	Homestar Runner Wiki	hrwiki.org/w/index.php?title=Special:Search&search={s}&go=Go
hswiki hearthstone	Hearthstone Wiki	hearthstone.wiki.gg/index.php?search={s}
html5d	HTML5 Doctor	html5doctor.com/search/?q={s}
htwiki wikiht	Haitian Creole Wikipedia	ht.wikipedia.org/w/index.php?search={s}
huawei	Huawei	consumer.huawei.com/en/search/index.htm?keywords={s}
hubski	Hubski	hubski.com/search?q={s}
hybrid	Google Map (Hybrid)	maps.google.com/maps?t=h&q={s}
hyphen	hyphenation24	www.hyphenation24.com/word/{s}/
iateen	European union terminology	iate.europa.eu/search/byUrl?term={s}&sl=en
iawiki wikiia	Interlingua Wikipedia	ia.wikipedia.org/w/index.php?search={s}
ibhejo	iBhejo	www.ibhejo.com/ssearch.php?simple_search=Y&mode=search&search_substring={s}&sort_by=high
icons8	Icons8	icons8.com/web-app/for/all/{s}
icultr	iCulture	www.iculture.nl/?s={s}
idefix	Idefix	www.idefix.com/search/?Q={s}
idroot	idroot	idroot.us/?s={s}
iewiki wikiie	Interlingue Wikipedia	ie.wikipedia.org/w/index.php?search={s}
ifixit	iFixit	www.ifixit.com/search?x=0&y=0&query={s}
ifunny	iFunny	ifunny.co/search/memes?q={s}
ijinus	ijinus.com	www.ijinus.com/?s={s}&lang=en
ikaros	Ikaros	www.ikaros.net/SearchDisplay?storeId=13152&sType=SimpleSearch&searchTerm={s}
ikeaat	IKEA Austria	www.ikea.com/at/de/search/products/?q={s}
ikeaau	IKEA Australia	www.ikea.com/au/en/search/?query={s}
ikeabe	Ikea Belgium	www.ikea.com/be/nl/search/?query={s}
ikeaca	Ikea Canada	www.ikea.com/ca/en/search/products/?q={s}
ikeach	ikea.ch	www.ikea.com/ch/de/search/?query={s}
ikeacs	Ikea Czech Republic	www.ikea.com/cz/cs/search/?query={s}
ikeade	Ikea Germany	www.ikea.com/de/de/search/products/?q={s}
ikeaes	Ikea Spain	www.ikea.com/es/es/search/products/?q={s}
ikeafr	Ikea FR	www.ikea.com/fr/fr/search/?query={s}
ikeaie	Ikea Ireland	www.ikea.com/ie/en/search/?query={s}
ikeait	Ikea (Italia)	www.ikea.com/it/it/search/?query={s}
ikeanl	IKEA Nederland	www.ikea.com/nl/nl/search/?q={s}
ikeapl	ikea.pl	www.ikea.com/pl/pl/search/?query={s}
ikeauk	IKEA UK	www.ikea.com/gb/en/search/products/?q={s}
ilpost	Il Post	www.ilpost.it/?s={s}
imdbep	IMDB TV Episodes	www.imdb.com/find?&q={s}&s=ep
imdbtv	IMDb TV	www.imdb.com/search/title?title={s}&title_type=tv_series
imgrwm	Google Image Search - Creative Commons	www.google.com/search?q={s}&udm=2&source=lnt&tbs=sur:cl
incomp	INCOMPETECH	incompetech.com/wordpress/?s={s}
indigo	Indigo Books	www.chapters.indigo.ca/home/search/?keywords={s}
infloo	inflooenz	inflooenz.com/?artist={s}
inhalt	Inhaltsangabe.de	www.inhaltsangabe.de/?s={s}
inkbun	Inkbunny	inkbunny.net/submissionsviewall.php?mode=search&stringtype=and&keywords=yes&title=yes&description=yes&text={s}
innerf	InnerFidelity	www.innerfidelity.com/search/node/{s}
innooo	Innooo	www.innovativity.org/moteur-de-recherche-innooo.php?typerecherche=&item={s}
inpost	InPost	inpost.pl/pl/pomoc/znajdz-przesylke?parcel={s}
inteli	Intel Intrinsics Guide	software.intel.com/sites/landingpage/IntrinsicsGuide/#!=undefined&text={s}
intohu	Into.hu	into.hu/kereses.php?kereses={s}&cikk=1&forum=1&letolt=1&fal=1&zene=1&kerdesek=1&page=1
ipinfo	ipinfo.io	ipinfo.io/{s}
ipvoid	Ipvoid	www.ipvoid.com/scan/{s}
isbndb	ISBNdb.com	isbndb.com/search-all.html?kw={s}
isbnnu	isbn.nu	isbn.nu/{s}
iscrap	iScrapApp	iscrapapp.com/?SearchTxt={s}
istock istockphoto stockphotos	iStockPhoto	www.istockphoto.com/search/2/image?phrase={s}
itaigi	iTaigi	itaigi.tw/k/{s}
itella	Itella Item Tracking	www.itella.fi/itemtracking/itella/search_by_shipment_id?ShipmentId={s}
itnewz	itnewz	itnewz.ro/?s={s}:
iyanmv	Iyanm	iyanmv.com/?s={s}
j2team	Juno_okyo's Blog	junookyo.blogspot.com/search?q={s}
jaconj	Ultra Handy Japanese Verb Conjugator	japaneseverbconjugator.com/VerbDetails.asp?txtVerb={s}&Go=Conjugate
javafx	Oracle JavaFX	search.oracle.com/search/search?num=10&exttimeout=false&q={s}+url:/javase/8/javafx/api&group=Documentation
jaycar	Jaycar Electronics NZ	www.jaycar.co.nz/search/?q={s}
jbhifi	JB Hi Fi	www.jbhifi.com.au/?q={s}
jdpune	JustDial Pune	www.justdial.com/Pune/{s}
jergas	Jergas de habla hispana	www.jergasdehablahispana.org/?pais=&palabra={s}&submit=Buscar&tipobusqueda=0
jetlag	The Happy Jetlagger	thehappyjetlagger.com/?s={s}
jhulib	Johns Hopkins University Library	catalyst.library.jhu.edu/multi_search?utf8=%E2%9C%93&search_field=all_fields&q={s}
jobsbg	jobs.bg	www.jobs.bg/front_job_search.php?zone_id=0&distance=0&location_sid=0&all_categories=0&all_type=0&all_position_level=1&all_company_type=1&keyword={s}&last=0
jobsca	Indeed Canada	www.indeed.ca/jobs?q={s}
jobsde	Jobs in Germany	englishjobs.de/search?q={s}
joinup	Joinup	joinup.ec.europa.eu/search?keys={s}
jshint	JSHint	www.jshint.com/docs/options/#{s}
jsinfo	Javascript Info	javascript.info/search/?query={s}
juejin	Juejin	juejin.im/search?query={s}&type=all
junodl	Juno Download	www.junodownload.com/search/?q[all][0]={s}
justia	Justia	law.justia.com/lawsearch?query={s}
juwelo	juwelo.es	www.juwelo.es/catalogsearch/result/?q={s}
kaffee	Citadella Online Kaffee Shop	www.citadella.de/?s={s}
kahoot	Kahoot	create.kahoot.it/search?filter=1&query=science&tags={s}
kakaku	Kakaku.com	search.kakaku.com/{s}/
kaleva	Kaleva.fi	www.kaleva.fi/haku/?search={s}
kanopy	Kanopy	www.kanopy.com/s?query={s}
kaprof	Khan Academy (Profile Page)	www.khanacademy.org/profile/{s}/
kelkoo	Kelkoo UK	www.kelkoo.co.uk/search?query={s}
kemono	Japari Library	japari-library.com/w/index.php?search={s}
khwiki	Kingdom Hearts Wiki	www.khwiki.com/index.php?title=Special:Search&search={s}
kicker	kicker online	www.kicker.de/home/suchergebnisse.html?suchbegriff={s}
kijiji	Kijiji	www.kijiji.ca/b-search.html?formSubmit=true&pageNumber=1&searchView=LIST&sortByName=dateDesc&urgentOnly=false&keywords={s}&SearchCategory=0
kindle	Amazon Kindle	www.amazon.com/s?k={s}&i=digital-text
kirkus	Kirkus Reviews	www.kirkusreviews.com/search/?q={s}
kkusta kuantokusta	KuantoKusta	www.kuantokusta.pt/search?q={s}
klocks	Klocksnack	klocksnack.se/search/6404040/?q={s}&o=date
koboca	Kobo (Canada)	www.kobo.com/ca/en/search?Query={s}
kobonz	Kobo NZ	www.kobo.com/nz/en/search?Query={s}
kobouk	Kobo UK	www.kobo.com/gb/en/search?Query={s}
kompas	Kompas	search.kompas.com/search/?q={s}&submit=Submit+Query
koohii	Koohii	kanji.koohii.com/study/kanji/{s}
koreus	Koreus	www.koreus.com/search.php?q={s}&sa=Rechercher
kosmas	Kosmas	www.kosmas.cz/hledani/?query={s}
kotlin	kotlinlang.org	kotlinlang.org/?q={s}
kreedo	Kreedo GbR	www.kreedo.de/index.php?cl=search&searchparam={s}
kuketz	Kuketz-Blog	www.kuketz-blog.de/?s={s}
kuwiki wikiku	Kurdish Wikipedia	ku.wikipedia.org/w/index.php?search={s}
kvasir	kvasir	www.kvasir.no/alle?q={s}
laftel	Laftel	laftel.net/search?keyword={s}
lammps	LAMMPS Documentation	lammps.sandia.gov/doc/search.html?q={s}
lanpor	Microsoft Language Portal	www.microsoft.com/Language/en-US/Search.aspx?sString={s}&langID=pl-pl
lapack	Netlib	www.netlib.org/lapack/complex16/{s}.f
lastfm last.fm	Last.fm	www.last.fm/search?q={s}
latino	Dizionario Latino Olivetti	www.dizionario-latino.com/dizionario-latino-italiano.php?parola={s}
lawyer	Avvo	www.avvo.com/search?query={s}
lbcidf	Le Bon Coin IDF	www.leboncoin.fr/recherche/?text={s}&regions=12
lcauth	Library of Congress Authorities	authorities.loc.gov/cgi-bin/Pwebrecon.cgi?Search_0Arg={s}&Search_Code=SHED_&PID=pyauyDhI6ZL9vR3exz9cx8t8BF&SEQ=20161101104025&CNT=100&HIST=1
ldlcbe	LDLC Belgium	www.ldlc.be/navigation/{s}/
leafly	Leafly	www.leafly.com/search?q={s}
lechat mistral	Le Chat	chat.mistral.ai/chat?q={s}
lecker	Lecker	www.lecker.de/suche-rezept/{s}
ledict	Le Dictionnaire	www.le-dictionnaire.com/resultats.php?mot={s}
legimi	Legimi.pl	www.legimi.pl/ebooki/?szukaj={s}
lelong	Lelong	www.lelong.com.my/catalog/all/list?TheKeyword={s}
lenovo	Lenovo	shop.lenovo.com/SEUILibrary/controller/e/web/LenovoPortal/en_US/site.workflow:SimpleSiteSearch?q={s}&v=15&lang=en&cc=us&en=utf&Search.x=0&Search.y=0&Search=Search
letras letrasbr	letras.mus.br	letras.mus.br/?q={s}
li-ion	Battdepot Nederland	www.battdepot.com/nl/Search.aspx?keywords={s}
libcom	libcom.org	libcom.org/search/node/{s}
libris	Libris	libris.kb.se/hitlist?d=libris&q={s}&f=simp&spell=true
libuva	UvA CataloguePlus	lib.uva.nl/primo-explore/search?query=any,contains,{s}&tab=all&search_scope=uva_all&vid=UVA
lienit	Linguee (English <-> Italian)	www.linguee.com/english-italian/search?source=auto&query={s}
lignux	LiGNUx	lignux.com/?s={s}
lindit	Linguee Ger - It	www.linguee.de/deutsch-italienisch/search?source=auto&query={s}
lingfe lingfr	Linguee (Fr-En)	www.linguee.fr/francais-anglais/search?source=auto&query={s}
lingfn	Linguee (Fr-Nl)	www.linguee.fr/francais-neerlandais/search?source=auto&query={s}
lingfp lingpf	Linguee (fr2pt)	www.linguee.fr/francais-portugais/search?source=auto&query={s}
linkup	LinkUp	www.linkup.com/results.php#q={s}
linode	Linode Library	library.linode.com/search?query={s}
linorg	Linux.org	www.linux.org/search/?q={s}
linuxq	linuxquestions	www.linuxquestions.org/questions/{s}
lipsum	Lorem Ipsum	www.lipsum.com/feed/html?amount={s}
listal	Listal	www.listal.com/search/{s}
listam	List.am	www.list.am/category?q={s}
litdev	Literary Devices and Terms	literarydevices.net/?s={s}
litefx	LiteFX	www.litefx.to/search?q={s}
llbean	L. L. Bean	www.llbean.com/llb/search/?freeText={s}&init=1
lmgtfy	LMGTFY	www.lmgtfy.com/?s=d&q={s}
lmwiki	Luigi's Mansion Wiki	luigi-mansion.wikia.com/wiki/Special:Search?search={s}
lobugs	LibreOffice Bugs	bugs.documentfoundation.org/buglist.cgi?quicksearch={s}
lodash	lodash documentation	lodash.com/docs#{s}
lojban	Lojban.org (the official website and wiki)	mw.lojban.org/index.php?search={s}&title=Special:Search&go=Go
lolcom	LocksOnline.com	www.locksonline.com/search/search.html?zoom_query={s}
lolpro	LoL Pro	www.lolpro.com/search?search={s}
longdo	LongDo Dict	dict.longdo.com/search/{s}
loomis	Loomis Tracking	www.loomisexpress.com/ca/wfTrackingStatus.aspx?PieceNumber={s}
loseit	loseit	www.loseit.com/search/?term={s}
loslog	LineageOS Log	www.lineageoslog.com/search?q={s}
lotrow	LOTRO-Wiki	lotro-wiki.com/index.php?search={s}&button=&title=Special:Search
lselib	LSE Library	librarysearch.lse.ac.uk/primo-explore/search?query=any,contains,{s}&tab=default_tab&search_scope=CSCOP_ALL&sortby=rank&vid=44LSE_VU1
lspace	L-Space	www.lspace.org/cgi-imps/perlfect/search/search.pl?q={s}
ltulib	La Trobe University Library	search.lib.latrobe.edu.au/primo_library/libweb/action/dlSearch.do?vid=LATROBE&institution=LATROBE&search_scope=All&query=any,contains,{s}
luther	luther.edu	www.luther.edu/search/?q={s}
lutris	Lutris - Open Gaming Platform	lutris.net/games/?q={s}
lyrics lyricwiki lyricswiki	Lyric Wiki	lyrics.wikia.com/Special:Search?search={s}&fulltext=Search
lyriki	Lyriki	lyriki.com/index.php?title=Special:Search&search={s}&go=Go
macdic macmillan	Macmillan Dictionary	www.macmillandictionary.com/dictionary/american/{s}
macmag	MacMagazine	macmagazine.uol.com.br/?s={s}
madonc	MAD On Collections	madoncollections.com/collectables/?q={s}
madura	Madura English-Sinhala Dictionary	maduraonline.com/?find={s}
magalu	Magazine Luiza	www.magazineluiza.com.br/busca/{s}
magpie	MusicMagPie	store.musicmagpie.co.uk/category/?keyword={s}
malall	MyAnimeList Search All	myanimelist.net/search/all?q={s}
mangas	Kitsu Manga	kitsu.io/manga?text={s}
manjbc	Manjaro Branch Compare	manjaristas.org/branch_compare?q={s}
manned	Manned	manned.org/browse/search?q={s}
mapfan	MapFan	mapfan.com/map/words/{s}/spots
mapion	Mapion	www.mapion.co.jp/s/q={s}/t=spot/
mapsfr	Google Maps FR	maps.google.com/maps?hl=fr&q={s}
mapsuk	Google Maps UK	maps.google.co.uk/maps?q={s}
marine	MarineTraffic	www.marinetraffic.com/en/ais/index/search/all/keyword:{s}
market	Android Market	market.android.com/search?q={s}&c=apps
marmit marmiton	Marmiton	www.marmiton.org/recettes/recherche.aspx?s={s}
marvel	Marvel.com	www.marvel.com/search/?query={s}
mathem	Mathem	www.mathem.se/sok?q={s}
mathse mstack semath	Mathematics - Stack Exchange	math.stackexchange.com/search?q={s}
matlab	Matlab	uk.mathworks.com/help/search.html?qdoc={s}&submitsearch=Search
mbarea	MusicBrainz Areas	musicbrainz.org/search?query={s}&type=area
mbeans	Magic Beans	mbeans.com/search.html?search={s}
mbwiki	MusicBrainz Wiki	wiki.musicbrainz.org/index.php?title=Special:Search&go=Go&search={s}
mbwork	MusicBrainz Works	musicbrainz.org/search?query={s}&type=work
mcgill	McGill University	www.mcgill.ca/search/?query={s}&find=Search
mcmods	Curseforge Minecraft Mods	www.curseforge.com/minecraft/mc-mods/search?search={s}
mcpedl	mcpedl.com	mcpedl.com/?s={s}
mcplmd	Montgomery County Public Libraries (Maryland)	mcpl.aspendiscovery.org/Union/Search?lookfor={s}
mcskin	Minecraft Skin Search	www.mcskinsearch.com/skin/{s}
mdcomp	MD Computers	mdcomputers.in/index.php?route=product/search&search={s}&description=true
mdmods mrmods	Modrinth (Mods)	modrinth.com/mods?q={s}
mdnapi	MDN API	developer.mozilla.org/en-US/search?q={s}&topic=api
me_irl	/r/me_irl	www.reddit.com/r/me_irl/search?q={s}&restrict_sr=on
mednar	Mednar	www.mednar.com/mednar/result-list/fullRecord:{s}
medphd	Medical Phd	medical-phd.blogspot.com/search?q={s}
meetup	Meetup	www.meetup.com/find/?keywords={s}
meijer	Meijer	www.meijer.com/shopping/search.html?text={s}
melvyl	Melvyl Catalog (University of California Libraries)	melvyl.worldcat.org/search?q={s}
merlin	Merlin.pl	merlin.pl/browse/search.html?offer=O&phrase={s}
metade	de.Metapedia.org	de.metapedia.org/m/index.php?search={s}&title=Spezial:Suche
metasx semeta	Meta Stack Exchange	meta.stackexchange.com/search?q={s}
meteli	Meteli	www.meteli.net/tapahtumahaku?q={s}
metoff metoffice	Met Office	www.metoffice.gov.uk/public/weather/location-search/sitename?searchLocation={s}
midday	Midday Somewhere	www.middaysomewhere.com/prices/search?q={s}
mindat	Mindat	www.mindat.org/search.php?search={s}
minsal	Ministero della Salute	cercaportale.salute.gov.it/search?q={s}&btnG=Cerca&skipob=true&ulang=it&proxystylesheet=defaultPORT_front-end&num=10&sort=date%3AD%3AL%3Ad1&wc=200&ud=1&entqr=3&wc_mc=1&oe=UTF-8&ie=UTF-8&client=default_frontend&entqrm=0&filter=p&site=default_collection
misumi	Misumi USA	us.misumi-ec.com/vona2/result/?Keyword={s}
mitlib	MIT Libraries	lib.mit.edu/search/bento?q={s}
mitvid	MIT Video	video.mit.edu/search/?q={s}
mjtsai	Michael Tsai - Blog	duckduckgo.com/?q={s}&sites=mjtsai.com&ia=web
mmanga muslimmanga	Muslim Manga	muslimmanga.org/?lang=en&s={s}
mnaver	Mobile Naver	m.search.naver.com/search.naver?query={s}
mobcup	MobCup	mobcup.net/search?q={s}
moglix	Moglix	www.moglix.com/search?controller=search&orderby=position&orderway=desc&search_query={s}&submit_search=Search
mojeek	mojeek	www.mojeek.com/search?q={s}
mollat	Mollat	www.mollat.com/recherche?requete={s}
monash	Monash University	www.monash.edu/search?query={s}
moncul	Et mon cul c'est du tofu ?	moncul.org/?s={s}
mondou	Mondou Pet Store	www.mondou.com/en-CA/Search?keywords={s}
mormon	mormon.org	www.mormon.org/searchresults#?query={s}
mouser	Mouser Electronics	www.mouser.com/c/?q={s}
ms.net	Microsoft .Net API	docs.microsoft.com/en-us/dotnet/api/?view=netframework-4.7&term={s}
muppet	Muppet Wiki	muppet.wikia.com/wiki/Special:Search?search={s}
murfie	Murfie	www.murfie.com/search?search={s}
musicr	Music Radar	www.musicradar.com/search?searchTerm={s}
musikm	Musik Meisinger Burghausen	www.musik-meisinger.de/1/advanced_search_result.php?keywords={s}
mxtool	MxToolBox	mxtoolbox.com/SuperTool.aspx?action={s}
mypdns	My Private DNS	www.mypdns.org/trac/search?q={s}
nabava	Nabava.net	www.nabava.net/search.php?q={s}
naruto	Narutopedia	naruto.wikia.com/wiki/Special:Search?search={s}
natgeo nationalgeographic	National Geographic	www.nationalgeographic.com/search/?q={s}
natpng	The National Newspaper Papua New Guinea	www.thenational.com.pg/?s={s}
nature	Nature	www.nature.com/search/executeSearch?sp-q-1=&sp-q={s}
nayiri	Nayiri Armenian dictionary	nayiri.com/search?query={s}
nbooks	NotebooksBillger	www.notebooksbilliger.de/produkte/{s}
nebula	Nebula	nebula.tv/search?q={s}
necrod	Crypt of the NecroDancer Wikia	crypt-of-the-necrodancer.wikia.com/wiki/Special:Search?search={s}&fulltext=Search&ns0=1&ns1=1&ns2=1&ns3=1&ns4=1&ns5=1&ns6=1&ns7=1&ns8=1&ns9=1&ns10=1&ns11=1&ns12=1&ns13=1&ns14=1&ns15=1&ns110=1&ns111=1&ns828=1&ns829=1&ns1201=1#advanced
nemlig	Nemlig	www.nemlig.com/?search={s}
neowin	Neowin	www.neowin.net/search/news?terms={s}
nesdev	NESDev Wiki	wiki.nesdev.com/w/index.php?title=Special:Search&search={s}&fulltext=1
nestde	Nestoria Deutschland	www.nestoria.de/{s}
nestuk	Nestoria UK	www.nestoria.co.uk/{s}
netbsd	The NetBSD Project	www.google.com/cse?cx=006277936787196004968:mbdhrauy1wm&q=guide#gsc.tab=0&gsc.q={s}&gsc.page=1
netsrc	DotNet Reference Sources	referencesource.microsoft.com/#q={s}
newark	Newark	www.newark.com/jsp/search/browse.jsp;jsessionid=HLQ02PGLEB0YKCXDUZ1G4IQ?N=0&Ntk=gensearch_001&Ntt={s}&Ntx=mode+matchallpartial&suggestions=false&ref=globalsearch&_requestid=285160
newsmx	DuckDuckGo News Mexico	duckduckgo.com/?q={s}&iar=news&kl=mx-es&ia=news
neyzen	Neyzen.com	www.neyzen.com/aramasonuc.html?q={s}
nfowrs infowars	Infowars	www.infowars.com/?s={s}
nixdoc	Nix Documentation	nix.dev/search.html?q={s}
nixhmo nixhopt nixhmopt	NixOS Home Manager Options Search	search.nixos.org/options?query={s}&source=home_manager
nixman	Nix Reference Manual	nix.dev/manual/nix/latest/introduction?search={s}
nixopt	NixOS Options Search	search.nixos.org/options?query={s}
nixpkg	NixOS Packages	nixos.org/nixos/packages.html?query={s}
njalla	Njalla	njal.la/list/?search={s}
nodejs	Node.js Documentation	duckduckgo.com/?q=!node+{s}
nomnom	Nom Nom Paleo	nomnompaleo.com/?s={s}
noodle	Noodle Chinese	www.noodlechinese.com/search?q={s}
noogle	Noogle Nix Function Search	noogle.dev/q?term={s}
nswgov	New South Wales Government	www.nsw.gov.au/search-google/?Search={s}
ntrans	TriTrans (Norsk)	www.tritrans.net/cgibin/translate.cgi?spraak=Norsk&Fra={s}
nukepy	Nuke Dev Guide	learn.foundry.com/nuke/developers/11.2/pythondevguide/search.html?q={s}&check_keywords=yes&area=default
number	Numbermatics, the number explorer	numbermatics.com/n/{s}/
nuuvem	Nuuvem	www.nuuvem.com/catalog/search/{s}
nvkrjp	NAVER Translate from Korean to Japanese	papago.naver.com/?sk=ko&tk=ja&st={s}
nvwiki	Welcome To Night Vale Wiki	nightvale.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
nypost	NYPost	nypost.com/search/{s}/
ocamod	Odoo Community Association modules	odoo-community.org/shop?search={s}
oculus	Oculus Rift Store	www.oculus.com/experiences/go/search/?q={s}
oglobo	O Globo	oglobo.globo.com/busca/?q={s}
okazii	Okazii	www.okazii.ro/cautare/{s}.html?autoc=write
omevan	Omevan	www.omevan.com/search?q={s}:
oneill	O'Neill	us.oneill.com/shop/search/?q={s}
ongoal	Ongoal	ongoal.se/search?type=article,page,product&q={s}*
onorsk	Old Norse dictionary	www.perseus.tufts.edu/hopper/morph?l={s}&la=non
oolone	Oolone	www.oolone.com/?search={s}
opencv	OpenCV	docs.opencv.org/3.0-last-rst/search.html?q={s}
optoma	Optoma	www.optomaeurope.com/search?query={s}
oracle	Oracle	www.oracle.com/search/results?Ntt={s}&Dy=1&Nty=1&Ntk=SI-ALL5
ordbog	beta.ordbogen.com	beta.ordbogen.com/da/search#/{s}
origin	Origin	www.origin.com/en-us/store/browse?q={s}
osmcom osmforum osmcommunity	OpenStreetMap Community Forum	community.openstreetmap.org/search?q={s}
osmway	OpenStreetMap Way	www.openstreetmap.org/way/{s}
osnews	OSNews	www.osnews.com/search?q={s}
osrsge	The Old School Runescape Grand Exchange	services.runescape.com/m=itemdb_oldschool/results?query={s}
osrshs	Old School Runescape Hiscores	services.runescape.com/m=hiscore_oldschool/hiscorepersonal.ws?user1={s}
ostech	OSTechNix	www.ostechnix.com/?s={s}
ouicar	OuiCar	www.ouicar.fr/car/search?where={s}
oworks	Officeworks	www.officeworks.com.au/shop/SearchDisplay?searchTerm={s}
oxenes	Oxford English to Spanish	es.oxforddictionaries.com/translate/english-spanish/{s}
oxesen	Oxford Spanish to English	es.oxforddictionaries.com/translate/spanish-english/{s}
oxford	Lexico	en.oxforddictionaries.com/definition/{s}
oxfren	Oxford French to English dictionary	premium.oxforddictionaries.com/translate/french-english/{s}?q=insoumise&searchDictCode=english-french
oxlint	Oxlint (Rule)	oxc.rs/docs/guide/usage/linter/rules/{s}
packet	Packet Storm	packetstormsecurity.com/search/?q={s}
pagely	Pagely	pagely.com/?s={s}
pagine	Pagine Gialle	www.paginegialle.it/pgol/4-{s}
pandas	Pandas	pandas.pydata.org/pandas-docs/stable/search.html?q={s}&check_keywords=yes&area=default
pantip	Pantip.com	pantip.com/search?q={s}
paokfc	Paok FC	www.paokfc.gr/en/?s={s}
parker	www.parker.com	www.parker.com/portal/site/PARKER/menuitem.c9e5838e8a4c0934704b7b10237ad1ca/?selectCategory=all&vgnextfmt=EN&vgnextoid=941b13fc0fa14110VgnVCM10000032a71dacRCRD&newSearch=1&searchbox={s}
pat.fi	Pauker.at Dictionary (German-Finnish)	www.pauker.at/pauker/DE_DE/FI/wb/?modus=&suche={s}&page=1#
pat.pt	Pauker.at	www.pauker.at/pauker/DE_DE/PT/wb/?modus=&suche={s}&page=1#
pat.sv	pauker.at Dictionary (German-Swedish)	www.pauker.at/pauker/DE_DE/SE/wb?modus=&suche={s}&page=1#
pauker	Pauker	www.pauker.at/pauker/DE_EN/EN/wb/?modus=&suche={s}&page=1#
payday	Payday Wiki	payday.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
paypal	PayPal	www.paypal.com/us/selfhelp/search?q={s}&helpSearchButton=Search
pbkids	Pottery Barn Kids	www.potterybarnkids.com/search/results.html?words={s}
pbswap	PaperBackSwap	www.paperbackswap.com/book/browser.php?k={s}
pbtech	PB Tech	www.pbtech.co.nz/search?sf={s}
pbteen	PBteen	www.pbteen.com/search/results.html?words={s}
pbwiki	Polandball Wiki	polandball.wikia.com/wiki/Special:Search?search={s}
pcguia	PCGuia	www.pcguia.pt/?s={s}
pcidss	PCI Security Standards	www.pcisecuritystandards.org/search/?cludoquery={s}
pclick	PicClick UK	picclick.co.uk/?q={s}
pcwelt	PC-Welt	www.pcwelt.de/suche?searchStr={s}
peapod	Peapod	www.peapod.com/product-search/{s}
pediaa	Pediaa	pediaa.com/?s={s}
peeron	Peeron	peeron.com/cgi-bin/invcgis/psearch?query={s}&limit=none
people	Zoho People	people.zoho.com/people/#selfservice/directory/employees-searchstring={s}&searchType=0
perfil	Perfil	www.perfil.com/buscador/?q={s}
perlen	Perlentaucher	www.perlentaucher.de/nsuche?q={s}
pexels	Pexels	www.pexels.com/search/{s}/
pfwiki	Phineas and Ferb Wiki	phineasandferb.wikia.com/wiki/Special:Search?search={s}
pgdocs	PostgreSQL documentation	www.postgresql.org/search/?u=/docs/&q={s}
pgpkey	Posteo	api.posteo.de/v1/public-keys/{s}?type=openpgp
php2py	Php2Python	www.php2python.com/wiki/search/?search_term={s}
piapro	Piapro Studio Wiki	piapro-studio.fandom.com/wiki/Special:Search?query={s}
pine64	pine64.org	forum.pine64.org/search.php?text={s}&sortby=&order=desc
pinout	PinoutsGuide	pinoutsguide.com/search.php?lang=eng&t={s}
pixelp	PixelProspector	www.pixelprospector.com/?s={s}
pkgsrc	Pkgsrc.se	pkgsrc.se/search.php?so={s}
plants	Plants of the World Online	powo.science.kew.org/?q={s}
pmwiki	Paper Mario Wiki	papermario.wikia.com/wiki/Special:Search?search={s}
pocket	Pocket	app.getpocket.com/search/{s}
poczta	Poczta Polska	emonitoring.poczta-polska.pl/?numer={s}
poddex podindex podcastindex	Podcast Index	podcastindex.org/search?q={s}&type=all
polimi	Politecnico di Milano	www.polimi.it/risultati-ricerca?q={s}&cerca=Cerca
polito	Politecnico di Torino	www.polito.it/search/?lang=it&q={s}
pollen	National Allergy Forecast	www.pollen.com/forecast/current/pollen/{s}
pollin	Pollin Electronic	www.pollin.de/shop/suchergebnis.html?S_TEXT={s}
ponsed ponsdeen	Pons (ende)	en.pons.com/translate?q={s}&l=deen&in=&lf=en
ponspt	Pons.eu	en.pons.com/translate?q={s}&l=enpt&in=&lf=en
poppin	Poppin	www.poppin.com/search?q={s}
popsci	Popular Science	www.popsci.com/find/{s}
porthu	PORT.hu	port.hu/kereso?q={s}
postat	Post.at	www.post.at/sendungsverfolgung.php/details?pnum1={s}
postch swisspost	Swiss Post	www.post.ch/EasyTrack/submitParcelData.do?formattedParcelCodes={s}
postdk	Postnord DK	www.postnord.dk/da/Sider/TrackTrace.aspx?search={s}
posten	Posten	sporing.posten.no/sporing.html/{s}
postnl	PostNL	www.postnl.nl/search?q={s}&searchEntry=searchfield&boosting_label=
poupar	PouparMelhor	www.pouparmelhor.com/?s={s}
powned	Powned.it	www.powned.it/?s={s}
pravda	Pravda	www.pravda.sk/vyhladavanie/?q={s}
presto	Presto Classical	www.prestoclassical.co.uk/search.php?searchString={s}
primfx	PrimFX	www.primfx.com/q/{s}/
pronto	Revista Pronto	www.pronto.com.ar/search/google?q={s}
psiram	Psiram	www.psiram.com/de/index.php?title=Spezial:Suche&profile=default&search={s}&fulltext=Search
psulib	Penn State Library	psu.summon.serialssolutions.com/search/results?spellcheck=true&q={s}&x=0&y=0
pubdev	pub.dev	pub.dev/packages?q={s}
publix	Publix	www.publix.com/search?query={s}
puppet	Puppet Forge	forge.puppetlabs.com/modules?q={s}&commit=Go
puzzse	Puzzling	puzzling.stackexchange.com/search?q={s}
pxhere	pxhere	pxhere.com/en/photos?q={s}
pygame	Pygame	www.pygame.org/docs/search.html?q={s}
pyside	PySide	www.pyside.org/docs/pyside/search.html?q={s}&check_keywords=yes&area=default
qlcrew	QL Crew	qlcrew.com/?q={s}
quandl	Quandl	www.quandl.com/search?query={s}
quirky	Quirky	www.quirky.com/search?query={s}
quotev	Quotev	www.quotev.com/search/{s}
racing	RACING.COM	www.racing.com/search?q={s}
random	RANDOM.ORG	www.random.org/search?q={s}
rbxdev	Roblox Developer Forum	devforum.roblox.com/search?q={s}
rcenpl	Reverso Context English-Polish	context.reverso.net/translation/english-polish/{s}
rcenru	Reverso Context English-Russian	context.reverso.net/translation/english-russian/{s}
rcfrnl	Reverso Context French Dutch	context.reverso.net/translation/french-dutch/{s}
rcplen	Reverso Context Polish-English	context.reverso.net/translation/polish-english/{s}
readdc	Digital Comics - DC Entertainment	www.readdc.com/search?search={s}&submit=SEARCH
reason	Reason.com	reason.com/search?q={s}
rebiun	Red de Bibliotecas REBIUN	rebiun.baratz.es/rebiun/search?q={s}&start=0&rows=12&sort=score+desc&advanced_handler=advanced
reborn	Reborn Wiki	reborn.wikia.com/wiki/Special:Search?search={s}
recipe recipes allrecipes	Allrecipes	allrecipes.com/search/results/?wt={s}
recode	Recode	www.recode.net/search?q={s}
redbot	REDbot	redbot.org/?uri={s}
redeen reverso	Reverso German - English	dictionary.reverso.net/german-english/{s}
redeye	Red Eye Records	www.redeye.com.au/answer.asp?reion=USA&atype=both&artist={s}
redfin	RedFin	www.redfin.com/homes-for-sale#!search_location={s}
reenes	Reverso English - Spanish	dictionary.reverso.net/english-spanish/{s}
reesen	Reverso Spanish - English	dictionary.reverso.net/spanish-english/{s}
reesfr	Reverso Spanish - French	dictionary.reverso.net/spanish-french/{s}
reesge	Reverso Spanish - German	woerterbuch.reverso.net/spanisch-deutsch/{s}
reespt	Reverso	dictionary.reverso.net/spanish-portuguese/{s}
refres	Reverso French - Spanish	dictionary.reverso.net/french-spanish/{s}
regees	Reverso German - Spanish	woerterbuch.reverso.net/deutsch-spanisch/{s}
regrav	Regravity	regravity.com/?s={s}
relmbk bkradio bendixking	bendixkingradios.com	bendixkingradios.com/catalogsearch/result/?q={s}
reverb	Reverb	reverb.com/marketplace?query={s}
rfsana	RedFox Sanakirja	redfoxsanakirja.fi/sanakirja/-/s/fin/eng/{s}
rhymer	Rhymer	www.rhymer.com/RhymingDictionary/{s}.html
riopac	Regesta Imperii OPAC	opac.regesta-imperii.de/lang_en/suche.php?qs={s}
ripedb	RIPE Database	apps.db.ripe.net/search/query.html?searchtext={s}&search:doSearch=Search#resultsAnchor
ritlib	RIT Library	rit.summon.serialssolutions.com/search?l=en&q={s}
robtex	Robtex	www.robtex.com/dns-lookup/{s}
rocket	Rocket Industrial	www.rocketindustrial.com/catalogsearch/result/?q={s}
rockit	Rockit	www.rockit.it/web/cerca.php?k={s}
rockol	Rockol	www.rockol.it/search.php?s={s}
rogers	Rogers	www.rogers.com/customer/search?searchTerm={s}
rossde	Rossmann(DE)	www.rossmann.de/verbraucherportal/toolbox/suche.html?query={s}
router	Router24	www.router24.info/uebersicht?s={s}
rpi-so	Raspberry pi Stackexchange	raspberrypi.stackexchange.com/search?q={s}
rs-std	std library docs for rust	doc.rust-lang.org/std/index.html?search={s}
rselec alliedelec	RS (fka Allied Electronics)	us.rs-online.com/catalogsearch/result/?q={s}
rtings	Rtings.com	www.rtings.com/search?q={s}
rtnews	RT	rt.com/search/?q={s}
rtoday	RT - Russial Today	www.rt.com/search?q={s}
rugame	R. U. Game?	www.retrovideogamestore.com/index.php?option=com_mijoshop&route=product/search&search={s}
rumble	Rumble	rumble.com/all/q/{s}/?type=videos
rzelda	/r/zelda	www.reddit.com/r/zelda/search/?q={s}
s_user	Scratch User	scratch.mit.edu/users/{s}
sabhow	Sabhow	sabhow.blogspot.com/search/?q={s}
safari	Safari Books Online	www.safaribooksonline.com/search/?query={s}
saidit	SaidIt	saidit.net/search?q={s}
sakuga	Sakugabooru	sakugabooru.com/post?tags={s}
saturn	Saturn	www.saturn.de/de/search.html?query={s}&searchProfile=onlineshop&channel=sedede
saugus	Saugus.net: Resources for Saugus, Massachusetts	www.saugus.net/cgi-bin/htsearch?config=htdig&restrict=&exclude=&words={s}&method=and&format=long
savido	Savido	www.savido.cz/download.php?url={s}
sbwiki	SpongeBob SquarePants Wiki	spongebob.wikia.com/wiki/Special:Search?search={s}
scalai scaladex	Scala Center	index.scala-lang.org/search?q={s}
scania	Scania Commercial Vehicles	www.scania.com/global/en/home/misc/searchresult.html?q={s}
sccode	sccode.org	sccode.org/search?q={s}
schema	schema.org	schema.org/docs/search_results.html?q={s}
scielo	Scientific Electronic Library Online	search.scielo.org/?q={s}&where=ORG
scilab	Scilab Documentation	help.scilab.org/docs/6.0.0/en_US/search/{s}
scilit	Scilit	www.scilit.net/articles/10/0?Search={s}
sclang	SuperCollider	doc.sccode.org/Search.html#{s}
scotby	Scotby Cycles	www.scotbycycles.co.uk/facetresults.aspx?Term={s}
scouts	Scouts UK	scouts.org.uk/cse-search/?query={s}
scp-es	scp	lafundacionscp.wikidot.com/search:site/a/pf/q/{s}
scrapy	scrapy docs	doc.scrapy.org/en/latest/search.html?q={s}
sechat	Stack Exchange Chat	chat.stackexchange.com/rooms/{s}
senate	Portal Senate	senat.me/en/?s={s}
sensei senseis senseislibrary	Sensei's Library	senseis.xmp.net/?search={s}&searchtype=title
sentry	Sentry	docs.sentry.io/search/?q={s}
sfgate	SFGate	www.sfgate.com/search/?action=search&query={s}
sfhelp	Salesforce Help	help.salesforce.com/search#q={s}
sfmoma	SFMOMA	www.sfmoma.org/search/?q={s}
sforce	Salesforce	login.salesforce.com/_ui/search/ui/UnifiedSearchResults?str={s}
sfulib	Simon Fraser University Library	search.lib.sfu.ca/?q={s}
sha256	Cryptography.cc	cryptography.cc/convert?text={s}&algorithm=sha256
shmoop	Shmoop	www.shmoop.com/search?q={s}
shopto	ShopTo.net	www.shopto.net/search/newSearchPage?Filter_department=&newsearch={s}
shpock	Shpock	en.shpock.com/q/{s}/
shwiki wikish	Serbo-Croatian Wikipedia	sh.wikipedia.org/w/index.php?search={s}
sicons	Simple Icons	simpleicons.org/?q={s}
sigfox	Sigfox Partner Network	partners.sigfox.com/search/products?q={s}
sikuli	Sikuli	doc.sikuli.org/search.html?q={s}
silver	providentmetals.com	www.providentmetals.com/catalogsearch/result/?q={s}
simbad	SIMBAD Astronomical Database	simbad.u-strasbg.fr/simbad/sim-basic?Ident={s}
simkla	Simkl Anime	simkl.com/search/?type=anime&q={s}
simkll	Simkl Lists	simkl.com/search/lists/?favorites=false&q={s}
simklm	Simkl Movies	simkl.com/search/?type=movies&q={s}
simklt	Simkl TV Shows	simkl.com/search/?type=tv&q={s}
skenfi	Sanakirja.org en-fi	www.sanakirja.org/search.php?l=3&l2=17&q={s}
skills	Skills.sh	skills.sh/?q={s}
skinny	The Skinny Confidential	www.theskinnyconfidential.com/?s={s}
slader	Slader	www.slader.com/search/?search_query={s}
slocki	Searchlock Images	www.searchlock.com/search?tbm=isch&q={s}
slwiki	Second Life Wiki	wiki.secondlife.com/w/index.php?search={s}
smarty	Smarty	www.smarty.net/search?q={s}&show=manual-en&x=0&y=0
smiths	smithsfoodanddrug	www.smithsfoodanddrug.com/search?query={s}&searchType=natural
smogrs	Smogon R_S	www.smogon.com/dex/rs/pokemon/{s}/
sndocs	ServiceNow Product Docs	docs.servicenow.com/search?q={s}
snuson	SnusOn	www.snuson.com/forum/shop/search/?q={s}&submit.x=0&submit.y=0
sobash	Stack Overflow Bash Search	stackoverflow.com/search?q=[bash]+{s}
sobeys	Sobeys	www.sobeys.com/en/search/?search={s}
sofasc	SofaScore	www.sofascore.com/search?q={s}
sofifa	SOFIFA	sofifa.com/players?keyword={s}
soft32	Soft32	www.soft32.com/search/?k={s}&submit=
sole24 ilsole24ore	Il Sole 24 Ore	www.ricerca24.ilsole24ore.com/fc?keyWords={s}&submit=+&header-search=keyWords&cmd=static&moneyPath=https://finanza-mercati.ilsole24ore.com&chId=30&path=/search/search_engine.jsp&field=Titolo|Testo&orderBy=score+desc
soluce	SuperSoluce	www.supersoluce.com/search/supersoluce/{s}
soundy	Soundy	www.soundy.top/sounds?q={s}
sowiki wikiso	Somali Wikipedia	so.wikipedia.org/w/index.php?search={s}
spigot spigotmc	SpigotMC	www.spigotmc.org/search/14487199/?q={s}&o=relevance
splice	Splice	splice.com/sounds/search?q={s}
splunk	splunk	www.splunk.com/en_us/search.html?query={s}
sponge spongebob	Encyclopedia SpongeBobia	spongebob.fandom.com/wiki/Special:Search?search={s}
sport1	Sport1	www.sport1.de/suche#{s}
sporum	The Sporum	forum.spore.com/jforum/jforum.page?module=search&action=search&search_keywords={s}
sqlite	SQLite	www.sqlite.org/search?s=d&q={s}
sretro	Sonic Retro	info.sonicretro.org/index.php?search={s}
sswiki speedsolvingwiki	Speedsolving wiki	www.speedsolving.com/wiki/index.php?title=Special:Search&search={s}&go=Go
staten	Statenvertaling	www.statenvertaling.net/zoek.php?q={s}
staygb	Stay GB	staygb.com/search?q={s}
stixoi	stixoi.info	www.stixoi.info/stixoi.php?info=SS&keywords={s}&act=ss
stockx	StockX	stockx.com/search?s={s}
strain	wikileaf	www.wikileaf.com/strains/?search={s}
strans	TriTrans	www.tritrans.net/cgibin/translate.cgi?spraak=Spansk&Fra={s}
strava	Strava	www.strava.com/athletes/search?utf8=%E2%9C%93&text={s}&gsf=1
street	StreetEasy	streeteasy.com/search?utf8=%E2%9C%93&search={s}
subeen	Subeen.com	subeen.com/?s={s}
subito	Subito.it	www.subito.it/annunci-italia/vendita/usato/?q={s}
subnet	Subnet Calculator - TunnelsUp	www.tunnelsup.com/subnet-calculator?ip={s}
sucuri	Sucuri	sitecheck.sucuri.net/results/{s}
sunnah	Sunnah.com	sunnah.com/search/?q={s}
superd superdownloads	SuperDownloads	busca.superdownloads.com.br/busca/{s}.s1.html
survey	SurveyMonkey	www.surveymonkey.com/dashboard/?term{s}
suttac	www.suttacentral.net	suttacentral.net/search?query={s}
suwiki wikisu	Sundanese Wikipedia	su.wikipedia.org/w/index.php?search={s}
svhelp	SiteVision Developer	help.sitevision.se/SiteVision_4_0/searchhelp.html?query={s}
sworks	Stanford SearchWorks	searchworks.stanford.edu/?utf8=%E2%9C%93&search_field=search&q={s}
swwiki	Wookieepedia	starwars.wikia.com/wiki/Special:Search?search={s}
syncme	Sync.me	sync.me/search/?number={s}
tacmed	Tactical Medicine Training and Equipment	tactical-medicine.com/search?q={s}
taddlr	Taddlr	taddlr.com/de/?s={s}
tafesa	TAFE SA	www.tafesa.edu.au/search-results?indexCatalogue=all&searchQuery={s}
talkgr	TalkGraphics	www.talkgraphics.com/search.php?searchid={s}:
tanuki	Tanuki.pl	tanuki.pl/szukaj/{s}
tanzil	Tanzil	tanzil.net/#search/quran/{s}
taobao	Taobao	s.taobao.com/search?q={s}
targeo	Targeo	mapa.targeo.pl/{s}
tarkov	Escape From Tarkov Wiki	escapefromtarkov.gamepedia.com/index.php?search={s}
tbooks	Thriftbooks	www.thriftbooks.com/browse/?b.search={s}#b.oos
tdbank	TD Bank	www.tdbank.com/CustomerService/search-results.aspx?q={s}
tearma	Tearma	www.tearma.ie/Search.aspx?term={s}
tek.no	tek.no	www.tek.no/sok?query={s}
tekmag	Teknikmagasinet	www.teknikmagasinet.se/sokresultat?CMS_SearchString={s}
telkku	Telkku.com	www.telkku.com/search?searchText={s}
tema18	Tema18 blog	tema18.blogspot.com/search?q={s}
texdoc	Texdoc	texdoc.net/pkg/{s}
tfwiki	Transformers Wiki	tfwiki.net/wiki/Special:Search?search={s}&go=Go
tgdict tangorin	Tangorin	tangorin.com/words?search={s}
tgwiki wikitg	Tajik Wikipedia	tg.wikipedia.org/w/index.php?search={s}
thalia	Thalia.de	www.thalia.de/suche?sq={s}
theage	The Age	www.theage.com.au/search?text={s}
theses	Theses.fr	www.theses.fr/?q={s}
thonky	Thonky	www.thonky.com/search.php?q={s}
thorne	Thorne Research	www.thorne.com/search?q={s}
thread	Thread reader	threadreaderapp.com/search?q={s}
thrive	Thrive Market	thrivemarket.com/search/results?filter[search]={s}
thwack	Thwack	thwack.solarwinds.com/search.jspa?q={s}
tiktok	TikTok	www.tiktok.com/search?q={s}
tildes	Tildes	tildes.net/search?q={s}
tindie	tindie	www.tindie.com/search/?q={s}
tineye	Tineye	www.tineye.com/search?url={s}
tippie	Tippie College of Business	tippie.uiowa.edu/google-search?search={s}
tiwimb	This is why I'm broke	www.thisiswhyimbroke.com/{s}
tkk2es	Tradukka Google Translate (to spanish)	tradukka.com/translate/es/{s}
tlwiki wikitl	Tagalog Wikipedia	tl.wikipedia.org/w/index.php?search={s}
tmblog	Trend Micro Security Blog	blog.trendmicro.com/?s={s}
tnyims	Tny.im Shorten URL	tny.im/yourls-api.php?action=shorturl&url={s}
toicon	to [icon]	www.toicon.com/icons?query={s}
tomshw tomshardware	Tom's Hardware	www.tomshardware.com/s/{s}
toramp	toramp.com	www.toramp.com/search.php?search={s}
tostar thestar	The Star	www.thestar.com/search.html?q={s}
touhou	Touhou Wiki	en.touhouwiki.net/index.php?search={s}
tperth	transperth	www.transperth.wa.gov.au/Search-Results?Search={s}
trackr	Packagetrackr	www.packagetrackr.com/track/?submit=&n={s}&c=
trainb zugtafel trainboard	Trainboard	trainboard.eu/bang.html?station={s}
travel	The Well Travelled Family	thewelltravelledfamily.com/?s={s}
travis	Travis CI	travis-ci.org/search/{s}
trello	Trello	trello.com/search?q={s}
trends gtrends	Google Trends	trends.google.com/trends/explore?date=all&geo=US&q={s}
tropes	All the tropes	allthetropes.wikia.com/wiki/Special:Search?search={s}
trouva	Trouva	www.trouva.com/shop/search/{s}
trrust	TRRUST	www.grnpedia.org/trrust/result.php?gene={s}&species=human&confirm=0
trulia	Trulia	www.trulia.com/validate.php?tst=h&display=for+sale&search={s}&type=&min_price=min&max_price=max&min_num_beds=0&min_num_baths=0&min_size=0&submit_btn=SEARCH
tshirt	Tpop	www.tpop.fr/search?type=product&q={s}
tubafm	Tuba FM	fm.tuba.pl/artysta/{s}
tumblr	tumblr	www.tumblr.com/search/{s}
tureng	Tureng	tureng.com/tr/turkce-ingilizce/{s}
tvdbfr	TheTVDB	www.thetvdb.com/search?q={s}&l=fr
tvmaze	TVmaze	www.tvmaze.com/search?q={s}
tvthek	ORF TVThek	tvthek.orf.at/search?q={s}
twitch twitchc	Twitch Channel	twitch.tv/{s}
twittv	TWiT	twit.tv/search/{s}
twuser	Twitter users	x.com/search/users?q={s}
tydade	Tyda.se Dictionary (Swedish-German)	tyda.se/search/{s}?lang[0]=de&lang[1]=sv
tydala	Tyda.se Dictionary (Swedish-Latin)	tyda.se/search/{s}?lang[0]=la&lang[1]=sv
typstu	Typst Universe	typst.app/universe/search?q={s}
uappex	uApp Explorer	uappexplorer.com/apps?q={s}&sort=relevance
ubclib	University of British Columbia Library	ubc.summon.serialssolutions.com/search?s.cmd=addFacetValueFilters(ContentType,Newspaper+Article:t)&spellcheck=true&s.q={s}
ubottu	Ubottu.com	ubottu.com/factoids.cgi?search={s}
ubuntu	Ubuntu	www.ubuntu.com/search?q={s}
uchamp	U.GG Champion	u.gg/lol/champions/{s}
ucllib	UCL Library	ucl-new-primo.hosted.exlibrisgroup.com/primo-explore/search?query=any,contains,{s}&offset=0&tab=local&vid=UCL_VU2&search_scope=CSCOP_UCL
ucscgb	UCSC Genome Browser on Human	www.genome.ucsc.edu/cgi-bin/hgTracks?hgsid=592541357_hq8TArn5c0CoLwcXM3n3eZOaR8ZC&org=Human&db=hg38&position={s}&pix=800
uitinv	UIT in Vlaanderen	www.uitinvlaanderen.be/agenda/search?query={s}
ukcsgo	UKCSGO	ukcsgo.com/forums/search/{s}/
ulabox	Ulabox	www.ulabox.com/busca?q={s}
umassd	University of Massachusetts Dartmouth	www.umassd.edu/universitysearch/?q={s}
unclib	University of North Carolina at Chapel Hill Library	library.unc.edu/find/?q={s}
unicat	Unicat	unicat.be/uniCat?func=search&language=en&fromWeb=1&formQuery={s}
unicef	UNICEF	www.unicef.org/search/search.php?q_en={s}
unilad	UNILAD	www.unilad.co.uk/search/{s}
uniqlo	Uniqlo	www.uniqlo.com/us/en/search/?q={s}&lang=default
unitym	Unity Manual	docs.unity3d.com/Manual/30_search.html?q={s}
univie	University of Vienna	ufind.univie.ac.at/en/search.html?query={s}
unizar	Universidad de Zaragoza	www.unizar.es/search/node/{s}
unterm	UN terminology search portal	unterm.un.org/unterm2/en/search?searchTerm={s}
unxprn	reddit.com/r/unixporn	www.reddit.com/r/unixporn/search?q={s}&restrict_sr=1
uoalib	University of Auckland Library	www.library.auckland.ac.nz/search/{s}
uplabs	UpLabs	www.uplabs.com/search?q={s}
upwork	Upwork	www.upwork.com/o/jobs/browse/?q={s}
urbout	Urban Outfitters	www.urbanoutfitters.com/fr/catalog/search.jsp?q={s}
usclib	University of Southern California Libraries	usc-primo.hosted.exlibrisgroup.com/primo-explore/search?institution=01USC_INST&vid=01USC&mode=Basic&facet=&displayMode=full&bulkSize=25&highlight=true&dum=true&query=any,contains,{s}&displayField=all&pcAvailabiltyMode=true&sortby=rank&lang=en_US
usmint	The United States Mint	search.usmint.gov/search?affiliate=usmint.gov&formFocused=0&query={s}
usopen	US Open Tennis	www.usopen.org/en_US/search/results.html?query={s}
utaite	Utaite Database	utaitedb.net/Search?filter={s}
utopia	Utopia Wiki	wiki.utopia-game.com/index.php?title=Special:Search&search={s}&go=Go
uwalib	The University of Western Australia Library	onesearch.library.uwa.edu.au/discovery/search?query=any,contains,{s}&tab=Everything&search_scope=MyInst_and_CI&sortby=rank&vid=61UWA_INST:UWA&offset=0
uwflow	University of Waterloo Flow	uwflow.com/courses?keywords={s}
vagssp	ProCarManuals.com	procarmanuals.com/?s={s}
valves valvesonline	Valves Online	www.valvesonline.co.uk/catalogsearch/result/?q={s}
vatera	Vatera	www.vatera.hu/listings/index.php?q={s}
vector	VectorMe	vector.me/search/{s}
vedant	Vedant Computers	www.vedantcomputers.com/index.php?route=product/search&search={s}&description=true
veekun	Veekun Pokedex	veekun.com/dex/lookup?lookup={s}
verbfi	Finnish Verb Conjugator	www.dictionar-finlandez.net/online/verbs/conjugate_verb.php?verb={s}
verbix	Verbix	verbix.com/find-verb/?verb={s}
veroot	Veroot	veroot.com/search/{s}
versus	Versus	versus.com/en/{s}
vicgov vicgovau	Victorian Government	www.vic.gov.au/search?q={s}
vidaxl	www.vidaxl.nl	www.vidaxl.nl/catalogsearch/result/?q={s}
vidlii	VidLii	www.vidlii.com/results?q={s}
vigcit	The Vigilant Citizen	vigilantcitizen.com/?s={s}
vimdoc	Vimdoc	vimdoc.sourceforge.net/search.php?search={s}&docs=help
vivino	Vivino	www.vivino.com/search/wines?q={s}
vmdocs	VMware Docs	docs.vmware.com/en/search/#/{s}
vnillo	Vanillo	vanillo.co/search?q={s}
vocadb	VocaDB	vocadb.net/Search?filter={s}
vossey	Vossey.com	www.vossey.com/recherche/index.php?ac=recherche&titre={s}
vrchat	VRChat	vrchat.net/home/search/{s}
vscode	Visual Studio Code Extensions	marketplace.visualstudio.com/search?term={s}&target=VSCode&sortBy=Relevance
vsdocs	Visual Studio Code Docs	code.visualstudio.com/Search?q={s}
vtfile vthash	VirusTotal File	www.virustotal.com/gui/file/{s}
vtluug	vtluug wiki	vtluug.org/w/index.php?title=Special:Search&search={s}
w3satt	W3Schools Tag Attributes	www.w3schools.com/tags/att_{s}.asp
w3stag	W3 Schools Tag	www.w3schools.com/tags/tag_{s}.asp
wadoku	WaDoKu	www.wadoku.de/search/{s}
walrus	The Walrus	thewalrus.ca/?s={s}
wandsk	Wikiwand (sk)	www.wikiwand.com/sk/{s}
wanelo	Wanelo	wanelo.com/search?query={s}
watson	Watson	www.watson.ch/u/search?q={s}
wdtprs	Fr. Z's Blog (Wdtprs.com)	wdtprs.com/blog/?s={s}
web2py	Web2Py	web2py.com/books/default/search/29?search={s}
webbco	Webb Companies USA	webbco.us/search.php?q={s}
webext	WebExtension Docs	developer.mozilla.org/en-US/search?q={s}&topic=addons
weblio weblioj	Weblio	www.weblio.jp/content/{s}
webmin	Webmineral	webmineral.com/cgi-bin/search/search.pl?sitesearch=&Terms={s}&x=0&y=0
websta	Websta	websta.me/search/{s}
weezer	Weezerpedia	weezerpedia.com/wiki/index.php?search={s}
weixin	weixin	weixin.sogou.com/weixin?type=2&query={s}
wetten	Nederlandse wet- en regelgeving	wetten.overheid.nl/zoeken/rs/2,3,4/titel/{s}/
wetter	wetter.com	www.wetter.com/suche/?q={s}
whatis	WhatIs.com	whatis.techtarget.com/wsearchResults/1,290214,sid9,00.html?query={s}
whoint	World Health Organization	www.who.int/search?query={s}
whoizh	Heroku Whoiz	whoiz.herokuapp.com/lookup?url={s}
whosam whosampled	WhoSampled	whosampled.com/search/?q={s}
wickes	Wickes	www.wickes.co.uk/search?text={s}
wikith	Thai Wikipedia	th.wikipedia.org/w/index.php?search={s}
wiktbr	Wikeriadur	br.wiktionary.org/w/index.php?search={s}
wiktgr	Wikrionary(GR)	el.m.wiktionary.org/wiki{s}
wiktla	Latin Wiktionary	la.wiktionary.org/wiki/Special:Search?search={s}&go=Define
wiktnl	Dutch Wiktionary	nl.wiktionary.org/w/index.php?search={s}&title=Speciaal:Zoeken
wiktno	Norwegian Wiktionary (book language)	no.wiktionary.org/w/index.php?search={s}
windev	Windows Developer Feedback	wpdev.uservoice.com/search?query={s}
winget	winget.run	winget.run/search?query={s}
wissen	wissen.de	www.wissen.de/wissensserver/search?keyword={s}
wmphab	Wikimedia Phabricator installation	phabricator.wikimedia.org/search/?query={s}
wookie starwars	Wookiepedia	starwars.wikia.com/wiki/Special:Search?search={s}&go=&fulltext=Search
worten	Worten	www.worten.es/?qs={s}
wowtrk	WOW TRK	www.wowtrk.com/offers/?keyword={s}
wrdefr wrfrde	WordReference DE -> FR	www.wordreference.com/frde/{s}
wrende	WordReference en->de	www.wordreference.com/ende/{s}
wrenes	WordReference (enes)	www.wordreference.com/redirect/translation.aspx?w={s}&dict=enes
wrengr	wordreference english to greek translation	www.wordreference.com/engr/{s}
wrennl	WordReference (ennl)	www.wordreference.com/ennl/{s}
wrenpl	WordReference (enpl)	www.wordreference.com/enpl/{s}
wrensv wrsven	WordReference en->sv	www.wordreference.com/ensv/{s}
wresen	WordReference (esen)	www.wordreference.com/es/en/translation.asp?spen={s}
wresit	WordReference es > it	www.wordreference.com/esit/{s}
wrespt	WordReference (espt)	www.wordreference.com/espt/{s}
wrfres	WordReference (fres)	www.wordreference.com/fres/{s}
wrgren	wordreference greek to english translation	www.wordreference.com/gren/{s}
wrnlen	WordReference NL -> EN	www.wordreference.com/nlen/{s}
wrplen	Word Reference	www.wordreference.com/plen/{s}
wrsyes	Word Reference Spanish Synonym	www.wordreference.com/sinonimos//{s}
wuming	Wu Ming Foundation	www.wumingfoundation.com/giap/?s={s}
wurthe	Wurth Elektronik	www.we-online.com/web/en/wuerth_elektronik/searchpage.php?search={s}
xinhua	Xinhuanet	so.news.cn/#search/0/{s}/1/
yayimg	YAYIMAGES	yayimages.com/search?phrase={s}
yelpde	Yelp.de	www.yelp.de/search?find_desc={s}&ns=1&rpp=10&find_loc=
yelpsd	Yelp San Diego	www.yelp.com/search?find_desc={s}&find_loc=san+diego&ns=1
yjwiki	Young Justice Wiki	youngjustice.wikia.com/wiki/Special:Search?query={s}
youdao	Youdao	www.youdao.com/search?q={s}&ue=utf8&keyfrom=web.index
youpak clipzag	Clipzag	clipzag.com/search?q={s}
yourei	Yourei.jp	yourei.jp/{s}
ytdate	YouTube (sort by date)	www.youtube.com/results?search_query={s}&search_sort=video_date_uploaded
ytlist	YouTube Playlist	www.youtube.com/results?filters=playlist&lclk=playlist&search_query={s}
ytrack	YouTrack	youtrack.jetbrains.com/issues?q={s}
zameq2	ZAM - EQ2	eq2.zam.com/search.html?q={s}
zanran	Zanran	www.zanran.com/q/?search={s}
zapiks	Zapiks	www.zapiks.fr/search.php?action=search&search={s}
zappos	Zappos	www.zappos.com/{s}
zargan	Zargan	www.zargan.com/tr/q/{s}
zbmath	Zentralblatt MATH Database	www.zentralblatt-math.org/zbmath/search/?q={s}
zbsamp	Zapadni Balkan SA:MP	www.zbsamp.com/index.php?action=search2;search={s}
zenodo	Zenodo	zenodo.org/search?q={s}
zikinf	Zikinf	www.zikinf.com/recherche/?query={s}
zillow	Zillow	www.zillow.com/homes/{s}_rb/
zomato	Zomato	zomato.com/restaurants?q={s}
zoopla	Zoopla	www.zoopla.co.uk/search/?q={s}&geo_autocomplete_identifier=&country_code=&flatshare_q=&section=for-sale&search_source=nav&include_shared_ownership=true&include_retirement_homes=true&new_homes=include
zulily	zulily	www.zulily.com/search?q={s}
27crags	27crags	27crags.com/site/search?qs={s}
3tailer	3tailer	3tailer.com/search/?q={s}
4chnews	4chan's /news/ board	boards.4chan.org/news/catalog#s={s}
4shared	4shared	search.4shared.com/q/CCAD/1/{s}
7switch	7switch	www.7switch.com/fr/list/search/page/1?q={s}
8tracks	8tracks	8tracks.com/explore/all?q={s}
abadise	Abadis English to Persian dictionary	dictionary.abadis.ir/?LnType=entofa&Word={s}
abadisf	Abadis Persian to English dictionary	dictionary.abadis.ir/?lntype=fatoen&word={s}
abcnews	ABCNews	abcnews.go.com/search?searchtext={s}
abfahrt	Abfahrtsplan Deutsche Bahn	mobile.bahn.de/bin/mobil/bhftafel.exe/dox?input={s}&productsFilter=1111111111000000&time=actual&maxJourneys=40&start=Suchen&boardType=Abfahrt&rt=1
abshire	Aberdeenshire council	aberdeenshire.gov.uk/search?search={s}
abtimes abandonia	Abandoned Times (fka Abandonia)	www.abandonedtimes.com/?s={s}
abuseip	AbuseIPDB	www.abuseipdb.com/check/{s}
acortar shorten	Cortas	cortas.elpais.com/encode.pl?u=https://{s}
adablog	Adafruit Blog	blog.adafruit.com/?s={s}
addgene	Addgene	www.addgene.org/search/advanced/?q={s}
addtips	Addictive Tips	www.addictivetips.com/archives/search/?q={s}
adslabs	NASA ADS Labs	labs.adsabs.harvard.edu/ui/cgi-bin/topicSearch?q={s}
adtalem	Adtalem Careers	careers.adtalem.com/us/en/search-results?keywords={s}
adverts	Adverts.ie	www.adverts.ie/for-sale/q_{s}/
aerobis	aerobis fitness	www.aerobis.com/en/?s={s}
agerrit	Android Code Review (Gerrit)	android-review.googlesource.com/q/{s}
agorail	Agora.co.il	agora.co.il/toGet.asp?iseek={s}
aikatsu	Aikatsu Wikia	aikatsu.wikia.com/wiki/Special:Search?query={s}
aistars	Aikatsu Stars Wikia	aikatsustars.wikia.com/wiki/Special:Search?query={s}
akiduki	akizukidenshi	akizukidenshi.com/catalog/goods/search.aspx?keyword={s}&goods=&number=&name=&min_price=&max_price=&search.x=0&search.y=0
alatest	alaTest	alatest.de/searchaction.html?keyword1={s}
alberta	Government of Alberta	www.alberta.ca/search-results.aspx?q={s}
alesund	alesund kommune	alesund.kommune.no/sok.aspx?MId1=8&searchTerm={s}
alexalt	Alexalt	www.alexalt.es/?s={s}
alexasi	alexa	www.alexa.com/siteinfo/{s}
alexion	Alexion CRM software	alexion.nl/?s={s}&post_type=faq
alibris	alibris	www.alibris.com/booksearch?keyword={s}
allegro	Allegro	allegro.pl/listing?string={s}
allelec aretronics	Aretronics (fka All Electronics)	aretronics.com/search?type=product&q={s}
almanac	The Old Farmer's Almanac	www.almanac.com/store/product-search?keys={s}
amalexa	Amazon Alexa Skills Search Page	www.amazon.com/s?k={s}&i=alexa-skills
amcloud	Amazon Cloud	www.amazon.com/clouddrive/#G=0&path={s}
ametsoc	American Meteorology Society	journals.ametsoc.org/action/doSearch?AllField={s}
amnesty	Amnesty International	www.amnesty.org/en/search/?q={s}
ampwhat amp-what	Amp What	www.amp-what.com/unicode/search/{s}
amukmp3	Amazon.co.uk MP3	www.amazon.co.uk/s?k={s}&i=digital-music
amusing	Amusing Planet	www.google.com/cse?cx=partner-pub-4049870445958322:pxmbpw-atgu&ie=ISO-8859-1&q={s}
anagram	One Across	www.oneacross.com/cgi-bin/search_anagram.cgi?p0={s}&c0=&s=+Go+
anghami	anghami	www.anghami.com/search/{s}
animeka	Animeka	animeka.com/search/index.html?req={s}
anoikis	Anoik.is	anoik.is/systems/{s}
answers	Answers.com	www.answers.com/{s}
antiwar	Antiwar.com	news.antiwar.com/?s={s}
antonym	Synonyms.net	www.synonyms.net/antonyms/{s}
antyweb	Antyweb	antyweb.pl/?s={s}
ao3tags	Archive of Our Own (Tag Search)	archiveofourown.org/tags/search?query[name]={s}
aplcart	APLcart	aplcart.info/?q={s}
applebr	Apple (Brasil)	www.apple.com/br/search/{s}
aptoide	Aptoide.com	en.aptoide.com/search?query={s}
arageek	Arageek	www.arageek.com/?s={s}
arcblog	ArcGIS Blogs	www.esri.com/en-us/search/?q={s}
archaur	ArchLinux User Repository	aur.archlinux.org/packages?O=0&K={s}
archive	Internet	archive.org/search.php?query={s}
ardmoor	ArdMoor	www.ardmoor.co.uk/search/{s}
arduino	Arduino Stack Exchange	arduino.stackexchange.com/search?q={s}
argosie	Argos Ireland	www.argos.ie/webapp/wcs/stores/servlet/Search?storeId=10152&catalogId=14551&langId=111&searchTerms={s}
arkwiki	Ark official Wiki	ark.wiki.gg/index.php?search={s}
armtemp	Azure Quickstart Templates	azure.microsoft.com/de-de/resources/templates/?term={s}
artfire	ArtFire	www.artfire.com/browse/?term={s}
artsmia	The Collection at the Minneapois Institute of Arts	collections.artsmia.org/index.php?page=search#query={s}
artstor	ArtStor	library.artstor.org/#/search/{s};page=1;size=48
artwork	artcyclopedia.com	www.artcyclopedia.com/scripts/tsearch.pl?t={s}&type=2
askimam	ASK IMAM	askimam.org/public/processsearch/Question.keywords:{s}/Question.type:1
atmatix	ATmatix	www.atmatix.pl/patterns/all?q={s}
aud2eur	XE (AUD2EUR)	www.xe.com/currencyconverter/convert/?Amount={s}&From=AUD&To=EUR
aud2gdp	XE (AUD2GBP)	www.xe.com/currencyconverter/convert/?Amount={s}&From=AUD&To=GBP
aud2usd	XE (AUD2USD)	www.xe.com/currencyconverter/convert/?Amount={s}&From=AUD&To=USD
audible audible.com	Audible.com	www.audible.com/search?advsearchKeywords={s}
audubon	National Audubon Society	www.audubon.org/search/node?keys={s}
ausopen	Australian Open	ausopen.com/search?search={s}
auspost	Australia Post	auspost.com.au/track/track.html?id={s}
austlii	AustLII (Australasian Legal Information Institute)	www.austlii.edu.au/cgi-bin/sinosrch.cgi?query={s}&results=50&submit=Search&mask_world=&mask_path=&callback=on&method=auto&meta=/au
autobus	seznam-autobusu.cz	seznam-autobusu.cz/seznam?numberPlateOrNumber={s}
autocar	Autocar.co.uk	www.autocar.co.uk/SearchResults.aspx?q={s}
autosar	Autosar	www.autosar.org/nc/document-search/?tx_sysgsearch_pi1[query]={s}
avakotw wavakot	Avakot Wiki	wiki.avakot.org/?search={s}
avaktiv	alpenvereinaktiv	www.alpenvereinaktiv.com/en/search/?q={s}
awisdom	Ancient Wisdom	www.ancientwisdom.biz/search.php?q={s}
azfonts	AZFonts	www.azfonts.net/search.html?query={s}
babdedk	bab	fr.bab.la/dictionnaire/danois-allemand/{s}
babende	en.bab.la/dictionary/english-german/	en.bab.la/dictionary/english-german/{s}
babeneo	Bab.la English-Esperanto	en.bab.la/dictionary/english-esperanto/{s}
babensw	bab.la english swedish	en.bab.la/dictionary/english-swedish/{s}
babesde	bab.la Spanish-German	de.bab.la/woerterbuch/spanisch-deutsch/{s}
babplru	Bab.la pl ru	pl.bab.la/slownik/polski-rosyjski/{s}
baixaki	Baixaki	www.baixaki.com.br/busca.asp?q={s}
bargain	Shopping-Bargains	www.shopping-bargains.com/?s={s}
base64e	cryotography.cc	cryptography.cc/convert?text={s}&algorithm=base64encode
bazarbg	bazar.bg	bazar.bg/obiavi?q={s}
bbcfood	BBC Food	www.bbc.co.uk/food/recipes/search?keywords={s}&x=0&y=0
bbcnews	BBC News	www.bbc.co.uk/search/news/?q={s}
bcb-atm	BCB ATM	bcb-atm.com/map?keyword={s}
bedbath	Bed Bath and Beyond	www.bedbathandbeyond.com/store/s/{s}
bedrock	Bedrock Co.	bedrockgranitecompany.com/?s={s}
beewigs	Bees Beauty	beewigs.com/search?q={s}
behance	behance	www.behance.net/search?search={s}
bergfex	bergfex	www.bergfex.com/sommer/suchen/?q={s}
berneri	Circolo anarchico "C. Berneri"	circoloberneri.indivia.net/?s={s}
beslist	BESLIST.nl	www.beslist.nl/products/r/{s}/
betches	Betches	www.betches.com/search/{s}
bibgent	Bibliotheek Gent	zoeken.gent.bibliotheek.be/?q={s}
biblija	Biblija.net	www.biblija.net/biblija.cgi?m={s}
biblsrv	Bibleserver	www.bibleserver.com/search/{s}
bigfish	Big Fish Games	www.bigfishgames.com/download-games/search.html?search={s}
bigoven	BigOven	www.bigoven.com/recipes/{s}/best
bikenet	Bikenet	bikenet.nl/occasions/?zoeken={s}
biltema	Biltema	www.biltema.se/soksida/?query={s}
biluppg	Biluppgifter	biluppgifter.se/fordon/{s}
binggif	Bing Animated Images (GiFs)	www.bing.com/images/search?q={s}&qft=+filterui:photo-animatedgif
bintray	JFrog Bintray	bintray.com/search?query={s}
biobelp	biohelp	www.biohelp-profi.at/store-search-result.php?keywords={s}
biogrid	BioGRID	thebiogrid.org/search.php?search={s}
biology	All You Need Is Biology	allyouneedisbiology.wordpress.com/?s={s}
biorxiv	bioRxiv	biorxiv.org/search/{s}
birikim	Birikim Dergisi	www.birikimdergisi.com/arama/{s}
bitcoin	Blockchain.info	blockchain.info/search?search={s}
bitlair	bitlair	wiki.bitlair.nl/index.php?title=Special:Search&search={s}&go=Go
bitview	BitView	www.bitview.net/results.php?search={s}&t=Search+Videos
bizgift	Bizgift.vn	bizgift.vn/?s={s}
bizrate	Bizrate	www.bizrate.com/classify?search_box=1&keyword={s}&originalKeyword=&SEARCH_GO=
bkkpost	Bangkok Post	search.bangkokpost.com/search/result_advanced?category=all&xChannel=&q={s}
bkshare	Bookshare.org	www.bookshare.org/search?keyword={s}
bladehq	BladeHQ	www.bladehq.com/?search={s}
blender	Blender Manual	docs.blender.org/manual/en/latest/search.html?q={s}&check_keywords=yes
blocket	Blocket	www.blocket.se/annonser/hela_sverige?q={s}
bodyfit	Body & Fit	www.bodyandfit.com/nl-nl/search?text={s}
bolapkg parabola	Parabola GNU/Linux Packages	www.parabola.nu/packages/?q={s}
bonfire	Bonfire	www.bonfire.com/results/{s}
bookbaz	BookBaz	bookbaz.ir/?s={s}
bookdep	bookdepository	bookdepository.com/search?searchTerm={s}&search=Find+book
bookeen	Bookeen Store	www.bookeenstore.com/search?words={s}
booknet	Booknet	www.booknet.co.il/subc.asp?serin=3&c=3947&ser={s}
boomkat	boomkat	boomkat.com/products?q[keywords]={s}
bootleg	Bootleg Games Wiki	bootleggames.wikia.com/wiki/Special:Search?search={s}
botlist	Botlist	botlist.co/search?query={s}
bourbon	Bourbon	bourbon.io/docs/?q={s}
brakdag	Brakdag	brakdag.nl/?s={s}
british	British Slang	www.britishslang.co.uk/search/default.aspx?q={s}
brl2eur	XE (brl2eur)	www.xe.com/currencyconverter/convert/?Amount={s}&From=BRL&To=EUR
brl2gbp	XE (brl2gdp)	www.xe.com/currencyconverter/convert/?Amount={s}&From=BRL&To=GBP
brl2usd	XE (brl2usd)	www.xe.com/currencyconverter/convert/?Amount={s}&From=BRL&To=USD
bro-ids	The Bro Network Security Monitor	www.bro.org/sphinx/search.html?check_keywords=yes&q={s}
brutsel	Brutsellog Eetblog	www.brutsellog.nl/?s={s}
bsishop	BSI Shop	shop.bsigroup.com/SearchResults/?q={s}
bsocial	Bing Social	www.bing.com/social/search/updates?q={s}
btcaddr	Blockchain Address	www.blockchain.com/btc/address/{s}
bunware bunnings	Bunnings Warehouse	www.bunnings.com.au/search/products?q={s}&redirectFrom=Any
burbuja	Burbuja.info	www.burbuja.info/inmobiliaria/search.php?do=process&query={s}
buycott	Buycott	www.buycott.com/search/all?query={s}
bwbooks	Better World Books	www.betterworldbooks.com/search/results?q={s}
c2csite	Camp to Camp (sites)	www.camptocamp.org/documents/search?type=sites&q={s}
cadence	Cadence Community	www.cadence.com/content/cadence-www/global/en_US/home/search.html?k={s}
callook	Callook	callook.info/{s}
camelfr	CamelCamelCamel (French)	fr.camelcamelcamel.com/search?sq={s}
camesen	Cambridge Dictionary Spanish-English	dictionary.cambridge.org/dictionary/spanish-english/{s}
camfren	Cambridge French-English Dictionary	dictionary.cambridge.org/dictionary/french-english/{s}
camplen	Cambridge Polish-English Dictionary	dictionary.cambridge.org/dictionary/polish-english/{s}
candade	C-and-A DE	www.c-and-a.com/webapp/wcs/stores/servlet/SearchDisplay?catalogId=10001&storeId=10153&langId=-3&articleSearch=false&searchTerm={s}&x=0&y=0
capital	Capital.bg	www.capital.bg/search.php?stext={s}
castbox	CastBox	castbox.fm/podcasts/{s}
cbsnews	CBSNews	search.cbsnews.com/?source=cbs&q={s}
ccplace	Coworking & Coffee: search for place	www.coworking.coffee/places?q={s}
cdandlp	cdandlp	www.cdandlp.com/en/search/?q={s}
cdirect	comdirect	www.comdirect.de/inf/search/general.html?SEARCH_VALUE={s}
cernmap	Cern map	maps.cern.ch/mapsearch/mapsearch.htm?n=['{s}']
charity charitynavigator	Charity Navigator	www.charitynavigator.org/index.cfm?bay=search.results&keyword_list={s}
charmed	The Charmed Wikia	charmed.wikia.com/wiki/Special:Search?search={s}
cheatcc cheatcodes gamecheats	CheatCC.com	www.cheatcc.com/search/{s}/
check24	Check24 Preisvergleich	preisvergleich.check24.de/suche.html?query={s}
cheddar	Cheddar	cheddar.com/search?q={s}
chicken	Chicken Scheme	wiki.call-cc.org/search?text={s}
chinook	University of Colorado Libraries Catalog	ucblibraries.summon.serialssolutions.com/search?q={s}
chordie	Chordie	www.chordie.com/?q={s}
circuit	RacingCircuits.info	racingcircuits.info/misc/search-results.html?search={s}
citatum	Citatum	www.citatum.hu/kereso.php?kereses={s}
clearly	Clearly.ca	www.clearly.ca/eyewear/search?query={s}
clicrbs	ClicRBS	www.clicrbs.com.br/busca/rs/?q={s}
clipart	Microsoft Clipart	office.microsoft.com/en-us/clipart/results.aspx?qu={s}&sc=20
cliqist	Cliqist	cliqist.com/?s={s}
clojars	Clojars	clojars.org/search?q={s}
clojure clojuredocs	Clojure Docs	clojuredocs.org/search?x=0&y=0&q={s}
cloogle	Cloogle	cloogle.org/#{s}
cmake30	CMake 3.0 Documentation	www.cmake.org/cmake/help/v3.0/search.html?q={s}
cny2eur	XE (cny2eur)	www.xe.com/currencyconverter/convert/?From=CNY&To=EUR&Amount={s}
codegov	Code.gov	code.gov/search?query={s}
codrops	Codrops	tympanus.net/codrops/?s={s}
cololib	Colorado State University library	colostate-primo.hosted.exlibrisgroup.com/primo-explore/search?vid=01COLSU&lang=en_US&primoQueryTemp=d&search_field=any&search_scope=Everything&query=any,contains,{s}
comixeu	Comixology.eu	www.comixology.eu/search?search={s}
comixuk	ComiXology UK	www.comixology.co.uk/search?search={s}&submit=Submit
compass	Compass	compass-style.org/search/?q={s}
conarte	CONARTE	conarte.org.mx/?s={s}
consent	Consent Games	consent.games/?s={s}
convert	ClipConverter.cc	www.clipconverter.cc/?url={s}
cookpad	Cookpad	cookpad.com/search/{s}
coolapk	Coolapk	www.coolapk.com/search?q={s}
coop_de	Coop (DE)	www.coop.ch/pb/site/search/search/2057/Lde/index.html?qs={s}&fr=coop2012&SuchButton.x=0&SuchButton.y=0&search=search&backend=backend_coop2012&la=de&_sid=4aea1684-910e-4741-9099-86fff3d8a570
coop_fr	Coop (FR)	www.coop.ch/pb/site/search/search/2057/Lfr/index.html?qs={s}&fr=coop2012&SuchButton.x=0&SuchButton.y=0&search=search&backend=backend_coop2012&la=fr&_sid=2fae98df-7f08-49a8-86b5-38148b71ebdb
coop_it	Coop (IT)	www.coop.ch/pb/site/search/search/2057/Lit/index.html?qs={s}&fr=coop2012&SuchButton.x=0&SuchButton.y=0&search=search&backend=backend_coop2012&la=it&_sid=537d493c-9c35-41dc-8881-d878b57e702f
coop_se	Coop Sweden	www.coop.se/Sok/Receptsok/{s}
cop2usd	Xe (cop2usd)	www.xe.com/currencyconverter/convert/?From=COP&To=USD&Amount={s}
copilot	Microsoft Copilot	copilot.microsoft.com/?q={s}&bypassredir=1
cosmoty	COSMOTY.de	www.cosmoty.de/suche/{s}/
couleur	Couleur Science	couleur-science.eu/index.php?q={s}
country	CountryCode.org	www.countrycode.org/{s}
courant	Hartford Courant	www.courant.com/search/dispatcher.front?target=article&sortby=display_time++descending&Query={s}
courttv	Court TV	www.courttv.com/?s={s}
cracked	Cracked	www.cracked.com/search/search.php?sa=search&q={s}
craftsy	Craftsy	www.craftsy.com/search?query={s}
crawldb	##Crawl Learndb	loom.shalott.org/learndb.html#{s}
critiki	Critiki	critiki.com/search/?t={s}
crocker	Betty Crocker	www.bettycrocker.com/search?term={s}
crowdin	Crowdin	crowdin.com/projects?q={s}#advanced-search
cstrade gotrade	/r/globaloffensivetrade	www.reddit.com/r/GlobalOffensiveTrade/search?q={s}&restrict_sr=on&sort=new&t=all
ctvnews	CTV News	www.ctvnews.ca/search-results/search-ctv-news-7.137?q={s}
cubanet	Cubanet	www.cubanet.org/?s={s}
cults3d	cults3d	cults3d.com/fr/recherche?utf8=%E2%9C%93&q={s}
czk2eur	XE (czk2eur)	www.xe.com/currencyconverter/convert/?Amount={s}&From=CZK&To=EUR
dagobah	Dagobah Flash Gallery	dagobah.net/?search={s}
daniweb	DaniWeb	www.daniweb.com/search/index?q={s}
dariusf	Darius Foroux	dariusforoux.com/?s={s}
dartlib	Dartmouth College Libraries	search.library.dartmouth.edu/discovery/search?vid=01DCL_INST:01DCL&tab=All&search_scope=MyInst_and_CI&mode=basic&displayMode=full&bulkSize=10&highlight=true&dum=true&query=any,contains,{s}&displayField=all&pcAvailabilityMode=true
dartpub	Dart Packages	pub.dartlang.org/packages?q={s}
datagov	Data.Gov	catalog.data.gov/dataset?q={s}&sort=score+desc,+name+asc
datpiff	Datpiff	datpiff.com/mixtapes-search?criteria={s}&sort=rating
davidsw	DavidSW	davidsw.com/?s={s}&post_type=product
dbguide	Dotabuff Hero Guides	www.dotabuff.com/heroes/{s}/guides
dbmovie	Douban (movie)	movie.douban.com/subject_search?search_text={s}&cat=1002
dbmusic	Douban Music	music.douban.com/subject_search?search_text={s}&cat=1003
dbpedia	DBPedia	wiki.dbpedia.org/Search?phrase={s}
ddg-api	DuckDuckGo API	api.duckduckgo.com/?q={s}&o=json&pretty=1&no_html=1&no_redirect=1
ddg-day	DuckDuckGo (past day)	duckduckgo.com/?q={s}&df=d
ddg-tim ddg-timer	DuckDuckGo Timer	duckduckgo.com/?q=timer+{s}&ia=answer
dealabs	Dealabs	www.dealabs.com/search/?q={s}
debwiki	debian.org	wiki.debian.org/FrontPage?action=fullsearch&context=180&value={s}&titlesearch=Titles
decitre	Decitre	www.decitre.fr/rechercher/result/?q={s}
dedalus	University of Sao Paulo Library	dedalus.usp.br/F/?func=find-b&request={s}
deeplef	DeepL (enfr)	www.deepl.com/translator#en/fr/{s}
deepleg	DeepL (ende)	www.deepl.com/translator#en/de/{s}
deeplen deepleen	DeepL ES-EN	www.deepl.com/translator#es/en/{s}
deeplfr	deepl.com	www.deepl.com/translator#fr/en/{s}
deeplge	DeepL (deen)	www.deepl.com/translator#de/en/{s}
deeplru	DeepL Translator (RU)	www.deepl.com/ru/translator#en/ru/{s}
delfiee	Delfi.ee	otsing.delfi.ee/find?c=dns&q={s}&x=0&y=0
devotee	Devot:ee	devot-ee.com/search/results?keywords={s}&addon_version_support=ee2
devrant	devRant	devrant.com/search?term={s}
devtube	DevTube	dev.tube/?q={s}
dialnet	Dialnet	dialnet.unirioja.es/buscar/documentos?querysDismax.DOCUMENTAL_TODO={s}
digiato	digiato	digiato.com/?q={s}:
digikey	Digi-Key	www.digikey.com/product-search/en?x=17&y=13&lang=en&site=us&KeyWords={s}
digitec	Digitec	www.digitec.ch/Search?q={s}
dilbert	Dilbert	dilbert.com/search_results?terms={s}
discord	Discord Invite	discordapp.com/invite/{s}
dissent	Dissenter	dissenter.com/search?q={s}
divaliu	divaliu	liu.diva-portal.org/smash/resultList.jsf?searchType=SIMPLE&query={s}
djtrans	DictJuggler.net Japanese-English and English-Japanese Translation Dictionary	www.dictjuggler.net/en/yakugo/?word={s}
dkstore	Docker Store	store.docker.com/search?q={s}
dndwiki	Dungeons and Dragons Wiki	dnd-wiki.org/w/index.php?search={s}
dnevnik	Dnevnik.bg	www.dnevnik.bg/search/{s}
docksal	Docksal	docksal.readthedocs.io/en/master/search.html?q={s}
dogpile	Dogpile	results.dogpile.com/search/web?q={s}&ql=&topSearchSubmit.x=0&topSearchSubmit.y=0&fcoid=417&fcop=topnav&fpid=27&om_nextpage=True
dolphin	Dolphin Emulator Wiki	wiki.dolphin-emu.org/index.php?title=Special:Search&profile=default&search={s}&fulltext=Search
domainr	Domainr	domainr.com/?q={s}
dotwhat	DotWhat	dotwhat.net/search/{s}
douglas	Douglas	www.douglas.nl/nl/search?q={s}
dpdpost	DPD	tracking.dpd.de/parcelstatus?query={s}&locale=en_DE
dpldocs	The D Programming Language's Unofficial Docs	dpldocs.info/locate?q={s}
dpolicy	Debian Policy Manual	www.debian.org/doc/debian-policy/search.html?q={s}&check_keywords=yes&area=default
draomai	DRAOMAI	violettacyra.blogspot.com/search/?term={s}
dropbox	Dropbox	www.dropbox.com/search/personal?query={s}
dropout	Dropout	www.dropout.tv/search?q={s}
drupmod	Drupal modules repository	www.drupal.org/project/project_module/token?f[0]=&f[1]=&f[2]=&f[3]=&f[4]=sm_field_project_type:full&f[5]=&f[6]=&text={s}&solrsort=iss_project_release_usage+desc&op=Search
dsource	Debian Code Search	codesearch.debian.net/search?q={s}
dstarve dontstarve	Don't Starve Wiki	dontstarve.wiki.gg/index.php?search={s}
duluxdc	Dulux Decorator Centre	www.duluxdecoratorcentre.co.uk/servlet/SiteAdvancedSearchHandler?searchString={s}
duluxuk	Dulux UK	www.dulux.co.uk/en/search?s={s}
dumpert	Dumpert	www.dumpert.nl/tag/{s}/
dymocks	Dymocks Booksellers	www.dymocks.com.au/books/?term={s}
eastbay	Eastbay	www.eastbay.com/_-_/keyword-{s}
easybib	Easybib	www.easybib.com/cite/eval?url={s}
eatthis	eat-this.org	www.eat-this.org/?s={s}
ebookde	eBook.de	www.ebook.de/de/quickSearch?searchString={s}
econbiz	Econbiz	www.econbiz.de/Search/Results?lookfor={s}&type=AllFields&submit=Suchen
econlib	Library of Economics and Liberty	econlib.org/cgi-bin/fullsearch.pl?query={s}
ecowiki	Eco Wiki	wiki.play.eco/index.php?search={s}&title=Special:Search
edutalk	edutalk.id	edutalk.id/?s={s}
egghead	Egghead	egghead.io/search?q={s}
elastic	Elasticsearch Documentation	www.elastic.co/search?q={s}&section=Learn/Docs/
elfster	Elfster	www.elfster.com/shop/search/?q={s}
elheneu	Elhuyar Hiztegia EN-->EU	hiztegiak.elhuyar.eus/en_eu/{s}
elheseu	Elhuyar Hiztegia ES-->EU	hiztegiak.elhuyar.eus/es_eu/{s}
elheuen	Elhuyar Hiztegia EU-->EN	hiztegiak.elhuyar.eus/eu_en/{s}
elheues	Elhuyar Hiztegia EU-->ES	hiztegiak.elhuyar.eus/eu_es/{s}
elheufr	Elhuyar Hiztegia EU-->FR	hiztegiak.elhuyar.eus/eu_fr/{s}
elhfreu	Elhuyar Hiztegia FR-->EU	hiztegiak.elhuyar.eus/fr_eu/{s}
elmundo	El Mundo	ariadna.elmundo.es/buscador/archivo.html?q={s}&b_avanzada=
eloquii	Eloquii	www.eloquii.com/on/demandware.store/Sites-eloquii-Site/default/Search-Show?q={s}
emplois	Jobillico.com	www.jobillico.com/recherche-emploi/0?skwd={s}&scty=&icty=0&ipc=0&sil=&sjdpl=&sdl=&imc1=0&imc2=0&flat=0&flng=0&mfil=40&ipg=1&clr=1
engadin stmoritz	Engadin St. Moritz	www.engadin.ch/de/guide/suche?q={s}
engrish	Engrish	www.engrish.com/?s={s}
engtips	Eng Tips	www.eng-tips.com/search.cfm?q={s}&action=search
eoearth	Encyclopedia of Earth	www.eoearth.org/results/all/?searchnext=true&q={s}
epfldir	EPFL Directory	search.epfl.ch/psearch.action?q={s}&f=directory&lang=en&pageSize=10&sort=
eshopuk	Nintendo eShop UK	www.nintendo.co.uk/Search/Search-299117.html?q={s}
esolang	Esolang	esolangs.org/w/index.php?search={s}
esotalk	esoForum	esotalk.net/#search:{s}
esseffr	ESSEF (fr)	www.essef.be/fr/cataloog/index.search.asp?zoek={s}
estadao	O Estado de S. Paulo	busca.estadao.com.br/?q={s}
etbm.ro	etbm.ro	www.etbm.ro/search?Q={s}
eur2brl	XE (eur2brl)	www.xe.com/currencyconverter/convert/?Amount={s}&From=EUR&To=BRL
eur2cny	XE (eur2cny)	www.xe.com/currencyconverter/convert/?From=EUR&To=CNY&Amount={s}
eur2usd	XE (eur2usd)	www.xe.com/currencyconverter/convert/?From=EUR&To=USD&Amount={s}
evafing	EVA Fing	eva.fing.edu.uy/course/search.php?search={s}
eventid	EventID	eventid.net/display.asp?eventid={s}&source=
eventim	Eventim	www.eventim.de/Tickets.html?affiliate=TUG&fun=search&fuzzy=yes&doc=search&action=grouped&inline=false&suchbegriff={s}&btn=true&x10=4
evirtat	Estante Virtual (by author and/or title)	www.estantevirtual.com.br/q/{s}
evirtau	Estante Virtual (by author)	www.estantevirtual.com.br/qau/{s}
evirted	Estante Virtual (by publisher)	www.estantevirtual.com.br/qed/{s}
exalead	Exalead	www.exalead.com/search/web/results/?q={s}
existgo	Exist.ua	exist.ua/price.aspx?pcode={s}&sortType=
expired	Expired Domains	www.expireddomains.net/domain-name-search/?searchinit=1&q={s}
explara	Explara	www.explara.com/search/{s}
fabienm	fabienm	www.fabienm.eu/wordpress/?s={s}
fallout	Fallout Wiki	fallout.wiki/wiki/Special:Search?search={s}&fulltext=Search
fanartm	Fanart.tv (Music)	fanart.tv/?s={s}&sect=2
fancade	Fancade	www.fancade.com/search/?q={s}
fanlore	Fanlore	fanlore.org/w/index.php?search={s}
fansale	fansale	www.fansale.de/fansale/events.htm?searchText={s}
farmfor	Blog do Farmfor	www.farmfor.com.br/?s={s}
farnell	Farnell (UK)	uk.farnell.com/webapp/wcs/stores/servlet/Search?&st={s}
fcpeuro	FCP Euro	www.fcpeuro.com/products?utf8=%E2%9C%93&keywords={s}
fdobugs	freedesktop.org bugs	bugs.freedesktop.org/buglist.cgi?quicksearch={s}
ffstory	FanFiction Stories	www.fanfiction.net/search.php?keywords={s}&type=story&match=any&formatid=any&sort=0&genreid1=0&genreid2=0&characterid1=0&characterid2=0&characterid3=0&characterid4=0&words=0&ready=1&categoryid=0
ffxivtc	FFXIV Teamcraft	ffxivteamcraft.com/search?query={s}&onlyRecipes=true
fileext	File-Extensions.org	www.file-extensions.org/search/?searchstring={s}
filmart	FilmArt Gallery	filmartgallery.com/pages/search-results?q={s}
findlaw	FindLaw	public.findlaw.com/LCsearch.html?entry={s}
firebox	Firebox	www.firebox.com/search/{s}
firmycz	firmy.cz	www.firmy.cz/?thru=&q={s}
flickrc	Flickr (comm/deriv)	www.flickr.com/search/?q={s}&l=commderiv
folkets	Folkets lexikon	folkets-lexikon.csc.kth.se/folkets/#lookup&{s}&0
fonecta	Fonecta	www.fonecta.fi/henkilot/haku/-/{s}/
footage stockvideo	dissolve.com	www.dissolve.com/products?keywords={s}
fotolog	Fotolog	fotolog.com/search?query={s}
foxnews	FoxNews	www.foxnews.com/search-results/search?q={s}
fpstory	FictionPress (stories)	www.fictionpress.com/search/?keywords={s}&ready=1&type=story
frazeit	FrazeIt	fraze.it/n_search.jsp?q={s}
freecol	FreeCollocation.com	www.freecollocation.com/search?word={s}
freedom	Freedom Mobile Support	www.freedommobile.ca/support/search/faq-search-results?q={s}
freepik	Freepik	www.freepik.com/index.php?goto=2&searchform=1&k={s}
freesfx	freeSFX	www.freesfx.co.uk/sfx/{s}
freitag	Der Freitag	www.freitag.de/@@search?SearchableText={s}&SubmitSearch=Suche
ftbwiki	Unofficial Feed The Beast Wiki	ftbwiki.org/index.php?title=Special:Search&search={s}
funfact	WTF Fun Fact	wtffunfact.com/?s={s}
fuskanu	Fuska.nu	fuska.nu/sok/?search={s}
futhead	Futhead	www.futhead.com/16/players/?name={s}
fviewau	Freeview Australia	www.freeview.com.au/tv-search/?search={s}&x=0&y=0
g6month	Google (Past 6 Months)	www.google.com/search?tbs=qdr:m6&q={s}&safe=off&ie=utf-8&oe=utf-8
gaccess	Google Accessible	www.google.com/cse?ie=UTF-8&cx=000183394137052953072:zc1orsc6mbq&q={s}t&btnG=Search
gadgets	Gdgts	gdgts.de/?s={s}
galaxus	Galaxus.ch	www.galaxus.ch/de/Search?searchSectors=0&q={s}
galerts	google alerts	www.google.com/alerts?q={s}
galinos	galinos.gr	www.galinos.gr/web/drugs/main/search?q={s}
gallica	Gallica	gallica.bnf.fr/Search?ArianeWireIndex=index&p=1&lang=FR&q={s}
gamefly	Gamefly	www.gamefly.com/#!/search/all?q={s}
gamemar	GameMar	www.gamemar.com/arama?tip=1&word={s}
gayburg	Gayburg	gayburg.blogspot.com/search?q={s}:
gbp2brl	XE (gbp2brl)	www.xe.com/currencyconverter/convert/?Amount={s}&From=GBP&To=BRL
gbp2eur	xe.com	www.xe.com/currencyconverter/convert/?Amount={s}&From=GBP&To=EUR
gbp2nzd	XE (gbp2nzd)	www.xe.com/currencyconverter/convert/?Amount={s}&From=GBP&To=NZD
gbp2usd	XE (gbp2usd)	www.xe.com/currencyconverter/convert/?Amount={s}&From=GBP&To=USD
gcenter	Guitar Center	www.guitarcenter.com/search?typeAheadSuggestion=true&typeAheadRedirect=true&Ntt={s}
gdoodle	Google Doodles	www.google.com/doodles?q={s}
gematsu	Gematsu	gematsu.com/?s={s}
genbank	GenBank Database	www.ncbi.nlm.nih.gov/nuccore/?term={s}
genshin	Genshin Impact Wiki	genshin-impact.fandom.com/wiki/Special:Search?query={s}
georges	Zeno.org - Georges 1913	www.zeno.org/Zeno/0/Suche?q={s}&k=Georges-1913
geotool	Geotool	iplookup.flagfox.net/?ip={s}
gforums	Google Forums	productforums.google.com/forum/#!topicsearch/{s}
ghtopic	GitHub Topic	github.com/topic/{s}
giphytv	Giphy TV	tv.giphy.com/{s}
git-scm gitdocs	Git Documentation	git-scm.com/search/results?search={s}
glatest	Google Latest	www.google.com/search?q={s}&tbs=rltm:1
gmanews	GMA NEWS	www.gmanetwork.com/news/search/?q={s}
gmarket	GMarket	search.gmarket.co.kr/search.aspx?keyword={s}
godaddy	godaddy	www.godaddy.com/dpp/find?checkAvail=1,1&isc=daytona08&ci=8962&domainToCheck={s}
godotqa	Godot Engine Q&A	godotengine.org/qa/search?q={s}
gonthis	Gossip on This	gossiponthis.com/search/{s}
gorilla	Gorilla Sports	www.gorillasports.de/search?page=search&page_action=query&desc=on&sdesc=on&keywords={s}
gothere	gothere.sg	gothere.sg/maps#q:{s}
gpcanfr	Greenpeace Canada (French)	www.greenpeace.org/canada/fr/System-templates/Site-Settings-Pages/Recherche/?all={s}
gpindia	Greenpeace India	www.greenpeace.org/india/en/System-templates/Search-results/?all={s}
grabcad	GrabCAD	grabcad.com/library?per_page=20&query={s}
gradlep	gradle plugins	plugins.gradle.org/search?term={s}
grailed	grailed	www.grailed.com/search?search={s}
grammis	Grammis	grammis.ids-mannheim.de/suche?search={s}
graylog	Graylog Marketplace	marketplace.graylog.org/addons?search={s}
greddit	Reddit on Google	www.google.com/search?q=site:reddit.com+{s}
grepmed	grepmed	www.grepmed.com/?q={s}
groupon	Groupon	www.groupon.com/browse/?query={s}
grouvee	Grouvee	www.grouvee.com/search/?q={s}
grubhub	GrubHub	www.grubhub.com/search?queryText={s}
gsmpunt	GSMpunt	www.gsmpunt.nl/zoeken?z={s}
gtawiki	GTA Wiki	gta.wiki/?search={s}&title=Special%3ASearch
gtzh-cn gtchinese gt-chinese	Google Translate (to Chinese)	translate.google.com/#auto/zh-CN/{s}
gtzh-tw	Google Translate (to traditional Chinese)	translate.google.com/#auto/zh-TW/{s}
gumball	The Amazing World of Gumball Wiki	theamazingworldofgumball.fandom.com/wiki/Special:Search?query={s}
gumtree	gmtr	www.gumtree.com.au/s-melbourne/{s}/k0l3001317
gv100en	Google Search Verbatim 100 English Results	www.google.com/search?q={s}&tbo=1&num=100&tbs=li:1&lr=lang_en
gw2bltc	GW2BLTC	www.gw2bltc.com/en/tp/search?name={s}
gwentdb	GwentDB	www.gwentdb.com/search?search={s}
haaretz	Haaretz	www.haaretz.co.il/misc/search-results?searchType=textSearch&simpleSearch=simpleSearch&text={s}
hansard	Hansard (UK Parliament)	hansard.parliament.uk/search?searchTerm={s}
hanzidb	hanziDB	hanzidb.org/character/{s}
hardocp	[H]ardOCP	www.hardocp.com/search/?q={s}
hashtag	Twitter Hashtags	x.com/search?q=\\#{s}
hastane	Hastane	www.trhastane.com/arama.php?sehir=0&word={s}
haxelib	Haxelib	lib.haxe.org/search?v={s}
heaters	Heater Shop	www.heatershop.co.uk/search?query={s}
heureka	Heureka!	www.heureka.cz/?h[fraze]={s}
hexdocs	Hex Docs	hexdocs.pm/{s}
hfuboss	HS Furtwangen BOSS	hsfu.boss.bsz-bw.de/Search/Results?lookfor={s}&limit=20
hintafi	Hinta.fi	hinta.fi/haku?q={s}
history	History	www.history.com/search?search-field={s}&x=0&y=0
hklegco	Hong Kong Leg-Co	www.legco.gov.hk/tc/search/index.html?q={s}
hotline	Hotline	hotline.ua/sr/?q={s}
htmldog	HTML Dog	www.htmldog.com/search/?q={s}
hubspot	HubSpot	knowledge.hubspot.com/search?q={s}
hvstore	HV-Store	www.hv-store.de/navi.php?qs={s}:
hymnary	Hymnary.org	hymnary.org/search?qu={s}
hypixel	Hypixel	hypixel.net/player/{s}/
iappmag	iAppMag	www.iappmag.de/?s={s}
ibiblio	ibiblio	www.ibiblio.org/gsearch/?q={s}
icecast	Icecast Directory	dir.xiph.org/search?search={s}
ikanoon indiankanoon	Indian Kanoon	indiankanoon.org/search/?formInput={s}
ilfatto	Il Fatto Quotidiano	www.ilfattoquotidiano.it/{s}
illumos	illumos man	illumos.org/man/{s}
ilounge	iLounge	www.ilounge.com/index.php/search/results/search&keywords={s}
imagely	Imagely	www.imagely.com/?s={s}
imgflip	Imgflip	imgflip.com/search?q={s}
imgurul	Upload to imgur	imgur.com/api/upload/?url={s}
incense	Incense Pro	www.incensepro.com/search?type=product&q={s}
indiedb	IndieDB	www.indiedb.com/search?q={s}
infogal infogalactic	Infogalactic	infogalactic.com/w/index.php?search={s}
initium	initium wiki	initium.fandom.com/wiki/Special:Search?query={s}
inktweb	Inktweb.nl	www.inktweb.nl/search.php?search={s}
innsida	Innsida NTNU	innsida.ntnu.no/sok/?q={s}
inrocks	lesinrocks.com	lesinrocks.com/recherche/?q={s}
insider	Insider.in	insider.in/search?q={s}
intodns	intodns	www.intodns.com/{s}
iptrack iptracker	IP Tracker	www.ip-tracker.org/locator/ip-lookup.php?ip={s}
irowiki	IroWiki	irowiki.org/w/index.php?search={s}
islamqa	Islamqa.com	islamqa.info/en/search?key={s}&yt0=search
isprime	isprimenumber	www.calculator.net/prime-factorization-calculator.html?cvar={s}&x=Calculate
itninja	IT-Ninja	www.itninja.com/search?q={s}
jacobin	Jacobin Magazine	jacobinmag.com/search?query={s}
javadoc	Java 23 API Specification	docs.oracle.com/en/java/javase/23/docs/api/search.html?q={s}
jetpens	JetPens	www.jetpens.com/search?q={s}
jezebel	jezebel.com	jezebel.com/search?q={s}
jguitar	JGuitar	jguitar.com/chordsearch?chordsearch={s}
jorudan	Jorudan	www.jorudan.co.jp/jt/cgi/qsearch/qsearch.cgi?s={s}
juninet	Juniper networks	www.juniper.net/search/gsa/?keyword={s}
kaartje	Kaartje2go	www.kaartje2go.nl/zoeken?q={s}
kakijun	Kakijun.jp	kakijun.jp/main/u_kensaku.php?KANJI={s}
kalimah	Kalimah.top	kalimah.top/results/?q={s}
kateglo	Kateglo	kateglo.lostfocus.org/?phrase={s}&mod=dictionary
kdeblog	KDE Blog	www.kdeblog.com/?s={s}
kekanto	Kekanto	kekanto.com.br/newsearch?search={s}
kgforum	Kvinneguiden forum	forum.kvinneguiden.no/?q={s}
kgitlab	KDE GitLab	invent.kde.org/search?utf8=%E2%9C%93&snippets=&scope=&search={s}
khronos	Khronos	www.khronos.org/search/?q={s}
kimovil	Kimovil	www.kimovil.com/en/compare-smartphones/name.{s}
kinguin	Kinguin	www.kinguin.net/catalogsearch/result/?q={s}
kithara	kithara.to	kithara.to/index.php?cmd=fi&query={s}
kjellno	Kjell & Company Norge	www.kjell.com/no/sok?query={s}
kmartau	Kmart Australia	www.kmart.com.au/webapp/wcs/stores/servlet/SearchDisplay?searchTerm={s}&categoryId=&storeId=10701&catalogId=10102&langId=-1&pageSize=30&beginIndex=0&sType=SimpleSearch&resultCatEntryType=2&showResultsPage=true&searchSource=Q&pageView=
kojipkg fedkojip	Fedora: Koji package search	koji.fedoraproject.org/koji/search?match=glob&type=package&terms={s}
kollekt	Kollekt.FM	kollekt.fm/search/?q={s}&type=all
kolwiki	The KoL Wiki	kol.coldfront.net/thekolwiki/index.php?title=Special:Search&profile=default&search={s}&fulltext=Search
koodous	Koodous	koodous.com/apks?search={s}
koorong	Koorong	www.koorong.com/search/results.jhtml?w={s}
kraftly	Kraftly	kraftly.com/search?q={s}
labdoor	Labdoor	labdoor.com/review?q={s}
laemmle	Laemmle	www.laemmle.com/search?q={s}
laposte	La Poste Suivi	www.csuivi.courrier.laposte.fr/suivi?id={s}
laravel	Laravel	laravel.com/docs/{s}
larenfr	Larousse EN - FR translation	www.larousse.fr/dictionnaires/anglais-francais/{s}
laresfr	Larousse (es2fr)	www.larousse.fr/dictionnaires/espagnol-francais/{s}/
larfren	Larousse FR - EN translation	www.larousse.fr/dictionnaires/rechercher?q={s}&l=francais-anglais&culture=
larfres	Larousse (fr2es)	www.larousse.fr/dictionnaires/francais-espagnol/{s}/
larfrit	Larousse (fr2it)	www.larousse.fr/dictionnaires/francais-italien/{s}/
latdict	Latdict	latin-dictionary.net/search/latin/{s}
latexwb	LaTeX - Wikibooks	en.wikibooks.org/wiki/Search?search={s}&prefix=LaTeX
latimes	LATimes	search.latimes.com/search?q={s}
latlong	LatLong.net	www.latlong.net/search.php?keyword={s}
lawphil	Lawphil.net	cse.google.com/cse?cx=000327027907964447955:65fjwortx5c&q={s}
lcharts	LitCharts	www.litcharts.com/search?query={s}
leclerc	Espace Culturel E.Leclerc	www.culture.leclerc/pageRecherche?q={s}&univers=all
lernuen	Lernu!	lernu.net/en/vortaro/{s}
lernues	Lernu! (es)	lernu.net/es/vortaro/{s}
lftwiki	Lapfox Trax Wiki	lapfoxtrax.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
libdems	Liberal Democrats (UK)	www.libdems.org.uk/search?q={s}
liberia libuniversitaria	Libreria Universitaria	www.libreriauniversitaria.it/c_power_search.php?shelf=BIT&q={s}&submit=
libgfic	Library Genesis (Fiction)	libgen.is/fiction/?q={s}
libgsci	Library Genesis (Scientific Articles)	libgen.is/scimag/?q={s}
librefm	libre.fm	libre.fm/search.php?search_term={s}
liferay	Liferay	dev.liferay.com/es/search?p_p_id=3&p_p_lifecycle=0&p_p_state=maximized&p_p_mode=view&_3_struts_action=/search/search&_3_redirect=/es/develop/tutorials/-/knowledge_base/7-1/upgrading-a-liferay-mvc-portlet&_3_keywords={s}&_3_groupId=10184
liveatc	LiveATC.net	www.liveatc.net/search/?icao={s}
lizzart	Lizzart - Original Handmade in France	www.lizzart.fr/boutique/tout/recherche.html?keyword={s}&limitstart=0&option=com_virtuemart&view=category
loblaws	Loblaws	www.loblaws.ca/search/?search-bar={s}
localch	local.ch	tel.local.ch/de/q?what={s}
lovdata	Lovdata	lovdata.no/sok?q={s}
lowcarb	Recipe Gym	recipegym.com/?s={s}
lubuntu	Lubuntu.me	lubuntu.me/?s={s}
lunaavr	Luna (AVR)	avr.myluna.de/doku.php?do=search&id={s}
lunalux	Luna Lux	lunalux.io/search/?q={s}
lvoenru	Lingvo Live English Russian	www.lingvolive.com/en-us/translate/en-ru/{s}
lyrster	Lyrster	www.lyrster.com/songs-lyrics/{s}.html
maalbum	Metal Archives (album)	www.metal-archives.com/search?searchString={s}&type=album_title
macewan	Macewan Library	library.macewan.ca/library-search?query={s}
macwelt	Macwelt	www.macwelt.de/suche?searchStr={s}
madison	Madison.com	host.madison.com/search/?l=25&sd=desc&s=start_time&f=html&t=article,video,youtube,collection&app=editorial&q={s}&nsa=eedition
magento	Magento	magento.com/search/gss/{s}
makemac	MakeMac	makemac.com/?s={s}
mankier	Mankier	www.mankier.com/?q={s}
mariadb	Mariadb	mariadb.com/kb/en/+search/?q={s}
marvelc	Comics in marvel.com	marvel.com/search/?q={s}&category=comics
mathjax	MathJax	docs.mathjax.org/en/latest/search.html?q={s}&check_keywords=yes&area=default
matprat	MatPrat	www.matprat.no/sok?searchFor={s}
maxspar	MaxSpar	www.maxspar.de/s/{s}
mazemap	MazeMap	use.mazemap.com/?search={s}
mbglick	Moses B. Glick	www.mbglick.com/catalogsearch/result/?q={s}
mblabel	MusicBrainz Labels	musicbrainz.org/search?query={s}&type=label
mbplace	MusicBrainz Places	musicbrainz.org/search?query={s}&type=place
mbsdman	MirBSD Manpages	www.mirbsd.org/man.cgi?q={s}
mcstats	Minecraft Statistics	minecraft-statistic.net/en/search/?q={s}
mdnhtml	Mozilla Developer Network (HTML)	developer.mozilla.org/en-US/search?q={s}&topic=html
medical tfdmedical	The Free Dictionary (Medical)	medical-dictionary.thefreedictionary.com/{s}
medimax	MediMax	www.medimax.de/search?search={s}
megaman	Mega Man Knowledge Base	megaman.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
melorra	Melorra	www.melorra.com/jewellery/search/?q={s}:
memegen	Meme Generator	memegenerator.net/memes/search?q={s}
memento	Memento Project	timetravel.mementoweb.org/list/2013/{s}
memidex	Memidex	www.memidex.com/{s}
memrise	Memrise	www.memrise.com/courses/english/?q={s}
menadoc	MENAdoc	menadoc.bibliothek.uni-halle.de/search/quick?query={s}
menards	Menards	www.menards.com/main/search.html?search={s}
mennlex	Mennonitisches Lexikon	www.mennlex.de/doku.php?do=search&id={s}
mercari	mercari US	www.mercari.com/search/?keyword={s}
mercola	Mercola	search.mercola.com/results.aspx?q={s}
metager	Metager	www.metager.de/meta/meta.ger3?eingabe={s}
metalab	Metalab Mediawiki	metalab.at/wiki/index.php?search={s}
metalit	Metalitalia.com	metalitalia.com/?s={s}
mingpao	Ming Pao	news.mingpao.com/cfm/search2.cfm?keywords={s}
mironet	Mironet.cz	www.mironet.cz/Productlist/showSearch?EXPS={s}
mixergy	Mixergy	mixergy.com/?s={s}
mixesdb	MixesDB	www.mixesdb.com/db/index.php?title=Special:Search&search={s}&go=Go
mnnthbx	MNNTHBX	mnnthbx.com/?post_type=product&s={s}
moddota	ModDota	moddota.com/forums/search?Search={s}
modes4u	modeS4u	www.modes4u.com/japanese/{s}
modhelp	Reddit Modhelp	www.reddit.com/r/modhelp/search?q={s}
moedict	Moedict	www.moedict.tw/{s}
moegirl	Moe Girl Pedia	zh.moegirl.org/Special:Search?search={s}
mondefr	le monde	www.lemonde.fr/recherche/?keywords={s}
monster	Monster.com	jobsearch.monster.com/Search.aspx?re=130&cy=us&brd=1&JSNONREG=1&q={s}&rad=20&rad_units=miles
moonpig	MoonPig	www.moonpig.com/uk/testpages/search/ab277/?q={s}
motonet	Motonet Finland	www.motonet.fi/fi/haku?q={s}
moztest	Mozilla Observatory Test	observatory.mozilla.org/analyze/{s}
mozwiki	Mozilla Wiki	wiki.mozilla.org/index.php?search={s}
mpgpure	Max Planck Publication Repository	pure.mpg.de/pubman/faces/SearchResultListPage.jsp?cql=escidoc.objecttype=item+AND+escidoc.content-model.objid=escidoc:persistent4+AND+((escidoc.metadata={s})+OR+((escidoc.any-identifier={s}+OR+escidoc.property.latest-release.objid={s})))
mpgrena	MPG.ReNa - Max Planck Reseource Navigator	rena.mpdl.mpg.de/rena/Search/Results?lookfor={s}
msocial	Mastodon Social	mastodon.social/tags/{s}
mtawiki	Multi Theft Auto Wiki	wiki.multitheftauto.com/index.php?title=Special:Search&profile=default&fulltext=Search&search={s}
mtgwiki	MTG Salvation	mtgsalvation.gamepedia.com/index.php?search={s}
musicme	MusicMe	www.musicme.com/page.php?q={s}
musopen	Musopen	musopen.org/search?q={s}
muzofon	Muzofon	muzofon.com/search/{s}
mycroft	Mycroft Project	mycroftproject.com/search-engines.html?name={s}&opensearch=yes
mydealz	MyDealz	www.mydealz.de/search?q={s}
myfonts	Myfonts	www.myfonts.com/search?query={s}
mygofer	MyGofer	www.mygofer.com/search={s}
mynixos	MyNixOS	mynixos.com/search?q={s}
myspace	MySpace	searchservice.myspace.com/index.cfm?fuseaction=sitesearch.results&orig=search_Header&origpfc=Splash&type=People&qry={s}&submit=Search
naarden	Naardense Bijbel	www.naardensebijbel.nl/?search-class=DB_CustomSearch_Widget-db_customsearch_widget&widget_number=preset-default&-0=vers&cs-booknr-1=&cs-bijbelhoofdstuk-2=&cs-versnummer-3=&cs-bijbelvers_v2-4={s}&search=Zoeken
namchey	Namchey	namchey.com/search/?searchKeyword={s}
naslovi	Naslovi.net	www.naslovi.net/search.php?q={s}
natural	NaturallyBeautyCare	naturallybeautycare.com/search/{s}
nbnotes	National Bank Structured Notes	nbcstructuredsolutions.ca/listeProduits.aspx?search={s}
nbsdman	NetBSD manual pages	man.netbsd.org/{s}
ncsulib	NCSU Libraries	search.lib.ncsu.edu/?q={s}
netacad	Networking Academy	www.netacad.com/search/node/{s}
netgear	Netgear	netgear.com/Search.aspx?q={s}
nettuts	Nettuts+	code.tutsplus.com/tutorials/search/{s}
nevakit	Ne Vakit	nevakit.com/ara/{s}
newhome	NewHome.se	www.newhome.se/index.php?route=product/search&filter_name={s}
newport	Newport	www.newport.com/search/?text={s}
newsday	NewsDay.com	www.newsday.com/7.25434?q={s}
newsela	Newsela	newsela.com/search/#/?needle={s}
newsmax	NewsMax.com	www.google.com/search?domains=NewsMax.com&sitesearch=Newsmax.com&q={s}
newsnow	NewsNow	www.newsnow.co.uk/h/?search={s}
nicodic	Nico Nico Pedia	dic.nicovideo.jp/s/al/t/{s}/rev_created/desc/1-
nielsen	Nielsen	www.nielsen.com/us/en/search.html?q={s}&sp_cs=UTF-8
nikonuk	Nikon UK	www.nikon.co.uk/en_GB/search.page#keywords={s}
nimvelo	Nimvelo	kb.nimvelo.com/search?query={s}
nirsoft	Nirsoft	www.nirsoft.net/search_freeware_result_new.html?q={s}
nitrome	Nitrome	www.nitrome.com/search.php?id={s}&search_type=default
nixpkgs	NixOS Packages Search	search.nixos.org/packages?query={s}
nkurier	Nordkurier	www.nordkurier.de/suche?text={s}
nmlegis	New Mexico Legislature	nmlegis.gov/?q={s}
nnumber	FAA Aircraft Registry	registry.faa.gov/aircraftinquiry/NNum_Results.aspx?NNumbertxt={s}
novinky	Novinky.cz	www.novinky.cz/hledej?w={s}
numista	Numista	en.numista.com/catalogue/index.php?r={s}&mode=simplifie&p=1
nwvault	Neverwinter Vault	neverwintervault.org/search/node/{s}
ocremix	OverClocked Remix	ocremix.org/quicksearch/remix/?qs_query={s}
offline isonline isoffline	Down For Everyone Or Just Me?	www.downforeveryoneorjustme.com/{s}
oiseaux	Oiseaux.net	www.oiseaux.net/search/?q={s}
okidoki	okidoki kuulutused	www.okidoki.ee/buy/all/?query={s}
okkazeo	Okkazeo	www.okkazeo.com/jeux/searchJeux?rech_nom={s}
oldapps	OldApps.com	www.oldapps.com/betasearch.php?q={s}
oldcpan searchcpan	CPAN	search.cpan.org/search?query={s}&mode=all
omelete	omelete	omelete.uol.com.br/busca/?q={s}
oncyclo	Oncyclopedia	oncyclopedia.org/wiki/Speciaal:Zoeken?search={s}&go=Zoeken
onecard	South Australia Public Library	onecard.network/client/en_AU/sapubliclibraries/search/results?qu={s}
onelook	OneLook	onelook.com/?w={s}
onshape	Onshape Docs	cad.onshape.com/documents?resourceType=filter&nodeId=1&column=modifiedAt&order=desc&viewMode=0&q={s}
onvista	Onvista	www.onvista.de/suche/?onvHeaderSearchBoxAction=true&searchValue={s}
openbox	Openbox	openbox.org/wiki/Special:Search?search={s}
openbsd	OpenBSD	man.openbsd.org/?query={s}
opendns	OpenDNS	www.opendns.com/search/?s={s}
openhub	Open HUB	www.openhub.net/p?query={s}&sort=relevance
openuni	Open University	search.open.ac.uk/public/search/results?q={s}
optimot	Optimot	aplicacions.llengua.gencat.cat/llc/AppJava/index.html?action=Principal&method=cerca_generica&input_cercar={s}&tipusCerca=cerca.tot
oradocs	Oracle Docs	docs.oracle.com/apps/search/search.jsp?q={s}
ordguru	Ordguru	www.ordguru.se/synonymer/{s}
ordnett	Ordnett	www.ordnett.no/search?language=no&phrase={s}
osmnode	OpenStreetMap Node	www.openstreetmap.org/node/{s}
osummon	Oberlin Summon	oberlin.summon.serialssolutions.com/search?q={s}
ourdocs	Umbraco Documentation	our.umbraco.com/search?q={s}&cat=documentation
outlook	Outlook	mail.live.com/default.aspx?skws=hello#fid=flsearch&srch=1&skws={s}&sdr=4&satt=0
oxlinte oxlintes oxlinteslint	Oxlint (ESLint Rule)	oxc.rs/docs/guide/usage/linter/rules/eslint/{s}
pacific	Pacific Packaging Products	www.pacificpkg.com/search.php?kw={s}
packers	Packers	packers.com/?={s}
packman	PackMan	packman.links2linux.org/search?q={s}
pantone	Pantone Color Finder	www.pantone.com/color-finder?q={s}
parcels	Parcels	parcelsapp.com/en/tracking/{s}
parking	ParkWhiz	www.parkwhiz.com/search/?destination={s}
parkrun	Parkrun	www.parkrun.com/search?q={s}
partsdr	Parts Dr	partsdr.com/model-number-search/?query={s}
patheos	Patheos	www.patheos.com/search?q={s}
pathway	DJ Direct Inc.	www.wholesalehome.com/collections/outdoor-{s}-lighting
patient patientuk patientinfo	Patient Info	patient.info/search.asp?searchterm={s}
patreon	Patreon	www.patreon.com/search?q={s}
pcworld	PC World	www.pcworld.com/search?qt={s}&tk=srch_top
pective	Pective	pective.com/search?q={s}
pelando	Pelando	www.pelando.com.br/search?q={s}
perdola	Perdola	childishgiant.github.io/perdola/?app={s}
perldoc	Perldoc Browser	perldoc.pl/search?q={s}
perseus	Perseus Digital Library	www.perseus.tufts.edu/hopper/searchresults?q={s}
philips	Philips Careers	www.careers.philips.com/professional/global/en/search-results?keywords={s}
phoenix phoenixde	phoenix	www.phoenix.de/suche.html?vt={s}
phrasen	Phrasen.com	www.phrasen.com/index.php?do=suche&q={s}
physics	Physics Forums	www.physicsforums.com/search/90229641/?q={s}&o=relevance
pictame	Pictame	www.pictame.com/search?query={s}
pinside	Pinside Forums	pinside.com/pinball/forum/search?s=1&q={s}&include_basement=0#results
pinvoke	Pinvoke.net	pinvoke.net/search.aspx?search={s}
pinyin1	pin1yin1.com	www.pin1yin1.com/#{s}
plaisio	plaisio.gr	www.plaisio.gr/search.aspx?query={s}&catalogue=all&mode=searchlist
plancke	Plancke	plancke.io/hypixel/player/stats/{s}
plosmed	PLoS Medicine	www.plosmedicine.org/search/simple?query={s}&filterJournals=PLoSMedicine
plunket	Plunket	www.plunket.org.nz/home/SearchForm?Search={s}&action_results=Search
plyrics	PLyrics.com	www.plyrics.com/search.php?q={s}
podnews	Podnews	podnews.net/search?q={s}
poepage	Path of Exile page	www.poewiki.net/wiki/{s}
poewiki	Path of Exile Gamepedia	pathofexile.gamepedia.com/index.php?title=Special:Search&profile=default&search={s}&fulltext=Search
pokedex	Pokemon Official Website Pokedex	www.pokemon.com/us/pokedex/{s}
pokemmo	Pokemon MMO Wiki	pokemmo.wikia.com/wiki/Special:Search?search={s}
polygon	Polygon	www.polygon.com/search?q={s}
polymtl	Polytechnique Montreal	www.polymtl.ca/etudes/cours/recherche/*?sigle={s}
popsike	Popsike	www.popsike.com/php/quicksearch.php?searchtext={s}
porkbun	porkbun	porkbun.com/checkout/search?q={s}
posters allposters	All Posters	www.allposters.com/gallery.asp?txtSearch={s}
powells	Powells	www.powells.com/searchresults?keyword={s}
poweren	Power Engineering	poweren.ir/?s={s}
powerui	PowerUI	powerui.kulestar.com/wiki/index.php?search={s}
pplware	Pplware	pplware.sapo.pt/resultados-da-pesquisa/?q={s}
pplwiki	The Plugin People Wiki	thepluginpeople.atlassian.net/wiki/dosearchsite.action?queryString={s}
pptrack	Polish Post tracking	emonitoring.poczta-polska.pl/?lang=en&numer={s}
pricehk	Price.com.hk	www.price.com.hk/search.php?g=A&q={s}
pricero	price.ro	www.price.ro/index.php?action=q&text={s}&submit=Cauta
privacy rprivacy	r/privacy Subreddit	www.reddit.com/r/privacy/search?q={s}&restrict_sr=on
procomm	Progress Community	community.progress.com/search#q={s}
procook	ProCook	www.procook.co.uk/shop/search/?searchDep=main+site&searchstr={s}
prodhun	Producthunt	www.producthunt.com/#!/s/posts/{s}
program	CodeSpeedy	www.codespeedy.com/?s={s}
proshop	Proshop	www.proshop.dk/?s={s}
protein	NCBI Protein	www.ncbi.nlm.nih.gov/protein/?term={s}
provigo	Provigo Grocery Store	www.provigo.ca/search/?search-bar={s}
psddude	PSDDude Photoshop Tutorials	www.psd-dude.com/tutorials/?search={s}
psych22	https://psychologytoday.com	www.psychologytoday.com/us/archive?search={s}&op=Search
pubchem	PubChem	www.ncbi.nlm.nih.gov/pccompound/?term={s}
publico	Publico	www.publico.pt/pesquisa?q={s}
pumpbiz	PumpBiz	www.pumpbiz.com/shopping_search.asp?searchString={s}&searchType=0&FIND.x=0&FIND.y=0&FIND=FIND+IT
puptype	Puppet Docs	docs.puppet.com/puppet/latest/type.html#{s}
puzzles	Puzzlopia	www.puzzlopia.com/search-results?search={s}
py36doc	Python 3.6 Documentation	docs.python.org/3.6/library/{s}.html
pyramid	docs.pylonproject.org	docs.pylonsproject.org/projects/pyramid/en/latest/search.html?q={s}
pyside2	Pyside2 Docs	doc-snapshots.qt.io/qtforpython/search.html?q={s}&check_keywords=yes&area=default
python2	Python	docs.python.org/2/search.html?q={s}
pytorch	pytorch.org	pytorch.org/docs/stable/search.html?q={s}&check_keywords=yes&area=default
pyvideo	pyvideo.org	pyvideo.org/search?models=videos.video&q={s}
queryrs	Query.rs	query.rs/?q={s}
quizlet	Quizlet	quizlet.com/subject/{s}/
quttera	Quttera	quttera.com/sitescan/{s}
radio24	Radio24	www.radio24.ilsole24ore.com/ricerca/{s}
ravelry	Ravelry	www.ravelry.com/patterns/search#query={s}
raycast	Raycast Store	www.raycast.com/search?q={s}
raymond	Raymond-nh	raymond-nh.com/?s={s}
rclippy	Rust Clippy Lints	rust-lang.github.io/rust-clippy/master/index.html#{s}
rclivre	Recyclivre	www.recyclivre.com/shop/recherche?orderby=price&orderway=asc&search_query={s}&submit_search=&s=
reaktor nativeinstruments	Native Instruments User Library	www.native-instruments.com/en/reaktor-community/reaktor-user-library/all/all/all/all/{s}/latest/1/all/
realtor	Realtor.com	www.realtor.com/realestateandhomes-search/{s}
recfren	Reverso Context (fren)	context.reverso.net/traduction/francais-anglais/{s}
reclame	Reclame Aqui	www.reclameaqui.com.br/busca/?q={s}
recruit	australia.recruit.net	australia.recruit.net/search.html?query={s}&location=&s=
recycle earth911	Earth911.com	search.earth911.com/?what={s}
redable	Redable	www.redable.nl/catalogsearch/result/?q={s}
redalyc	REDALYC	www.redalyc.org/busquedaArticuloFiltros.oa?q={s}
redbull	Red Bull	www.redbull.com/int-en/search/{s}
redmine	Redmine	www.redmine.org/search?q={s}
redtram	RedTram	ru.redtram.com/search/?q={s}
reflets	Reflets.info	reflets.info/?s={s}
refresh	Refresh Cartridges	www.refreshcartridges.co.uk/advanced_search_result.php?q={s}
relword	Related Words	relatedwords.org/relatedto/{s}
restobe	RestoBE	en.resto.be/business/search?searchbox=true&businessTypeId=1&fullText={s}
restofr	RestoFR	www.resto.fr/business/search?searchbox=true&businessTypeId=1&fullText={s}
restolu	Resto.lu	www.resto.lu/fr/Luxembourg/guide.cfm?searchmode=classic&RESTOTYPE=isresto&nom={s}&idcuisine_type=&ville=&region=
revamed	RevaMed B.V.	www.revamed.com/search?s={s}
revenit	Reverso Context (enit)	context.reverso.net/translation/english-italian/{s}
revesen	Reverso context	context.reverso.net/translation/spanish-english/{s}
revolve	Revolve	www.revolve.com/r/Search.jsp?search={s}
rfsanae	RedFox Sanakirja (enfi)	redfoxsanakirja.fi/sanakirja/-/s/eng/fin/{s}
ricardo	Ricardo	www.ricardo.ch/de/s/{s}
rigveda rigvedawiki	Rigveda Wiki	rigvedawiki.net/r1/wiki.php/{s}
robloxl	Roblox Creator Store	create.roblox.com/store/models?keyword={s}
rocwiki	Rochester Wiki	rocwiki.org/?action=search&string={s}
roetgen	Gemeinde Roetgen	www.roetgen.de/?s={s}
routard	Le Guide Du Routard	www.routard.com/recherche.asp?q={s}
rozetka	Rozetka	rozetka.com.ua/search/?section_id=&section=&text={s}&rz-search-button=
rpggeek	RPGGeek	rpggeek.com/geeksearch.php?action=search&objecttype=rpgunified&q={s}&B1=Go
rphilos	Radical Philosophy	www.radicalphilosophy.com/?s={s}
rsibank	Risibank	risibank.fr/#{s}
rswikin	Runescape Wiki (new)	runescape.wiki/?search=test&title=Special:Search&fulltext={s}
rubocop	RuboCop	rubocop.readthedocs.io/en/latest/search.html?q={s}
rubydoc	Ruby-Doc.org	www.ruby-doc.org/search.html?q={s}
rustrfc	Rust RFC GitHub.com	github.com/rust-lang/rfcs/issues?utf8=%E2%9C%93&q={s}
s.fyapp	Shopify App Store	apps.shopify.com/search?q={s}&st_source=
saltmod	SaltStack Execution Modules	docs.saltstack.com/en/latest/ref/modules/all/salt.modules.{s}.html
sampled whosama whosamart whosamartist whosamartists	WhoSampled (Artists)	www.whosampled.com/search/artists/?q={s}
saphelp	SAP Help Portal	help.sap.com/viewer/search?q={s}
sapnote	SAP notes	launchpad.support.sap.com/#/notes/{s}/E
saporta	SaportaReport	saportareport.com/?s={s}
sbmania	SpongeBuddy Mania	www.sbmania.net/advsearch.php?l=80&q={s}
scidict	The Science Dictionary	thesciencedictionary.org/search2/?q={s}
scienze	Le Scienze	www.lescienze.it/?q={s}
scimago	SCImago Journal Rank	scimagojr.com/journalsearch.php?q={s}
sciplus	American Science and Surplus(SciPlus)	www.sciplus.com/s/?q={s}
scrooge	Scrooge	www.scrooge.co.uk/search?keyphrase={s}
seatalk	Nautical Dictionary	www.seatalk.info/cgi-bin/nautical-marine-sailing-dictionary/db.cgi?db=db&view_records=1&uid=default&Term={s}
secjobs	infosec-jobs.com	infosec-jobs.com/?search_keywords={s}
sefaria	Sefaria	www.sefaria.org/search?q={s}
semrush	SEM Rush	www.semrush.com/info/{s}+(full+search)
sendict	SentenceDict	sentencedict.com/{s}.html
sephora	Sephora	www.sephora.com/search?keyword={s}
serebii	Serebii	www.serebii.net/search.shtml?q={s}
serenes	Serenes Forest	serenesforest.net/?s={s}
session thesession	The Session	thesession.org/search?where=&q={s}
shabbat	Hebcal.com	www.hebcal.com/shabbat/?cfg=json&m=50&b=18&zip={s}&a=on
sharese	SharePoint Stack Exchange	sharepoint.stackexchange.com/search?q={s}
sherdog	Sherdog	www.sherdog.com/stats/fightfinder?SearchTxt={s}
sherwin	Sherwin-Williams	www.sherwin-williams.com/SearchDisplay?categoryId=&storeId=10151&catalogId=11051&langId=-1&sType=SimpleSearch&resultCatEntryType=2&showResultsPage=true&searchSource=Q&pageView=list&beginIndex=0&searchType=1000&pageSize=15&globalSearch=true&searchTerm={s}
shiatsu	Shiatsu Stijlen	www.shiatsu-stijlen.nl/zoeken.php?q={s}
shinden	Shinden	shinden.pl/search?q={s}
shkwiki	Stronghold Kingdoms Wiki	help.strongholdkingdoms.com/index.php?search={s}&title=Special:Search
shoopde	Shoop.de	www.shoop.de/suche?q={s}
shopify shopifyforum	Shopify	help.shopify.com/en/search?utf8=%E2%9C%93&q={s}
simages	Startpage Picture Search	startpage.com/do/metasearch.pl?cat=pics&query={s}
simania	Simania	simania.co.il/searchBooks.php?searchType=tabAll&query={s}
similar	SimilarSites	www.similarsites.com/site/{s}
sinopak	sinopak	sinopak.net/search?controller=search&orderby=position&orderway=desc&search_query={s}&submit_search=Search
sischmi	Silberschmiede Online	www.silberschmiede-online.de/advanced_search_result.php?keywords={s}
sjiauto	Science Jobs India	sjiauto.wordpress.com/?s={s}
skalman	Skalman	www.skal-man.se/sok/{s}
skelbiu	Skelbiu	skelbiu.lt/skelbimai/?keywords={s}
skimage	scikit-image	scikit-image.org/docs/dev/search.html?q={s}&check_keywords=yes&area=default
skroutz	Skroutz	www.skroutz.gr/search?keyphrase={s}
slanggr	SLANG.gr	www.slang.gr/lemmas?q={s}
slatefr	Slate.fr	www.slate.fr/search?mot-cle={s}
slotech	Slo-Tech	slo-tech.com/forum/isci/?q={s}
slyrics	SONG LYRICS	www.songlyrics.com/index.php?section=search&searchW={s}&submit=Search
smartos	SmartOS Man Pages	smartos.org/man/{s}
smitten	Smitten Kitchen	smittenkitchen.com/?s={s}
smulweb	Smulweb	www.smulweb.nl/recepten/{s}
snogard	Snogard.de	www.snogard.de/suche.html?suchwort={s}
snpedia	SNPedia	www.snpedia.com/index.php?title=Special:Search&search={s}&fulltext=Search
societe	societe.com	www.societe.com/cgi-bin/search?champs={s}
socwall	Socwall - Social Wallpapering	www.socwall.com/wallpapers/search:{s}
sofurry	SoFurry	www.sofurry.com/browse/search?search={s}
solomid	Solomid	www.solomid.net/searchresults.php?q={s}
sorabel	Sorabel	www.sorabel.com/products/search?query={s}
soyluna	Soy Luna Wiki	soyluna.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
spartan	Spartan Donate	www.spartan-donate.com/?s={s}
speccie	The Spectator	www.spectator.co.uk/?s={s}
spekbio	Spektrum Akademischer Verlag - Lexikon der Biologie	www.spektrum.de/lexikon/biologie/?q={s}
spekgeo	Spektrum	www.spektrum.de/lexikon/geographie/?q={s}
spinoza	Spinoza	www.spinoza.it/?s={s}
sporcle	Sporcle	www.sporcle.com/games/tags/{s}
sportsi	Sports Illustrated	www.si.com/search?q={s}
sproget	Sproget	sproget.dk/lookup?SearchableText={s}
sputnik	Sputnik	www.sputnik.ru/search?q={s}
ssllabs	ssllabs	www.ssllabs.com/ssltest/analyze.html?d={s}
stadium	Stadium	www.stadium.se/search?SearchTerm={s}
staples	Staples.com	www.staples.com/search?query={s}
startup	Startup Buffer	startupbuffer.com/search?s={s}
steamdb	Steam Database	steamdb.info/search/?a=app&q={s}
steamgl	Steam Greenlight	steamcommunity.com/workshop/browse/?appid=765&searchtext={s}
steamid	Steam app ID	store.steampowered.com/app/{s}/
steamio	steamid.io	steamid.io/lookup/{s}
steemit	Steemit	steemit.com/static/search.html?q={s}
steigan	Steigan.no	steigan.no/?s={s}
stocksy	Stocksy United	www.stocksy.com/search/{s}
strongs	Strong's Exhaustive Concordance	www.biblestudytools.com/search/?q={s}&t=kjv&s=Bibles
ststock shutterstock	Shutterstock	www.shutterstock.com/search/{s}
sttexts	Sacred Texts	www.sacred-texts.com/cat/srchtitl.htm?search_str={s}
stubhub tickets	StubHub	www.stubhub.com/search/doSearch?searchStr={s}&pageNumber=1&resultsPerPage=50&searchMode=event&start=0&rows=50
stuffnz	stuff.co.nz	www.stuff.co.nz/searchresults?q={s}
subldoc	Sublime Text Unofficial Documentation	docs.sublimetext.info/en/latest/search.html?q={s}
sublime	Sublime Package Control	sublime.wbond.net/search/{s}
sudomod	sudomod	sudomod.com/?s={s}
sulekha	Sulekha	search.sulekha.com/sulekhasearch.aspx?txtsearch={s}
sundell	Swift by Sundell	www.swiftbysundell.com/search?query={s}
surplus	SurplusTraders	www.surplustraders.net/catalogsearch/advanced/result/?name={s}
svgrepo	SVG Repo	www.svgrepo.com/vectors/{s}/
swalter	S. Walter Packaging	www.swalter.com/catalogsearch/result/?q={s}
synapse	Sage Synapse	www.synapse.org/#!Search:{s}
sysensw	Systranet English-Swedish	www.systranet.com/fr/fr/dictionary/english-swedish/{s}?
sysswen	Systranet Swedish-English	www.systranet.com/fr/fr/dictionary/swedish-english/{s}?
tableau	Tableau Software	www.tableau.com/search#q={s}
tabroom	Tabroom	www.tabroom.com/index/search.mhtml?search={s}
taginfo	OpenStreetMap Taginfo	taginfo.openstreetmap.org/search?q={s}
talaios	Talaios.net	talaios.net/?s={s}
tanishq	tanishq	www.tanishq.co.in/search-result/{s}
tapwage	Tapwage.com	tapwage.com/search?q={s}
tdnotes	tdnotes	www.tdstructurednotes.com/snp/searchByKeyword.action?criteria.keyword={s}
tech-wd	tech-wd.com	www.tech-wd.com/wd/?s={s}
technet	Microsoft TechNet	social.technet.microsoft.com/search/en-us/?query={s}
tecmint	Tecmint	www.tecmint.com/search/?q={s}
teketen	Teketen	teketen.com/?s={s}&submit=Search
telstra	Telstra	www.telstra.com.au/search/simple-search?inpSearch={s}&requestSiteId=personal&searchFormSubmited=Yes
termcat	Termcat	www.termcat.cat/cercaterm/{s}?type=basic
termium	TERMIUM Plus	www.btb.termiumplus.gc.ca/tpv2alpha/alpha-eng.html?srchtxt={s}
textise	Textise	www.textise.net/showText.aspx?strURL={s}
thecrag	The Crag	www.thecrag.com/nodes/fuzzy-search/{s}
thetvdb	The TV db	www.thetvdb.com/search?q={s}&l=en
theweek	The Week	www.theweek.co.uk/search/site/{s}
thilina	Blog of Thilina Piyasundara	thilina.piyasundara.org/search?q={s}
thriftb	ThriftBooks	www.thriftbooks.com/browse/?b.search={s}
ticmate	Ticmate	www.ticmate.com/search?freeText={s}
tiketti	Tiketti	www.tiketti.fi/tapahtumat#q={s}
timmail	Tim Mail	mail.tim.it/?q={s}
tinypic	TinyPic	tinypic.com/search.php?tag={s}
tinyurl	TinyURL.com	tinyurl.com/create.php?url={s}
tkkrlab	tkkrlab	tkkrlab.nl/wiki/Special:Search?search={s}&go=Go
tmarket	Torn Market	www.torn.com/imarket.php#/p=shop&step=shop&type=&searchname={s}
tockdom	Custom Mario Kart Wiki	wiki.tockdom.com/w/index.php?title=Special:Search&search={s}&fulltext=Search
todoist	Todoist	todoist.com/app?lang=en#agenda/{s}
topgeek	Top Geek	www.topgeek.net/fr/recherche?controller=search&orderby=position&orderway=desc&search_query={s}&submit_search=Rechercher
topshop	Topshop	us.topshop.com/webapp/wcs/stores/servlet/CatalogNavigationSearchResultCmd?langId=-1&storeId=13052&catalogId=33060&beginIndex=1&viewAllFlag=false&pageSize=20&sort_field=Relevance&searchTerm={s}
torwiki	Torproject Wiki	trac.torproject.org/projects/tor/search?q={s}
tppress	Theme Park Press	themeparkpress.com/?s={s}
tradera	Tradera	www.tradera.com/search?q={s}
traeger	Traeger Pellet Grill Recipes	www.traegergrills.com/recipes?types=RecipeDetail&term={s}
trailer traileraddict	Trailer Addict	www.traileraddict.com/search/{s}
triplea	Axis & Allies Wiki	axisandallies.wikia.com/wiki/Special:Search?search={s}&fulltext=Search&ns0=1&ns14=1#
tripoto	Tripoto	www.tripoto.com/travel-guide/{s}
tripsit	TripSit	wiki.tripsit.me/index.php?search={s}
trivago	trivago	www.trivago.com/?sQuery={s}
tshirts	Tee Territory	www.teeterritory.com/search?q={s}
tstypes	DefinitelyTyped	www.npmjs.com/search?q=@types/{s}
ttb-ita	Tatoeba to Italian	tatoeba.org/eng/sentences/search?query={s}&from=und&to=ita
ttbooks	talk to books	books.google.com/talktobooks/query?q={s}
tunebat	Tunebat	tunebat.com/Search?q={s}
tuttich	tutti.ch	www.tutti.ch/ganze-schweiz?q={s}
tv4play	Tv4play	www.tv4play.se/sok/{s}
tvguide	TV Guide	www.tvguide.com/search/index.aspx?keyword={s}
tyndale	Tyndale Publishers	www.tyndale.com/search?q={s}&f=
ubuntuf ubuntuforums	Ubuntu Forums	ubuntuforums.org/search.php?do=process&query={s}
ucsc-eu	UCSC Genome Browser (Europe, GRCH38)	genome-euro.ucsc.edu/cgi-bin/hgTracks?db=hg38&position={s}
ue4docs unrealengine	Unreal Engine Documentation	docs.unrealengine.com/en-us/Search-Results?Search={s}
uketabs	Ukulele Tabs	www.ukulele-tabs.com/search-uke-chords.html?find={s}
umagine youmagine	YouMagine	www.youmagine.com/search/designs?utf8=%E2%9C%93&search={s}
uniprot	UniprotKB	www.uniprot.org/uniprot/?query={s}
uniwiki	UniWiki	wiki.eveuniversity.org/index.php?title=Special:Search&search={s}&button=
unomaha	unomaha	www.unomaha.edu/search/?q={s}
untappd	Untappd	untappd.com/search?q={s}
urbaani	Urbaani Sanakirja	urbaanisanakirja.com/search/?q={s}
urbanfx	urbaneffect.net	urbaneffect.net/?s={s}
urlscan	urlscan	urlscan.io/search/#{s}
urlvoid	Urlvoid	www.urlvoid.com/scan/{s}
uschess	US Chess Federation	www.uschess.org/datapage/player-search.php?name={s}&state=ANY&ratingmin=&ratingmax=&order=N&rating=R&mode=Find
uscript	Unity Script Reference	docs.unity3d.com/Documentation/ScriptReference/30_search.html?q={s}
usd2brl	XE (usd2brl)	www.xe.com/currencyconverter/convert/?Amount={s}&From=USD&To=BRL
usd2cop	XE (usd2cop)	www.xe.com/currencyconverter/convert/?From=USD&To=COP&Amount={s}
usd2eur	Xe.com	www.xe.com/currencyconverter/convert/?From=USD&To=EUR&Amount={s}
usd2gbp	xe	www.xe.com/currencyconverter/convert/?Amount={s}&From=USD&To=GBP
usydlib	University of Sydney Library	sydney.primo.exlibrisgroup.com/discovery/search?query=any,contains,{s}&tab=Everything&search_scope=MyInst_and_CI&vid=61USYD_INST:sydney&offset=0
vagrant	Vagrant Cloud	app.vagrantup.com/boxes/search?q={s}
vakblog	Vakblog	rsnijders.info/vakblog/?s={s}
valadoc	Valadoc	valadoc.org/?q={s}
vandale	Van Dale	www.vandale.nl/opzoeken?pattern={s}&lang=nn
variety	Variety	variety.com/results/#?q={s}
varsome	VarSome	varsome.com/variant/search?query={s}
vatican	Vatican	gsearch.vatican.va/search?q={s}&btnG=Search+on&site=default_collection&client=default_frontend&output=xml_no_dtd&proxystylesheet=default_frontend&sort=date:D:L:d1&entsp=a__policy_documenti&wc=200&wc_mc=1&oe=UTF-8&ie=UTF-8&ud=1&exclude_apps=1&filter=0
vegewel	Vegewel	vegewel.com/en/search?utf8=%E2%9C%93&q[g][1][restaurant_search]={s}&q[g][0][m]=or&commit=Search
viaplay	Viaplay	viaplay.com/search?query={s}
viasona	Viasona	www.viasona.cat/cerca?que={s}&cerca=
vijesti	Vijesti Online	www.vijesti.me/trazi/?q={s}
vikatan	vikatan	www.vikatan.com/search.php?search={s}
villain	Villains Wikia	villains.wikia.com/wiki/Special:Search?search={s}
vivaldi	Vivaldi Forums	forum.vivaldi.net/search?term={s}
vogueuk	Vogue.co.uk	www.vogue.co.uk/search?q={s}
volcans	Librairie Les Volcans	www.librairielesvolcans.com/listeliv.php?RECHERCHE=simple&MOTS={s}&x=0&y=0
voltron	Voltron Wiki	voltron.wikia.com/wiki/Special:Search?query={s}
voterly	Voterly	voterly.com/search/politicians?q={s}
votraro	Plena Ilustrita Vortaro de Esperanto	vortaro.net/?w={s}
vrijuit	Vrij Uit vakanties	vrijuit.nl/algemeen/ListerPage.aspx?filter=search({s})
vschart	vsChart.com	vschart.com/search?q={s}
vuetify	Vuetifyjs	vuetifyjs.com/en/components/{s}
vulners	Vulners.com	vulners.com/search?query={s}
vulnhub	Vulnhub	www.vulnhub.com/?q={s}&sort=date-asc&type=vm
wafresh	WA Fresh Delivered	www.wafresh.com.au/search.php?Search=&search_query={s}
wakoopa	Wakoopa	social.wakoopa.com/search?query={s}
walmart	Walmart	www.walmart.com/search/?query={s}
warwick	University of Warwick	search.warwick.ac.uk/?q={s}
wattpad	Wattpad	www.wattpad.com/stories/search/{s}
wayfair	Wayfair	www.wayfair.com/keyword.php?keyword={s}
wcanaan	Wiki Canaan	www.wikicanaan.org/wiki/bienvenue?do=search&id={s}&fulltext=Recherche
wcoulls	Whitcoulls	www.whitcoulls.co.nz/search?q={s}
weather	Weather.com	www.weather.com/search/enhancedlocalsearch?where={s}&loctypes=1/5/9/11/13/19/&from=hdr
web1913	Webster's Dictionary (1913)	www.websters1913.com/words/{s}
webbspy	webbspy.com	www.webbspy.com/?s={s}
webcams	webcams.travel	www.webcams.travel/search/{s}
webcomp webcomponents	webcomponents.org	www.webcomponents.org/search/{s}
webliot	Weblio Thesaurus	thesaurus.weblio.jp/content/{s}
wegmans	Wegmans	www.wegmans.com/search.html?searchKey={s}
wehkamp	Wehkamp	www.wehkamp.nl/Winkelen/SearchOverview.aspx?N=186&Nty=1&Ntk=ART&VIEW=Grid&Ntt={s}
weladee	Job Weladee	job.weladee.com/?q={s}
westelm	West Elm	www.westelm.com/search/results.html?words={s}
whatcms	WhatCMS	whatcms.org/?s={s}
whfoods	The World's Healthiest Foods	whfoods.org/sitesearch.php?sstr={s}&how=1
whichit	Whichit	www.getwhichit.com/whichitapp.html#!/Search/{s}
whisper	Whisper.sh	whisper.sh/search?q={s}
whoisbg	whoisbg.com	www.whoisbg.com/?domain={s}
whoisbr	Registro.br	registro.br/cgi-bin/whois/?qr={s}
whosamt whosamtrack whosamtracks	WhoSampled (Tracks)	www.whosampled.com/search/tracks/?q={s}
wiki.pl	Wikipedia Polska	pl.wikipedia.org/wiki/{s}
wikiart wikipainting wikipaintings	WikiArt	wikiart.org/en/search/{s}/1
wikidex	WikiDex	www.wikidex.net/index.php?search={s}
wikifur	WikiFur	en.wikifur.com/wiki/Special:Search?search={s}&go=Go
wikirby	Wikirby	wikirby.com/w/index.php?title=Special:Search&search={s}&go=Go
wikisum	Wiki Summaries	www.wikisummaries.org/index.php?title=Special:Search&search={s}&go=Go
wikitox	WikiTox	www.wikitox.org/doku.php?do=search&id=start&q={s}
wiringa	Wiringa Technische Groothandel	wiringa.nl/search?q={s}
witredk	Witre Denmark	www.witre.dk/SearchDisplay?storeId=11712&sType=SimpleSearch&searchTerm={s}
witrefi	Witre Finland	www.witre.fi/SearchDisplay?storeId=11713&sType=SimpleSearch&searchTerm={s}
witreno	Witre Norway	www.witre.no/no/wno/SearchDisplay?storeId=11714&sType=SimpleSearch&searchTerm={s}
witrese	Witre Sweden	www.witre.se/SearchDisplay?storeId=11715&sType=SimpleSearch&searchTerm={s}
woodmac	Wood Mackenzie	www.woodmac.com/store/search/?q={s}
woolies woolworths	Woolworths	www.woolworths.com.au/shop/search/products?searchTerm={s}
wordery	Wordery	wordery.com/search?term={s}
wordnet	WordNet	wordnetweb.princeton.edu/perl/webwn?s={s}&sub=Search+WordNet&o2=&o0=1&o7=&o5=&o1=1&o6=&o4=&o3=&h=
wordweb	WordWeb Online	www.wordwebonline.com/search.pl?w={s}
woutick	Woutick	www.woutick.es/?busqueda={s}
wowwiki	WoWWiki	www.wowwiki.com/Special:Search?search={s}
wrensyn	WordReference.com English Synonyms	www.wordreference.com/thesaurus/{s}
wrhymer wikirhymer	WikiRhymer	wikirhymer.com/words/{s}
wulfila	Project Wulfila	www.wulfila.be/gothic/browse/search/?find={s}&mode=1
wurmweb	wurmweb	www.wurmweb.at/?s={s}
xamarin	Xamarin developer	developer.xamarin.com/search?q={s}
yesasia	Yes Asia	www.yesasia.com/us/search/{s}/0-0-0-q.{s}_bpt.48-en/list.html
yopmail	YopMail	www.yopmail.com/en/index.php?login={s}
youloop	youloop.org	youloop.org/search.php?q={s}
ysports	Yahoo Sports	search.yahoo.com/search?p=/{s}
yume100	Yume100 Wiki	yume100prince.wikia.com/wiki/Special:Search?search={s}
zalando	Zalando (uk)	www.zalando.co.uk/catalog/?q={s}
zentrum	Zentrum Online	zentrum-online.at/?s={s}
zoom.us	zoom.us	zoom.us/?q={s}
zzounds	ZZounds	www.zzounds.com/prodsearch?q={s}
15mpedia	15Mpedia	15mpedia.org/w/index.php?search={s}
24matins	24matins	www.24matins.fr/?s={s}
2dehands	2dehands.be	www.2dehands.be/markt?qq={s}
2ememain	2ememain.be	www.2ememain.be/marche/?qq={s}
34travel	34travel.me	34travel.me/search?text={s}
401games	401 Games	store.401games.ca/pages/search-results?q={s}
7digital	7digital	www.7digital.com/search?q={s}
95google	9to5Google	9to5google.com/?s={s}
abcgames	ABCgames.cz	www.abcgames.cz/?p=sekcia_hladaj&key={s}
abebooks	abebooks	www.abebooks.com/servlet/SearchResults?kn={s}
abiunity	abiunity	www.abiunity.de/datenbank.php?boardid=48#!v=searchdb&search={s}&boardid=48
academia	academia.edu	www.academia.edu/people/search?utf8=%E2%9C%93&q={s}
aceforum	AceLab official forum	forum.acelab.eu.com/search.php?keywords={s}
adlibris adlibrisse	Adlibris	www.adlibris.com/se/sok?q={s}
agricola	AGRICOLA	agricola.nal.usda.gov/vwebv/search?searchArg={s}&searchCode=GKEY^&setLimit=1&recCount=10&searchType=1&page.search.search.button=Search
aitopics	AITopics	aitopics.org/search?q={s}
alarmpkg	Arch Linux ARM Packages	archlinuxarm.org/packages/?q={s}
albumart	iTunes Album Artwork Finder	bendodson.com/projects/itunes-artwork-finder/index.html?entity=album&country=us&query={s}
alliance	Alliance Champions Training Center	alliancechampions.com/?s={s}
allmovie	AllMovie	allmovie.com/search/all/{s}
allsides	AllSides	www.allsides.com/allsides-search-results?search_api_views_fulltext={s}
allsongs	AllSongs	allsongs.tv/search/?q={s}
almedina	Livraria Almedina	www.almedina.net/search.php?query={s}
alternet	Alternet	www.alternet.org/search/site/{s}
amademp3	Amazon.de	www.amazon.de/s?k={s}&i=digital-music
amazonnl	Amazon Nederland	www.amazon.nl/s?k={s}
amazontr	Amazon.com.tr	www.amazon.com.tr/s?k={s}
american	American National Careers	agentcareers.americannational.com/search-results?keywords={s}
amglobal	Amazon (GLOBAL)	www.amazon.com/s?k={s}&i=us-worldwide-shipping-aps
ampparit	Ampparit.com	www.ampparit.com/haku?q={s}
ancestry	Ancestry	www.ancestry.com/search/?keyword={s}
antonimo	Antonimos	www.antonimos.net/?termino={s}
aopscomm	Art Of Problem Solving Community	artofproblemsolving.com/community/search/{s}
apertium	Apertium Wiki	wiki.apertium.org/w/index.php?title=Special:Search&search={s}&go=Go
appbrain	AppBrain	www.appbrain.com/search?q={s}
apppedia	AppPedia	programs.wikia.com/wiki/Special:Search?search={s}
arabnews	Arab News	www.arabnews.com/search/google/{s}
arcgames	ArcGames	www.arcgames.com/en/games/all-games/query/{s}
archbugs	ArchLinux Bugtracker	bugs.archlinux.org/index.php?string={s}&project=0
archivpd	Archivportal-D	archivportal-d.de/objekte?query={s}
arkpedia	Ark Gamepedia	ark.gamepedia.com/index.php?search={s}&title=Special:Search&go=Go
armadeus	Armadeus Project	www.armadeus.com/wiki/index.php?search={s}
armslist	ARMSLIST	www.armslist.com/classifieds/search?search={s}&location=usa&category=all&posttype=7&ships=
artifact	Artifact Wiki	artifact.gamepedia.com/index.php?search={s}
asiavape	AsiaVape.co	asiavape.co/?s={s}&post_type=product
astrobin	AstroBin	www.astrobin.com/search/?q={s}&search_type=1&solar_system_main_subject=&telescope_type=any&camera_type=any&aperture_min=&aperture_max=&pixel_size_min=&pixel_size_max=&start_date=&end_date=&integration_min=&integration_max=&moon_phase_min=&moon_phase_max=
atlantis	Atlantis Time-Line	www.atlantistime.com/?s={s}
atlaspiv	Atlas piv	www.atlaspiv.cz/?beername={s}
audiogon	Audiogon	app.audiogon.com/listings?&global_search_text={s}
audubonb	National Audubon Society (birds)	birds.audubon.org/search/node?keys={s}
autoblip	Autoblip	www.autoblip.com/used/{s}
autozone	AutoZone	www.autozone.com/searchresult?searchText={s}
avenwiki	AVENwiki	www.asexuality.org/wiki/index.php?search={s}
avtoprom	avtoprom.org	avtoprom.org/search.php?keywords={s}
b-rhymes	B-Rhymes	www.b-rhymes.com/rhyme/word/{s}
babelnet	BabelNet	babelnet.org/search?word={s}&lang=EN
babymigo	Babymigo	babymigo.com/search/questions?query={s}
baeldung	Baeldung	www.baeldung.com/?s={s}
bandband	Band-Band Paris	band-band.com/?s={s}
banggood	Bang good	www.banggood.com/index.php?keywords={s}&cat_id=0&com=search
barchive	The /b/ Archive	thebarchive.com/_/search/text/{s}
bartlets	Bartelby	www.bartleby.com/search?q={s}
bbcmusic	BBC Music	www.bbc.co.uk/music/search-results?q={s}
bbcsport	BBC Sport	www.bbc.co.uk/search/sport/{s}?video=on&audio=on&text=on
beatport	Beatport	www.beatport.com/search?q={s}
beckshop	beck-shop.de	www.beck-shop.de/trefferliste.aspx?q={s}&action=search&page=0
bergdorf	Bergdorf Goodman	www.bergdorfgoodman.com/search.jsp?N=0&Ntt={s}
bertrand	Livraria Bertrand	www.bertrand.pt/pesquisa/{s}
betalist	BetaList	betalist.com/search?q={s}
bgunikat	Sterling silver jewelry	bgunikat.eu/index.php?route=product/search&search={s}
bibliomi	Sistema Bibliotecario di Milano	milano.biblioteche.it/opac/search/lst?q={s}
bibunipi	Onesearch Unipi	onesearch.unipi.it/primo_library/libweb/action/search.do?fn=search&ct=search&initialSearch=true&mode=Basic&tab=default_tab&indx=1&dum=true&srt=rank&vid=39UPI_V1&frbg=&tb=t&vl(freeText0)={s}&scp.scps=scope:(39UPI),39UPI_EbscoLocal,primo_central_multiple_fe
bidorbuy	bidorbuy	www.bidorbuy.co.za/search/{s}
bigstock	Bigstock	www.bigstockphoto.com/search/{s}/
bigwords	BigWords.com	www5.bigwords.com/search/easy-search/?producttype=all&searchtype=isbn&searchstring={s}&buySell=
bikedsct	Bike-Discount	www.bike-discount.de/de/suche?q={s}
bittrust	BitTrust	bittrust.org/search#stq={s}
blendapi	Blender Current API	docs.blender.org/api/current/search.html?q={s}&check_keywords=yes&area=default
bloodcat	Bloodcat Beatmap Mirror	bloodcat.com/osu/?q={s}&c=b&s=&m=&g=&l=
bluehive	BlueHive	www.bluehive.com/providers/search/{s}
blueline	Blueline	rsw.me.uk/blueline/methods/search?q={s}
bmonotes	BMO Structured Notes	www.bmonotes.com/Search/GeneralSearch?query={s}
bmwparts	BMW Parts	www.getbmwparts.com/search?search_str={s}
boardman	Boardman Perspective	dillonboardman.wordpress.com/?s={s}&submit=Search
bobdylan	Bob Dylan	www.bobdylan.com/?s={s}
bocpages	bocpages	bocpages.org/w/index.php?search={s}
bondfaro	Bondfaro	www.bondfaro.com.br/cprocura?produto={s}
booklive	BookLive!	booklive.jp/search/keyword?keyword={s}
booksetc	Books etc UK	www.booksetc.co.uk/books/search?q={s}
bookshop	Bookshop	bookshop.org/search?keywords={s}
boyslife	Boys' Life magazine	boyslife.org/search/?q={s}
brickset	Brickset	brickset.com/sets?query={s}
bricoman	Bricoman	www.bricoman.it/search/?q={s}
britimgq imagequest	Britannica ImageQuest	quest.eb.com/search/{s}
britsche britannicaschoole	Britannica School (Elementary)	school.eb.com/levels/elementary/search/articles?query={s}
britschh britannicaschoolh	Britannica School (High)	school.eb.com/levels/high/search/articles?query={s}
britschm britannicaschoolm	Britannica School (Middle)	school.eb.com/levels/middle/search/articles?query={s}
brumario	Biblioteca - Universidad de Salamanca	brumario.usal.es/search/?searchtype=X&searcharg={s}&op=Buscar&SORT=D&searchscope=
brussels	We Love Brussels	welovebrussels.org/?s={s}
bugforum	Bug Online Forum	www.bug.hr/forum/search/topic/?txt={s}
bugguide	Bug Guide	bugguide.net/index.php?q=search&keys={s}
bustimes	Bus Times	bustimes.org/search?q={s}
byggahus	ByggaHus.se	www.byggahus.se/sokresultat/?q={s}
c2cforum	Camptocamp (forum)	www.camptocamp.org/documents/search?type=forums&q={s}
cakebook	CakePHP Cakebook 3.x	book.cakephp.org/3.0/en/search.html?check_keywords=yes&area=default&q={s}
camerapb	Camera Price Buster	www.camerapricebuster.co.uk/Search?q={s}
cannabis	AND Cannabis	www.andcannabis.com/?s={s}
carsales	Carsales	www.carsales.com.au/cars/results/?q=CarAll.keyword({s}).&area=Stock&vertical=car&WT.z_srchsrcx=makemodel
casetext	casetext	casetext.com/search?q={s}
catholic	Catholic Answers	www.catholic.com/search?q={s}
ccsearch	Creative commons search	ccsearch.creativecommons.org/search?q={s}
cfpforum	Curve Fever Pro Forum	forum.curvefever.pro/search?q={s}
chairish	Chairish	www.chairish.com/search?q={s}
chambers	Chambers	chambers.co.uk/search.php?query={s}&title=21st
channel5	Channel 5	www.channel5.com/search?q={s}
chatters	Chatters Salons	chatters.ca/catalogsearch/result/?q={s}
chefkoch	chefkoch.de	www.chefkoch.de/suche.php?wo=2&suche={s}
chilango	Chilango	www.chilango.com/?s={s}
chordify	Chordify	chordify.net/?search={s}
citeseer	CiteSeer	citeseer.ist.psu.edu/search?q={s}&submit=Search&sort=rlv&t=doc
clearweb	ClearWebStats	www.clearwebstats.com/process.php?q={s}
clinical	Advanced Clinical Careers	jobs.advancedclinical.com/search-results?keywords={s}
cloudron	Cloudron	cloudron.io/appstore.html?search={s}
codeberg	Codeberg	codeberg.org/explore/repos?q={s}
concerts pollstar	Pollstar	www.pollstar.com/tour/searchall.pl?By=All&Content={s}&go_green.x=0&go_green.y=0
confrank	Computing Research and Education Association of Australasia, CORE	portal.core.edu.au/conf-ranks/?search={s}&by=all&source=all&sort=atitle&page=1
congress	Congress	www.congress.gov/search?q={"source":"legislation","search":"{s}"}
conradat	Conrad Austria	www.conrad.at/de/Search.html?searchType=REGULAR&search={s}
contamet	contamet.wordpress.com	contamet.wordpress.com/?s={s}
cookbook	Opscode community cookbooks	supermarket.chef.io/cookbooks?q={s}
coolshop	Coolshop	www.coolshop.dk/s/?q={s}
correios	Correios	www.linkcorreios.com.br/{s}
corriere	Corriere della Sera	sitesearch.corriere.it/forward.jsp?q={s}
costcoca	Costco Canada	www.costco.ca/CatalogSearch?dept=All&keyword={s}
cottages	Self Cater	selfcater.com/find?query={s}
coursera	Coursera	www.coursera.org/search?query={s}
cozydays	CozyDays	www.cozydays.com/search.aspx?q={s}
cpandeps	CPAN Dependencies Checker	deps.cpantesters.org/?module={s}&perl=any+version&os=any+OS
cpuworld	cpu-world.com	www.cpu-world.com/cgi-bin/SearchSite.pl?SEARCH={s}&PROCESS=Search
creation	Creation Ministries	creation.com/search?q={s}
cricbuzz	Cricbuzz	www.cricbuzz.com/search?q={s}
cricinfo	Cricinfo	search.espncricinfo.com/ci/content/site/search.html?search={s}&gblsearch=
critique	CritiqueBrainz	critiquebrainz.org/search/?query={s}&type=artist
critrole	Critical Role Wiki	criticalrole.miraheze.org/w/index.php?search={s}&title=Special:Search
cronista	El Cronista Comercial	www.cronista.com/buscar/{s}
crossclj	CrossClj	crossclj.info/search?q={s}
cstheory	Theoretical Computer Science - Stack Exchange	cstheory.stackexchange.com/search?q={s}
cubehero	Cube Hero	cubehero.com/search?q={s}
cubicles	Skutchi Designs	www.skutchi.com/catalogsearch/result/?q={s}
cultpens	Cult Pens	www.cultpens.com/s?q={s}
cybrhome	CybrHome	www.cybrhome.com/search?q={s}
cycletec	CycleTec GmbH	www.cycletec.ch/index.php?route=product/search&search={s}
d20pfsrd	Pathfinder SRD	www.d20pfsrd.com/system/app/pages/search?scope=search-site&q={s}
dagjeweg	DagjeWeg.NL	www.dagjeweg.nl/zoeken?dq={s}
dailymed	DailyMed	dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query={s}
datacite	datacite.org	search.datacite.org/works?query={s}
datagouv	DataGouv	www.data.gouv.fr/fr/search/?q={s}
dblp.pub	DBLP	dblp.uni-trier.de/search/publ?q={s}
dccomics	DC Comics	www.dccomics.com/search/node/{s}
dcinside	dcinside	search.dcinside.com/combine/q/{s}
ddg-help	DuckDuckGo Help	help.duckduckgo.com/search?q={s}
ddg-week ddg-recent	DuckDuckGo Last Week	duckduckgo.com/?q={s}&df=w
deadline	Deadline Hollywood	deadline.com/results/#?q={s}
deadspin	Deadspin	deadspin.com/search?q={s}
dealnews	Deal News	dealnews.com/search.html?search={s}
debfiles debcontent	Debian Package Contents	packages.debian.org/search?searchon=contents&keywords={s}
debianfr	Debian Pages (French)	www.google.com/cse?cx=007724375775369850404:jwpah_hbbjk&ie=UTF-8&q={s}&siteurl=www.google.com/cse/home?cx=007724375775369850404:jwpah_hbbjk
decipher	Decipher Genomics	www.deciphergenomics.org/search?q={s}
deepdyve	DeepDyve	www.deepdyve.com/search?query={s}
delfruit	Delicious Fruit	delicious-fruit.com/ratings/full.php?s={s}
delivery	Yelp Delivery Search	www.yelp.com/search?&rpp=10&find_loc=&start=0&attrs=RestaurantsDelivery&find_desc={s}
dexigner	Dexigner	www.dexigner.com/search?q={s}
dicpixiv	Pixiv Dictionary	dic.pixiv.net/a/{s}
digibron	Digibron	www.digibron.nl/search/results?q={s}
digikala	Digikala	www.digikala.com/Search?q={s}
digitick	Digitick	www.digitick.com/fr/recherche?query={s}
disboard	DISBOARD	disboard.org/search?keyword={s}
djticket	Django Ticket	code.djangoproject.com/ticket/{s}
docbook5	DocBook 5: The Definitive Guide	docbook.org/search/?q={s}
doccheck	doccheck	www.doccheck.com/de/search/?q={s}
doctrine	Doctrine.fr	www.doctrine.fr/?q={s}
donedeal	Done Deal	www.donedeal.ie/all?words={s}
doomsday	Doomsday Prep	www.doomsdayprep.com/?s={s}&post_type=product
doordash	DoorDash	www.doordash.com/search/store/{s}?event_type=search
downpour	Downpour	www.downpour.com/catalogsearch/result/?q={s}
dragball	Dragon Ball Wiki	dragonball.wikia.com/wiki/Special:Search?query={s}
dragcave	Dragon Cave Wiki	dragcave.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
drinkify	Drinkify	www.drinkify.org/{s}
drugbank	drugbank.ca	www.drugbank.ca/search?query={s}
dubizzle	dubizzle.com	dubai.dubizzle.com/search/?keywords={s}&is_basic_search_widget=1&is_search=1
dustloop	Dustloop Wiki	www.dustloop.com/wiki/index.php?search={s}
dynamite	Dynamite Entertainment	dynamite.com/htmlfiles/search2.html?0=19&next0=&KMPZ={s}
earthcam	earthcam	www.earthcam.com/?q={s}
eaterlon	Eater London	london.eater.com/search?q={s}
ebatesca	Ebates Canda	www.ebates.ca/srch/all?query={s}
ebseller	eBay Seller	www.ebay.com/sch/{s}/m.html
ecodices	e-codices: Virtual Manuscript Library of Switzerland	www.e-codices.unifr.ch/en/search/all?sQueryString={s}
ecuavisa	Ecuavisa (Ecuador)	www.ecuavisa.com/busqueda?search_api_views_fulltext={s}
edmsauce	EDM Sauce	www.edmsauce.com/?s={s}
eggtimer	Egg Timer	e.ggtimer.com/{s}
ekspress	Eesti Ekspress	ekspress.delfi.ee/otsing/?query={s}
electron	electron.atom.io	electron.atom.io/apps/?q={s}
emoneyge	emoney.ge	www.emoney.ge/index.php/main/services?search_query={s}
enggramm	English Grammar	www.englishgrammar.org/?s={s}
enkcwiki	Kancolle Wiki	en.kancollewiki.net/index.php?search={s}&title=Special:Search&go=Go
entearth	Entertainment Earth	www.entertainmentearth.com/s/?query1={s}
epflbook	EPFL Library	beast-epfl.hosted.exlibrisgroup.com/primo-explore/search?query=any,contains,{s}&tab=default_tab&search_scope=default_scope&vid=EPFL&lang=fr_FR&offset=0&fn=search
epriceit	ePrice	www.eprice.it/search/qs={s}
equaldex	Equaldex	equaldex.com/search?q={s}
estraviz	Estraviz	estraviz.org/{s}
eternity	Eternity Engine Wiki	eternity.youfailit.net/index.php?title=Special:Search&search={s}
eukeries	eukeries	www.eukeries.com/?s={s}
eurobuch	Eurobuch	www.eurobuch.de/buch/isbn/9604672819.html?search={s}
euronics	Euronics	www.euronics.de/search/?sSearch={s}&log=search
europarl	European Parliament	www.europarl.europa.eu/portal/en/search?q={s}
evernote	Evernote	www.evernote.com/Home.action#x={s}
everyeye	Everyeye	www.everyeye.it/ricerca/?q={s}
evirtdes	Estante Virtual (description)	www.estantevirtual.com.br/qdes/{s}
evirttit	Estante Virtual (by title)	www.estantevirtual.com.br/qtit/{s}
evreward	Evreward	evreward.com/store/find?store[name]={s}
exastris	Ex Astris Scientia	www.ex-astris-scientia.org/search/search.cgi?Terms={s}:
exlibris	exlibris.ch	www.exlibris.ch/de/suche/?q={s}
expresso	Expresso	expresso.pt/pesquisa?q={s}
failliet	Faillissementen.com	www.faillissementen.com/insolventies/nederlandse-insolventies/?q={s}
fandango	Fandango	www.fandango.com/search/?q={s}
fangamer	Fangamer	www.fangamer.com/search?type=product&q=*{s}*
farsi123	Farsi123	farsi123.com/?word={s}
fastmail	FastMail	www.fastmail.com/help/search/?q={s}
fculture	France Culture	www.franceculture.fr/recherche?q={s}
feedough	Feedough	www.feedough.com/?s={s}
fegtherm	fegtherm	fegtherm.hu/?s={s}
fileinfo	File info	fileinfo.com/extension/{s}
filmanic	Filmanic	filmanic.com/search-for-movies-actors-directors/?q={s}
filmtvde	FILM.TV	www.film.tv/google-suchergebnisse.html?cx=partner-pub-3004436243331931:1982226405&query={s}
finedict	Fine Dictionary	www.finedictionary.com/{s}.html
finelien	Fineli English	fineli.fi/fineli/en/elintarvikkeet?q={s}
finelisv	Fineli Swedish	fineli.fi/fineli/sv/elintarvikkeet?q={s}
finnjobb	Finn.no Jobb	www.finn.no/job/fulltime/search.html?q={s}
finnkino	Finnkino	www.finnkino.fi/Search?query={s}
finntorg finntorget	Finn.no Torget	www.finn.no/bap/forsale/search.html?q={s}
fireball	Fireball	fireball.de/q/{s}
firstcry	www.firstcry.com	www.firstcry.com/search.aspx?q={s}
fishpond	Fishpond	www.fishpond.com.au/advanced_search_result.php?keywords={s}
flaticon	FlatIcon	www.flaticon.com/search?word={s}
flexjobs	Flexjobs	www.flexjobs.com/search?search={s}&Location=
flickrcc	Flickr (All Creative Commons)	www.flickr.com/search/?text={s}&license=2,3,4,5,6,9
flipjuke	FlipJuke	www.flipjuke.fr/search.php?keywords={s}
folkwiki	FolkWiki	www.folkwiki.se/?n=Meta.Start&action=search&q={s}
foodsubs	Cook's Thesaurus	search.freefind.com/find.html?id=81296093&pageid=r&query={s}
forosuse	ForoSUSE	www.forosuse.org/?q={s}
fortinet	Fortinet	www.fortinet.com/search.html?q={s}
fortnite	Epic Games Fortnite	epicgames.com/fortnite/en-US/search?q={s}
fpwriter	FictionPress (writers)	www.fictionpress.com/search/?keywords={s}&ready=1&type=writer
freenode	Freenode	webchat.freenode.net/?channels={s}
frinkiac	Frinkiac	frinkiac.com/?p=search&q={s}
funplass	Funplass	funplass.com/recherche.php?what={s}&where=0&when=0
fusetron	fusetron	www.fusetronsound.com/search?q={s}
fussball	Fussball.de	www.fussball.de/suche/-/text/{s}
futurama infosphere	The Infosphere	www.theinfosphere.org/index.php?search={s}
gamejolt	Gamejolt	gamejolt.com/search/?q={s}
gamergen	GAMERGEN	www.gamergen.com/s/{s}
gameslol	Games.lol	games.lol/search/{s}
gamespot	GameSpot	www.gamespot.com/search/?q={s}
gamestar	GameStar	www.gamestar.de/index.cfm?pid=109&s={s}
gamestop	GameStop	www.gamestop.com/search/?q={s}&lang=default
gamezebo	Gamezebo	www.gamezebo.com/search/games?query={s}
gasolina	Mais Gasolina	www.maisgasolina.com/pesquisa/{s}/
gematria	Gematrix	www.gematrix.org/?word={s}
geocache geocaching	Geocaching.com	www.geocaching.com/seek/nearest.aspx?key={s}
geograph	Geograph Britain and Ireland	www.geograph.org.uk/of/{s}
geonames	GeoNames	www.geonames.org/search.html?q={s}
geonorge	GeoNorge	kartkatalog.geonorge.no/search?text={s}
gfactory	Genius Factory	geniusfactory.fr/search/{s}
giffgaff	GiffGaff	community.giffgaff.com/t5/forums/searchpage/tab/message?q={s}
giftinfo	Giftinformationscentralen	www.giftinformation.se/searchpage/?query={s}
gigabyte	Gigabyte support	www.gigabyte.com/Search?kw={s}
gigantti	Gigantti Finland	www.gigantti.fi/search?SearchTerm={s}
gizoogle	Gizoogle	www.gizoogle.net/index.php?search={s}
gloriatv	Gloria.tv	gloria.tv/?search={s}
glotenes	Interglot EN -> ES	www.interglot.com/dictionary/en/es/search?q={s}
glotennl	Interglot	www.interglot.com/dictionary/en/nl/search?q={s}
glotesen	Interglot ES -> EN	www.interglot.com/dictionary/es/en/search?q={s}
gnomedev	GNOME Developer Center	developer.gnome.org/symbols/?q={s}
gocomics	GoComics	www.gocomics.com/search/results?utf8=%E2%9C%93&terms={s}
godville	Godville Wiki	wiki.godvillegame.com/index.php?search={s}
gofundme	GoFundMe	www.gofundme.com/mvc.php?route=search&term={s}
goodguys	The Good Guys	www.thegoodguys.com.au/SearchDisplay?categoryId=&storeId=900&catalogId=30000&langId=-1&sType=SimpleSearch&resultCatEntryType=2&showResultsPage=true&searchSource=Q&pageView=&beginIndex=0&orderBy=0&pageSize=60&searchTerm={s}
googlebe	Google Belgium	www.google.be/#q={s}
googlech	Google Suisse/Schweiz/Switzerland	www.google.ch/search?q={s}
googlefr	Google France	www.google.fr/#q={s}
googleit	www.google.it	google.com/search?hl=it&q={s}
googlepl	Google Poland	www.google.pl/#q={s}
googlept	Google Portugal	www.google.pt/search?hl=pt_pt&q={s}
googlese	Google Sweden	google.se/?q={s}
googletr	Google Turkey	www.google.com.tr/search?q={s}
govtrack	govtrack.us	www.govtrack.us/search?q={s}
gpafrica	Greenpeace Africa	www.greenpeace.org/africa/en/Search-results/?all={s}
gpphilip	Greenpeace Philippines	www.greenpeace.org/seasia/ph/System-templates/Search-results/?all={s}
gpsearch	Group Policy Search	gpsearch.azurewebsites.net/default.aspx?search={s}
gpseasia	Greenpeace Southeast Asia	www.greenpeace.org/seasia/System-templates/Search-results/?all={s}
gradcafe	Grad Cafe	thegradcafe.com/survey/index.php?q={s}
grainger	Grainger	www.grainger.com/search?nls=1&searchQuery={s}
grosbill	GrosBill	www.grosbill.com/catv2.cgi?mode=recherche&recherche={s}
groupees	Groupees	groupees.com/?q={s}:
gt-nl-du	google translate	translate.google.com/m/translate#nl/de/{s}
guardian	The Guardian	www.theguardian.com/{s}
gundeals	gun.deals	gun.deals/search/apachesolr_search/{s}
gurtband	Gurtbandlager.de	www.gurtbandlager.de/search?sSearch={s}
gussmark	GUSSMARK GesmbH & Co KG	www.gussmark.at/_/search?query={s}
gwentify	Gwentify	gwentify.com/cards/?st={s}
hackster	Hackster	www.hackster.io/search?i=projects&q={s}
hafelenl	Hafele.nl	www.hafele.nl/INTERSHOP/web/WFS/Haefele-HNL-Site/nl_NL/-/EUR/ViewParametricSearch-SimpleOfferSearch?SearchType=all&SearchTerm={s}
happycow	HappyCow	www.happycow.net/searchmap?lat=&lng=&location={s}
harptabs	HarpTabs	www.harptabs.com/searchsong.php?Name={s}&HarpType=0
hcommons	Humanities Commons	hcommons.org/?s={s}
heritage	Heritage Foundation	www.heritage.org/search?contains={s}
highsnob	highsnobiety	www.highsnobiety.com/?s={s}
hilux4x4	Hilux 4x4	www.hilux4x4.co.za/views/search.php?keywords={s}&terms=all&author=&sc=1&sf=all&sr=posts&sk=t&sd=d&st=0&ch=300&t=0&submit=Search
hintoeng	Max Gyan Hindi to English	www.maxgyan.com/search/hindi-to-english/index.php?q={s}
hlectura	HoraLectura	horalectura.blogspot.com/search?q={s}
hockeydb	hockeydb.com	www.hockeydb.com/ihdb/stats/findplayer.php?full_name={s}
hollbarr	Holland and Barrett	www.hollandandbarrett.com/search?query={s}&isSearch=true
homebase	Homebase	www.homebase.co.uk/webapp/wcs/stores/servlet/Search?storeId=10151&catalogId=1500001201&langId=110&searchTerms={s}&authToken=
homesnap	Homesnap	www.homesnap.com/search?q={s}
homework	Homework Help For Kids	homeworkhelpforkids.co.uk/?s={s}
honeypot	Project Honey Pot	www.projecthoneypot.org/ip_{s}
hornbach	Hornbach	www.hornbach.de/shop/suche/sortiment/{s}
hottopic	Hot Topic	www.hottopic.com/search?q={s}
hsozkult	H-Soz-Kult	www.hsozkult.de/searching/page?q={s}
html2txt	Html2Txt	www.w3.org/services/html2txt?url={s}
huffpost huffingtonpost	Huffington Post	www.huffingtonpost.com/search?keywords={s}&sortBy=recency&sortOrder=desc
hvnorman	Harvey Norman	www.harveynorman.com.au/catalogsearch/result/?q={s}
iarchive	archive.org	www.archive.org/search.php?query={s}
iasutoya irasutoya	Irasutoya	www.irasutoya.com/search?q={s}
identica	Identi.ca	identi.ca/search/people?q={s}&search=Search
iltapulu	Iltapulu	www.iltapulu.fi/search.php?q={s}
imagenet	ImageNet	www.image-net.org/search?q={s}
indieweb	Indie Web Camp	indieweb.org/wiki/index.php?title=Special:Search&search={s}&go=Go
infogram	Infogram	infogr.am/search#{s}
infoseek	Rakuten Infoseek	websearch.rakuten.co.jp/Web?qt={s}
integral	WolframAlpha integration	www.wolframalpha.com/input/?i=integral+{s}
ipernity	Ipernity	www.ipernity.com/search/doc?q={s}&w=on
iphonees	Actualidad iPhone	www.actualidadiphone.com/search/{s}
iplookup	theel0ja.info's IPLookup	iplookup.theel0ja.info/?host={s}
ishuffle	IndieShuffle	www.indieshuffle.com/search/songs/{s}
islam21c	Islam21c	www.Islam21c.com/?s={s}
itebooks	IT eBooks	it-ebooks.info/search/?q={s}&type=title
javalibs	Javalibs	javalibs.com/search?q={s}
jetphoto	JetPhotos	www.jetphotos.com/photo/keyword/{s}
joefresh	Joe Fresh	www.joefresh.com/search?text={s}
jpralves	jpralves.net	jpralves.net/search.html?q={s}
jsonlint	JsonLint	jsonlint.com/?json={s}
jssupply	Johnstone Supply	www.johnstonesupply.com/search/go?w={s}
jutarnji	Jutarnji.hr	www.jutarnji.hr/search/?q={s}
kamailio	Kamailio	www.kamailio.org/w/?s={s}
kancolle	Kantai Collection Wiki	kancolle.wikia.com/wiki/Special:Search?search={s}
katacoda	katacoda	katacoda.com/search?q={s}
kchannet	konachan.net	konachan.net/post?tags={s}
kelkoose	Kelkoo Sweden	www.kelkoo.se/sok?sokterm={s}
kenteken	RDW (Dutch governmental traffic agency)	ovi.rdw.nl/default.aspx?kenteken={s}
kicknews	KickNews	www.kicknews.net/news/search?q={s}
kicktraq	Kicktraq	www.kicktraq.com/search/?find={s}
kijijigm	Kijiji Great Montreal	www.kijiji.ca/b-grand-montreal/{s}/k0l80002
kijijiit	kijiji.it	www.kijiji.it/{s}/
kijijiog	Kijiji Ottawa/Gatineau	www.kijiji.ca/b-ottawa-gatineau-area/{s}/k0l1700184?dc=true
kilimall	Kilimall	www.kilimall.co.ke/?act=search&keyword={s}
kimdeyir	Kimdeyir	kimdeyir.com/?s={s}
kindlecn	Amazon Kindle (China)	www.amazon.cn/s?k={s}&i=digital-text
kindlede	Kindle Shop (German)	www.amazon.de/s?k={s}&i=digital-text
kindlees	Kindle Spain	www.amazon.es/s?k={s}&i=digital-text
kindlejp	Amazon Kindle (Japan)	www.amazon.co.jp/s?k={s}&i=digital-text
kindleuk	Amazon UK Kindle	www.amazon.co.uk/s?k={s}&i=digital-text
kitkraft	Kit Kraft	kitkraft.com/search_a.php?q={s}
kochwiki	Koch-Wiki	www.kochwiki.org/w/index.php?search={s}&go=Seite
koherald	The Korea Herald	www.koreaherald.com/search/index.php?q={s}&kr=0
komplett	Komplett	www.komplett.no/search?q={s}
kotakuau	KotakuAus	www.kotaku.com.au/?s={s}
kritiker	Kritiker.se	kritiker.se/sok/?q={s}
kuopassa	Kuopassa.net	kuopassa.net/haku/?q={s}
kuribo64	Kuribo64	kuribo64.net/board/search.php?q={s}&inposts=0
lacuerda	LaCuerda	acordes.lacuerda.net/busca.php?canc=0&exp={s}
lainwiki	SEL wiki	lain.wiki/index.php?search={s}
lapatria	La Patria	lapatria.com/?q={s}
lastampa	La Stampa	www.lastampa.it/ricerca?search={s}
lazadaid	Lazada Indonesia	www.lazada.co.id/catalog/?q={s}
learn-js	learn.javascript.ru	learn.javascript.ru/search?query={s}
learnlol	league of legends summoner school	www.reddit.com/r/summonerschool/search/?q={s}&restrict_sr=1
legowiki	Brickipedia	lego.fandom.com/search?query={s}
lernabit	Lernabit	lernabit.com/search?q={s}
libiiitd	IIITD library	library.iiitd.edu.in/cgi-bin/koha/opac-search.pl?idx=&q={s}
librivox	LibriVox	librivox.org/newcatalog/search.php?title={s}&author=&status=all&action=Search
lidwoord welklidwoord	Welk lidwoord	www.welklidwoord.nl/{s}
lin-nlen	Linguee (NL-EN)	www.linguee.nl/nederlands-engels/search?source=auto&query={s}
listcorp	Listcorp	www.listcorp.com/search?q={s}
literana	Literana	literana.de/?s={s}
livemint	Live Mint	www.livemint.com/Search/Link/Keyword/{s}
lmddgtfy	LMDDGTFY.NET	lmddgtfy.net/?q={s}
lobsters	Lobsters	lobste.rs/search?q={s}
lolchamp	lolalytics	lolalytics.com/ranked/worldwide/current/diamond/plus/champion/{s}
lolnames	LoL Names	lolnames.gg/en/na/{s}/
lolskill	Lolskill	www.lolskill.net/{s}
lookdocs	Looker Documentation	docs.looker.com/#stq={s}&stp=1
losource	LibreOffice Source Code	opengrok.libreoffice.org/search?q={s}&project=core
lovelive	Love Live! Wiki	love-live.wikia.com/wiki/Special:Search?query={s}
loveseat	Loveseat	www.loveseat.com/search/?term={s}
lowongan	Lowongan Kerja Terbaru	www.lowonganterpadu.com/search?q={s}
ls.de-sv	Langenscheid dictionary German-Swedish	de.langenscheidt.com/deutsch-schwedisch/search?term={s}&q_cat=/deutsch-schwedisch/
luadoc51	Lua 5.1 Documentation	www.lua.org/manual/5.1/manual.html#pdf-{s}
luadoc52	Lua 5.2 Documentation	www.lua.org/manual/5.2/manual.html#pdf-{s}
luadoc53	Lua 5.3 Documentation	www.lua.org/manual/5.3/manual.html#pdf-{s}
luaforge	LuaForge	luaforge.net/search/?type_of_search=soft&words={s}&Search=Search
luxflair	Luxflair	www.luxflair.de/search?sSearch={s}
mabiwiki	Mabinogi World Wiki	wiki.mabinogiworld.com/index.php?search={s}
macports	MacPorts	www.macports.org/ports.php?by=name&substr={s}
macworld	Macworld	www.macworld.com/search?query={s}&submit=search
manorama	Manoramaonline	www.manoramaonline.com/search-results.html?q={s}
marisela	Marisela Veludo	mariselaveludo.fashion/?s={s}
martinka	martinka	www.martinka.com/catalogsearch/result/?q={s}
martinus	Martinus	www.martinus.sk/?uMod=list&uTyp=search&uQ={s}
massdrop	Massdrop	drop.com/search/{s}/drops
materiel	materiel.net	www.materiel.net/achat/{s}/
matlabfx	Matlab File Exchange	www.mathworks.com/matlabcentral/fileexchange/?term={s}
mbamblog	Malwarebytes Unpacked	blog.malwarebytes.org/?s={s}
mbartist	MusicBrainz Artists	musicbrainz.org/search?query={s}&type=artist
mbcdstub	MusicBrainz CD Stubs	musicbrainz.org/search?query={s}&type=cdstub
mbeditor	MusicBrainz Editors	musicbrainz.org/search?query={s}&type=editor
mbseries	MusicBrainz series	musicbrainz.org/search?query={s}&type=series
mcatwiki	Monstercat Wiki	monstercat.wikia.com/wiki/Special:Search?query={s}
mcwikide	German Minecraft Wiki	de.minecraftwiki.net/index.php?title=Spezial:Suche&search={s}
mcwikifr	Minecraft Wiki FR	fr.minecraft.wiki/?search={s}
mcwikizh	Minecraft Wiki (Chinese)	zh.minecraft.wiki/?search={s}
mediatum	mediaTUM	mediatum.ub.tum.de/?query={s}
medimops	Medimops	www.medimops.de/produkte-C0/?fcIsSearch=1&searchparam={s}
medscape emedicine	Medscape Reference	search.medscape.com/reference-search?newSearchHeader=1&queryText={s}
megatenw megamitensei	Megami Tensei Wiki	megatenwiki.com/index.php?search={s}&title=Special%3ASearch
melopero	Melopero	www.melopero.com/?s={s}&post_type=product
mendeley	Mendeley	www.mendeley.com/research-papers/search/?query={s}
mendesah	MediaMarkt DE	www.mediamarkt.de/de/search.html?query={s}
metappcg	Meta Programming Problems & Code Golf	codegolf.meta.stackexchange.com/search?q={s}
meteorjs	Meteor Docs	docs.meteor.com/#/full/{s}
michaels	Michaels Stores	www.michaels.com/search?q={s}
miitopia	Miitopia WIki	miitopia.wikia.com/wiki/{s}
military	The Military Channel	www.military-stuff.org/?s={s}
millersv	Millersville University	www.millersville.edu/search-results.php?query={s}
miniclip minigame	Miniclip	www.miniclip.com/games/en/search.php?query={s}
minimins	MiniMins	www.minimins.com/index.php?search/search&keywords={s}:
mirabile	Mirabile: Digital Archives for Medieval Culture	www.mirabileweb.it/search/results;fulltext={s}
mistborn	Mistborn Wiki	mistborn.wikia.com/wiki/Special:Search?search={s}
mobafire	MobaFire LOL Strategy	www.mobafire.com//?q={s}:
mobythes	Moby Thesaurus	www.moby-thesaurus.org/search?q={s}
modcloth	ModCloth	www.modcloth.com/shop/search?keyword={s}
mofakult	Mofakult	www.mofakult.ch/catalogsearch/result/?q={s}
mojposao	MojPosao	www.moj-posao.net/Pretraga-Poslova/?keyword={s}&area=&category=
movieweb	Movie Web	www.movieweb.com/search?search={s}
mrporter	Mr. Porter	www.mrporter.com/mens/search?keywords={s}
msammler	Musik-Sammler	www.musik-sammler.de/search/{s}/
msdotnet	.NET Docs	docs.microsoft.com/en-us/search/index?search={s}&scope=.NET
msupdate	Microsoft Update Catalog	www.catalog.update.microsoft.com/Search.aspx?q={s}
mtforums	Minetest Forums	forum.minetest.net/search.php?keywords={s}
mugshots	Mugshots.com	mugshots.com/search.html?q={s}
mungfali	Mungfali	mungfali.com/explore.php?q={s}
muralpsi	Mural psicologia	muralpsicologia.com.br/eventos/pesquisa?s={s}
musicmap	music-map	www.music-map.com/{s}
muylinux	MuyLinux	www.muylinux.com/?s={s}
nakedsec	Naked Security (by Sophos)	nakedsecurity.sophos.com/?s={s}
nautilus	Nautil.us	nautil.us/search/{s}
ndeutsch	Neues Deutschland	www.neues-deutschland.de/suche/index.php?and={s}&s0_d=00&s0_m=00&s0_y=0000&s1_d=00&s1_m=00&s1_y=0000&modus=2&sort=1&searchfields[]=0&searchfields[]=1&searchfields[]=2&searchfields[]=3&searchfields[]=4&display=1&search=Suchen
netbible	netbible	netbible.org/bible/search?q={s}
netcraft	Netcraft	toolbar.netcraft.com/site_report?url={s}
netolink	Netolink	netolink.com/?s={s}
netonnet	NetOnNet	www.netonnet.no/Search?query={s}
newhomes	New Home Source	www.newhomesource.com/locationhandler?searchtext={s}
newstapa	Newstapa	newstapa.org/?s={s}
newsweek	Newsweek	www.newsweek.com/search/site/{s}
nexpress	NExpress Catalog	catalog.nexpresslibrary.org/cgi-bin/koha/opac-search.pl?q={s}
ngramsde	Google Ngram Viewer (German)	books.google.com/ngrams/graph?content={s}&year_start=1800&year_end=2000&corpus=20&smoothing=3
nicegear	nicegear	nicegear.co.nz/search/?q={s}
nightbot	Nightbot Commands	nightbot.tv/t/{s}/commands
nintendo	Nintendo	www.nintendo.com/search/#category=all&page=1&query={s}
nixcraft	Nix Craft	www.cyberciti.biz/faq/?s={s}
njuskalo	Njuskalo.hr	www.njuskalo.hr/?ctl=search_ads&keywords={s}
nlverbix	Verbix (Dutch)	www.verbix.com/webverbix/go.php?D1=24&T1={s}
noverbix	Verbix (Norwegian)	www.verbix.com/webverbix/go.php?D1=25&T1={s}
nsissues	NSIndex	nsindex.net/w/index.php?search={s}
nullbyte	Null Byte	null-byte.wonderhowto.com/search/{s}
numerama	Numerama	www.numerama.com/magazine/recherche/1/{s}/date
nusearch	NUsearch	nusearch.nottingham.ac.uk/primo_library/libweb/action/search.do?dscnt=0&scp.scps=scope:(UNUK),scope:(unuk_pda_ebl)&frbg=&tab=default_tab&dstmp=1430162925299&srt=rank&ct=search&mode=Basic&dum=true&indx=1&tb=t&vl(freeText0)={s}&fn=search&vid=UNUK
obspydev	Obspy documentation of development version	docs.obspy.org/master/search.html?q={s}
oeticket	oeticket	www.oeticket.com/Tickets.html?affiliate=EOE&fun=search&fuzzy=yes&doc=search&action=grouped&inline=false&suchbegriff={s}
oglasnik	Oglasnik	www.oglasnik.hr/search?q={s}&category_id=
ohmygear	OhMyGear	ohmygear.net/en/search/{s}
okcaller	okcaller.com	www.okcaller.com/detail.php?number={s}
olibtext	Open Library (Full Text Search)	openlibrary.org/search/inside?q={s}
olivetti	Dizionario Italiano Olivetti	www.dizionario-italiano.it/dizionario-italiano.php?parola={s}
ondarock	OndaRock	www.ondarock.it/websearch.php?q={s}
onedrive	OneDrive	onedrive.live.com/#qt=search&q={s}
onelookr	OneLook Reverse	onelook.com/?w=*&loc=revfp2&clue={s}
onepiece	One Piece Wiki	onepiece.wikia.com/wiki/Special:Search?search={s}
onzetaal	Genootschap Onze Taal	onzetaal.nl/zoekresultaten/?q={s}
opencomp	OpenCompanies	www.opencompanies.nl/zoekresultaten?q={s}
openings	Openings.moe	openings.moe/list/?s={s}
openparl	openparliament.ca	openparliament.ca/search/?q={s}
openrent	OpenRent	www.openrent.co.uk/properties-to-rent/{s}
openrice	OpenRice	www.openrice.com/zh/hongkong/restaurant/sr1.htm?tc=sr1quick&s=1&region=0&inputstrwhat={s}&inputstrwhere=
openstax	OpenStax	cnx.org/search?q={s}
operaext	Opera Extensions	addons.opera.com/addons/extensions/?query={s}&order=new&top=0
ordbogen	Ordbogen	www.ordbogen.com/opslag.php?word={s}&dict=auto
oriantnu	Oria NTNU	bibsys-almaprimo.hosted.exlibrisgroup.com/primo-explore/search?query=any,contains,{s}&tab=default_tab&search_scope=default_scope&vid=NTNU_UB&lang=no_NO&offset=0
ostadium	OStadium	ostadium.com/search?q={s}
osxdaily	Osxdaily	osxdaily.com/gsearch/?q={s}
outclock	Forum Outclock	www.outclock.org/index.php?searchword={s}&searchphrase=all&Itemid=548&option=com_search
outletpc	Outlet PC	www.outlet-pc.es/?q={s}:
owmaster	OverWatchMaster	masteroverwatch.com/search/{s}
paloalto	Palo Alto Networks Documentation	www.paloaltonetworks.com/documentation/document-search.html?q={s}
panideas	The Ideas Kitchen	www.theideaskitchen.co.uk/search/-{s}
pasetrad	Pasetrad	www.pasetrad.com/search-engine.html?#gsc.tab=0&gsc.q={s}&gsc.sort==
passmark	passmark.com	www.passmark.com/search/zoomsearch.php?zoom_query={s}&search=Search
pastebin	pastebin	pastebin.com/search?q={s}
payscale	Payscale	www.payscale.com/rcsearch.aspx?category=&str={s}&CountryName=United+States&SourceId=/research/US/Country=United_States/Salary
pdict.cc	Pocket dict.cc	pocket.dict.cc/?s={s}
pdqtopen	ProQuest Dissertations & Theses Open	pqdtopen.proquest.com/results.html?QryTxt={s}
pedigree	Pedigree Database	www.pedigreedatabase.com/search.html?q={s}
peppernl	Pepper NL	nl.pepper.com/search?q={s}
petitweb	Petit Web	www.petitweb.fr/?s={s}
petsmart	PetSmart	www.petsmart.com/search/?q={s}
pfonline	Pathfinders Online	www.pathfindersonline.org/component/search/?searchword={s}&ordering=newest&searchphrase=all
phoronix	Phoronix	www.phoronix.com/scan.php?page=search&q={s}
photopin	PhotoPin	photopin.com/search/{s}
picolisp	picolisp.com	picolisp.com/wiki/?home&*Search={s}
planplus	Digitalna mapa Srbije	www.planplus.rs/#!pretraga/{s}
playasia	Play-asia	www.play-asia.com/paOS-19-71-99-15-{s}.html
playterm	PlayTerm	www.playterm.org/s/?tags={s}
pleiades	Pleiades	pleiades.stoa.org/search?SearchableText={s}&portal_type=Place&submit=Search
podcloud	podCloud	podcloud.fr/search?q={s}
politico	Politico	www.politico.com/search?q={s}
pomagalo	pomagalo.com	search.pomagalo.com/?keywords_id=&keywords={s}
ponsdepl	Pons German-Polish	en.pons.com/translate?q={s}&l=depl&in=&lf=de
ponsderu	PONS Deutsch-Russisch	en.pons.com/translate?q={s}&l=deru&in=&lf=de&cid=
ponsensl	Pons en->sl	en.pons.com/translate?q={s}&l=ensl&in=en&lf=en
ponsplen	Pons PL-EN	en.pons.com/translate?q={s}&l=enpl&in=&lf=en
portal12	portal12.bg	portal12.bg/search?q={s}
postnord	Postnord	www.postnord.no/minside/SOPS/{s}
pragprog	The Pragmatic Bookshelf	pragprog.com/search?q={s}
preloved	Preloved	preloved.com/?q={s}
pricerun	Pricerunner	www.pricerunner.dk/results?q={s}
primrose	Primrose	www.primrose.co.uk/search.mvc?search_term={s}
progress	Progress	knowledgebase.progress.com/pkb_Home?q={s}
progrock progarchives	Prog Archives	www.progarchives.com/google-search-results.asp?q={s}
promobit	Promobit	www.promobit.com.br/buscar?q={s}
psprices	PSPrices	psprices.com/search/?q={s}
pubgwiki	PLAYERUNKNOWN'S BATTLEGROUNDS Wiki	pubg.wiki.gg/index.php?search={s}
puredata	Pure Data	puredata.info/search?SearchableText={s}
python26	Python2.6 Docs	docs.python.org/2.6/search.html?q={s}&check_keywords=yes&area=default
python27	Python2.7 Docs	docs.python.org/2.7/search.html?q={s}&check_keywords=yes&area=default
python30	Python3.0 Docs	docs.python.org/3.0/search.html?q={s}&check_keywords=yes&area=default
python31	Python3.1 Docs	docs.python.org/3.1/search.html?q={s}&check_keywords=yes&area=default
python32	Python3.2 Docs	docs.python.org/3.2/search.html?q={s}&check_keywords=yes&area=default
qrdecode	ZXing QR decode	zxing.org/w/decode?u={s}
raamattu	Koivuniemen Raamattuhaku	www.koivuniemi.com/raamattuhaku?tila=pikahaku&hakuehto={s}
raiderio	Raider.io	raider.io/search?type=character&name[0][contains]={s}
rakuteng	Rakuten Global Market	global.rakuten.com/en/search/?k={s}
ratgeber	TopRatgeber24	www.topratgeber24.de/suche?s={s}
razzball	Razzball	razzball.com/index.php?s={s}
reactome	Reactome	reactome.org/content/query?q={s}
reckless	Reckless Records	www.reckless.com/index.php?keywords={s}&format=&cond=&store=&is_search=true&srch=Search
redpanda roterpanda	Red Pandazine	redpandazine.com/?s={s}
reelgood	Reelgood	reelgood.com/search?q={s}
regexper	Regexper	regexper.com/#{s}
reichelt	Reichelt	secure.reichelt.de/?ACTION=446;SEARCH={s}
releases	Releases	www.releases.com/search?q={s}
repeater	Repeater Book	www.repeaterbook.com/repeaters/keyword.php?func=result&keyword={s}
repology	Repology	repology.org/projects/?search={s}
revolico	Revolico	www.revolico.com/search.html?q={s}
revzilla	RevZilla	www.revzilla.com/search?query={s}&commit=Search
rightnow	Rightnow Media	www.rightnowmedia.org/Search?q={s}
rijnmond	rijnmond.nl	www.rijnmond.nl/zoeken?query={s}
rknastro	RKN Astrology vastu	rknastrovastu.com/?s={s}
robloxgr	Roblox Communities	www.roblox.com/search/communities?keyword={s}
rockauto	RockAuto	www.rockauto.com/en/partsearch/?partnum={s}
rokomari	rokomari.com	rokomari.com/search?term={s}
roll205e	Roll20 DnD 5e Compendium	roll20.net/compendium/dnd5e/searchbook/?terms={s}
rti51cpp	RTI DDS 5.1 C++ API Search	community.rti.com/rti-doc/510/ndds.5.1.0/doc/html/api_cpp/search.php?query={s}
rti523um	RTI Connext-DDS 5.2.3 User Manual	community.rti.com/static/documentation/connext-dds/5.2.3/doc/manuals/connext_dds/html_files/RTI_ConnextDDS_CoreLibraries_UsersManual/index.htm#search-{s}
rubydocs	RubyDocs	rubydocs.org/d/ruby-latest/?q={s}
rubylane	Ruby Lane	www.rubylane.com/search?q={s}
rustlabs	Rustlabs	rustlabs.com/search={s}
rutronik	Rutronik	www.rutronik24.com/search-result/qs:{s}
rvrental	El Monte RV Rentals	www.elmonterv.com/search/?q={s}
rymgenre	Rate Your Music genre search	rateyourmusic.com/search?searchtype=g&searchterm={s}
samsclub	Sam's Club	www.samsclub.com/sams/search/searchResults.jsp?searchTerm={s}&searchCategoryId=all
sandiego	San Diego - The Official Travel Resource for the San Diego Region	www.sandiego.org/search/site.aspx?q={s}
sanskrit	Spoken Sanskrit Dictionary	spokensanskrit.de/index.php?tinput={s}
sapblogs	SAP Community Blogs	blogs.sap.com/?s={s}
sapnotes	SAP Notes	launchpad.support.sap.com/#/solutions/notes/?q={s}
sapphire	Sapphire	forums.sapphirecommunity.com/search.php?keywords={s}&terms=all&author=&fid[]=4&fid[]=6&sc=1&sf=all&sr=posts&sk=t&sd=d&st=0&ch=800&t=0&submit=Search
saptable saptables	TCodeSearch Tables	www.tcodesearch.com/sap-tables/detail?id={s}
saucenao	SauceNAO	saucenao.com/search.php?db=999&url={s}
savannah	Savannah	savannah.gnu.org/search/?type_of_search=soft&words={s}
scalaapi	Scala Standard Library	www.scala-lang.org/api/current/index.html?search={s}
scoop-it	Scoop.it	www.scoop.it/search?q={s}
scope.dk	scope.dk	www.scope.dk/sogning?sog={s}
scrabble	Scrabble Word Solver	www.scrabblewordsolver.com/word-checker/{s}/
screwfix	Screwfix	www.screwfix.com/search?search={s}
seamless	Seamless	www.seamless.com/search?queryText={s}
searchch	search.ch	www.search.ch/?q={s}&search=Suchen
seatgeek	SeatGeek	seatgeek.com/search/?search={s}
secedgar	SEC Edgar	www.sec.gov/cgi-bin/browse-edgar?CIK={s}&owner=exclude&action=getcompany
seclists	SecLists.org	insecure.org/search.html?q={s}
selfhtml	SELFHTML	de.selfhtml.org/navigation/suche/index.htm?Suchanfrage={s}
sentence	Your Dictionary	sentence.yourdictionary.com/{s}
seriebox	Seriebox	www.seriebox.com/search.php?txt={s}&submit=OK
server24	servershop24	www.servershop24.de/?ActionCall=WebActionArticleSearch&BranchId=0&multishop_id=0&customer_class=9&lang=de&Params[SearchParam]={s}
shironet	Shironet	shironet.mako.co.il/search?q={s}
shirtoid	Shirtoid	shirtoid.com/search/{s}
shitcore	shitcore.org	shitcore.org/search.php?keywords={s}
shopcade	Shopcade	www.shopcade.com/search?query={s}
shopeeph	Shopee	shopee.ph/search?keyword={s}
simpsons	Simpsons Wikia	simpsons.wikia.com/wiki/Special:Search?search={s}
sinonimi	Sinonimi Master	luirig.altervista.org/sinonimi/hypertext/ricerca.php?title={s}
situsali	Situs Ali	situsali.com/?s={s}&submit=Search
skeptoid	Skeptoid	skeptoid.com/search.php?q={s}
skindeep	Skin Deep Cosmetics Database	www.ewg.org/skindeep/search.php?query={s}
skystore	Sky Store	www.skystore.com/search?q={s}
slackdoc	Slackware Documentation Project	docs.slackware.com/start?do=search&id={s}&fulltext=Search
slackpkg	Slackware Package Browser	packages.slackware.com/?search={s}
smartcat	Smartcat	rug.on.worldcat.org/search?databaseList=&queryString={s}
smention	Social Mention	socialmention.com/search?q={s}
smogonbw	Strategy Pokedex Black and White Smogon	www.smogon.com/dex/bw/pokemon/{s}
smogondp	Strategy Pokedex Diamond Perl Smogon	www.smogon.com/dex/dp/pokemon/{s}
smogongs	Strategy Pokedex Gold Silver Smogon	www.smogon.com/dex/gs/pokemon/{s}
smogonrb	Strategy Pokedex Re Blue Smogon	www.smogon.com/dex/rb/pokemon/{s}
smogonsm	Smogon	www.smogon.com/dex/sm/pokemon/{s}/
smogonxy	Smogon X/Y strategydex	www.smogon.com/dex/xy/pokemon/{s}
snapdeal	Snapdeal	www.snapdeal.com/search?keyword={s}
son2teuf	Son2Teuf	son2teuf.org/search/category_sort/Page-1?searchphrase=any&searchword={s}&view=search
songlink	Songlink/Odesli	odesli.co/?q={s}
songtext	Songtexte.com	www.songtexte.com/search?q={s}&c=all
sophoskb sophoscom	Sophos Community	community.sophos.com/search?q={s}
sorocaba	Prefeitura de Sorocaba	www.sorocaba.sp.gov.br/pesquisar/?q={s}
soscrapy	Stack Overflow	stackoverflow.com/search?q={s}[scrapy]
sparkfun	SparkFun	www.sparkfun.com/search/results?term={s}
spattern subtlepatterns	Subtle Patterns	subtlepatterns.com/?q={s}
speakers	Speakers Associates	www.speakersassociates.com/search?search_api_views_fulltext={s}
speedrun	Speedrun.com	speedrun.com/{s}
sphereon	Sphereon	sphereon.com/?s={s}
splatoon	Inkpedia	splatoonwiki.org/w/index.php?search={s}
spriters spritersresource	The Spriters Resource	www.spriters-resource.com/search/?q={s}
squidmag	Squid Mag	squidmag.ink/?s={s}
srcforge sourceforge	SourceForge	sourceforge.net/directory/?q={s}
stackage	Hoogle at Stackage	www.stackage.org/lts/hoogle?q={s}
stargate	Stargate Wiki	stargate.wikia.com/wiki/Special:Search?query={s}
starmade	Official StarMade Wiki	starmadepedia.net/index.php?title=Special:Search&search={s}&go=Go
startech startechus	Startech	www.startech.com/en-us/search?search_term={s}
statista	Statista	www.statista.com/search/?q={s}
stdebook	Standard Ebooks	standardebooks.org/ebooks/?query={s}
steamrep	SteamRep	steamrep.com/?q={s}
steamspy	SteamSpy	steamspy.com/search.php?s={s}
stickpng	StickPNG	www.stickpng.com/search?q={s}
sublevel	Sublevel	sublevel.net/search/?q={s}
substack	Substack	substack.com/search/{s}
suntimes	SunTimes	chicago.suntimes.com/?s={s}
swarajya	Swarajya	swarajyamag.com/search?q={s}
swissbib	swissbib	www.swissbib.ch/Search/Results?lookfor={s}&type=AllFields
symantec	Symantec	www.symantec.com/search?hiddenq=Pedroerkul&q={s}&searchJson={"filter":[],"startPage":1,"start":0,"sort":"score"}
synoniem synoniemen	Synoniemen.net	synoniemen.net/index.php?zoekterm={s}
systemet systembolaget	Systembolaget	www.systembolaget.se/sortiment/?q={s}
takealot	takealot.com	www.takealot.com/all/?qsearch={s}
tapestry	Apache Tapestry	tapestry.apache.org/search.html?q={s}
tapology	Tapology	www.tapology.com/search?term={s}
tastekid	TasteKid	www.tastekid.com/like/{s}
tbaddons	Add-ons for Thunderbird	addons.thunderbird.net/en-US/thunderbird/search/?q={s}
tbbtwiki	The Big Bang Theory Wiki	bigbangtheory.wikia.com/wiki/Special:Search?search={s}&fulltext=Search&ns0=1&ns14=1#
tdcanada	TD Canada Trust	www.tdcanadatrust.com/search/index.jsp?query={s}&language=en&site=td_tdct_tdcb_en
techdirt	TechDirt	www.techdirt.com/search.php?site=&q={s}
techinfo	Tech info easy	techinfoeasy.blogspot.com/search?q={s}
techspot	Techspot	www.techspot.com/search/?q={s}
techtudo	TechTudo	www.techtudo.com.br/busca/?q={s}
techvorm	TechVorm	techvorm.com/?s={s}
tecmundo	Tecmundo	www.tecmundo.com.br/busca?q={s}
tekstowo	Tekstowo	www.tekstowo.pl/szukaj,{s}.html
telefang	Wikifang	wiki.telefang.net/index.php?search={s}
telegram	Telegram.hr	www.telegram.hr/?s={s}
tematimi	Tematimi	www.tematimi.com/ara&search={s}
teradata	Teradata	www.teradata.com/Search?SearchText={s}
termania	Termania	www.termania.net/iskanje?query={s}&SearchIn=All
terraria	Official Terraria Wiki	terraria.wiki.gg/index.php?search={s}
tfdlegal	The Free Dictionary (Legal Dictionary)	legal-dictionary.thefreedictionary.com/{s}
theblaze	TheBlaze	www.theblaze.com/search/?q={s}
thebrick	The Brick	www.thebrick.com/pages/search-results?limit=48&q={s}
thefella	TheFella	thefella.com/search?q={s}
thegreat	Greatness Reinvented	www.thegreat.uk/?s={s}
thislife	This American Life	www.thisamericanlife.org/archive?keyword={s}
thousand	Thousand-Sunny.org	www.thousand-sunny.org/?s={s}
timezone	Time and Date (time zone)	www.timeanddate.com/time/zones/{s}
tinglesa	Tienda Inglesa Uy	www.tiendainglesa.com.uy/busqueda?0,0,{s},0
tinhouse	Tin House	www.tinhouse.com/blog/search_results?q={s}
tipranks	Tip Ranks	www.tipranks.com/stocks/{s}
tjournal	TJ	tjournal.ru/search/{s}
tokmanni	Tokmanni	www.tokmanni.fi/catalogsearch/result/?q={s}
tookapic	tookapic	stock.tookapic.com/search?q={s}
topachat	Topachat	www.topachat.com/pages/recherche.php?mc={s}
toswikia	Tower of Saviors Wikia	towerofsaviors.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
totalcmd	TotalCmd.Net	www.totalcmd.net/search.php?s={s}
training	Training Industry	trainingindustry.com/?s={s}
treccani	treccani	www.treccani.it/vocabolario/tag/{s}
trictrac	Tric Trac	www.trictrac.net/recherche?query={s}
tripwire	Tripwire The State of Security	www.tripwire.com/state-of-security?s={s}
trisquel	Trisquel	trisquel.info/en/search/node/{s}
tumbview	Tumbview	tumbview.com/{s}/grid/
tunearch	Tune Arch: The Traditional Tune Archive	tunearch.org/w/index.php?search={s}
tutanota	Tutanota Mail	mail.tutanota.com/search/mail/LSWThzP--3-1?query={s}
tutsplus	Envato Tuts+	tutsplus.com/tutorials/search?utf8=%E2%9C%93&search[topic]=&search[terms]={s}&button=
tweakers	tweakers.net	tweakers.net/nieuws/zoeken/?keyword={s}
ubiquiti	Ubiquiti Forums	community.ubnt.com/t5/forums/searchpage/tab/message?q={s}
ubuntufr	ubuntu-fr	www.google.fr/search?q={s}+site:ubuntu-fr.org&gws_rd=ssl
unisalib	UniSA Library Catalogue	find.library.unisa.edu.au/discovery/search?query=any,contains,{s}&tab=LIBCOLL&search_scope=MyInst_and_CI&vid=61USOUTHAUS_INST:UNISA&offset=0
unityans	Unity3D answers	unity3d.com/search?refinement=answers&gq={s}
unityast	Unity asset store	www.assetstore.unity3d.com/en/#!/search/page=1/sortby=relevance/query={s}
unseen64	Unseen64	www.unseen64.net/?s={s}
unspider	UN-SPIDER Knowledge Portal	www.un-spider.org/search/apachesolr_search/{s}
uptodown	Uptodown	en.uptodown.com/android/search?query={s}
urlquery	Urlquery	urlquery.net/search.php?q={s}&type=string&max=50
usatoday	USA Today	www.usatoday.com/search/{s}/
utoronto	University of Toronto	find.utoronto.ca/search?proxystylesheet=default_frontend&q={s}
uvafaulk	Faulkner at Virginia	faulkner.lib.virginia.edu/results?type=transcription&q={s}
vagalume	Vagalume	www.vagalume.com.br/search.php?q={s}
vanguard	Vanguard	www.vanguardinvestments.com.au/retail/mvc/searchresults.htm?https://www.vanguardinvestments.com.au/retail/mvc/searchresults.htm=&searchtext={s}
vapetime	Vapetime EC	www.vapetime-ec.com/?s={s}
vecteezy	Vecteezy	www.vecteezy.com/free-vector/{s}
verbixes	Verbix Spanish	www.verbix.com/webverbix/Spanish/{s}.html
verbixpt	Verbix (pt)	www.verbix.com/webverbix/Portuguese/{s}.html
verisure	Verisure	www.verisure.se/hidden/search-results.html?query={s}
verkoper	Controleer verkopergegevens Politie	www.politie.nl/zoek?query={s}
vertalen	vertalen.nu	www.vertalen.nu/vertaal?van=nl&naar=en&vertaal={s}
vidangel	VidAngel	www.vidangel.com/?s={s}
vikipedi	Vikipedi (Turkish Wikipedia)	tr.wikipedia.org/wiki/Special:Search?search={s}
viveport	Viveport	www.viveport.com/list/desktop?keyword={s}
vocaloid	Vocaloid Wiki	vocaloid.wikia.com/wiki/Special:Search?search={s}
vodafone	Vodafone	www.vodafone.com/content/index/search.html?search-query={s}
voiddocs	Void Linux Handbook	docs.voidlinux.org/?search={s}
vtdomain	VirusTotal Domain	www.virustotal.com/gui/domain/{s}
wacotrib	Waco Tribune-Herald	www.wacotrib.com/search/?sd=desc&l=25&s=start_time&f=html&t=article,video,youtube,collection&app=editorial&nsa=eedition&q={s}
waitrose	Waitrose	www.waitrose.com/ecom/shop/search?searchTerm={s}
wallapop	Wallapop	es.wallapop.com/search?keywords={s}
watchkin	Watchkin	watchkin.com/search.php?q={s}
webbkoll	Webbkoll	webbkoll.dataskydd.net/en/results?url={s}
webnovel	Webnovel	www.webnovel.com/search?keywords={s}
webstats	webstatsdomain	www.webstatsdomain.com/?q={s}
websters	Online Dictionary and Translations	www.webster-dictionary.org/definition/{s}
webstore	Webstore	www.webstore.com/search.php?option=basic_search&basic_search={s}&form_basic_search=Search
webxicon	webxicon	webxicon.org/search.php?q={s}
weltbild	www.weltbild.de	www.weltbild.de/suche?q={s}
wetterde	wetter.de	www.wetter.de/suche.html?search={s}
whatruns	whatruns	www.whatruns.com/website/{s}
whiskyde	whisky DE	www.whisky.de/shop/index.php?&cl=search&searchparam={s}
wikiarms	WikiArms	www.wikiarms.com/guns?q={s}
wikichip	WikiChip	en.wikichip.org/w/index.php?search={s}
wikicook	Wiki Cookbook	en.wikibooks.org/wiki/Special:Search?search={s}&prefix=Cookbook:&fulltext=Search+Cookbook&fulltext=Search
wikimoon	WikiMoon	wikimoon.org/index.php?search={s}
wisepick	The Minds Journal	themindsjournal.com/?s={s}
wonkette	Wonkette	www.wonkette.com/search/?q={s}
wordinfo	Word Information	wordinfo.info/results?searchString={s}
wordlift	WordLift	wordlift.io/blog/en/?s={s}
worldcat	WorldCat.org	www.worldcat.org/search?qt=worldcat_org_all&q={s}
wowpedia	Wowpedia	www.wowpedia.org/index.php?title=Special:Search&search={s}
wpthemes	WordPress.org Themes	wordpress.org/extend/themes/search.php?q={s}
wresconj wrspconj	WordReference (esconj)	www.wordreference.com/conj/ESverbs.aspx?v={s}
writconj	WordReference Italian Conjugator	www.wordreference.com/conj/ItVerbs.aspx?v={s}
wtsbooks	Westminster Bookstore	www.wtsbooks.com/index/page/search?FullText={s}
xpresate	Xpresate	xpresate.com.mx/busqueda.php?search={s}
yanswers	Yahoo! Answers	answers.yahoo.com/search/search_result;_ylt=AnPnri0ekBBFsWt64sNbHmvj1KIX;_ylv=3?p={s}&submit-go=Search+Y!+Answers
yellowlu	Yellow.lu	www.yellow.lu/en/yellow-pages/search?location=&query={s}&sort_by=relevance
yellownz	Yellow NZ	yellow.co.nz/yellow+pages/{s}/New+Zealand
ylilauta	ylilauta.org	ylilauta.org/{s}
yogscast	Yogscast Wiki	yogscast.wikia.com/wiki/index.php?search={s}&fulltext=Search
youglish	YouGlish	youglish.com/search/{s}/us
yugiohdb	Yu-Gi-Oh! Card Database	www.db.yugioh-card.com/yugiohdb/card_search.action?ope=1&sess=1&keyword={s}&stype=1&ctype=&starfr=&starto=&atkfr=&atkto=&deffr=&defto=&othercon=1
zaragoza	Ayuntamiento de Zaragoza	www.zaragoza.es/ciudad/servicios/buscar_Web?q={s}
zerochan	Zerochan	www.zerochan.net/search?q={s}
zetawiki	zetawiki	zetawiki.com/w/index.php?search={s}
1001fonts	1001 Fonts	www.1001fonts.com/search.html?search={s}&x=0&y=0
101domain	101domain	www.101domain.com/domain-availability-search.htm?q={s}
11freunde	11 Freunde	www.11freunde.de/search/gss/{s}
4chsearch	4chansearch	4chansearch.com/?q={s}
4x4direct	4x4 Direct	www.4x4direct.co.za/search?controller=search&orderby=position&orderway=desc&search_query={s}&submit_search=
aamulehti	Aamulehti	duckduckgo.com/?sites=www.aamulehti.fi&kh=1&q={s}&ia=web
acurazine	AcuraZine	acurazine.com/forums/search.php?do=showgcs&query={s}
adaderana	AdaDerana	adaderana.lk/search_results.php?mode=1&show=1&query={s}
addicting addicting-games	Addicting Games	www.addictinggames.com/search/games.jsp?gameKeyword={s}
adminwiki	AdminWiki	www.adminwiki.fr/start?do=search&id={s}
aftership	Aftership	track.aftership.com/{s}
aftvhacks	aftvhacks	aftvhacks.de/?s={s}
aifriends	Aikatsu Friends Wikia	aikatsu-friends.wikia.com/wiki/Special:Search?query={s}
airforums	Airforums	airforums.com/?={s}:
airframes	Aircraft Registration Database Lookup	www.airframes.org/reg/{s}
airliners	Airliners.net	www.airliners.net/search?keywords={s}
airsoftdb	Airsoftdb	www.airsoftdb.com/search/?q={s}
aktuality	Aktuality	www.aktuality.sk/vyhladavanie/?q={s}
alipaczka	AliPaczka	alipaczka.pl/?track={s}
allabolag	Alla Bolag	www.allabolag.se/what/{s}
allbibles	Online Parallel Bible	biblez.com/search.php?q={s}
almaanyfa	Almaany persian	www.almaany.com/ar/dict/ar-fa/{s}/
alternate	Alternate	www.alternate.de/html/search.html?searchCriteria={s}
alvanista	Alvanista	alvanista.com/search?s={s}
anandtech	Anandtech	anandtech.com/SearchResults?q={s}
angelajey	Angela Jey	www.angelajey.com/index.php?route=product/search&search={s}
angellist	AngelList	angel.co/search?q={s}
angularjs	Angular JS (1.0) documentation	docs.angularjs.org/?as_q={s}
anisearch	aniSearch	www.anisearch.com/search?q={s}
apcentral	AP Central College Board	apstudent.collegeboard.org/search?searchq={s}&searchType=aps_site&tp=aps_site
appengine	App Engine Docs	code.google.com/query/#p=appengine&q={s}
appsliced	App Sliced	appsliced.co/apps?search={s}
aptbrowse	Apt-Browse	www.apt-browse.org/search/?query={s}
arcgisres	ArcGIS Resource Center	resources.arcgis.com/content/search-result?searchKeyWord={s}
archdaily	ArchDaily	www.archdaily.com/search/all?q={s}
archiplus	Archipel plus	univtoulouse.summon.serialssolutions.com/search?s.q={s}
archivetv	Internet Archive TV News	archive.org/details/tv?q={s}
archlinux archforums	Arch Linux Forums	bbs.archlinux.org/search.php?action=search&keywords={s}&author=&search_in=0&sort_by=0&sort_dir=DESC&show_as=topics&search=Submit
asianwiki	AsianWiki	asianwiki.com/index.php?title=Special:Search&search={s}&fulltext=Search
askfedora	Ask Fedora	ask.fedoraproject.org/en/questions/scope:all/sort:activity-desc/page:1/query:{s}/
askreddit	/r/AskReddit	www.reddit.com/r/AskReddit/search?q={s}&restrict_sr=on&sort=relevance&t=all
audiblede audible.de	Audible.de	www.audible.de/search?advsearchKeywords={s}
audibleuk	Audible UK	www.audible.co.uk/search/?advsearchKeywords={s}&filterby=field-keywords&x=0&y=0
babylonee	Babylon Translator <en-es>	traductor.babylon-software.com/ingles/a-espanol/{s}
backloggd	Backloggd	backloggd.com/search/games/{s}
bakatsuki	Baka-Tsuki	www.baka-tsuki.org/project/index.php?search={s}
bancodata	Banco Data	bancodata.com.br/busca/?i={s}
barnivore	Barnivore	www.barnivore.com/search?keyword={s}
bartender	Webtender	www.webtender.com/cgi-bin/search?name={s}&show=15&verbose=on
basenotes	Basenotes	www.basenotes.net/fragrancedirectory/?search={s}
battledex	Pokemon Go Hub Battledex	pokemongohub.net/?s={s}
battlenet	Battle.Net	eu.battle.net/en/search?q={s}
beautymnl	Beauty MNL	beautymnl.com/search?utf8=%E2%9C%93&q={s}
belsimpel	Belsimpel	www.belsimpel.nl/zoeken?s={s}
berekenen	BerekenHet	www.berekenhet.nl/zoeken.html?q={s}
berufenet	BERUFENET - Berufsinformationen einfach finden	berufenet.arbeitsagentur.de/berufenet/faces/index?path=null/suchergebnisse&such={s}
bestprice	BestPrice	www.bestprice.gr/search?q={s}
bibliotek	Bibliotek.dk	bibliotek.dk/search/work/{s}
bibsonomy	BibSonomy	www.bibsonomy.org/search/{s}
bigbasket	BigBasket	bigbasket.com/ps/?q={s}
bigfuture	BigFuture	bigfuture.collegeboard.org/sitesearch?searchType=bf_site&tp=bf&q={s}
bilpriser	Bilpriser	www.bilpriser.se/bilvardering?regnr={s}
blablacar	BlaBlaCar	www.blablacar.fr/trajets/vers-{s}
blackbook blackbookmag	BlackBook	www.blackbookmag.com/search/articles#keywords:{s}
blacklist spamcheck	MXToolbox (blacklist)	mxtoolbox.com/SuperTool.aspx?action=blacklist:{s}&run=toolpage
blindekuh	Blindekuh.de	www.blinde-kuh.de/bksearch.cgi?input=bksearchbox+start&query={s}
blueapron	Blue Apron	blueapron.com/?q={s}
bluelight	Bluelight	cse.google.com/cse?cx=009513296995230692334:6ksgwcos37i&q={s}
boulanger	Boulanger	www.boulanger.com/resultats?tr={s}
bratabase	Bratabase	www.bratabase.com/search/?q={s}
bricklink	Bricklink	www.bricklink.com/search.asp?q={s}
brickpart	Brickset (parts)	brickset.com/parts?query={s}
brockhaus	Brockhaus	brockhaus.de/search/?t=enzy&q={s}
brownells	Brownells	www.brownells.com/search/index.htm?k={s}
bukalapak	Bukalapak	www.bukalapak.com/products?utf8=%E2%9C%93&search[keywords]={s}
bullmoose	Bull Moose	www.bullmoose.com/search?q={s}&SC=1
c2csummit	Camp to Camp (summits)	www.camptocamp.org/documents/search?type=summits&q={s}
cafepress	CafePress	www.cafepress.com/+{s}
cagematch	Cagematch - The Internet Wrestling Database	www.cagematch.net/?id=666&search={s}
campusnav	TU Dresden Campus Navigator	navigator.tu-dresden.de/erweitertesuche/{s}
canopener	11foot8.com	11foot8.com/?s={s}
cantodict	CantoDict	www.cantonese.sheik.co.uk/dictionary/search/?searchtype=1&text={s}
cardboard	The Cardboard Connection	www.cardboardconnection.com/search-results?q={s}
carousell	carousell	carousell.com/search/products/?query={s}
cbssports	CBS Sports	www.sportsline.com/info/search?q={s}
ccgrforum	Christ Centered Gamer Forums	www.christcenteredgamer.com/phpBB3/search.php?keywords={s}&submit=Search
cdiscount	Cdiscount	www.cdiscount.com/search/10/{s}.html
cdnfinder	CDNPlanet CDN Finder Tool	www.cdnplanet.com/tools/cdnfinder/#host:{s}
celebrity	Celebrity Magazine	celebrity.tn/?s={s}
cercavino	CercaVino	cercavino.com/cerca?vino={s}
chakrapkg	The Chakra Project Packages	www.chakraos.org/packages/index.php?act=search&subdir=&sortby=date&order=descending&searchpattern={s}
checkhost	Check-host.net	check-host.net/ip-info?host={s}
chemie.de	Chemie.de	www.chemie.de/search/?q={s}
chequeado	Chequeado	chequeado.com/?s={s}
chipoteka	Chipoteka	www.chipoteka.hr/search?q={s}
chordwiki	Chord Wiki	ja.chordwiki.org/search.html?q={s}
cifraclub	Cifra Club	www.cifraclub.com.br/?q={s}
cinemagay	CinemaGay	www.cinemagay.it/ricerca.asp?tipo=0&campo={s}&Submit=Cerca
classicdb	ClassicDB	classicdb.ch/?search={s}
clipstijl	Clipstijl	www.clipstijl.nl/zoeken.php?zoek={s}
closebook	WorldCat	www.worldcat.org/search?qt=worldcat_org_bks&q={s}&fq=dt:bks
cocatalog	Copyright Catalog (title)	cocatalog.loc.gov/cgi-bin/Pwebrecon.cgi?Search_Arg={s}&Search_Code=TALL&CNT=25&HIST=1
collinsge	Collins German to English	www.collinsdictionary.com/dictionary/german-english/{s}
combodeck	ComboDeck	combodeck.net/Query/{s}
comicvine	Comic Vine	www.comicvine.com/search/?q={s}
confranks	Conference Ranks	www.conferenceranks.com/?searchall={s}
conjuguer	Le figaro	leconjugueur.lefigaro.fr/conjugaison/verbe/{s}.html
connectny	Connect NY	www.connectny.info/search/?searchtype=X&SORT=D&searcharg={s}
cptdbwiki	Canadian Public Transit Discussion Board Wiki	cptdb.ca/wiki/index.php?search={s}&title=Special:Search&go=Go
crickhero	CRICKET HERO	crickhero.blogspot.com/search/?q={s}
criticker	Criticker	www.criticker.com/?search={s}&type=films
crossover	CodeWeavers	www.codeweavers.com/compatibility/search/?name={s}&search=app
crossword	WordFun crossword solver	www.wordfun.ca/words/fw?q={s}
crxviewer	Extension Source Viewer	robwu.nl/crxviewer/?crx={s}
csgostats	CSGO-STATS.NET	csgo-stats.net/search?q={s}
csmonitor	CSMonitor	www.csmonitor.com/content/search?SearchText={s}&SearchButton=Search
culibrary	Clemson University Library	libraries.clemson.edu/?s={s}
cultofmac	Cult of Mac	www.cultofmac.com/?s={s}
currclick	CurrClick	www.currclick.com/browse.php?keywords={s}
cyberport	Cyberport	www.cyberport.de/?EVENT=itemsearch&query={s}
dailymail	Daily Mail Online	www.dailymail.co.uk/home/search.html?sel=site&searchPhrase={s}
darkhorse	Dark Horse Comics	www.darkhorse.com/Search/{s}
datagovau	Australia Government Datasets	data.gov.au/dataset?q={s}
dbrartist	Danbooru Artists	danbooru.donmai.us/artists?commit=Search&search[any_name_matches]={s}&search[order]=created_at&utf8=%E2%9C%93
ddg-month	DuckDuckGo (past month)	duckduckgo.com/?q={s}&df=m
dealagora	DealAgora	www.dealagora.com/recherche?q={s}
debbuildd	Debian Package Auto-Building	buildd.debian.org/status/package.php?p={s}
debenhams	Debenhams	www.debenhams.com/search/{s}
decathlon	Decathlon	www.decathlon.co.uk/Buy/{s}
deeplenpt	DeepL en-pt	www.deepl.com/translator#de/pt/{s}
deeplpten	DeepL pt-en	www.deepl.com/translator#pt/en/{s}
deltarune	Deltarune Wiki	deltarune.wiki/index.php?search={s}&title=Special:Search
dewikihow	de.wikihow.com	de.wikihow.com/Special:GoogSearch?ie=UTF-8&q={s}&sa=Suche
dexonline	Dexonline	dexonline.ro/definitie/{s}
dictleode	Leo Translation EN<->DE	dict.leo.org/ende?cmpType=relaxed&search={s}
diepresse	Die Presse	diepresse.com/user/search.do?resetForm=1&resultsPage=0&searchText={s}&x=0&y=0
discourse	Discourse Meta	meta.discourse.org/search?q={s}
discovery	Discovery.com	dsc.discovery.com/search.htm?terms={s}
discworld pratchett	Terry Pratchett Wiki	wiki.lspace.org/index.php?search={s}&title=Special%3ASearch
dogechain	DogeChain	dogechain.info/address/{s}
dopeclics	Dopeclics	www.dopeclics.com/search?q={s}
drugs.com	Drugs.com	www.drugs.com/search.php?searchterm={s}
dutchnews	Dutch News	www.dutchnews.nl/?s={s}&post_type=post
duunitori	Duunitori	duunitori.fi/tyopaikat/?haku={s}
eattender	Eat Tender	eattender.com/recipes/search?q={s}
ebgamesca	EB Games Canada	www.ebgames.ca/SearchResult/QuickSearch?q={s}
economist	The Economist	www.economist.com/search?q={s}
edbpriser	EDBpriser.dk	www.edbpriser.dk/Search/General.aspx?q={s}}
edinburgh	City of Edinburgh Council	www.edinburgh.gov.uk/site/scripts/google_results.php?q={s}
en-sutsis	la sutsis	mw.lojban.org/extensions/ilmentufa/i/en/#sisku/{s}
entireweb	Entireweb	entireweb.com/?q={s}
epicmafia	Epic Mafia Wiki	epicmafia.fandom.com/wiki/Special:Search?query={s}&scope=internal&navigationSearch=true
eplibrary	Evanston Public Library	ccs.polarislibrary.com/polaris/search/searchresults.aspx?ctx=19.1033.0.0.2&type=Keyword&term={s}&by=KW&sort=PD&limit=TOM=*&query=&page=0&searchid=1
eslexicon	Lexicon (Es)	lexicoon.org/es/{s}
espacenet	Espacenet	worldwide.espacenet.com/searchResults?ST=singleline&query={s}&Submit=Search
esvonline	ESVonline	www.esvonline.org/search/{s}/
eurogamer	Eurogamer.net	www.eurogamer.net/search.php?q={s}
europeana	Europeana	europeana.eu/search?query={s}
evesearch	EVE Search	eve-search.com/search/{s}
evillecom	e-ville.com	www.e-ville.com/fi/q/{s}
expert-nl	Expert	www.expert.nl/catalogsearch/result/?q={s}
exploitdb	exploit-db	www.exploit-db.com/search?q={s}
facephoto	Google (facephoto)	www.google.com/search?q="{s}"&tbm=isch&tbs=ic:color,isz:lt,itp:face,isg:to&filter=0&safe=off&pws=0&tbs=rl:0
factbites	Factbites	www.factbites.com/topics/{s}
fancythat	Fancy That	www.shopfancythat.com/search?q={s}
farmaline	FARMALINE	www.farmaline.be/apotheek/zoeken/{s}/
farnellfr	Farnell france	fr.farnell.com/{s}
fatsecret	FatSecret	www.fatsecret.com/calories-nutrition/search?q={s}
feedbooks	Feedbooks	www.feedbooks.com/search?query={s}
fextrads3	Dark Souls 3 wiki	darksouls3.wiki.fextralife.com/{s}
fifthcity	The Fifth City: Fallen London Lore Wikia	thefifthcity.wikia.com/wiki/Special:Search?query={s}
filefacts	Filefacts	www.filefacts.net/search.php?ext={s}
findchips	FindChips	www.findchips.com/avail?part={s}
firstmats	First Mats	www.firstmats.co.uk/search?type=product&q={s}
firstpost	FIRSTPOST	www.firstpost.com/?s={s}
flashback	Flashback	www.flashback.org/sok/{s}
flatmusic	Flat	flat.io/search?q={s}
fontslike	Identifont (similar)	www.identifont.com/find?similar={s}&q=Go
fontspace	FontSpace	www.fontspace.com/search/?q={s}
food2fork	Food2Fork	food2fork.com/top?q={s}
forrester	Forrester	www.forrester.com/search?tmtxt={s}
foxracing	Fox Racing	www.foxracing.com/search?facade=&q={s}&lang=en_US
freqcheck frequencycheck	FrequencyCheck	www.frequencycheck.com/search?s={s}
freshdesk	Freshdesk Support Home	support.freshdesk.com/support/search?term={s}
fsarating	Food Standards Agency - Food Hygiene Ratings	ratings.food.gov.uk/business-search?business-name-search={s}&business_type=-1&country_or_la=all&hygiene_rating=all&range=Equal&hygiene_status=all
fullforms	FullForms	fullforms.com/{s}
gamasutra	Gamasutra	www.gamasutra.com/search/?search_text={s}
gamefront	GameFront	www.gamefront.com/search/files?q={s}
gamekings	Gamekings	www.gamekings.tv/index.php?cat=3&s={s}
gamingbox	The Gamingbox	thegamingbox.pfweb.eu/?s={s}
garbarino	Garbarino	www.garbarino.com/productos?q={s}
gcultinst	Google Cultural Institute	www.google.com/culturalinstitute/browse/{s}
geekbench	Geekbench Browser	browser.geekbench.com/v4/cpu/search?q={s}
geeksided	GeekSided	geeksided.com/?s={s}
geenstijl	Geenstijl	www.geenstijl.nl/fastsearch?query={s}&zoek=zoek
genecards	GeneCards	www.genecards.org/index.php?path=/Search/keyword/{s}
generasia	generasia	www.generasia.com/w/index.php?title=Special:Search&search={s}&go=Go
geography	GeoFact of the Day	geofactoftheday.blogspot.com/search?q={s}
geoiptool	Geo IP Tool	geoiptool.com/fr/?IP={s}
ghananews	GhanaNews.xyz	ghananews.xyz/?s={s}
giantbomb	GiantBomb	www.giantbomb.com/search/?q={s}
gifcities	Gifcities	gifcities.org/?q={s}
gitignore	gitignore.io	www.gitignore.io/api/{s}
glottolog	Glottolog	glottolog.org/glottolog?search={s}
gnomebugs	GNOME Gitlab Issues	gitlab.gnome.org/groups/GNOME/-/issues?search={s}
gnomewiki	GNOME Wiki	wiki.gnome.org/Home?action=fullsearch&context=180&value={s}&titlesearch=Titles
go-search	Go Search	go-search.org/search?q={s}
gocompare	Gocompare.com	www.gocompare.com/searchresults/?q={s}
golfparks	Golfparks Migros	www.golfparks.ch/de/suche?q={s}
goodfeeds	GoodFeeds	goodfeeds.net/search?q={s}
goodreads	GoodReads	www.goodreads.com/search/search?search_type=books&search[query]={s}
google.kr	Google Korea	www.google.co.kr/search?q={s}
goproblog	GoPro Blog	www.goproblog.nl/component/search/?searchword={s}
govimages	US Government Image Search	search.usa.gov/search/images?affiliate=usagov&query={s}
greensdic	Green's Dictionary of Slang	greensdictofslang.com/search/basic?q={s}
gryonline	Gry-Online	www.gry-online.pl/gry/{s}/
guardiana	Guardiana	www.guardiana.net/MDG-Database/Search/?search_value={s}
guidestar	GuideStar	www.guidestar.org/search?q={s}
guildwiki	Guild Wiki	www.guildwiki.org/index.php?title=Special:Search&redirs=0&search={s}&fulltext=Search&ns0=1
gulesider	Gule Sider	www.gulesider.no/?q={s}
gumtreeuk	Gumtree UK	www.gumtree.com/search?search_category=all&q={s}
gumtreeza	Gumtree South Africa	www.gumtree.co.za/s-{s}/v1q0p1
gunbroker	GunBroker	www.gunbroker.com/All/BI.aspx?Keywords={s}
gunengine	GunEngine	www.gunengine.com/guns?q={s}
gutefrage	Gutefrage	www.gutefrage.net/search?query={s}
gutschein	Gutscheine.de	www.gutscheine.de/suche?search={s}
gworkshop	Games Workshop	www.games-workshop.com/searchResults?_dyncharset=UTF-8&_dynSessConf=1497710725317319147&qty=&sorting=&view=&Ntt={s}
gwsonline gwsonlinegh	Ghana Web Solutions	www.ghanawebsolutions.com/search.php?q={s}
hackology	Hackology	blog.drhack.net/?s={s}
halaltube	Halal Tube	www.halaltube.com/?s={s}
halopedia	Halopedia	www.halopedia.org/index.php?search={s}
hannaford	Hannaford	www.hannaford.com/catalog/search.cmd?form_state=searchForm&keyword={s}
hearthpwn	Hearthpwn	www.hearthpwn.com/search?search={s}#t1:cards
heurekask	Heureka.sk	www.heureka.sk/?h[fraze]={s}
hihostels	Hostelling International	www.hihostels.com/search/hostels?q={s}
hitchwiki	Hitchwiki	hitchwiki.org/en/index.php?search={s}&fulltext=Search&title=Special:Search
hobbyking	Hobby King	hobbyking.com/en_us/catalogsearch/result/?q={s}
homestuck	Homestuck.com	www.homestuck.com/search?search={s}
housetrip	HouseTrip	www.housetrip.com/en/search-holiday-apartments/{s}?guests=2
hpsupport	HP Support	www.support.hp.com/us-en/search?q={s}&filter=
huskermax	huskermax	huskermax.com/?q={s}
iberlibro	Iberlibro	www.iberlibro.com/servlet/SearchResults?sts=t&an=&tn=&kn={s}&isbn=
icannwiki	ICANNWiki	icannwiki.org/index.php?search={s}
icarecept	ICA - Recept	www.ica.se/recept/?q={s}
iconbuddy	Iconbuddy	iconbuddy.app/search?q={s}
icstation	icstation.com	www.icstation.com/advanced_search_result.php?keywords={s}&search_in_description=1
ikkepedia	Ikkepedia	ikkepedia.org/wiki/{s}
indiamart	IndiaMART	dir.indiamart.com/cgi/catprdsearch.mp?ss={s}
infoworld	InfoWorld	www.infoworld.com/search/google?query={s}
inkipedia	Inkipedia	splatoonwiki.org/w/index.php?search={s}&go=Go
intercept	The Intercept	theintercept.com/search/?s={s}
investing	investing.com	www.investing.com/search/?q={s}
isrgrajan	Isrg Rajan	www.isrgrajan.com/?s={s}
jbovlaste	Jbovlaste - search the lojban dictionary in any language	jbovlaste.lojban.org/dict/{s}
jbplugins	JetBrains IDE Plugins	plugins.jetbrains.com/search?correctionAllowed=true&search={s}
jedipedia	Jedipedia Wikia	jedipedia.wikia.com/wiki/Spezial:Suche?search={s}&fulltext=Search
jensonusa	JensonUSA	www.jensonusa.com/search?q={s}
jetbrains	Jetbrains	www.jetbrains.com/search/?q={s}
jrdevjobs	Jr.DevJobs	www.jrdevjobs.com/jobs?query={s}
kashipara	Kashipara	www.kashipara.com/search/search.php?search={s}
kaspersky	Kaspersky Lab Technical Support	support.kaspersky.com/search?query={s}
kdnuggets	KDnuggets	www.kdnuggets.com/?s={s}
khinsider	Kingdom Hearts Insider	www.khinsider.com/search?search={s}
kijijiyyc	Kijiji Calgary	www.kijiji.ca/b-calgary/{s}/k0l1700199?dc=true
komputeko	Komputeko	www.komputeko.net/index_eo.php?vorto={s}
kotikokki	Kotikokki	www.kotikokki.net/reseptit/?freeText={s}
kprofiles	KProfiles	kprofiles.com/?s={s}
kprojects	KDE Git Projects	projects.kde.org/search?q={s}&all_words=1&projects=1&submit=Submit
kruizinga	Kruizinga	www.kruizinga.de/search?q={s}
kthplaces	KTH Places	www.kth.se/places/search/?query={s}
kuserbase	KDE Userbase	userbase.kde.org/index.php?search={s}&title=Special:Search
lametayel	https://forum.lametayel.co.il/	forum.lametayel.co.il/index.php?t=search&forum_limiter=0&field=all&search_logic=AND&type=msg&srch={s}&btn_submit=
legoideas	LEGO Ideas	ideas.lego.com/search/global_search/ideas?query={s}
leidenlib	Bibilotheek Universiteit Leiden	www.bibliotheek.universiteitleiden.nl/zoeken?q={s}
lexicanum	Lexicanum	wh40k.lexicanum.com/mediawiki/index.php?title=Special:Search&search={s}
libreflix	Libreflix	www.libreflix.org/busca/{s}
libreture	Libreture	www.libreture.com/search/?q={s}
lifeprint	Lifeprint	cse.google.com/cse?cx=partner-pub-2513564923850231:nzof3qz9abm&ie=ISO-8859-1&q={s}&sa=Search
lingualeo	lingualeo.com	lingualeo.com/ru/glossary/learn/dictionary#{s}
lingueefe	Linguee	www.linguee.de/francais-englisch/search?source=auto&query={s}
linkiesta	Linkiesta	www.linkiesta.it/cerca/{s}
linuxmint	Linux Mint Forums	forums.linuxmint.com/search.php?keywords={s}
listverse	Listverse	listverse.com/search/?q={s}&sa=Search
localtime	Time an Date (local time)	www.timeanddate.com/time/zone/?query={s}
lparchive	Let's Play Archive	lparchive.org/title/{s}#results
lyricsing	Hindi Lyrics	lyricsing.com/search/{s}
macrumors	MacRumors	www.macrumors.com/search/?s={s}
magiskmod	Magisk modules repo	github.com/Magisk-Modules-Repo?&q={s}
mailcatch	mailcatch.com	mailcatch.com/en/temporary-inbox?box={s}
mailchimp	MailChimp	mailchimp.com/search/?q={s}
maltapark	Maltapark	www.maltapark.com/search?c=s1&search={s}
mandarake	Mandarake	ekizo.mandarake.co.jp/shop/en/search.do?action=keyword&doujin=all&searchStrategy=keyword&keyword={s}
mangahigh	Mangahigh	www.mangahigh.com/browse/?q={s}
mangarock	mangarock	mangarock.com/search?q={s}
manutanbe	Manutan Belgium	www.manutan.be/SearchDisplay?storeId=11706&sType=SimpleSearch&searchTerm={s}
manutanch	Manutan Switzerland	www.manutan.ch/SearchDisplay?storeId=11705&sType=SimpleSearch&searchTerm={s}
manutancz	Manutan Czech Republic	www.manutan.cz/SearchDisplay?storeId=11716&sType=SimpleSearch&searchTerm={s}
manutanes	Manutan Spain	www.manutan.es/SearchDisplay?storeId=11704&sType=SimpleSearch&searchTerm={s}
manutanfr	Manutan France	www.manutan.fr/earchDisplay?storeId=11701&sType=SimpleSearch&searchTerm={s}
manutanhu	Manutan Hungary	www.manutan.hu/SearchDisplay?storeId=11717&sType=SimpleSearch&searchTerm={s}
manutanit	Manutan Italy	www.manutan.it/SearchDisplay?storeId=11702&sType=SimpleSearch&searchTerm={s}
manutannl	Manutan Netherlands	www.manutan.nl/SearchDisplay?storeId=11708&sType=SimpleSearch&searchTerm={s}
manutanpl	Manutan Poland	www.manutan.pl/SearchDisplay?storeId=11718&sType=SimpleSearch&searchTerm={s}
manutanpt	Manutan Portugal	www.manutan.pt/SearchDisplay?storeId=11703&sType=SimpleSearch&searchTerm={s}
manutansk	Manutan Slovakia	www.manutan.sk/SearchDisplay?storeId=11719&sType=SimpleSearch&searchTerm={s}
manutanuk	Manutan United Kingdom	www.manutan.co.uk/SearchDisplay?storeId=11709&sType=SimpleSearch&searchTerm={s}
mathisfun	Math is fun	www.mathsisfun.com/sphider/search.php?query={s}&submit=&search=1
matlabans	MATLAB Answers	es.mathworks.com/matlabcentral/answers/?term={s}
mcgilllib	McGill University Library	mcgill.worldcat.org/search?q={s}&qt=owc_search&scope=2
mdplugins mrplugins	Modrinth (Plugins)	modrinth.com/plugins?q={s}
mdproject mrproject	Modrinth (Project by slug)	modrinth.com/project/{s}
mdshaders mrshaders	Modrinth (Shaders)	modrinth.com/shaders?q={s}
mediadico	Mediadico	mediadico.com/dictionnaire/definition/{s}
mediainfo	media.info	media.info/search?s={s}
mediapart	Mediapart	www.mediapart.fr/search?search_word={s}
mediawiki	MediaWiki	www.mediawiki.org/w/index.php?search={s}
megalodon	megalodon jp	megalodon.jp/?url={s}
meligrana	meligrana.com	www.meligrana.com/es/alojamiento-turismo/buscar-alojamiento.asp?q={s}
mercarijp	mercari JP	www.mercari.com/jp/search/?keyword={s}
messeinfo	Eglise info	egliseinfo.catholique.fr/horaires/{s}
metaculus	Metaculus	www.metaculus.com/questions/?search={s}
metageren	MetaGer English	metager.de/meta/cgi-bin/meta.ger1?ui=en&lang=en&wikiboost=on&QuickTips=off&langfilter=yes&eingabe={s}&mm=and&time=1&exalead=on&fastbot=on&yacy=on&nebel=on&atsearch=on&acoon=on&overture=on&base=on&yandex=on&onenewspage=on&dmozint=on
meteociel	Meteociel	www.meteociel.fr/prevville.php?action=getville&ville={s}
meucrespo	MeuCrespo	meucrespo.com.br/?s={s}
mightyape	Mighty Ape	www.mightyape.co.nz/search/?i=All&prev=&s={s}&SearchButton=Search
migros_de migros_fr migros_it	Migros (DE)	search.migros.ch/de/q:{s}
mijnserie	MijnSerie	www.mijnserie.nl/zoeken/?search={s}
mimovrste	Mimovrste	www.mimovrste.com/iskanje?s={s}
miniology	Miniology	miniology.com/?s={s}&submit=Search
mmlafleur	MM.LaFleur	mmlafleur.com/shop/catalogsearch/result/?q={s}
mobygames	Moby Games	www.mobygames.com/search/quick?q={s}&x=0&y=0
moneyland	moneyland.ch	www.moneyland.ch/search?q={s}
monolecte	Le Monolecte	blog.monolecte.fr/?s={s}
monoprice	Monoprice	www.monoprice.com/products/search.asp?keyword={s}
moshville	The Moshville Times	www.moshville.co.uk//?s={s}
moviechat	MovieChat	moviechat.org/search?name={s}
moviefone	Moviefone	www.moviefone.com/search/{s}/
mscdirect	MSC Direct	www.mscdirect.com/browse/?searchterm={s}
msmalware	MS Malware Encyclopedia	www.microsoft.com/security/portal/Threat/Encyclopedia/Search.aspx?query={s}
multcolib	Multnomah County Library	multcolib.org/search/site/{s}
multitron	multitronic	www.multitronic.fi/en/search/results#lang=en&c=search&keywords={s}
musescore	MuseScore.com	musescore.com/sheetmusic?text={s}
musimundo	Musimundo	www.musimundo.com/Busqueda?cbrand=0&title=0&artist=0&categories=&search={s}&typeGrid=grid
musipedia	Musipedia	www.musipedia.org/result.html?tx_mpsearch_pi1[pc]={s}&tx_mpsearch_pi1[submit_button]=Search
muzikersk	Muziker.sk	www.muziker.sk/search?q={s}
mygovscot	mygov.scot	www.mygov.scot/search?q={s}&cat=sitesearch
myvidster	MyVidster	www.myvidster.com/search/?q={s}
nautiljon	Nautiljon	www.nautiljon.com/search.php?q={s}
needsnest	Needs Nest	www.needsnest.com/search/?search_keywords={s}
nerdstore	Nerd Store	www.nerdstore.com.br/{s}
netbsdman	NetBSD Manual Pages	man.netbsd.org/man/{s}
newscomau	News.com.au	search.news.com.au/search?us=ndmnews&as=NEWS&q={s}
newyorker	The New Yorker	www.newyorker.com/search/q/{s}
nixcourse	Nix Discourse	discourse.nixos.org/search?q={s}
nominatim	OpenStreetMap Nominatim	nominatim.openstreetmap.org/search?q={s}
nordstrom	Nordstrom	shop.nordstrom.com/sr?origin=keywordsearch&keyword={s}
noslivres	NosLivres	noslivres.net/?r={s}
npmtrends	NPM Trends	www.npmtrends.com/{s}
nusagates	Nusagates Institute	nusagates.com/?s={s}
occuprint	Occuprint	occuprint.org/?action=search&q={s}
openfreax	Open-Freax	open-freax.fr/?s={s}
openhours	OpenHours Denmark	openhours.dk/spots?utf8=%E2%9C%93&q={s}
openradar	OpenRadar	openradar.appspot.com/search?query={s}
openrepos	OpenRepos	openrepos.net/search/node/{s}
overstock	Overstock	www.overstock.com/search?keywords={s}
overwatch	Overwatch Wiki	overwatch.wikia.com/wiki/Special:Search?search={s}&fulltext=Search&ns0=1&ns14=1#
oxfordref	Oxford Reference	www.oxfordreference.com/search?siteToSearch=aup&q={s}
ozstoners	OZ Stoners	cannabis.community.forums.ozstoners.com/index.php?search_term={s}&search_app=forums
pagespeed	Google PageSpeed insights	developers.google.com/speed/pagespeed/insights/?url={s}
paleoleap	Paleo Leap	paleoleap.com/?s={s}
papersera	Il Forum del Papersera	www.papersera.net/cgi-bin/yabb/YaBB.cgi{s}
paradigit	Paradigit	www.paradigit.nl/zoekresultaten/?tn_q={s}
paytmmall	PaytmMall	paytmmall.com/shop/search?q={s}&from=organic&child_site_id=6&site_id=2&brand=16051
pcmasters	PCMasters.de	www.pcmasters.de/suche?search_keywords={s}
pdpreddit	PewDiePieSubmissions	www.reddit.com/r/PewdiepieSubmissions/search?q={s}&restrict_sr=1
peeringdb	PeeringDB	www.peeringdb.com/search?q={s}
pennbooks	UPENN: The Online Books Page	onlinebooks.library.upenn.edu/webbin/book/search?author=&amode=words&title={s}&tmode=words&c=x
perlmonks	PerlMonks.org	www.perlmonks.org/?node={s}
pewdiepie	PewDiePie	www.youtube.com/user/PewDiePie/search?query={s}
philenews	Philenews	www.philenews.com/search?kw={s}
philibert	Philibert	www.philibertnet.com/fr/recherche?orderby=position&orderway=desc&search_query={s}&submit_search=C'est+parti+!
phonemore	PhoneMore	www.phonemore.com/search/?q={s}
photodune	PhotoDune	photodune.net/search?utf8=%E2%9C%93&term={s}
pietsmiet	PietSmiet	www.pietsmiet.de/search?query={s}
pikipedia	Pikipedia	www.pikminwiki.com/index.php?title=Special:Search&search={s}&go=Go
pinterest	pinterest.com/	pinterest.com/search/?q={s}
planetkey	PlanetKey	www.planetkey.de/suche/?s={s}
playright	Play:Right	www.playright.dk/playright/soeg?_submit=1&_soeg=0&soeg={s}
pluggedin	Plugged In	www.pluggedin.com/search/?q={s}&i=titles&p=0&l=20&c={}
pluscodes	Plus Codes	plus.codes/{s}
pokepedia	Pokepedia	www.pokepedia.fr/index.php?title=Special:Recherche&search={s}
politiken	Politiken.dk	politiken.dk/search/?q={s}
poromagia	Poromagia	poromagia.com/fi/search/?q={s}
posterspy	PosterSpy	posterspy.com/posters/?s={s}&post_type=poster
postillon	Der Postillon	www.der-postillon.com/search?q={s}
potafocal	Pota Focal	www.potafocal.com/?s={s}
predictit	PredictIt	www.predictit.org/markets/search?query={s}
prezzybox	Prezzybox	www.prezzybox.com/Search/?s={s}
primeabgb	PrimeABGB	www.primeabgb.com/?s={s}&post_type=product
princeton	Princeton	www.princeton.edu/main/tools/search/?q={s}&x=0&y=0
proofwiki	ProofWiki	proofwiki.org/w/index.php?title=Special:Search&search={s}
prusahelp	Prusa Help	help.prusa3d.com/search?s={s}
prusashop	Prusa E-shop	www.prusa3d.com/search/?q={s}
purolator	Purolator shipment tracking	eshiponline.purolator.com/ShipOnline/Public/Track/TrackingDetails.aspx?pin={s}
pythondev	Python dev doc	docs.python.org/dev/search.html?q={s}
quantcast	Quantcast	www.quantcast.com/home/site/search/{s}
quickdocs	Quickdocs	quickdocs.org/search?q={s}
railsdock	Rails-Dock	apidock.com/rails/search?query={s}
recipetin	Recipetin Eats	www.recipetineats.com/?s={s}
redbubble	RedBubble	www.redbubble.com/shop/{s}
reelviews	Reelviews	www.reelviews.net/search/{s}
rfclipart	RFclipart	rfclipart.com/search.html?text={s}
riksdagen	Riksdagen.se	www.riksdagen.se/sv/global/sok/?q={s}&st=1
rockethub	RocketHub	rockethub.com/projects?utf8=%E2%9C%93&q={s}
royalroad	Royal Road	www.royalroad.com/fictions/search?title={s}
rpmfusion	RPMFusion Packages	admin.rpmfusion.org/pkgdb/packages/{s}/
rti51java	RTI DDS 5.1 Java API Search	community.rti.com/rti-doc/510/ndds.5.1.0/doc/html/api_java/search.php?query={s}
runescape	Runescape Wiki	runescape.wiki/w/Special:Search?search={s}
saabforum	Saabforum.nl	www.saabforum.nl/search.php?keywords={s}
safariext	Safari Extensions Gallery	apps.apple.com/us/mac/search?term={s}
safebooru	Safebooru	safebooru.org/index.php?page=post&s=list&tags={s}
sailguide	Sailguide	www.sailguide.com/boats?boatname={s}
sandstorm	Sandstorm App Market	apps.sandstorm.io/search?term={s}
scarecrow	Scarecrow Video	www.scarecrow.com/45/search.html?keywords={s}
scheidung	Scheidung.de	www.scheidung.de/suche.html?tx_kesearch_pi1[sword]={s}
seamonkey	Seamonkey Add-on	addons.mozilla.org/en-US/seamonkey/search/?q={s}&cat=all&lver=any&pid=1&sort=&pp=20&lup=&advanced=
searchbug	SearchBug	www.searchbug.com/tools/reverse-phone-lookup.aspx?TYPE=phonerev&TAG=tools&FULLPHONE={s}
seefelder	Seefelder	www.seefelder.net/suche?id=&searchTerm={s}
selectome	Selectome	selectome.unil.ch/cgi-bin/getResult.cgi?query={s}&res_type=auto
sephoraau	Sephora Australia	www.sephora.com.au/search?q={s}
sfxsearch	Sound Effects Search	soundeffectssearch.com/find-a-sound-library/?library={s}
shadertoy	shadertoy.com	www.shadertoy.com/results?query={s}
shopclues	SHOPCLUES	shopclues.com/?q={s}:
shopzilla	Shopzilla	www.shopzilla.com/{s}/search
shoutcast	Shoutcast Streaming Internet Radio	directory.shoutcast.com/Search?query={s}
shroomery	Shroomery	www.shroomery.org/search.php?terms={s}
sindonews	SINDOnews	search.sindonews.com/search?type=artikel&q={s}
sinemalar	Sinemalar	www.sinemalar.com/ara/?type=all&page=1&q={s}
sinonimit	Sinonimi.it	sinonimi.it/{s}
sitepoint	Sitepoint	www.sitepoint.com/?s={s}
siteslike	siteslike	www.siteslike.com/similar/{s}
skelbimai	Skelbimai	www.skelbimai.lt/paieska?q={s}
sketchfab	Sketchfab	sketchfab.com/models?q={s}&sort_by=-likeCount
skinflint	Skinflint	skinflint.co.uk/?fs={s}
skyvector	SkyVector	skyvector.com/search/site/{s}
slovnenya	Slovnenya	slovnenya.com/dictionary/{s}
smashbomb	Smashbomb	smashbomb.com/search?keyword={s}
soccerway	Soccerway	int.soccerway.com/search/?q={s}&module=all
softpedia	Softpedia	www.softpedia.com/dyn-search.php?search_term={s}&x=0&y=0
solidaris	Solidaris	solidaris.be/MonsWP/Pages/recherche.aspx?k={s}
solopress	Solopress	www.solopress.com/search?searchTerm={s}
songfacts	Songfacts	www.songfacts.com/search/songs/{s}
sonnentor	Sonnentor	www.sonnentor.com/de-at/find?q={s}&c=Alle
sounddogs	Sounddogs	www.sounddogs.com/search?keywords={s}
southpark	South Park Studios	www.southparkstudios.com/search?keywords={s}
spacedock	SpaceDock	spacedock.info/search?query={s}
speedyhen	SpeedyHen	www.speedyhen.com/Search/Keyword?keyword={s}
spinrilla	Spinrilla	spinrilla.com/search?q={s}
staplesca	Staples Canada	www.staples.ca/search?query={s}
starbound starbounder	Starbound Wiki	starbounder.org/mediawiki/index.php?title=Special:Search&search={s}
startpage	Startpage	www.startpage.com/do/dsearch?query={s}&cat=web&pl=opensearch
staticice	Static Ice	staticice.com.au/cgi-bin/search.cgi?q={s}
steamgift	Steamgift	www.steamgifts.com/giveaways/search?q={s}
steelcase	Steelcase	www.steelcase.com/?s={s}
stellaris	Stellaris Wiki	stellaris.paradoxwikis.com/index.php?search={s}
storybank	storybank	storybank.id/?s={s}
strumenti	StrumentiMusicali.net	www.strumentimusicali.net/advanced_search_result.php?manufacturers_id=&keywords={s}&inc_subcat=1
sublforum	Sublime Text Forum	forum.sublimetext.com/search?q={s}
submarino	Submarino	www.submarino.com.br/busca?conteudo={s}
svartling	Svartling Network	www.svartling.net/search?q={s}
swagbucks	Swagbucks	swagbucks.com/?q={s}
swisscows	Swisscows	swisscows.com/?query={s}
swtsearch	Sweet Search	www.sweetsearch.com/search?q={s}
synonymes	Synonymes	synonymes.com/resultats.php?mot={s}
systranet	Systranet	www.systranet.com/translate?text={s}
tagfinder	Tagfinder	tagfinder.herokuapp.com/search?query={s}
taginfoch	taginfo Switzerland	taginfo.openstreetmap.ch/search?q={s}
tasteline	Tasteline	www.tasteline.com/ReceptSok/{s}
tcfreview	The Christian Film Review	www.thechristianfilmreview.com/?s={s}
tech2days	Tech2days	tech2days.com/?q={s}:
techified	Techified	techified-news.blogspot.co.uk/{s}uds-search-results
techposts	TechPosts	techposts.org/?s={s}
techradar	TechRadar	www.techradar.com/search?searchTerm={s}
tecnoblog	Tecnoblog	tecnoblog.net/?s={s}
telegraaf	Telegraaf	www.telegraaf.nl/zoeken/{s}
telegraph	Telegraph	www.telegraph.co.uk/search.html?q={s}
teletekst	Teletekst	teletekst-data.nos.nl/webplus?p={s}
telsearch	Schweizer Telefonbuch tel.search.ch	tel.search.ch/{s}
teslarati	Teslarati	www.teslarati.com/?s={s}
thedonald	Reddit r/the_donald	www.reddit.com/r/the_donald/search?q={s}&restrict_sr=on&sort=relevance&t=all
thehdroom	TheHDRoom	www.thehdroom.com/?s={s}
themighty	The Mighty	www.themighty.com/search/?search={s}
theorytab	Theorytab	www.hooktheory.com/theorytab/results?path={s}
thermatru	Therma-tru Doors	www.thermatru.com/search/?q={s}
thesource	The Source	www.thesource.ca/en-ca/search/?text={s}&search_submit=
theyarddr	The Yard Dr	theyarddr.com/?s={s}
thinkwiki	ThinkWiki	www.thinkwiki.org/w/index.php?search={s}&go=Go&title=Special:Search
thoughtco	ThoughtCo	www.thoughtco.com/search?q={s}
tibiawiki	Tibia Wikia	tibia.wikia.com/wiki/Special:Search?query={s}
tikettien	Tiketti (English)	www.tiketti.fi/events#q={s}
tinycards	Tinycards	tinycards.duolingo.com/search?query={s}
tldrlegal	TL;DR Legal	tldrlegal.com/search?q={s}
tophatter	Tophatter	tophatter.com/catalogs/search?utf8=%E2%9C%93&category=&query={s}
toppreise	Toppreise.ch	www.toppreise.ch/index.php?search={s}&res=OK
tracemyip	tracemyip	tools.tracemyip.org/lookup/{s}
trashwiki	TrashWiki	trashwiki.org/w/index.php?search={s}&title=Special:Search
trendstop	TrendsTop	trendstop.knack.be/nl/results.aspx?s1={s}
triviaowl	TriviaOwl	triviaowl.com/?s={s}
truesteam	TrueSteamAchievements	truesteamachievements.com/searchresults.aspx?search={s}
turnstone	Turnstone	myturnstone.com/?s={s}&lang=en
tutorilio	Tutorilio Tech	www.tutorilio.com/?q={s}
twitchpop	Twitch.tv	player.twitch.tv/?volume=0.5&channel={s}
ubergizmo	ubergizmo	www.ubergizmo.com/search/?q={s}
uberspace	Uberspace-Wiki	wiki.uberspace.de/start?do=search&id={s}
ukgovpeti	Petitions UK Government and Parliament	petition.parliament.uk/petitions?q={s}
undertale	Undertale Wiki	undertale.wiki/index.php?search={s}&title=Special:Search
underwear	calida.com	www.calida.com/search/#/q/{s}
unescowhc	UNESCO World Heritage Centre	whc.unesco.org/en/search/?criteria={s}
unshorten	Unshorten.me	unshorten.me/s/{s}
untergang	Linux und Technik	untergang.de/index.php?option=search&searchword={s}
usegalaxy	Galaxy Community Hub	galaxyproject.org/search/?q={s}
userbench	User Benchmark	www.userbenchmark.com/Search?searchTerm={s}
utlibrary	University of Texas in Austin - Library	catalog.lib.utexas.edu/search/?searchtype=X&SORT=D&searcharg={s}&searchscope=29
vancouver	City of Vancouver	vancouver.ca/search.aspx?q={s}&searchEngine=GSA
vapefiend	Vapefiend	vapefiend.co.uk/search?q={s}&type=product
verbixeng	Verbix (English conjugation verb)	www.verbix.com/webverbix/English/{s}r.html
vgcollect	VGCollect	vgcollect.com/search/{s}
videohive	VideoHive	videohive.net/search?utf8=%E2%9C%93&term={s}
videonews	Video News	www.videonews.com/?s={s}
videosift	Videosift	videosift.com/search?q={s}
visuwords	Visuwords	visuwords.com/{s}
vortaronl	vortaro.nl	vortaro.nl/?v={s}
vukajlija	Vukajlija	vukajlija.com/pretraga/izraz?s={s}
walkscore	Walk Score	www.walkscore.com/score/{s}
walmartca	Walmart Canada	www.walmart.ca/search/{s}
warhammer	Total war Warhammer Wiki	totalwarwarhammer.gamepedia.com/index.php?search={s}
wayfairca	Wayfair.ca	www.wayfair.ca/keyword.php?keyword={s}&command=dosearch&new_keyword_search=true
weathergc	Environment Canada Weather Office	weather.gc.ca/city/jump_e.html?city={s}
webhallen	Webhallen	www.webhallen.com/se/search?searchString={s}&sort=searchRating
weheartit	We Heart It	weheartit.com/search?query={s}
wfootball	WorldFootball	www.worldfootball.net/search/?q={s}&kind=1
whitakers	Whitaker's Words English	www.archives.nd.edu/cgi-bin/wordz.pl?english={s}
whois.com	Whois.com	www.whois.com/search.php?query={s}
whoscored	WhoScored	www.whoscored.com/Search/?t={s}
wikibound	WikiBound	wikibound.info/index.php?title=Special:Search&search={s}&fulltext=Search
wikichips	WikiChips	en.wikichip.org/w/index.php?title=Special:Search&search={s}
wikiindex	WikiIndex	wikiindex.org/index.php?search={s}
wikimapia	Wikimapia	www.wikimapia.org/#search={s}
wikiquote	Wikiquote	en.wikiquote.org/w/index.php?search={s}
wikitroid	Wikitroid	metroid.wikia.com/wiki/Special:Search?search={s}
woodbrass	Woodbrass	www.woodbrass.com/advanced_search_result.php?keywords={s}
wordsmyth	Wordsmyth	www.wordsmyth.net/?level=3&ent={s}
wortvogel	Wortvogel	wortvogel.de/?s={s}
wowarmory wowarmoryus	Battle.net	us.battle.net/wow/en/search?q={s}
wowheadde	Wowhead german	de.wowhead.com/search?q={s}
wpplugins	WordPress.org Plugins	wordpress.org/extend/plugins/search.php?q={s}&sort=
xenoblade	Xenoblade Wiki	www.xenoserieswiki.org/w/index.php?search={s}&title=Special%3ASearch
xfce-look	Xfce-Look	www.xfce-look.org/search?projectSearchText={s}
xmostrata	Xmo Strata	xmostrata.com/?s={s}
xmpprooms	Trafficpixel XMPP Rooms	trafficpixel.tk/chatrooms/showRooms.php?search={s}&numberResults=10
yodobashi	Yodobashi.com	www.yodobashi.com/ec/category/index.html?word={s}
yop.email	YopMail.com	www.yopmail.com/en/?login={s}
yourglish	Yourglish	youglish.com/search/{s}?
zalandode	Zalando.de	www.zalando.de/katalog/?q={s}
zemljevid	Zemljevid Najdi.si	zemljevid.najdi.si/search_maps.jsp?q={s}
zerohedge	ZeroHedge	www.zerohedge.com/search/apachesolr_search/{s}
zivefirmy	ZiveFirmy.cz	www.zivefirmy.cz/?q={s}
24sessions	24sessions	24sessions.com/search/text:{s}
7digitalno	7digital (Norway)	no.7digital.com/search?q={s}
abebooksde	AbeBooks.de	www.abebooks.de/servlet/SearchResults?kn={s}&sts=t&x=0&y=0
accountcia	Accountcia	www.accountcia.com/?geodir_search=1&stype=gd_place&sgd_placecategory[]=&s={s}
adlibrisfi	Adlibris FI	www.adlibris.com/fi/haku?q={s}
adlibrisno	Adlibris NO	www.adlibris.com/no/sok?q={s}
airlinehyd	Airline Hydraulics	www.airlinehyd.com/Results.aspx?srh={s}
albumartcd	Albumart (Music)	www.albumart.org/index.php?skey={s}&itempage=1&newsearch=1&searchindex=Music
allerhande	Allerhande	www.ah.nl/allerhande/recepten-zoeken?Ntt={s}
allexperts	All Experts	www.allexperts.com/web?q={s}
alnaturade	Alnatura(DE)	www.alnatura.de/de-de/suche?q={s}
androidpit	AndroidPit	www.androidpit.com/en/android/search?st={s}
ans.splunk	Splunk Answers	answers.splunk.com/search.html?q={s}
ansiblemod	Ansible Module Documentation	docs.ansible.com/ansible/latest/collections/ansible/builtin/{s}_module.html
apolloduck	Apollo Duck	www.apolloduck.com/search.phtml?search={s}&exact=1&sr=1&q=1
appledaily	Apple Daily (Hong Kong)	appledaily.com/?s={s}
appshopper	Appshopper	appshopper.com/search/?search={s}
appstoreuk ukappstore	App Store UK (iPhone)	apps.apple.com/gb/iphone/search?term={s}
archangels	Heavenly Archangels	heavenlyarchangels.wordpress.com/?s={s}
armorgames	armorgames	armorgames.com/search/games?type=games&q={s}
arnzenarms	Arnzen Arms	secure.arnzenarms.com/catalog-search?fulltext={s}
artstation	Artstation	www.artstation.com/search?q={s}&sorting=recent
atomthemes	Atom themes	atom.io/themes/search?q={s}
audubonmag	Audubon Magazine	www.audubonmagazine.org/search/node?keys={s}
awesomecow	Awesome Cow	awesomecow.com/index.php?ieska={s}
backpacker	Backpaker Magazine	www.backpacker.com/search?query={s}
bangpeople	Pipl - Profile Search enguine	pipl.com/search/?q={s}
basesearch	BASE Search	www.base-search.net/Search/Results?lookfor={s}
berlingske	Berlingske	b.dk/search/{s}
bibleatlas	Bible Atlas	biblehub.net/searchatlas.php?q={s}
bibletools	Bible Study Tools	www.biblestudytools.com/search/?q={s}
bio-online	Biology Online	www.biology-online.org/search.php?search={s}
blackwells	Blackwell's	blackwells.co.uk/bookshop/search/?keyword={s}
bleepingpc	Bleeping Computer	www.bleepingcomputer.com/search/?q={s}
blenderapi	Blender API	docs.blender.org/api/current/search.html?q={s}
blockchain	blockchain	blockchain.info/en/search?search={s}
blockchair	Blockchair	blockchair.com/search?q={s}
bloganchoi	BlogAnChoi	bloganchoi.com/?s={s}
bloonswiki	Bloons Wiki	www.bloonswiki.com/index.php?search={s}&title=Special%3ASearch
boingboing	boingboing	www.google.com/cse?cx=partner-pub-2170174688585464:d58nno-rqp8&ie=ISO-8859-1&q={s}&siteurl=www.boingboing.net/
bookbrainz	BookBrainz	bookbrainz.org/search?q={s}
bookfinder	Book Finder	www.bookfinder.com/search/?author=&title={s}&lang=en&submit=Begin+search&new_used=*&destination=us&currency=USD&mode=basic&st=sr&ac=qr
bookflavor	Bookflavor	bookflavor.com/#!{s}
buffalolib	Buffalo & Erie County Public Library	www.buffalolib.org/vufind/Union/Search?lookfor={s}&type=keyword&submit=Find&sort=title
canadapost	Canada Post Tracking	www.canadapost.ca/cpotools/apps/track/personal/findByTrackNumber?trackingNumber={s}&LOCALE=en&LOCALE2=en
casalsport	Casal Sport	www.casalsport.com/SearchDisplay?storeId=13151&sType=SimpleSearch&searchTerm={s}
catawikibe	Catawiki	www.catawiki.be/search?q={s}
cbtnuggets	CBT Nuggets	www.cbtnuggets.com/search?q={s}
chakrawiki	Chakra Wiki	chakraos.org/wiki/index.php?search={s}&go=Go
chemspider	ChemSpider	www.chemspider.com/Search.aspx?q={s}
chessgames	Chess Games	www.chessgames.com/perl/ezsearch.pl?search={s}
chichester	Chichester District Council	www.chichester.gov.uk/article/23353/Search?q={s}
chronopost	Chronopost France	www.chronopost.fr/fr/chrono_suivi_search?lang=fr&listeNumerosLT={s}
cleanfreak	CleanFreak	www.cleanfreak.com/catalogsearch/result/?q={s}
climatempo	Climatempo	www.climatempo.com.br/?q={s}
cloudsdale	Cloudsdale	www.cloudsdale.org/explore/clouds/search?q={s}
clovia.app	Clovia	nightwear.clovia.com/search/?q={s}
cocatalogn	Copyright Catalog (name)	cocatalog.loc.gov/cgi-bin/Pwebrecon.cgi?Search_Arg={s}&Search_Code=NALL&CNT=25&HIST=1
codecanyon	CodeCanyon	codecanyon.net/search?utf8=%E2%9C%93&term={s}
codeforces	Codeforces	codeforces.com/search?query={s}
codepoints	Codepoints	codepoints.net/search?q={s}
codinglove	thecodinglove.com	thecodinglove.com/search/{s}
coffeeshop	GetSmokin'	getsmokin.nl/coffeeshops?shopsearch={s}
coldfusion	ColdFusion Docs	helpx.adobe.com/search.html?q={s}&filters={%22products%22%3A[%22ColdFusion%22]}
colormango	ColorMango	www.colormango.com/search/index.asp?keyword={s}
compumundo	Compumundo	www.compumundo.com.ar/shop?search={s}
continente	Continente	www.continente.pt/stores/continente/pt-pt/public/Pages/searchResults.aspx?k={s}
coopathome	Coop at Home	www.coopathome.ch/search/?text={s}
coppermind	The Coppermind	coppermind.net/wiki/Special:Search?search={s}
couponmeup	CouponMeUp	www.couponmeup.com/cgi-bin/display.pl?search=1&q={s}
crackberry	Crackberry	crackberry.com/search/{s}
creacables	Creative Cables NL	www.creative-cables.nl/zoeken?controller=search&orderby=position&orderway=desc&search_query={s}
cuprinoluk	Cuprinol UK	www.cuprinol.co.uk/servlet/SiteAdvancedSearchHandler?searchtype=all&searchString={s}
dafoodmall	dafoodmall	www.dafoodmall.com/goods/search.asp?sword={s}
dailytimes delcotimes	Delaware County Daily Times	www.delcotimes.com/search?text={s}
dallasnews	The Dallas Morning News	www.dallasnews.com/search?q={s}
danmurphys	Dan Murphy's	www.danmurphys.com.au/search?searchTerm={s}
dansverine	Dansverine	www.dansverine.com/search?q={s}
darklyrics	DarkLyrics.com	www.darklyrics.com/search?q={s}
datavicgov	Victorian Government Datasets	www.data.vic.gov.au/data/dataset?q={s}
ddg-videos	DuckDuckGo Videos	duckduckgo.com/?q={s}&ia=videos&iax=1
debtracker	Debian Package Tracker	tracker.debian.org/search?package_name={s}
definekids	Kids Wordsmyth	kids.wordsmyth.net/we/?ent={s}
delectable	Delectable	delectable.com/search/{s}
deredactie	deredactie.be	deredactie.be/cm/vrtnieuws/1.516538?text={s}&action=submit
dev.splunk	dev.splunk.com	dev.splunk.com/search/dev?q={s}
devonforum	DEVONtechnologies Forum	forum.devontechnologies.com/search.php?keywords={s}
diccionari	Diccionari de la llengua Catalana	www.diccionari.cat/cgi-bin/AppDLC3.exe?APP=CERCADLC&GECART={s}
digitalspy	DigitalSpy	www.digitalspy.com/search/{s}
dimensions	Dimensions	app.dimensions.ai/discover/publication?search_text={s}&search_type=kws&search_field=full_search
disclosetv	Disclose.tv	www.disclose.tv/search/desk?title={s}
disconnect	Disconnect Search	search.disconnect.me/searchTerms/search?query={s}&ses=Google
djpackages	Django Packages	djangopackages.com/search/?q={s}
domainsbot	domainsbot.com	domainsbot.com/?q={s}
dreambible	Dream Bible	www.dreambible.com/search.php?q={s}
drivetribe	Drive Tribe	drivetribe.com/search/{s}
drnerdlove	Dr Nerdlove	www.doctornerdlove.com/?s={s}
drupalcode	drupalcode.org	cgit.drupalcode.org/{s}
earthbound	Earthbound Wiki	wikibound.info/w/index.php?title=Special%3ASearch&search={s}
ecole-club	Ecole-club Migros	www.ecole-club.ch/Cours/recherche@{s}
ecoshopper	ecoshopper.de	www.ecoshopper.de/ecoshopper2/faces/SuchErgebnis.jsp?query={s}&brancheDropDown=alle&preisspanneDropDown=0&_charset_=UTF-8&suchen=Suchen&searchrange=namen
eddiebauer	Eddie Bauer	www.eddiebauer.com/search/a-search.jsp?sTerm={s}
edfeminism	Everyday Feminism	everydayfeminism.com/?s={s}
elgiganten	Elgiganten	www.elgiganten.se/search?SearchTerm={s}
elotrolado	ElOtroLado	www.elotrolado.net/search.php?keywords={s}&type=h
eluniverso	El Universo (Ecuador)	www.eluniverso.com/resultados?search={s}
energystar	Energy Star	essearch.energystar.gov/search?query={s}&affiliate=www.energystar.gov
epicurious	Epicurious	www.epicurious.com/tools/searchresults?search={s}&x=0&y=0
equipboard	Equipboard	equipboard.com/search?search_term={s}
ethnologue	Ethnologue	www.ethnologue.com/search?keys={s}
euronewsen	Euronews English	www.euronews.com/search?query={s}
everyclick	Every Click	www.everyclick.com/search?keyword={s}&filterType=&sortType=&searchArea=web&sbtn=
fairtragen	fairtragen	www.fairtragen.de/advanced_search_result.php?keywords={s}
fanfiction	Fanfiction	www.fanfiction.net/search/?keywords={s}
fedorawiki	Fedora Project	fedoraproject.org/wiki/Special:Search?search={s}&go=Go
filmstarts	Filmstarts	www.filmstarts.de/suche/?q={s}
finnkinoen	Finnkino (en)	www.finnkino.fi/eng/Search/?query={s}
flickchart	Flickchart	www.flickchart.com/SearchResults.aspx?s={s}
flickriver	Flickriver	flickriver.com/search/{s}/
footlocker	Foot Locker	www.footlocker.com/_-_/keyword-{s}
freelancer	freelancer.com	www.freelancer.com/work/{s}/
freepascal	Freepascal	wiki.freepascal.org/index.php?search={s}
freshports	FreshPorts	www.freshports.org/search.php?query={s}&search=go&num=10&stype=name&method=match&deleted=excludedeleted&start=1&casesensitivity=caseinsensitive
fusionfall	FusionFall Wikia	fusionfall.wikia.com/wiki/Special:Search?query={s}
gadgetflow	The Gadget Flow	thegadgetflow.com/?s={s}&submit=Search
gadgetsnow	Gadgets Now	gadgetsnow.indiatimes.com/topic/{s}
gamersgate	GamersGate	gamersgate.com/games?q={s}
gamesradar	GamesRadar	www.gamesradar.com/search/?searchTerm={s}
geekbuying	GeekBuying	www.geekbuying.com/Search/?keyword={s}
geizhalsde	geizhals.de	geizhals.de/?fs={s}&in=
geoawesome	Geoawesomeness	geoawesomeness.com/?s={s}
globaledge	globalEDGE	globaledge.msu.edu/search?q={s}
goldenline	GoldenLine	www.goldenline.pl/szukaj/?q={s}
goodfoodau	Good Food Australia recipes	www.goodfood.com.au/search?text={s}&type=recipe
graphemica	Graphemica	graphemica.com/search?q={s}
greenpeace	Greenpeace	www.greenpeace.org/usa/?s={s}
grokipedia	Grokipedia	grokipedia.com/search?q={s}
guitartabs	GuitarTabsExplorer.com	www.guitartabsexplorer.com/search.php?search={s}
gunwatcher	GunWatcher	gunwatcher.com/Search/{s}
hanzicraft	HanziCraft	www.hanzicraft.com/character/{s}
harvardlib	Harvard University Library	hollis.harvard.edu/primo_library/libweb/action/dlSearch.do?institution=HVD&vid=HVD&tab=everything&displayField=all&search_scope=everything&mode=Basic&onCampus=false&displayMode=full&query=any,contains,{s}
headtalker	HeadTalker	headtalker.com/?s={s}&post_type[]=campaigns
healthable	Healthable	www.healthable.org/?s={s}
heartbleed	Heartbleed Test	filippo.io/Heartbleed/#{s}
heatspring	HeatSpring	www.heatspring.com/app/courses/?query={s}
historious	Historious	historio.us/search/?q={s}
hobbyworks	HobbyWorks	www.hobbyworks.com/index.cfm?action=search&searchText={s}
humblewiki	The Humble Wiki	humble.wikia.com/w/{s}
ibergourfr	ibergour.fr	www.ibergour.fr/fr/search?query={s}
iconsearch	IconSearch	iconsear.ch/?q={s}
imageshack	Image Shack	imageshack.us/photos/{s}
incredible	Incredible Connection	www.incredible.co.za/search/?q={s}
indiemerch	IndieMerchstore	www.indiemerchstore.com/search?q={s}
instapaper	Instapaper	www.instapaper.com/search?q={s}
intersport	Intersport	www.intersport.se/soksida/?q={s}
irishtimes	The Irish Times	www.irishtimes.com/search/search-7.4195619?q={s}
isbnsearch	ISBN Search	isbnsearch.org/search?s={s}
jesuerocha	Jesue Rocha	jesuerocha.com/search/{s}
joofficial	JoOfficial	www.joofficial.com/website/search?query={s}
karmadecay	Karma Decay	karmadecay.com/{s}
karmaplace	KarmaPlace	www.karmaplace.com/catalogsearch/result/?q={s}
kcommunity	KDE Community Wiki	community.kde.org/index.php?title=Special:Search&search={s}
kidsinmind	Kids-In-Mind	www.kids-in-mind.com/cgi-bin/search/search.pl?q={s}
kieskeurig	KIESKEURIG	www.kieskeurig.nl/zoeken/index.html?q={s}
kingarthur	King Arthur Baking	www.kingarthurbaking.com/search?query={s}#all_indices
kinokuniya	Kinokuniya	www.kinokuniya.co.jp/disp/CSfDispListPage_001.jsp?qsd=true&ptk=01&q={s}&SEARCH.x=0&SEARCH.y=0
kitapyurdu	Kitapyurdu	www.kitapyurdu.com/index.php?route=product/search&filter_name={s}
klubschule	Klubschule Migros	www.klubschule.ch/Kurse/suche@{s}
koopjedeal	koopjedeal	www.koopjedeal.nl/catalogsearch/result/?q={s}
kooponline	Koop Online	www.kooponline.com/search.php?q={s}
krebsonsec	Krebs on Security	krebsonsecurity.com/?s={s}&x=0&y=0
kubapichci	Kuba Pichci	www.kuba-pichci.pl/?s={s}
kulinarian	kulinarian	www.kulinarian.com/recipe/search?q={s}
laopinione	LaOpinione.com	laopinione.com/?s={s}
lcuerdanet	La Cuerda.net	acordes.lacuerda.net/busca.php?exp={s}
leisurepro	LeisurePro	www.leisurepro.com/search?searchinfo={s}
letssingit	Letssingit	search.letssingit.com/?s={s}&a=search&l=archive
lexisnexis	LexisNexis Australia	www.lexisnexis.com.au/en/global-pages/search?query={s}
libadwaita	libadwaita Documentation	gnome.pages.gitlab.gnome.org/libadwaita/doc/1-latest/index.html?q={s}
librestock	Librestock	librestock.com/search/?query={s}
lilearning	LinkedIn Learning	www.linkedin.com/learning/search?keywords={s}
liquipedia	Liquipedia2	wiki.teamliquid.net/starcraft2/index.php?title=Special:Search&go=Go&search={s}
liquorland	Liquorland	www.liquorland.com.au/Search?q={s}
liveplasma	LivePlasma	www.liveplasma.com/#/artist/{s}
livestrong	LIVESTRONG	www.livestrong.com/search/?mode=standard&search={s}
logosearch	Logo Search	logosear.ch/?q={s}
lolcounter	LOL counter	www.lolcounter.com/champions/{s}
lololyrics	Lololyrics	www.lololyrics.com/search?q={s}
louisville	LouisvilleKy.gov	louisvilleky.gov/search/site/{s}
lstarcraft	Liquipedia Starcraft 2	liquipedia.net/starcraft2/index.php?search={s}
macstories	MacStories	www.macstories.net/?s={s}
maerklinde	Maerklin.de	www.maerklin.de/index.php?id=247&q={s}
mailinator	Mailinator	www.mailinator.com/v3/index.jsp?zone=public&query={s}
manualslib	ManualsLib	www.manualslib.com/a/{s}.html
marginalia	Marginalia Search	search.marginalia.nu/search?query={s}
marvelwiki	Marvel Comics Database	marvel.wikia.com/Special:Search?search={s}&fulltext=Search
mcmodpacks	Curseforge Minecraft Modpacks	www.curseforge.com/minecraft/modpacks/search?search={s}
mdmodpacks mrmodpacks	Modrinth (Modpacks)	modrinth.com/modpacks?q={s}
mecabricks	Mecabricks.com	mecabricks.com/en/library/search?q={s}
mediamarkt	MediaMarkt	www.mediamarkt.nl/nl/search.html?storeId=10259&langId=-11&searchProfile=onlineshop&channel=mmnlnl&searchParams=&path=&query={s}
memalphade	MemoryAlpha Deutsch	de.memory-alpha.wikia.com/wiki/Spezial:Suche?query={s}
memorybeta	Memory Beta	memory-beta.wikia.com/wiki/Special:Search?search={s}
messaggero	Il Messaggero	www.ilmessaggero.it/?p=search&q={s}
metacanada	Subreddit r/metacanada	www.reddit.com/r/metacanada/search?q={s}&restrict_sr=on
metalstorm	Metal Storm	www.metalstorm.net/home/search.php?search_where=band&search_what={s}&x=0&y=0
meteomedia	MeteoMedia	www.meteomedia.com/ca/search?q={s}
mobileread	MobileRead	www.mobileread.com/forums/gcs.php?cx=011403329271260343335:mzng3fi-cti&q={s}&sa=Search&siteurl=www.mobileread.com/
modes4u_it	modeS4u [IT]	www.modes4u.com/carino/{s}
morchstore	MorchStore	www.morchstore.com/?post_type=product&s={s}
motorsport	Motorsport.com	www.motorsport.com/all/search/?q={s}
movieguide	MovieGuide	www.movieguide.org/?s={s}&submit.x=0&submit.y=0&submit=Search&key=hs
mozbrowser	MozBrowser.nl	www.mozbrowser.nl/forum/search.php?keywords={s}
mozillians	Mozillians	mozillians.org/en-US/search/?q={s}
msanctuary	Manga Sanctuary	www.manga-sanctuary.com/recherche.php?keywords={s}
msulibrary	Michigan State University Library	lib.msu.edu/searchresults/?Ntt={s}
musicaneto	Musicaneto	www.musicaneto.com/?s={s}
musicstack	MusicStack	www.musicstack.com/show.cgi?find={s}
mysongbook	mySongBook	www.mysongbook.com/search?utf8=%E2%9C%93&search[type_item]=4&search[name]={s}
naijalingo	Naija Lingo	naijalingo.com/search?word={s}
natgeokids	National Geographic Kids	www.natgeokids.com/?s=testhttps://www.nationalgeographic.com/search/?q={s}
naturespic	Nature's Pic Images	www.naturespic.com/NewZealand/result_search.asp?search={s}
naverdicfr	Naver Dictionnaire Fr	dict.naver.com/frkodict/#/search?query={s}
nerdwallet	NerdWallet	www.nerdwallet.com/search/results#q={s}
netflixdvd	Netflix DVD	dvd.netflix.com/Search?v1={s}
newgrounds	Newgrounds	www.newgrounds.com/search/summary?suitabilities=etm&terms={s}
nieuwsblad	Het Nieuwsblad	www.nieuwsblad.be/Search/Index.aspx?searchString={s}
nintendode	Nintendo Deutschland	www.nintendo.de/Suche-/Suche-299117.html?q={s}&f=147393
notdoppler	Not Doppler	www.notdoppler.com/search.php?q={s}
noteflight	Noteflight	www.noteflight.com/public_scores#/search/{s}
observador	observador	observador.pt/pesquisa/?q={s}
ocregister	Orange County Register	www.ocregister.com/search/?q={s}&x=0&y=0
offliberty	Offliberty	offliberty.com/#{s}
oliveyoung	Olive Young	global.oliveyoung.com/display/search?query={s}
openbsdman	man.openbsd.org	man.openbsd.org/?query={s}&apropos=0&sec=0&arch=default&manpath=OpenBSD-current
opensource	Opensource.com	opensource.com/sitewide-search?search_api_views_fulltext={s}
openthebox	Openthebox	openthebox.be/search?q={s}&v=t
openuserjs	OpenUserJS	openuserjs.org/?q={s}
osmforumnl	Openstreetmap forum Netherlands	community.openstreetmap.org/search?q={s}%20%23communities:nl
ostarrichi	Ostarrichi	www.ostarrichi.org/dictionary-search.html?search={s}
outsidemag	Outside Magazine	www.outsideonline.com/search/site/{s}
pdqtglobal	ProQuest Dissertations & Theses Global	fedsearch.proquest.com/search/sru/pqdtglobal?operation=searchRetrieve&version=1.2&maximumRecords=30&query={s}
pennydeals	best of deals and coupons	pennydeals.in/usearch.php?search={s}
perrypedia	Perrypedia	www.perrypedia.proc.org/mediawiki/index.php?search={s}
petsmartca	PetSmart Canada	www.petsmart.ca/search?SearchTerm={s}
phalcondoc	Phalcon Docs	cse.google.com/cse?cx=009733439235723428699:lh9ltjgvdz8&q=validation&oq=validation&gs_l=partner.3...77240.79724.1.80133.10.10.0.0.0.0.325.1627.4j2j1j3.10.0.gsnos,n=13...0.2495j1017187j10..1ac.1.25.partner..10.0.0.XePJcoeor8s#gsc.tab=0&gsc.q={s}&gsc.page=1
philpapers	PhilPapers	philpapers.org/s/{s}
phonearena	Phone Arena	www.phonearena.com/search/term/{s}
phonespell	PhoneSpell	phonespell.org/combo.cgi?n={s}
photocrati	Photocrati	www.photocrati.com/?s={s}
planetmath	Planet Math (GitHub repo)	github.com/search?l=TeX&q=org:planetmath+{s}&type=Topics
politicoeu	Politico EU	www.politico.eu/?s={s}
politifact	PolitiFact	www.politifact.com/search/?q={s}
portalwiki	Portal Wiki	theportalwiki.com/w/index.php?search={s}
postgresql	PostgreSQL.org	www.postgresql.org/search?q={s}&a=1&submit=Search
poststatus	PostStatus	poststatus.com/?s={s}
pricemania	Pricemania	www.pricemania.sk/katalog/vyhladavanie/{s}.html
primevideo	Amazon Prime Video	www.amazon.com/s?url=search-alias=prime-instant-video&field-keywords={s}
printables	Printables	www.printables.com/search/models?q={s}
protonmail	Proton Mail	mail.proton.me/u/0/all-mail#keyword={s}
purplemath	PurpleMath	search.freefind.com/find.html?id=5014414&pageid=r&mode=ALL&n=0&query={s}
queryposts	QueryPosts	queryposts.com/?s={s}
radioshack	RadioShack	www.radioshack.com/search?q={s}
radiotimes	RadioTimes	www.radiotimes.com/search?q={s}
railscasts	RailsCasts	railscasts.com/?search={s}
rallypoint	RallyPoint	www.rallypoint.com/answers?q={s}
reactparts	React Parts Libraries	react.parts/?search={s}
reasonator	Reasonator	tools.wmflabs.org/reasonator/?find={s}
replicante	La mirada del replicante	lamiradadelreplicante.com/?s={s}
repubblica	La Repubblica	ricerca.repubblica.it/ricerca/repubblica?query={s}
reviewgeek	ReviewGeek	www.reviewgeek.com/?s={s}
rhymebrain	RhymeBrain	rhymebrain.com/en/What_rhymes_with_{s}.html
rightscale	RightScale Docs	docs.rightscale.com/search.html?q={s}
rymrelease	rateyourmusic.com	rateyourmusic.com/search?searchterm={s}&type=l
sabahlatan	Sabahlatan	sabahlatan.com/?s={s}
sahibinden	sahibinden.com	www.sahibinden.com/kelime-ile-arama?query_text={s}
sainsburys	Sainsbury's	www.sainsburys.co.uk/webapp/wcs/stores/servlet/SearchDisplayView?storeId=10151&searchTerm={s}
saltstates	SaltStack State Modules	docs.saltstack.com/en/latest/ref/states/all/salt.states.{s}.html
saltystock	saltystock	www.saltystock.com/search.pp?keyword={s}
samaritans	Samaritan's Purse	www.samaritanspurse.org/?s={s}
sanalpazar	Sanal Pazar	www.sanalpazar.com/urunara?criteria={s}
sandiamesa	Sandia Mesa Animation Studios	sandiamesa.com/?s={s}
scholieren	scholieren.com	www.scholieren.com/zoek?q={s}
scottwyden	Scott Wyden Imagery	scottwyden.com/?s={s}
searchcode	searchco.de	searchco.de/?q={s}
securedrop	SecureDrop Read the Docs	securedrop.readthedocs.org/en/latest/search.html?q={s}
securitynl	Security.nl	www.security.nl/zoeken?search={s}
senderbase	SenderBase	www.senderbase.org/senderbase_queries/detailhost?search_string={s}
similarweb	SimilarWeb	www.similarweb.com/website/{s}
sixdegrees	Six Degrees of Kanye West	sixdegreesofkanyewest.com/artist?q={s}
sketchport	SketchPort	www.sketchport.com/search?q={s}
slideshare	SlideShare	www.slideshare.net/search/slideshow?q={s}&submit=post&commit=Search
smashwords	Smashwords	www.smashwords.com/books/search?query={s}
snappygoat	SnappyGoat	snappygoat.com/s/?q={s}
soccerwiki	Soccer Wiki	soccerwiki.com/wiki.php?action=search&q={s}&searchType=players
sonarcloud	SonarCloud	sonarcloud.io/explore/projects?search={s}
sonicretro	Sonic Retro / Sega Retro	info.sonicretro.org/Special:Search?search={s}&go=Go
soulflower	Soul Flower	www.soul-flower.com/mm5/merchant.mvc?Screen=search&onlyone=1&sort=id.desc&x=0&y=0&Search={s}
spare-part	KFZ-Schlachter	kfz-schlachter.de/Store?q={s}
sparknotes	SparkNotes	www.sparknotes.com/search?q={s}
splunkbase	Splunkbase	apps.splunk.com/apps/#/search/{s}/page/1
sqlalchemy	SQL Alchemy Docs	www.sqlalchemy.org/docs/search.html?q={s}&check_keywords=yes&area=default
stackshare	StackShare	stackshare.io/search/q={s}
stacksproj	The Stacks project	stacks.math.columbia.edu/search?query={s}
startechat	Startech Austria	www.startech.com/de-at/search?search_term={s}
startechau	Startech Australia	www.startech.com/en-au/search?search_term={s}
startechbe	Startech Belgium	www.startech.com/en-be/search?search_term={s}
startechca	Startech Canada	www.startech.com/en-ca/search?search_term={s}
startechch	Startech Switzerland	www.startech.com/de-ch/search?search_term={s}
startechcl	Startech Chile	www.startech.com/es-cl/search?search_term={s}
startechco	Startech Colombia	www.startech.com/es-co/search?search_term={s}
startechde	Startech Germany	www.startech.com/de-de/search?search_term={s}
startechdk	Startech Denmark	www.startech.com/en-dk/search?search_term={s}
starteches	Startech Spain	www.startech.com/es-es/search?search_term={s}
startecheu	Startech Europe	www.startech.com/en-eu/search?search_term={s}
startechfi	Startech Finland	www.startech.com/en-fi/search?search_term={s}
startechfr	Startech France	www.startech.com/fr-fr/search?search_term={s}
startechie	Startech Republic of Ireland	www.startech.com/en-ie/search?search_term={s}
startechit	Startech Italy	www.startech.com/it-it/search?search_term={s}
startechjp	Startech Japan	www.startech.com/ja-jp/search?search_term={s}
startechmx	Startech Mexico	www.startech.com/es-mx/search?search_term={s}
startechnl	Startech Netherlands	www.startech.com/nl-nl/search?search_term={s}
startechnz	Startech New Zealand	www.startech.com/en-nz/search?search_term={s}
startechpe	Startech Peru	www.startech.com/es-pe/search?search_term={s}
startechse	Startech Sweden	www.startech.com/sv-se/search?search_term={s}
startechsg	Startech Singapore	www.startech.com/en-sg/search?search_term={s}
startechuk	Startech United Kingdom	www.startech.com/en-gb/search?search_term={s}
starticket	Starticket	www.starticket.ch/de/suche?_csquery={s}
stdtplnlmn	Stadtplan Ilmenau	stadtplan-ilmenau.de/?query={s}
steimatzky	Steimatzky	www.steimatzky.co.il/Steimatzky/Pages/SearchResult.aspx?SearchType=Simple&SearchSimpleText={s}
stilltasty	StillTasty	stilltasty.com/Search?q={s}
stortinget	Stortinget	www.stortinget.no/no/sok/?query={s}
studybible	Study bible	studybible.info/YLT/{s}
subnautica	Subnautica Wiki	wiki.subnautica.com/sn/?search={s}&title=Special%3ASearch
summitpost	SummitPost	www.summitpost.org/object_list.php?object_type=0&object_name_0={s}&page=1
tabcrawler	Tabcrawler	tabcrawler.com/search/{s}
tagesschau	Tagesschau	www.tagesschau.de/suche#/all/1/?searchText={s}
tageswoche	Tageswoche	www.tageswoche.ch/search/?q={s}
technetlib	Microsoft TechNet Library	social.technet.microsoft.com/search/en-us/?query={s}#refinementChanges=85
technobyte	Technobyte	www.technobyte.org/?s={s}
techrights	TechRights	techrights.org/wiki/index.php/Special:Search?search={s}&fulltext=Search
techtips4u	TechTips4U	www.techtips4u.com/?s={s}
teknofiyat	TeknoFiyat	www.teknofiyat.com/?search={s}
teknoseyir	TeknoSeyir	teknoseyir.com/?s={s}
theitdepot	The IT Depot	www.theitdepot.com/search.html?keywords={s}
thetoptens	TheTopTens	www.thetoptens.com/search.asp?q={s}
thoriummod	Official Thorium Mod Wiki	thoriummod.wiki.gg/index.php?search={s}
timhortons	Tim Hortons	www.timhortons.com/ca/en/search/search-results.php?q={s}
tokyonoise	TokyoNoise	www.tokyonoise.net/cerca.php?s={s}&p=1
tonymacx86	tonymacx86	www.tonymacx86.com/search/48223690/?q={s}&o=date
toptenrevs	TopTenReviews	www.toptenreviews.com/search/?q={s}
toutvendre	ToutVendre	www.toutvendre.fr/s?k={s}
trademarks	Trademarkia	www.trademarkia.com/trademarks-search.aspx?tn={s}
traxsource	Traxsource	www.traxsource.com/search?term={s}
trendmicro	Trend Micro	www.trendmicro.com/en_us/common/cse.html#?cludoquery={s}
trulytexan	Truly Texan	www.trulytexan.com/?{s}
trustpilot	Trustpilot	www.trustpilot.com/search?query={s}
tuttocitta	TuttoCitta	www.tuttocitta.it/mappe/{s}
twitchbots	Twitch Bit Directory	twitchbots.info/check?username={s}
twitchchat	Twitch Chat	www.twitch.tv/{s}/chat?popout=
userstyles	Userstyles	userstyles.org/styles/browse/all/{s}
veganistan	Veganistan	veganistan.se/search/innehall/{s}
vertalennu	Vertalen.nu	www.vertalen.nu/vertaal?vertaal={s}&van=en&naar=nl
vimscripts	Vim Scripts	www.vim.org/scripts/script_search_results.php?keywords={s}&script_type=&order_by=rating&direction=descending&search=search
waitbutwhy	Wait But Why	waitbutwhy.com/?s={s}
watchcount	WatchCount.com	www.watchcount.com/completed.php?bkw={s}&bcat=0&bcts=&sfsb=Show+Me!&csbin=all&cssrt=ts&bslr=&bnp=&bxp=
weatherbug	WeatherBug	weather.weatherbug.com/Common/SearchResults.html?loc={s}&nav_section=1&zcode=z6169&lang_id=en-us&country=US&x=0&y=0&is_search=true
webcrawler	WebCrawler	www.webcrawler.com/serp?q={s}
webstagram	Webstagram	web.stagram.com/search/{s}
webutation	Webutation	www.webutations.org/go/review/{s}
webxiconen	Webxicon -> English	webxicon.org/search.php?l=-1&l2=3&q={s}
webxiconfi webxiconsu	Webxicon -> Finnish	webxicon.org/search.php?l=-1&l2=17&q={s}
webxiconse webxiconsv	Webxicon -> Swedish	webxicon.org/search.php?l=-1&l2=15&q={s}
weeronline	Weeronline	www.weeronline.nl/Go/Search/SearchResults?searchCriteria={s}&pageIndex=0&searchAction=WeatherInformation
werstreamt	WerStreamt.es	www.werstreamt.es/filme-serien?q={s}
whoscalltw	Whoscall TW	whoscall.com/en-US/tw/{s}
wikimodule	Wikipedia Modules	en.wikipedia.org/wiki/Module:{s}
wikisearch	WikiSpaces	www.wiki.com/results1.htm?q={s}
wikizimbra	Zimbra wiki	wiki.zimbra.com/index.php?search={s}
wirecutter	The Wirecutter	thewirecutter.com/search/?s={s}
workcircle	Workcircle	www.workcircle.com/jobs/?search=1&query={s}
worldatlas	World Atlas	www.worldatlas.com/search?q={s}
wpackagist	WordPress Packagist	wpackagist.org/search?q={s}&type=any&search=
yahoofinau	Yahoo Finance Australia	au.finance.yahoo.com/quote/{s}
zabasearch	Zabasearch	www.zabasearch.com/people/{s}
abcnotation	abcnotation.com	abcnotation.com/searchTunes?q={s}&f=c&o=a&s=0
accuweather	AccuWeather	www.accuweather.com/us-city-list.asp?zipcode={s}
activestate	ActiveState.com	www.activestate.com/search/index.html?q={s}#1013
addtopocket	Add to Pocket	getpocket.com/edit?url={s}
albumartdvd	Albumart (DVD)	www.albumart.org/index.php?skey={s}&itempage=1&newsearch=1&searchindex=DVD
allacronyms	All Acronyms	www.allacronyms.com/{s}
alternatenl	Alternate Nederland	www.alternate.nl/html/search.html?query={s}
animefiller	Anime Filler List	www.animefillerlist.com/search/node/{s}
animelyrics	AnimeLyrics	www.animelyrics.com/search.php?q={s}
apert-en-es	Apertium (English to Spanish)	www.apertium.org/index.spa.html?dir=eng-spa&q={s}#translation
apidockruby	APIdock	apidock.com/ruby/search/quick?query={s}
applerealty	Apple Realty	applesold.com/search?q={s}
apps.splunk	apps.splunk.com	apps.splunk.com/apps/#/search/{s}
arcadeotaku	Arcade Otaku Wiki	wiki.arcadeotaku.com/index.php?search={s}
archivedmoe	Archived.Moe	archived.moe/_/search/text/{s}
archiveteam	Archive Team Wiki	www.archiveteam.org/index.php?title=Special:Search&search={s}&fulltext=Search
arrow-wikia	Arrowverse Wikia	arrow.wikia.com/wiki/Special:Search?query={s}
askapatient	AskaPatient.com	www.askapatient.com/searchresults.asp?searchField={s}
audiobookjp	audiobookjp	audiobook.jp/search?q={s}
audiojungle	AudioJungle	audiojungle.net/search?utf8=%E2%9C%93&term={s}
avatarpress	Avatar Press	www.avatarpress.com/?s={s}
beautypedia	Beautypedia	www.beautypedia.com/skin-care-reviews/?Ntt={s}
beforeiplay	Before I Play	beforeiplay.com/index.php?search={s}
bergfreunde	Bergfreunde	www.bergfreunde.de/s/*/?searchparam={s}
bibleserver	bibleserver.com	bibleserver.com/search/LUT/{s}/1
biblionetka	Biblionetka.pl	www.biblionetka.pl/search.aspx?searchType=book_catalog&searchPhrase={s}
borderlands	Borderlands Wiki	borderlands.wikia.com/wiki/Special:Search?query={s}
bostonglobe	Boston Globe	www.bostonglobe.com/queryResult/search?q={s}
brainyquote	BrainyQuote	www.brainyquote.com/search_results.html?q={s}
brettspiele	Brettspiel Angebote	www.brettspiel-angebote.de/spiele/?s={s}&t=
budgetbytes	Budget Bytes	www.budgetbytes.com/?s={s}
bulletproof	Bulletproof blog	blog.bulletproof.com/?s={s}
cajunlyrics	CajunLyrics	www.cajunlyrics.com/?page=search&word={s}
cardkingdom	CardKingdom	www.cardkingdom.com/catalog/search?search=header&filter[name]={s}
ccgrreviews	Christ Centered Gamer Reviews	www.christcenteredgamer.com/index.php/component/search/?searchword={s}&ordering=newest&searchphrase=all&areas[0]=blogs
chakraforum	The Chakra Project	chakraos.org/forum/search.php?action=search&keywords={s}&author=&search_in=0&sort_by=0&sort_dir=DESC&show_as=topics&search=Submit
cheezburger	Cheezburger	search.cheezburger.com/?q={s}
chemicalize	Chemicalize	www.chemicalize.org/structure/#!mol={s}&source=fp
chimerarevo	Chimera Revo	www.chimerarevo.com/search/{s}
cocklestorm	Cocklestorm Fencing Ltd	www.cocklestorm.com/catalogsearch/result/?q={s}
codeweavers	Codeweavers	www.codeweavers.com/compatibility/search/?name={s}
collocation	Online Oxford Collocation Dictionary	oxforddictionary.so8848.com/search1?word={s}
comicrocket	Comic Rocket	www.comic-rocket.com/search?q={s}
commitstrip	Commit Strip	www.commitstrip.com/?s={s}
consumerlab	ConsumerLab.com	www.consumerlab.com/Search/{s}
coolinarika	Coolinarika	www.coolinarika.com/recepti/pretrazivanje/?upit={s}
couponcabin	CouponCabin	www.couponcabin.com/ps/{s}/1/
courrierint	Courrier International	www.courrierinternational.com/search/result/{s}
creativecow	Creative Cow Forums	creativecow.net/forums/search/{s}/
crowdsupply	CrowdSupply	www.crowdsupply.com/search?q={s}
crunchyroll	CrunchyRoll	www.crunchyroll.com/search?q={s}
dacardworld	Dave & Adam's	www.dacardworld.com/search?Search={s}
dandyfellow	Dandy Fellow	www.dandyfellow.com/search/{s}
datablogger	Data Blogger	www.data-blogger.com/?s={s}&submit=Search
davesgarden	Dave's Garden	davesgarden.com/sitewidesearch.php?q={s}
davidnesher	David Nesher Blog	davidnesher.com.ar/?q={s}:
dealspricer	DealsPricer	www.dealspricer.com/search?q={s}
decathlonfr	Decathlon France	www.decathlon.fr/Acheter/{s}
decathlonit	Decathlon Italia	www.decathlon.it/Comprare/{s}
derstandard	derStandard.at	www.derstandard.at/search?query={s}
destructoid	Destructoid	www.destructoid.com/search.phtml?q={s}
divinipedia	Divinipedia	kidicarus.wikia.com/wiki/Special:Search?search={s}
dmaciasblog	dmaciasblog	dmaciasblog.com/?s={s}
docs.splunk	Splunk Docs	docs.splunk.com/Special:SplunkSearch/docs?q={s}
documentary	Documentary Heaven	documentaryheaven.com/find/?q={s}
dougscripts	Doug's AppleScripts for iTunes	dougscripts.com/itunes/itinfo/searchform.php?my_srch_term={s}
dreamincode	Dream In Code	www.dreamincode.net/forums/index.php?app=core&module=search&section=search&do=quick_search&search_app=core&fromsearch=1&search_term={s}&search_app=forums
eclipsewiki	Eclipse Wiki (Eclipsepedia)	wiki.eclipse.org/index.php?search={s}&fulltext=search
elixirforum	elixirforum.com	elixirforum.com/search?q={s}
explainxkcd	explain xkcd	www.explainxkcd.com/wiki/index.php?search={s}
fantasylife	Fantasy Life Wikia	fantasy-life.wikia.com/wiki/{s}
fettrechner	Fettrechner	www.fettrechner.de/cgi-bin/kalorientabelle.pl?t=temsearch&sort=BEZEICHNUNG&f=*RUBRIK,*SUCHBEGRIFFE,*BEZEICHNUNG,*HERSTELLER&f1=HERSTELLER&start=1&dif=50&c={s}
fibercables	FiberCables.com	www.fibercables.com/search?q={s}
findanyfilm	FindAnyFilm	www.findanyfilm.com/search?term={s}
finecooking	FIne Cooking	www.finecooking.com/?s={s}
fontlibrary	Font Library	fontlibrary.org/en/search?query={s}
foodnetwork	Food Network	www.foodnetwork.com/search/delegate.do?fnSearchString={s}&fnSearchType=site
fragrantica	Fragrantica	www.fragrantica.com/search/?q={s}
furaffinity	FurAffinity	www.furaffinity.net/search/?q={s}
genereviews	GeneReviews	www.ncbi.nlm.nih.gov/books/n/gene/?term={s}
genickbruch	Genickbruch.com	genickbruch.com/index.php?befehl=suche&sname={s}
getabstract	getAbstract	www.getabstract.com/en/search?initial=true&query={s}
getlinkinfo	GetLinkInfo	www.getlinkinfo.com/info?link={s}
gfycatdepot	/r/GfycatDepot	www.reddit.com/r/GfycatDepot/search?q={s}&restrict_sr=on&sort=relevance&t=all
githubstars	GitHub Stars	github.com/stars?q={s}
graphhopper	GraphHopper Maps	graphhopper.com/maps/?point={s}
grottopress	GrottoPress	www.grottopress.com/?s={s}
gunstreamer	Gun Streamer	gunstreamer.com/search?q=Test&idx=videos&p=0&keyword={s}
handytarife	handytarife.de	www.handytarife.de/?q={s}
harrypotter	Harry Potter wiki	harrypotter.wikia.com/wiki/Special:Search?query={s}
haskellwiki	Haskell Wiki	www.haskell.org/haskellwiki/Special:Search/{s}
humbledeals	Humble Bundle	www.humblebundle.com/store/search?sort=discount&search={s}
icaruspedia	Icaruspedia	www.kidicaruswiki.org/index.php?title=Special:Search&search={s}
iconarchive	IconArchive	www.iconarchive.com/tag/{s}
iltasanomat	Ilta-Sanomat	iltasanomat.fi/haku/?search-term={s}
impericonde	Impericon(de)	www.impericon.com/de/advancedsearch/result/?q={s}
impericonuk	Impericon(uk)	www.impericon.com/uk/advancedsearch/result/?q={s}
independent	The Independent	www.independent.co.uk/search/simple.do?destinationSectionUniqueName=search&publicationName=ind&searchString={s}
intheclouds	INTHECLOUDS	intheclouds.io/search?q={s}
ironmongery	Ironmongery Direct	www.ironmongerydirect.co.uk/search?query={s}
javalibhunt	Java LibHunt	java.libhunt.com/search?query={s}
justwalkers	Just Walkers	justwalkers.com/catalogsearch/result/?q={s}
justwatchau	JustWatch AU	www.justwatch.com/au/search?q={s}
justwatchde	justwatch german	www.justwatch.com/de/Suche?q={s}
justwatchfi	Justwatch (Finnish)	www.justwatch.com/fi/search?q={s}
justwatchuk	JustWatch UK	www.justwatch.com/uk/search?q={s}
kamelopedia	Kamelopedia	kamelopedia.mormo.org/index.php?title=Spezial:Suche&search={s}&button=Senden
korrekturen	korrekturen.de	www.korrekturen.de/suche/searcher.php?q={s}
kotlinlinks	Kotlin Links	kotlin.link/?q={s}
kreativfont	Kreativ Font	www.kreativfont.com/?s={s}
learngaelic	LearnGaelic.net	www.learngaelic.net/dictionary/index.jsp?slang=both&wholeword=false&abairt={s}
lifehacking	Lifehacking	lifehacking.nl/?s={s}
linternaute	linternaute	www.linternaute.com/encyclopedie/recherche/?f_libelle={s}
liquidation	Liquidation	www.liquidation.com/auction/search?cmd=keyword&searchparam_words={s}&flag=new
liquidpedia	Liquidpedia	wiki.teamliquid.net/starcraft2/index.php?title=Special:Search&search={s}&go=Go
maakjetaart	Maak Je Taart	www.maakjetaart.nl/advanced_search_result.php?search_in_description=0&keywords={s}
macobserver	The Mac Observer	www.macobserver.com/?s={s}
majorsbooks	Majors Books	www.majorsbooks.com/search/?searchQuery={s}
makeupalley	MakeupAlley	www.makeupalley.com/search.asp?q={s}&x=0&y=0
marineparts	MarinePartsSource	www.marinepartssource.com/catalogsearch/result/?q={s}
marktplaats	Marktplaats	www.marktplaats.nl/z.html?query={s}
mddatapacks mrdatapacks	Modrinth (Datapacks)	modrinth.com/datapacks?q={s}
medlineplus	MedlinePlus	vsearch.nlm.nih.gov/vivisimo/cgi-bin/query-meta?v:project=medlineplus&query={s}
mercurynews	Mercury News	www.mercurynews.com/circare/html/sca_template.jsp?runSearch=true&query={s}&searchButton.x=0&searchButton.y=0&searchButton=Search&view=entiresitesppublished
metacrawler	MetaCrawler	www.metacrawler.com/search/web?q={s}
metroidwiki	Metroid Wiki	www.metroidwiki.org/w/index.php?title=Special:Search&search={s}
michaelispt	Michaelis English - Portuguese	michaelis.uol.com.br/busca?r=1&f=1&t=0&palavra={s}
microcenter	Micro Center	www.microcenter.com/search/search_results.phtml?Ntt={s}
mobilegeeks	Mobile Geeks	www.mobilegeeks.com/?s={s}
modulargrid	ModularGrid	www.modulargrid.net/e/modules/browser?SearchName={s}
morningstar	Morningstar Search	www.morningstar.com/search?query={s}
moviepilotm	Moviepilot Mobile	m.moviepilot.de/suche?utf8=%E2%9C%93&q={s}
mtgotraders	MTGO Traders	www.mtgotraders.com/store/search.php?q={s}&x=0&y=0
musikazblai	Musikazblai Euskaraz	eu.musikazblai.com/foro/search.php?q={s}
muusikoiden	Muusikoiden.net	muusikoiden.net/tori/haku.php?keyword={s}&title_only=0&location=all&province=&city=&type=all&price_min=&price_max=&category=all&with_image=0
muycomputer	MuyComputer	www.muycomputer.com/?s={s}
myallsearch	MyAllSearch	www.myallsearch.com/Web/{s}.html
natobserver nationalobserver	National Observer	www.nationalobserver.com/search?keywords={s}
netcore2api	.NET API Browser - .NET Core 2.0	docs.microsoft.com/en-us/dotnet/api/?view=netcore-2.0&term={s}
netzpolitik	Netzpolitik.org	netzpolitik.org/?s={s}
newsarchive	Google News Archive	www.google.com/#q={s}&hl=en&tbm=nws&prmd=imvnsfd&source=lnt&tbs=ar:1&sa=X&ei=UJrnT8LwO8Sf6QGHmIjhDg&ved=0CCcQpwUoBQ&bav=on.2,or.r_gc.r_pw.r_cp.r_qf.,cf.osb&fp=3c6a142c5aa1edc2&biw=1366&bih=706
newsjournal	The News Journal	www.delawareonline.com/search/{s}/
nihongodict	NihongoDict	www.nihongodict.com/?s={s}
nordicnames	Nordic Names Wiki	www.nordicnames.de/w/index.php?title=Special:Search&search={s}
nyheteridag	Nyheter Idag	nyheteridag.se/?s={s}
nzlibraries	New Zealand Libraries' Catalogue	tepuna.on.worldcat.org/external-search?queryString={s}
officedepot	OfficeDepot	www.officedepot.com/catalog/search.do?Ntt={s}
openbsdmisc	OpenBSD misc list	marc.info/?l=openbsd-misc&w=2&r=1&s={s}&q=b
openclipart	OpenClipart	openclipart.org/search/?query={s}
opensecrets	OpenSecrets.org	www.opensecrets.org/usearch/?q={s}
oreillyauto	O'Reilly Auto Parts	www.oreillyauto.com/search/?q={s}
osmrelation	OpenStreetMap Relation	www.openstreetmap.org/relation/{s}
owgamepedia	Overwatch Gamepedia	overwatch.gamepedia.com/index.php?search={s}&title=Special:Search&go=Go
pagesjaunes	Pages Jaunes	www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui={s}&monochamp={s}
parisreview	The Paris Review	www.theparisreview.org/search?q={s}
pepperplate	Pepperplate	www.pepperplate.com/search/?text={s}
perezhilton	PerezHilton	perezhilton.com/?s={s}
perfectgame	Perfect Game	www.perfectgame.org/Search.aspx?search={s}
photobucket	PhotoBucket.com	photobucket.com/images/{s}/
pianostreet	Pianostreet	www.pianostreet.com/index_sr.php?q={s}
piratenwiki	Wiki der Piratenpartei Deutschland	wiki.piratenpartei.de/Spezial:Suche?search={s}&fulltext=Suchen
piratetimes	Pirate Times	piratetimes.net/?s={s}&submit=Search
planetdepos	Planet Depos	planetdepos.com/?s={s}
playgrounds	Custom Playground Equipment	www.customplaygroundequipment.com/search?search={s}
pluralsight	Pluralsight	www.pluralsight.com/search/?searchTerm={s}
pocketgamer	Pocket Gamer	www.pocketgamer.co.uk/latest.asp?srch={s}
potterybarn	Pottery Barn	www.potterybarn.com/search/results.html?words={s}
pricerunner	PriceRunner	www.pricerunner.se/results?q={s}
protocolsio	Protocols.io	protocols.io/search?key={s}
protondrive	Proton Drive	drive.proton.me/search#q={s}
psimplified	Programming Simplified	www.programmingsimplified.com/search/node/{s}
psnprofiles	PSN Profiles	psnprofiles.com/search/games?q={s}
rapidonline	Rapid Online	www.rapidonline.com/Catalogue/Search?Query={s}
recordclick	RecordClick	recordclick.com/?s={s}&x=0&y=0
redensarten	Redensarten-Index	www.redensarten-index.de/suche.php?suchbegriff={s}&bool=relevanz&gawoe=an&suchspalte[]=rart_ou&suchspalte[]=rart_varianten_ou
retailmenot	RetailgMeNot	www.retailmenot.com/view/{s}
reversoiten	Reverso DIctionary	dictionary.reverso.net/italian-english/{s}
robotreview	RobotReview	robot-review.ru/search?q={s}
rocketbeans	Rocket Beans TV	www.rocketbeans.tv/?s={s}
rubytoolbox	Ruby Toolbox	www.ruby-toolbox.com/search?utf8=%E2%9C%93&q={s}
salixforums	SalixOS Forums	www.salixos.org/forum/search.php?keywords={s}
scienceblog	ScienceBlog.com	scienceblog.com/?s={s}
scratchwiki	Scratch Wiki	wiki.scratch.mit.edu/w/index.php?search={s}&fulltext=Search&title=Special:Search
searchworks	SearchWorks (SULAIR)	searchworks.stanford.edu/?q={s}&search_field=search
searsoutlet	Sears Outlet	www.searsoutlet.com/d/products.jsp?md=srh_md&stxt={s}
seriouseats	Serious Eats	www.seriouseats.com/search?term={s}&site=all
silvergames	Silvergames.com	www.silvergames.com/en/s?q={s}
simplyhired	SimplyHired	www.simplyhired.com/a/jobs/list/q-{s}
simplyscuba	Simply Scuba	www.simplyscuba.com/pages/search-results-page?q={s}
smartsearch	SmartSearch	smartsearch.altervista.org/?q={s}
smithsonian	Smithsonian	si.edu/sisearch?edan_q={s}
snappywords	Snappy Words	www.snappywords.com/?lookup={s}
socialblade	Socialblade	socialblade.com/search/{s}
sockandmore	Socks & More	www.socksandmore.dk/catalogsearch/result/?q={s}
socompanies	StackOverflow Companies	stackoverflow.com/jobs/companies?q={s}
songmeaning	Songmeaning	www.songmeanings.net/query/?q={s}&type=artists&page=1&start=0&mm=1&pp=20&b=Go
sourcewatch	SourceWatch	www.sourcewatch.org/index.php?search={s}&title=Special:Search
spieletipps	Spieletipss	www.spieletipps.de/suche/?keyword={s}
spoonacular	spoonacular	spoonacular.com/{s}
stacksocial	Stack Social	stacksocial.com/search?utf8=%E2%9C%93&query={s}
startupjobs	Startup Jobs	startup.jobs/?q={s}
stationsweb	Stationsweb	www.stationsweb.nl/stationlijst.asp?station={s}
steamcharts	Steam Charts	steamcharts.com/search/?q={s}
steammarket	Steam Community Market	steamcommunity.com/market/search?q={s}
steamprices	Steam Prices	www.steamprices.com/us/search?{s}
steamtrades	Steam Trades	www.steamtrades.com/forum/search/{s}
sthlmbibbla	Stockholms stadsbibliotek	biblioteket.stockholm.se/sok?freetext={s}
stockcharts	StockCharts	stockcharts.com/h-sc/ui?s={s}&p=D&yr=0&mn=6&dy=0
subetashops	Subeta	subeta.net/user_shops.php/search/shops/{s}
suconlavite	Suconlavite.it	www.suconlavite.it/?s={s}
sunnysports	SunnySports	www.sunnysports.com/search?searchinfo={s}
surveygizmo	SurveyGizmo help	help.surveygizmo.com/help/search/?phrase={s}
sweetsearch	SweetSearch4me	sweetsearch.com/search?q={s}
telefonbuch	Das Telefonbuch	www.dastelefonbuch.de/?pid=OpenSearch&cmd=search&kw={s}
tfdacronyms	The Free Dictionary (Acronyms)	acronyms.thefreedictionary.com/{s}
theatlantic	The Atlantic	www.theatlantic.com/search/?q={s}
thefastmode	TheFastMode	www.thefastmode.com/site-search?q={s}
themeforest	ThemeForest	themeforest.net/search?utf8=%E2%9C%93&term={s}
thinkwikide	thinkwiki.de	thinkwiki.de/index.php?search={s}
thrustcurve	ThrustCurve Hobby Rocket Motor Data	www.thrustcurve.org/motorsearch.jsp?designation={s}
tigerdirect	TigerDirect	www.tigerdirect.com/applications/SearchTools/search.asp?keywords={s}
tn-annonces	Tunisie Annonces	www.tunisie-annonce.com/search.asp?q={s}
toucharcade	Touch Arcade	toucharcade.com/?s={s}
touslesprix	Touslesprix.com	www.touslesprix.com/achat,{s}.html
travelgator	TravelGator	www.travelgator.com/en/search/?locationquery={s}
tripadvisor	Trip Advisor	www.tripadvisor.com/Search?q={s}&sub-search=Go
trovaprezzi	Trovaprezzi.it	www.trovaprezzi.it/categoria.aspx?libera={s}&id=-1&prezzomin=&prezzomax=
tudogostoso	Tudo Gostoso	www.tudogostoso.com.br/busca?q={s}
tvspielfilm	TV Spielfilm	www.tvspielfilm.de/suche/?q={s}
ubuntuchina	Ubuntu China Forum	forum.ubuntu.org.cn/search.php?keywords={s}
ubuntuusers	Ubuntuusers	ubuntuusers.de/search/?query={s}&area=all
ultrastares	Ultrastar Espana	ultrastar-es.org/en/canciones?busqueda={s}
unlimitedbr	Kindle Unlimited Brasil	www.amazon.com.br/s?k={s}&i=digital-text
usaspending	usaspending.gov	www.usaspending.gov/search?form_fields={"search_term":"{s}"}
validatecss	CSS Validation Service	jigsaw.w3.org/css-validator/validator?uri={s}&profile=css3&usermedium=all&warning=1&vextwarning=&lang=en
validatornu	Validator.nu	validator.nu/?doc={s}
vectorlogos	VectorLogoZone	www.vectorlogo.zone/q={s}
vectorspace	Vectorspace AI	vectorspace.ai/recommend/app/crypto_discover?query={s}
venturebeat	VentureBeat	venturebeat.com/?s={s}
voteformost	voteformost	voteformost.net/?s={s}
waterstones	Waterstones	www.waterstones.com/books/search/term/{s}
weathforyou	Weather For You	www.weatherforyou.com/reports/index.php?forecast=zandh&pands={s}&Submit=Get+Weather
wiki.splunk	wiki.splunk.com	wiki.splunk.com/Special:SplunkSearch/wiki?q={s}
wikianswers	WikiAnswers	answers.wikia.com/wiki/Special:Search?search={s}&fulltext=Search&ns0=1&ns112=1&ns500=1&ns502=1
windowparts	WindowParts	www.windowparts.co.uk/catalogsearch/result/?q={s}
woerterbuch	woerterbuch.info	www.woerterbuch.info/?query={s}
wordcentral	Merriam-Webster's Word Central	wordcentral.com/cgi-bin/student?book=Student&va={s}
wowarmoryeu wowbattlenet	WOW Armory (EU)	eu.battle.net/wow/en/search?q={s}
wowprogress	WoWProgress	www.wowprogress.com/search?q={s}
wrighttools	Wright Tools	wright.tools/en/stable/search.html?q={s}&check_keywords=yes&area=default
4x4community	4x4 Community	www.4x4community.co.za/forum/threadloom/threadloom.php?query={s}
allerstorfer	Allerstorfer.at	www.allerstorfer.at/?s={s}
androidpitfr	AndroidPit (Fr)	www.androidpit.fr/search?st={s}
apidockrails	APIDock - Rails	apidock.com/rails/search/quick?query={s}
appledailytw	Apple Daily (Taiwan)	tw.appledaily.com/search/result?querystrS={s}
applediscuss	Apple Discussions	discussions.apple.com/search?source=aml&origin=asc_serp&q={s}
applefritter	Applefritter	www.applefritter.com/search/node/{s}
appleinsider	AppleInsider	appleinsider.com/search/{s}
applesupport applesoftware	Apple Support	support.apple.com/kb/index?page=search&product=&q={s}
archpackages	ArchLinux Package Search	www.archlinux.org/packages/?q={s}
asapsupplies	A.S.A.P. Supplies	www.asap-supplies.com/catalogsearch/result/?q={s}
audiofanzine	Audiofanzine	fr.audiofanzine.com/recherche/{s}.html
audionetwork	Audio Network	www.audionetwork.com/show-production-results.aspx?stype=4&keywords={s}
autoanything	AutoAnything	www.autoanything.com/shop/{s}
awesomenauts	Awesomenauts Wiki	awesomenauts.gamepedia.com/index.php?title=Special:Search&profile=default&search={s}&fulltext=Search
beautyheaven	Beautyheaven	www.beautyheaven.com.au/search?term={s}
beeradvocate	BeerAdvocate	www.beeradvocate.com/search/?q={s}
bitesizegcse	BBC GCSE Bitesize	www.bbc.co.uk/schools/gcsebitesize/search/index.shtml?scope=gcsebitesize_include&q={s}
bookcrossing	BookCrossing	bookcrossing.by/books?find={s}
bountysource	Bountysource	www.bountysource.com/search?query={s}
bricklinkcat	Bricklink Catalog	www.bricklink.com/catalogList.asp?q={s}
caranddriver	Car and Driver	caranddriver.com/search/{s}
cashoverflow	CashOverflow	www.cashoverflow.in/?s={s}
champssports	Champs Sports	www.champssports.com/_-_/keyword-{s}
cheatography	Cheatography	www.cheatography.com/explore/search/?q={s}
clashofclans	Clash of Clans	clashofclans.wikia.com/wiki/Special:Search?search={s}&fulltext=Search&ns0=1&ns14=1#
coastercrazy	CoasterCrazy	www.coastercrazy.com/forums/search.php?keywords={s}
collegeboard	CollegeBoard	www.collegeboard.org/search?tp=usearch&x=15&x1=t4&y=13&searchType=site&word={s}
comparegames	Compare Games	www.comparegames.com.br/comprar/{s}
computrabajo	CompuTrabajo	www.computrabajo.com.ar/ofertas-de-trabajo/?q={s}
couponsurfer	CouponSurfer	www.couponsurfer.com/coupon_search.cfm?q={s}
cowboylyrics	Cowboy Lyrics	www.cowboylyrics.com/search.html?q={s}
dailywriting	DailyWritingTips	www.dailywritingtips.com/?s={s}
debianforums	Debian Forums	forums.debian.net/search.php?keywords={s}
debianizzati	Forum Debianizzati.org	forum.debianizzati.org/search.php?keywords={s}
democracynow	Democracy Now!	www.democracynow.org/search?query={s}
dictzonespma	DictZone spanyol-magyar	dictzone.com/spanyol-magyar-szotar/{s}
draftexpress	DraftExpress	www.draftexpress.com/search/term/{s}
dragonflyman	DragonFly BSD Manual Pages	leaf.dragonflybsd.org/cgi/web-man?command={s}
easymerchant	EasyMerchant	www.easymerchant.co.uk/?product_cat=&s={s}&post_type=product
elconjugador	El conjugador	www.elconjugador.com/conjugaison/verbe/espagnol/{s}.html
empregosaqui	Empregos Aqui	www.empregosaqui.com.br/?s={s}
endlessphere	endless-sphere	endless-sphere.com/forums/?q{s}
fallenlondon	Fallen London wiki	fallenlondon.wikia.com/wiki/Special:Search?search={s}&fulltext=Search
filmaffinity	FilmAffinity	www.filmaffinity.com/en/search.php?stext={s}
fnacportugal	Fnac Portugal	pesquisa.fnac.pt/Search/SearchResult.aspx?Search={s}
forexstation	Forex Station	forex-station.com/search.php?keywords={s}&terms=all&author=&sc=1&sf=all&sr=posts&sk=t&sd=d&st=0&ch=300&t=0&submit=Search
freedompress	Freedom of the Press Foundation	freedom.press/search/?query={s}
fuskanuforum	Fuska.nu forum	fuska.nu/forum/sok.php?sok={s}
gameinformer	GameInformer	www.gameinformer.com/search?keyword={s}
gamepressure	Gamepressure	games.gamepressure.com/games_encyclopedia.asp?search={s}
gamerankings	GameRankings.com	www.gamerankings.com/browse.html?search={s}
globetrotter	Globetrotter	www.globetrotter.de/search?q={s}
globoesporte	GloboEsporte.com	globoesporte.globo.com/busca/?q={s}
golivelively	Go Live Lively	golivelively.com/tag/{s}
graphicriver	GraphicRiver	graphicriver.net/search?utf8=%E2%9C%93&term={s}
habbotrading	Habbo Ruilwaarde	www.ruilwaarde.nl/?p={s}
handelsblatt	Handelsblatt	app.handelsblatt.com/suche/?sw={s}
heilkraeuter	Heilkraeuter	heilkraeuter.de/cgi-bin/search.cgi?Terms={s}
heinzelnisse	Heinzelnisse	www.heinzelnisse.info/dict?searchItem={s}
hockessinlib	Hockessin Library	dlc.lib.de.us/client/en_US/default/search/results?qu={s}&te=
hockeymonkey	Hockey Monkey	www.hockeymonkey.com/nsearch?q={s}
igorandandre	Igor + Andre	igorandandre.com/search/{s}
insectimages	Insect Images	www.insectimages.org/search/action.cfm?q={s}
iplayerradio	BBC iPlayer Radio	www.bbc.co.uk/radio/programmes/a-z/by/{s}/player
irc-galleria	Irc-Galleria	irc-galleria.net/users/search?username={s}
itunesartist	iTunes	itunes.apple.com/us/artist/{s}
kasperskymal	Securelist Malware info	www.securelist.com/en/descriptions?words={s}&behavior=&Search=Search&search_type=1
kubadownload	KubaDownload	kubadownload.com/search?q={s}
kultofathena	Kult of Athena	kultofathena.com/s_results.asp?search={s}
lafourchette	lafourchette	www.lafourchette.com/search-refine/{s}
laptopdirect	LaptopDirect	www.laptopdirect.co.za/search.php?SearchTerm={s}
linuxtracker	Linux Tracker	linuxtracker.org/index.php?page=torrents&search={s}
lonelyplanet	Lonely Planet	www.lonelyplanet.com/search?q={s}
lubimyczytac	lubimyczytac	lubimyczytac.pl/szukaj/ksiazki?phrase={s}
mbannotation	MusicBrainz Annotations	musicbrainz.org/search?query={s}&type=annotation
mbinstrument	MusicBrainz instruments	musicbrainz.org/search?query={s}&type=instrument
mediamarktfr	MediaMarkt FR	www.mediamarkt.be/fr/search.html?query={s}
mediamarktnl	MediaMarkt Nederland	www.mediamarkt.nl/nl/search.html?query={s}&searchProfile=onlineshop&channel=mmnlnl
millionshort	Million short	millionshort.com/search.php?q={s}&remove=1000k
minecraft-ru	ru.minecraft.wiki	ru.minecraft.wiki/?search={s}
miniinthebox	MiniInTeBox	www.miniinthebox.com/index.php?main_page=advanced_search_result&inc_subcat=1&search_in_description=0&keyword={s}
moneycontrol	MoneyControl	www.moneycontrol.com/stocks/cptmarket/compsearchnew.php?search_data=&cid=&mbsearch_str=&topsearch_type=1&search_str={s}
mosaicmarble	Mosaic Marble	mosaicmarble.com/products/search?query={s}
musixmatchde	Musixmatch DE	www.musixmatch.com/de/search/{s}
mwunabridged	Merriam-Webster Unabridged	unabridged.merriam-webster.com/unabridged/{s}
mybestbrands	MYBESTBRANDS	www.mybestbrands.de/search/?q={s}
nationalpost	National Post	nationalpost.com/?s={s}
nextcloudapp	Nextcloud App Store	apps.nextcloud.com/?search={s}
nintendowiki	Nintendo Wiki	nintendo.wikia.com/wiki/Special:Search?search={s}
openbsdports	marc.info	marc.info/?l=openbsd-ports&w=2&r=1&s={s}&q=b
opticsplanet	Optics Planet	www.opticsplanet.com/s/{s}
opussoftware	Opus Software	www.opus-software.com.br/?s={s}
orthodoxwiki	OrthodoxWiki	orthodoxwiki.org/index.php?title=Special:Search&search={s}
owl-you-need	Owl-You-Need	www.owl-you-need.de/suche/{s}
owliquipedia	Overwatch Liquipedia	liquipedia.net/overwatch/index.php?search={s}
penguinmagic	Penguin Magic	www.penguinmagic.com/s/{s}
plattentests	Plattentests.de	www.plattentests.de/suche.php?parameter=all&suche={s}
pleatedjeans	Pleated Jeans	www.pleated-jeans.com/?s={s}
plombservice	Plombservice	www.plombservice.fr/catalogsearch/result/?imageField.x=0&imageField.y=0&q={s}
pricegrabber	Price Grabber	www.pricegrabber.com/{s}/products/
primeinspire	Prime Inspiration	www.primeinspiration.com/?s={s}
primevideojp	amazon prime video jp	www.amazon.co.jp/s/?url=search-alias=instant-video&field-keywords={s}
princetonlib	Princeton University Library	library.princeton.edu/find/all/{s}
protocentral	Protocentral	www.protocentral.com/search?controller=search&orderby=position&orderway=desc&search_query={s}
punctumbooks	punctum books	punctumbooks.com/?s={s}
rabbionrails	Rabbi On Rails	blog.yechiel.me/search?q={s}
racksforcars	Racks For Cars	www.racksforcars.com/store/search.asp?keyword={s}
rapidracking	Rapid Racking	www.rapidracking.com/SearchDisplay?storeId=11612&sType=SimpleSearch&searchTerm={s}
readwriteweb	ReadWriteWeb	readwrite.com/search?keyword={s}
redflagdeals	Red Flag Deals	www.redflagdeals.com/search/?={s}
revengerists	The Revengerists Consortium of Stuff	revengerists.wikia.com/wiki/Special:Search?search={s}
reverbnation	Reverb Nation	www.reverbnation.com/main/search?q={s}
ritchiespecs	RitchieSpecs	www.ritchiespecs.com/results/{s}
rollingstone	Rolling Stone	www.rollingstone.com/search?q={s}
schottenland	Schottenland	www.schottenland.de/suche/?searchstring={s}
scienceblogs	Science Blogs	www.google.com/cse?cx=017254414699180528062:uyrcvn__yd0&q={s}
seekingalpha	Seeking Alpha	seekingalpha.com/search/?q={s}
selfhtmlwiki	SELFHTML wiki	wiki.selfhtml.org/wiki/Spezial:Suche?search={s}
shopdisciple	Disciple Records Shop	www.shopdisciple.com/search?q={s}
signingsavvy	Signing Savvy	www.signingsavvy.com/search/{s}
skipthedrive	SkipTheDrive	www.skipthedrive.com/jobs/?search={s}
slitazforums	SliTaz Forums	forum.slitaz.org/search.php?q={s}
soundonsound	soundonsound.com	www.soundonsound.com/search/all/{s}
speedsolving	SpeedSolving Forum	www.speedsolving.com/forum/searchresults.php?q={s}
springsource	SpringSource	www.springsource.org/search/google?query={s}
sputnikmusic	Sputnik Music	www.sputnikmusic.com/search_results.php?search_in=Bands&search_text={s}
starmadedock	StarMade Dock	starmadedock.net/search/1/?q={s}
steam2twitch twitch2steam	twitch tab bot	tab-bot.net/botcheck?twitchname_botcheck=&steam_botcheck={s}
straightdope	Straight Dope	www.straightdope.com/columns/search?query={s}&action=search
straitstimes	The Straits Times	www.straitstimes.com/search?searchkey={s}
strategywiki	StrategyWiki	strategywiki.org/w/index.php?search={s}
studiofutbol	StudioFutbol	studiofutbol.com.ec/?submit=&s={s}
tacticalguru	The Tactical Guru	thetacticalguru.com/?s={s}
testberichte	Testberichte.de	www.testberichte.de/d/search.php?searchstr={s}&submit=Suchen
tfdfinancial	The Free Dictionary (Financial Dictionary)	financial-dictionary.thefreedictionary.com/{s}
theatricalia	Theatricalia	theatricalia.com/search?q={s}
thecolumbian	The Columbian	www.columbian.com/search/?q={s}
thriftyfoods	Thrifty Foods	www.thriftyfoods.com/search?k={s}
ticketmaster	Ticket Master	www.ticketmaster.com/search?q={s}
todonoticias	TN.com.ar	tn.com.ar/buscar/{s}
torrentfreak	Torrent Freak	torrentfreak.com/search/{s}
tractorhouse	TractorHouse	www.tractorhouse.com/listings/farm-equipment/for-sale/list/?fulltext={s}
traumdeutung	Traum-Deutung	traum-deutung.de/?s={s}
truetrophies	TrueTrophies	www.truetrophies.com/searchresults.aspx?search={s}
tryggehandel	Trygg E-Handel	www.tryggehandel.se/?s={s}
unicodeparty	Unicode Party	unicode.party/?query={s}
unityanswers	Unity Answers	answers.unity3d.com/search.html?q={s}
usedvictoria	UsedVictoria	www.usedvictoria.com/classifieds/all?description={s}
virgiliomail	Virgilio Mail	mail.virgilio.it/login/?q={s}:
visiondirect	VisionDirect	www.visiondirect.com.au/search?query={s}
weatherspark	Weather Spark	weatherspark.com/#!dashboard;q={s}
wikitemplate	Wikipedia Templates	en.wikipedia.org/wiki/Template:{s}
wikivoyagede	Wikivoyage (Deutsch)	de.wikivoyage.org/w/index.php?search={s}&title=Special:Search&go=Go
wikivoyageit	Wikivoyage (Italiano)	it.wikivoyage.org/wiki/Special:Search?search={s}&go=Go
wikivoyagenl	Wikivoyage (Netherlands)	nl.wikivoyage.org/wiki/Special:Search?search={s}&go=Go
wikivoyagepl	Wikivoyage (Polski)	pl.wikivoyage.org/wiki/Special:Search?search={s}&go=Go
wikivoyagesv	Wikivoyage (Svenska)	sv.wikivoyage.org/wiki/Special:Search?search={s}&go=Go
wikizionario	wikizionario	it.wiktionary.org/wiki/{s}
windowsphone	Windows Phone	www.microsoft.com/en-us/search/result.aspx?q={s}&form=apps
wookieepedia	Star Wars Wiki	starwars.wikia.com/wiki/Special:Search?search={s}&fulltext=Search&ns0=1&ns14=1
woordenlijst	Woordenlijst	woordenlijst.org/zoek/?q={s}&w=w
zuckerzauber	Caros Zuckerzauber Shop	shop.zuckerzauber.at/epages/es121414.sf/de_AT/?ObjectPath=/Shops/es121414_Caros_Zuckerzauber&ViewAction=DetailSearchProducts&Search=SF-AllStrings&SearchString={s}
academicearth	Academic Earth	academicearth.org/?s={s}
angelhalowiki	Angelhalo Wiki	www.rigvedawiki.net/r1/wiki.php/{s}
behindsurname	Behind the name - Surnames	surnames.behindthename.com/name/{s}
bellissimi.bg	Bellissimi Jewelry BG	bellissimi.bg/index.php?route=product/search&search={s}
blockexplorer	Block Explorer	blockexplorer.com/searchgo/{s}
blogtalkradio	BlogTalkRadio	blogtalkradio.com/search/{s}
boardgamegeek	BoardGameGeek	boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q={s}
businessgovau	Business.gov.au	www.business.gov.au/search?q={s}
careerbuilder	CareerBuilder	www.careerbuilder.com/Jobseeker/Jobs/JobResults.aspx?IPath=QH&ch=&rs=&s_rawwords={s}&s_jobtypes=ALL&s_freshness=30&s_education=DRNS&s_freeloc=&qsbButton=Find+Jobs+>>
catholicstore	Zieglers - Catholic Store	www.zieglers.com/search.php?search_query={s}
cellartracker	CellarTracker	www.cellartracker.com/list.asp?fInStock=0&Table=List&iUserOverride=0&szSearch={s}
celticpodcast	Irish & Celtic Music Podcast	celticmusicpodcast.com/?s={s}
cheapassgamer	Cheap Ass Gamer	www.cheapassgamer.com/query.php?keywords={s}
chefkochvegan	Chefkoch.de Vegan	www.chefkoch.de/rs/s0t57/{s}/Vegan-Rezepte.html
churchclarity	Church Clarity	www.churchclarity.org/search?query={s}
churchofsatan	Church of Satan Official Site	www.churchofsatan.com/search-results.php?q={s}
climatecounts	Climate Counts	climatecounts.org/searchresults.php?p=term&term={s}
conservapedia	Conservapedia	www.conservapedia.com/index.php?search={s}
cryptoanalyst	CryptoAnalyst	www.cryptoanalyst.co/?s={s}
cryptocoinspy	Cryptocoin Spy	cryptocoinspy.com/?s={s}
cyclingweekly	Cycling Weekly	www.cyclingweekly.com/?s={s}
deepthidevaki	Deepthi Devaki Akkoorath	dd.thekkedam.org/search/?q={s}
dierenkruiden	Dierenkruiden	www.dierenkruiden.nl/search?s={s}
digitalcomics digitalcomicmuseum	Digital Comic Museum	digitalcomicmuseum.com/index.php?ACT=dosearch&terms={s}
digitaltrends	DigitalTrends	www.digitaltrends.com/?s={s}
disconnectimg	Disconnect Image Search	search.disconnect.me/searchTerms/search?query={s}&option=Images
domaindossier	Domain Dossier	centralops.net/co/DomainDossier.aspx?addr={s}&dom_whois=true&dom_dns=true&traceroute=true&net_whois=true&svc_scan=true
ecotimesindia	Economic Times	economictimes.indiatimes.com/topic/{s}
eternalwarcry	Eternal Warcry	eternalwarcry.com/cards?Query={s}
euro-industry	Euro Industry	euro-industry.com/main.php?index=search&search={s}
fantagraphics	Fantagraphics Books	www.fantagraphics.com/index.php?keyword={s}
filmportal.de	filmportal.de	www.filmportal.de/search?search_api_fulltext={s}
fortnitestats	Fortnite stats	fortnitestats.com/stats/{s}
fussballdaten	Fussballdaten	www.fussballdaten.de/suche/?{s}
gadgetsdirect	Gadgets Direct	www.gadgetsdirect.com.au/index.php?main_page=advanced_search_result&search_in_description=1&keyword={s}
gartenexperte	mein Gartenexperte	www.mein-gartenexperte.de/suche?keywords={s}
goodreadslist	Goodreads Lists	www.goodreads.com/search?search_type=lists&q={s}
howstuffworks	How Stuff Works	www.howstuffworks.com/search.php?terms={s}
howtodoinjava	Howtodoinjava	howtodoinjava.com/search-results/?q={s}
iconarchivecc	IconArchive (Commercial Free)	www.iconarchive.com/search?q={s}&license=commercialfree
idownloadblog	iDownloadBlog	www.idownloadblog.com/search/?q={s}
insideschools	Insideschools	insideschools.org/search?q={s}
instantgaming	Instant Gaming	www.instant-gaming.com/en/search/?q={s}
kleinezeitung	Kleine Zeitung	www.kleinezeitung.at/user/search.do?searchText={s}&action=1&resetForm=1&resultsPage=0
leroymerlinit	LeroyMerlin.it	www.leroymerlin.it/ricerca?q={s}&page=1
linternautesy	linternaute synonyme	www.linternaute.fr/dictionnaire/fr/synonyme/{s}/
marinetraffic	Marine Traffic	www.marinetraffic.com/en/ais/index/search/all?keyword={s}
markandgraham	Mark and Graham	www.markandgraham.com/search/results.html?words={s}
marketplacetf	Scrap.TF	marketplace.tf/search?q={s}&?r=76561198039950396
musiker-board	Musiker Board	www.google.de/search?q={s}+site:www.musiker-board.de
mvnrepository	MVNRepository	mvnrepository.com/search.html?query={s}
nettimarkkina	NettiMarkkina	www.nettimarkkina.com/haku?tag_cld=Y&site=A&status_typeF=F&status_typeR=R&status_typeP=P&search_keyword[]={s}&
nonciclopedia	Nonciclopedia	nonciclopedia.wikia.com/index.php?title=Speciale:Ricerca&search={s}&go=Vai
nuclearthrone	Nuclear Throne Wiki	nuclear-throne.wikia.com/wiki/Special:Search?query={s}
nutritiondata	NutritionData	nutritiondata.self.com/foods-{s}000000000000000000000.html
ottawacitizen	Ottawa Citizen	ottawacitizen.com/?s={s}
pagesblanches	Pages Blanches	www.pagesjaunes.fr/pagesblanches/recherche?quoiqui={s}
pocketexplore	Pocket Explore	www.getpocket.com/explore/{s}
pockettactics	Pocket Tactics	www.pockettactics.com/home/SearchForm?Search={s}
queenslibrary	QueensLibrary	www.queenslibrary.org/search/apachesolr_search/{s}
reisartikelen	Reisartikelen.nl	www.reisartikelen.nl/search/?q={s}
rightsidenews	Right Side News	www.rightsidenews.com/?s={s}
scratchforums	Scratch Forums Search	scratchforums.asun.co/search?q={s}
searchtempest	Search Tempest	www.searchtempest.com/search?location=12345&search_string={s}&cityselect=zip
securityshelf	Security Shelf	securityshelf.com/index.php?s={s}
servicepublic	service-public.fr	www.service-public.fr/particuliers/recherche?keyword={s}
stabihannover	Stadtbibliothek Hannover OPAC	bibliothek.hannover-stadt.de/alswww3.dll/APS_ZONES?fn=SEARCH?q={s}
studentdoctor	Student Doctor Network	www.studentdoctor.net/search-sdn/?cx={s}
suivicourrier	La Poste	www.csuivi.courrier.laposte.fr/suivi/index?id={s}#
superphysique	Superphysique	www.google.fr/search?q=site:www.superphysique.org+{s}
superstropdas	SuperStropdas	superstropdas.nl/?s={s}
technikdirekt	TechnikDirekt	www.technikdirekt.de/search?sSearch={s}
textileschool	Textile School	www.textileschool.com/?s={s}
thehackernews	The Hacker News	www.google.com/cse?q=test&cx=partner-pub-7983783048239650:3179771210#gsc.tab=0&gsc.q={s}&gsc.page=1
ticketnetwork	TicketNetwork	www.ticketnetwork.com/en/search/?text={s}
tiragegagnant	Tirage Gagnant	tirage-gagnant.com/?s={s}
trademachines	TradeMachines	trademachines.com/search?phrase={s}
translatesite	Microsoft Translator (for websites)	www.microsofttranslator.com/bv.aspx?from=&to=en&a={s}
tropicalprice	Tropical Price	tropicalprice.com/?query={s}
tuffyproducts	Tuffy Security Products	www.tuffyproducts.com/search.aspx?searchterm={s}
unkompliziert	unkompliziert.eu	unkompliziert.eu/index.php?search={s}
vertigocomics	Vertigo Comics	vertigo.wikia.com/wiki/Special:Search?query={s}
videoculinary	videoculinary.ru	www.videoculinary.ru/search/?q={s}
videogamegeek	VideoGameGeek	videogamegeek.com/geeksearch.php?action=search&objecttype=videogameunified&q={s}&B1=Go
windowsreport	WindowsReport	windowsreport.com/?s={s}
wiringherlant	RSG Wiringherlant	www.wiringherlant.nl/?s={s}
worldbuilding	worldbuilding.stackexchange.com	worldbuilding.stackexchange.com/search?q={s}
xamarinforums	Xamarin Forums	forums.xamarin.com/search?Search={s}
yentlendeboer	Yentl en de Boer	www.yentlendeboer.nl/?s={s}
anguscatalogue	Angus Libraries Catalogue	library.angus.gov.uk/ipac20/ipac.jsp?session=138BN7L458484.310312&menu=search&aspect=subtab184&npp=10&ipp=20&spp=20&profile=ang--7&ri=&term={s}&index=.AW&x=-354&y=-218&aspect=subtab184&term=&index=.TW&term=&index=.SE&term=&index=.SW&term=&index=BSTLLR&sort=
answers.splunk	answers.splunk.com	answers.splunk.com/search/?q={s}&Submit=Search
besteveralbums	Besteveralbum	www.besteveralbums.com/search.php?s_o=all&s_q={s}
buytruckwheels	Buy Truck Wheels	www.buytruckwheels.com/index.php?route=product/search&filter_name={s}
cartoonnetwork	Cartoon Network	www.cartoonnetwork.com/search/index.html?keywords={s}
chicagotribune	The Chicago Tribune	www.chicagotribune.com/?s={s}&orderby=date
companieshouse	UK Companies House	beta.companieshouse.gov.uk/search/companies?q={s}
darknetmarkets	Darknet Markets News	www.darknetmarkets.net/?s={s}
discountoffice	Discount Office	discountoffice.co.nz/search?type=product&q={s}*
eliteprospects	Elite Prospects	www.eliteprospects.com/search/team?q={s}
engineering360	IHS Engineering360	www.globalspec.com/search/all?query={s}
estantevirtual	Estante Virtual	www.estantevirtual.com.br/busca?utf8=%E2%9C%93&type=q&new=&q={s}
explorecourses	Explore Courses	explorecourses.stanford.edu/search?q={s}
fedoramagazine	fedoramagazine.org	fedoramagazine.org/?s={s}
fischertechnik	fischertechnik.de	www.fischertechnik.de/desktopdefault.aspx/tabid-1//tabid-35/searchcall-4/4_keepvisible-true/redirected-1/?/sid-3230669/mid-4/tid-1/ct-0/q-{s}//k-/et-0/rpp-10/sar-False/t-/p-0/ap-True/cat-/cr-0/pr-0/icp-False/icc-False/ifc-False/sl-1/sp-0/cs-/
folktunefinder	folktunefinder	www.folktunefinder.com/tunes?text={s}
gardenersworld	Gardeners' World	www.gardenersworld.com/search/{s}
indiabookstore	IndiaBookStore	www.indiabookstore.net/search?q={s}
inspirationhut	Inspiration Hut	inspirationhut.net/?s={s}
islamicboighor	Islamic Boighor	islamicboighor.com/?s={s}&post_type=product
keithspecialty	Keith Specialty	keithspecialty.com/cgi-keithspecialty/sb/productsearch.cgi?storeid=*0ee0f14a0870280c8d&search_field={s}
killerstartups	Killer Startups	www.killerstartups.com/?s={s}
kitchenstories	Kitchen Stories	kitchenstories.io/en/search?search={s}
loweringthebar	Lowering the Bar	www.loweringthebar.net/?s={s}
mbreleasegroup	MusicBrainz Release Groups	musicbrainz.org/search?query={s}&type=release_group
minecraftseeds	Minecraft Seeds	minecraft-seeds.net/seeds/search/?q={s}
mobafirebuilds	Mobafire Builds	www.mobafire.com/league-of-legends/browse/?q={s}:
mobilefriendly	Mobile-Friendly Test - Google	search.google.com/test/mobile-friendly?url={s}
mondadoristore	Mondadori Store	www.mondadoristore.it/search/?tpr=10&g={s}&swe=N&search-input=active
monstercoupons	Monster-Coupons	monster-coupons.com/search.php?q={s}
moraneducation	Moran Education	www.moraneducation.com/index.php?route=product/search&search={s}
mozillasupport	Mozilla Support	support.mozilla.org/search?q={s}
nationalreview	National Review	www.nationalreview.com/?s={s}
niebezpiecznik	Niebezpiecznik	niebezpiecznik.pl/?s={s}
notalwaysright	Not Always Right	notalwaysright.com/?s={s}
nutritionfacts	NutritionFacts.org	nutritionfacts.org/?s={s}
onestopenglish	Onestopenglish	www.onestopenglish.com/searchResults.aspx?keywords={s}
openprocessing	OpenProcessing	www.openprocessing.org/search/?q={s}
oxfordlearners	Oxford learners dictionary	www.oxfordlearnersdictionaries.com/definition/english/{s}
ozsmoke.com.au	www.ozsmoke.com.au	ozsmoke.com.au/search/?q={s}
particleforums	Particle Community	community.particle.io/users/{s}/
pathfinderwiki	Pathfinder Wiki	pathfinderwiki.com/mediawiki/index.php?title=Special:Search&search={s}
platekompaniet	Platekompaniet	platekompaniet.no/search/?q={s}
protoncalendar	Proton Calendar	calendar.proton.me/search#keyword={s}
rollingstoneit	Rolling Stone Italia	www.rollingstone.it/?s={s}
scrabblelookup	scrabblelookup	www.scrabblelookup.com/word/portion/search/{s}
sechenovclinic	www.sechenovclinic.ru	www.sechenovclinic.ru/search/index.php?q={s}
sfxperformance	SFX performance	sfxperformance.com/search/part-search.asp?search={s}
sheetmusicplus	Sheet Music Plus	www.sheetmusicplus.com/search?q={s}
siemenssupport	Siemens Industry Support	support.industry.siemens.com/cs/search?search={s}
skypecommunity	Skype Community	community.skype.com/t5/forums/searchpage/tab/message?filter=labels,location&location=category:English&q={s}
slidescarnival	Slides Canival	www.slidescarnival.com/?s={s}
sonofmarketing	Son of Marketing	www.sonofmarketing.it/?q={s}
soundtrackinfo	Soundtrack info project	www.soundtrackinfo.com/search/{s}/
sqprofessional	SQ Professional	www.sqprofessional.com/?q={s}
suivicolissimo	Suivi Colissimo	www.colissimo.fr/portail_colissimo/suivre.do?language=fr_FR&parcelnumber={s}
supercoachtalk	SupercoachTalk	supercoachtalk.com/?s={s}
thefutoncritic	The Futon Critic	www.thefutoncritic.com/search.aspx?q={s}&type=titles
ticketmasteruk	Ticketmaster UK	www.ticketmaster.co.uk/search?tm_link=tm_homeA_header_search&user_input=test&q={s}
tvseriesfinale	TVSeriesFinale	tvseriesfinale.com/?s={s}
videodetective	Video Detective	www.videodetective.com/Search/Results?id={s}
voedingswaarde	Voedingswaardetabel.nl	www.voedingswaardetabel.nl/voedingswaarde/?q={s}
wikipediocracy	Wikipediocracy (blog)	wikipediocracy.com/?s={s}
williamssonoma	Williams-Sonoma	www.williams-sonoma.com/search/results.html?words={s}
bellevuecollege	Bellevue College	www.bellevuecollege.edu/search/?txtQuery={s}&search=Search
canadacomputers	Canada Computers	www.canadacomputers.com/advanced_search_result.php?keywords={s}
chillingeffects	Chilling Effects	www.chillingeffects.org/notices/search?&term={s}
citroenc3owners	citroenC3owners.com	citroenc3owners.com/search.php?keywords={s}&terms=all&author=&fid[]=5&sc=1&sf=all&sk=t&sd=d&sr=posts&st=0&ch=300&t=0&submit=Search
demeureetjardin	Demeure et Jardin	www.demeure-et-jardin.com/?q={s}
designdirectory	Design Directory	www.dexigner.com/directory/search.html?q={s}
eveningstandard	London Evening Standard	www.standard.co.uk/search/site/{s}
forewordreviews	Foreword Reviews	www.forewordreviews.com/search/?q={s}
fotbollskanalen	Fotbollskanalen	www.fotbollskanalen.se/sok?q={s}
guardianproject	Guardian Project	guardianproject.info/?s={s}
hobby-machinist	The Hobby Machinist	www.hobby-machinist.com//?={s}
howtomakemyblog	HowToMakeMyBlog	howtomakemyblog.com/?s={s}
istoric-preturi	Istoric Preturi	www.istoric-preturi.info/search/{s}
jumbosupermarkt	Jumbo Supermarkten	www.jumbo.com/zoeken?SearchTerm={s}
kinderfilmliste	KinderFilmListe.de	www.kinderfilmliste.de/?suche={s}
lyricstranslate	Lyrics Translate	lyricstranslate.com/en/site-search?query={s}
mdresourcepacks mrresourcepacks	Modrinth (Resource Packs)	modrinth.com/resourcepacks?q={s}
musiciansfriend	Musician's Friend	www.musiciansfriend.com/search/search.jsp?sB=r&question={s}
mymovingreviews	MyMovingReviews.com	www.mymovingreviews.com/search.php?q={s}&x=0&y=0
offerteinternet	Offerte Internet	www.offerteinternet.net/?s={s}
officefurniture	Office Furniture Direct	www.office-furniture-direct.co.uk/search?query={s}
palatinelibrary	Palatine Public Library	encore.palatinelibrary.org/iii/encore/search?target={s}
poolsupplyworld	Pool Supply World	www.poolsupplyworld.com/search.htm?searchBox={s}&x=0&y=0
princetonreview	Princeton Review	www.princetonreview.com/search-results?q={s}
programmerhumor	Reddit /r/ProgrammerHumor	www.reddit.com/r/ProgrammerHumor/search?q={s}&restrict_sr=on
repubblicavideo	La Repubblica Video	ricerca.repubblica.it/ricerca/repubblica-video?query={s}&view=repubblica-video
robertchristgau	Robert Christgau CG	robertchristgau.com/get_artist.php?name={s}
schnittberichte	Schnittberichte	www.schnittberichte.com/svds.php?Page=Suche&String={s}
scottsradiosite	Scott's Radio Site	www.scottsradiosite.co.uk/?s={s}
securityheaders	securityheaders.io	securityheaders.io/?q={s}&followRedirects=on
startpagevideos	StartPage (videos)	startpage.com/do/search?cat=video&cmd=process_search&query={s}
tfdencyclopedia	The Free Dictionary (Encyclopedia)	encyclopedia2.thefreedictionary.com/{s}
visitwarrington	Visit Warrington	visitwarrington.com/explore/?type=search-all&search_keywords={s}&sort=latest
worshiptogether	worshiptogether.com	worship-songs-resources.worshiptogether.com/search?w={s}
allaboutcircuits	allaboutcircuits	www.allaboutcircuits.com/scripts/search.html?q={s}
answersingenesis	Answers in Genesis	answersingenesis.org/search/?q={s}
betterworldbooks	betterworldbooks.com	betterworldbooks.com/?q={s}
centredailytimes	Centre Daily Times	www.centredaily.com/search/?q={s}
clockworksynergy	Clockwork Synergy	www.clockworksynergy.com/?s={s}&post_type=product
cultureunplugged	CultureUnplugged.com	www.cultureunplugged.com/festival/gsearch.php?q={s}
datasheetarchive	Datasheet Archive	www.datasheetarchive.com/{s}-datasheet.html
ebgamesaustralia	EB Games Australia	www.ebgames.com.au/any/any?q={s}
ebukaokoriesblog	ebuka okories blog	ebukaokorie.blogspot.com/search?q={s}
freelancinghacks	Freelancing Hacks	freelancinghacks.com/?s={s}
listadomangablog	Listado manga blog	www.listadomanga.es/blog/?s={s}
lovebusinessexpo	Love Business EXPO	www.lovebusinessexpo.co.uk/search/?q={s}
statsbiblioteket	Statsbiblioteket Aarhus	www.statsbiblioteket.dk/au/?locale=en#/search?query={s}
thecheckeredflag	The Checkered Flag	www.thecheckeredflag.co.uk/?s={s}
trueachievements	TrueAchievements	www.trueachievements.com/searchresults.aspx?search={s}
webdesignerdepot	Web Designer Depot	www.webdesignerdepot.com/?q={s}
baseballreference	Baseball-Reference	www.baseball-reference.com/pl/player_search.cgi?search={s}
brainpopeducators	BrainPOP Educators	educators.brainpop.com/search/?q={s}
catalandictionary	CatalanDictionary.org	www.catalandictionary.org/en/search/?q={s}
danielshomecenter	Daniel's Home Center	www.danielshomecenter.com/catalogsearch/result/?q={s}
envatomarkettheme	Envato Marketplace	themeforest.net/search?term={s}
ilovefreesoftware	I Love Free Software	www.ilovefreesoftware.com/gsearch?q={s}
mountainwarehouse	Mountain Warehouse	www.mountainwarehouse.com/search/{s}/
outdoorandcountry	Outdoor and Country	www.outdoorandcountry.co.uk/search/go?w={s}
quoteinvestigator	Quote Investigator	quoteinvestigator.com/?s={s}
searchenginewatch	Search Engine Watch	searchenginewatch.com/?s={s}
thehimalayantimes	The Himalayan Times	thehimalayantimes.com/?s={s}
dreamcareerbuilder	DreamCareerBuilder	www.dreamcareerbuilder.com/findjob.php?keyword={s}
innerlightcrystals	Inner Light Crystals	innerlightcrystals.co.uk/sales/index.php?main_page=advanced_search_result&keyword={s}&search_in_description=1
marginalrevolution	Marginal Revolution	marginalrevolution.com/?s={s}
publicintelligence	Public Intelligence	publicintelligence.net/?s={s}
americastestkitchen	AmericasTestKitchen	americastestkitchen.com/search?q={s}
asearchoficeandfire	A Search of Ice and Fire	asearchoficeandfire.com/?q={s}
bostonpubliclibrary	Boston Public Library	bpl.bibliocommons.com/search?q={s}&t=smart&search_category=keyword&commit=Search&submitsearch=go&se=catalog
candlestickpatterns	Candlestick Patterns	www.candlestickpatterns.org/?s={s}
collegeconfidential	CollegeConfidential Forums	www.collegeconfidential.com/search_results.htm?q={s}
cottrillcompassblog	Cottrill Compass blog	cottrillcompass.com/blog/?s={s}
cuchilleriaalbacete	Cuchilleria Albacete - Grupo Marpasi S.L.	cuchilleriaalbacete.com/articulos-buscar.php?busco={s}
whitetailproperties	Whitetail Properties	www.whitetailproperties.com/hunting-land/filtered-search?search_mode=all&keywords={s}
worldcubeassociation	World Cube Association	www.worldcubeassociation.org/search?q={s}`;
const BANG_LIST_UNICODE = `g п goog google	Google	www.google.com/search?q={s}
õ õs	Eesti õigekeelsussõnaraamat	www.eki.ee/dict/qs/index.cgi?Q={s}
γ ggr	Google GR	www.google.gr/search?q={s}&meta=&aq=f&aqi=g10&aql=&gs_rfai=
в	Wikipedia (Ukraine)	uk.m.wikipedia.org/wiki/{s}
г	Google Ru	google.com/search?hl=ru&q={s}
л	Лабиринт	www.labirint.ru/search/{s}
ц вики	Википедия	ru.wikipedia.org/w/index.php?search={s}&
ш wru шру ruwk w.ru ruwiki wikiru	Russian Wikipedia	ru.wikipedia.org/w/index.php?search={s}
я ya yandex	Yandex	ya.ru/search?text={s}
ג gil	Google Israel	www.google.co.il/#q={s}
و	ويكيبيديا العربية	ar.wikipedia.org/wiki/Special:Search?search={s}
ㄴ na nv naver	NAVER	search.naver.com/search.naver?query={s}
3m	Trójmiasto	www.trojmiasto.pl/s/{s}/
ac allo allocine allociné	Allociné	www.allocine.fr/rechercher/?q={s}
aj ajl ajp amjp amazonjp	アマゾン (Amazon Japan)	www.amazon.co.jp/s?k={s}
äx	Levykauppa Äx	www.levykauppax.fi/search/?q={s}
d3 д3	dirty.ru	dirty.ru/search/?query={s}
e1 е1	e1	www.e1.ru/news/search/?search={s}
fl фл гмп gluck lucky	Google Feeling Lucky	www.google.com/search?btnI&q={s}
gc contacts gcontact контакты	Google Contacts	contacts.google.com/search/{s}
gd гд гдок gdocs гдокс гдокументы	Google Docs	docs.google.com/document/u/0/?q={s}
gg гг ggroups	Google Groups	groups.google.com/groups/search?q={s}&qt_s=Search+Groups
gm gmap gmaps гкарты googlemap googlemaps	Google Maps	maps.google.com/maps?q={s}
gp gapp play плей gplay гплей плейстор playstore googleplay	Google Play Store	play.google.com/store/search?q={s}
gt гп gten gtenglish gt-english gtranslate	Google Translate (to English)	translate.google.com/#auto/en/{s}
gv гв	Google Video	www.google.com/search?tbm=vid&q={s}
já	Já.is	ja.is/?q={s}
jd	京东网上商城	search.jd.com/Search?keyword={s}&enc=utf-8
kg кг	KG-Portal	kg-portal.ru/?search&s_str={s}
or	Obchodní rejstřík – Ministerstvo spravedlnosti České republiky	or.justice.cz/ias/ui/rejstrik-$firma?jenPlatne=PLATNE&nazev={s}&polozek=50&typHledani=STARTS_WITH
pa	Páginas Amarillas	www.paginasamarillas.es/search/all-ac/all-ma/all-pr/all-is/all-ci/all-ba/all-pu/all-nc/1?what={s}
pe	Dicionário Porto Editora	www.infopedia.pt/dicionarios/pesquisa/{s}
qc	Questões de Concursos	www.qconcursos.com/busca?q={s}
sz	Süddeutsche Zeitung	suche.sueddeutsche.de/news?search={s}
ty yt υτ ют you ytb ютуб watch youtube	YouTube	www.youtube.com/results?search_query={s}
ub	Göteborgs universitetsbibliotek / University of Gothenburg library	gu-se-primo.hosted.exlibrisgroup.com/primo-explore/search?query=any,contains,{s}&tab=default_tab&search_scope=default_scope&vid=46GUB_VU1&lang=sv_SE&offset=0
vk вк	Vkontakte	vk.com/search?c[q]={s}&c[section]=auto
vz	Verslo žinios	www.vz.lt/section/?template=search&search={s}
yr	yr.no/NRK/Meteorologisk institutt Weather	www.yr.no/nb/søk?q={s}
ys яп яс yad ytr slov yaslovari	Yandex Translate	translate.yandex.ru/?text={s}
вн	викиновости	ru.wikinews.org/wiki/Служебная:Поиск?search={s}
вс wikru wiktru	Викисловарь	ru.wiktionary.org/w/index.php?search={s}
гз keep гзаметки	Google Keep	keep.google.com/#search/text={s}
гк	Google Images Russian	www.google.ru/search?q={s}&tbm=isch
гн gnru	Google News RU	www.google.ru/search?q={s}&tbm=nws&cad=h
гс гпрез гслайд gslides гслайдс гпрезентации	Google Slides	slides.google.com/presentation/u/0/?q={s}
гш gsh гшит гшитс gsheet gsheets гтаблицы gspreadsheets	Google Spreadsheets	docs.google.com/spreadsheets/u/0/?q={s}
д2 d2r drive2 драйв2	Drive2.ru	www.drive2.ru/search?text={s}
кп kino kpoisk кинопоиск	Kinopoisk	www.kinopoisk.ru/index.php?first=no&what=&kp_query={s}
мш myshows	myshows.ru	myshows.me/search/?q={s}
пш	Google Images (ru)	www.google.ru/search?tbm=isch&q={s}
рк rcruen реверсо	Reverso Context Russian-English	context.reverso.net/translation/russian-english/{s}
рт рутуб rutube	RuTube	rutube.ru/search.html?page=index&search={s}&search_type=track
яв yav	Yandex Video	ya.ru/video/search?text={s}
як yai yak	Yandex Images	ya.ru/images/search?text={s}
ям mya яма yama yandexm ямаркет	Yandex Market	market.yandex.ru/search?text={s}
사전 stdict	Standard Korean Language Dictionary	stdict.korean.go.kr/search/searchResult.do?searchKeyword={s}
3ds exaled	Dassault Systèmes	www.3ds.com/search/?q={s}
a.a	Aktüel Adam	aktueladam.com/?s={s}
aae aax àax albex	Album Art Exchange	www.albumartexchange.com/covers.php?q={s}
aat	Art & Architecture Thesaurus® Online	www.getty.edu/vow/AATServlet?english=N&find={s}&logic=AND&page=1&note=
amx amazonmx	Amazon México	www.amazon.com.mx/s?k={s}
art	Apărătorul Ortodox	www.aparatorul.md/?s={s}
aru arukereso	Árukereső	www.arukereso.hu/CategorySearch.php?st={s}
asi	AsíHablamos	www.asihablamos.com/www/significado/palabra/{s}
bbm	Biblioteca Brasiliana Guita e José Mindlin	digital.bbm.usp.br/simple-search?location=&query={s}
bdg bdt bedetheque	Bedethèque	www.bedetheque.com/search/tout?RechTexte={s}&RechWhere=0
bdl	Banque de dépannage linguistique	bdl.oqlf.gouv.qc.ca/bdl/gabarit_bdl.asp?T1={s}&T3.x=0&T3.y=0
bgm	Bangumi 番组计划	bgm.tv/subject_search/{s}?cat=all
bin	Beygingarlýsing íslensks nútímamáls	bin.arnastofnun.is/leit/?q={s}
bkl	博客來	search.books.com.tw/search/query/key/{s}/cat/all
blk booklooker	Booklooker	www.booklooker.de/Bücher/Angebote/infotext={s}
bna	Banco de la Nación Argentina	www.bna.com.ar/Buscador?q={s}
bpb	Bundeszentrale für politische Bildung	www.bpb.de/suche/?suchwort={s}&suchen=Suchen
bpp	Bibliothèques de prêt de la Ville de Paris	bibliotheques.paris.fr/Default/search.aspx?SC=CATALOGUE&QUERY={s}&QUERY_LABEL=
bvs	Biblioteca Virtual em Saúde	pesquisa.bvsalud.org/regional/?q={s}
chm	La chaine météo	www.lachainemeteo.com/synthese-previsions-meteo-{s}
clt	東京都の図書館横断検索 | カーリル	calil.jp/local/search?csid=tokyo&q={s}
csn	Catálogo cisne UCM	cisne.sim.ucm.es/search*spi~S/X?SEARCH={s}&sort=D
dba	Den Blå Avis	www.dba.dk/soeg/?soeg={s}
dcs	Rutgers University – Digital Classroom Services	dcs.rutgers.edu/search/node/{s}
ded	Dedalus - Catálogo Geral	dedalus.usp.br/F/2GT4AME1FV9M25Q886NF9PCLB2BK39NF8XMFRXNHCQIL1JX5IG-19193?func=find-b&request={s}&find_code=WRD&adjacent=N&local_base=USP01&x=39&y=11&filter_code_1=WLN&filter_request_1=&filter_code_2=WYR&filter_request_2=&filter_code_3=WYR&filter_request_3=&filter_code_4=WMA&filter_request_4=&filter_code_5=WBA&filter_request_5=
din	Dicionário inFormal	www.dicionarioinformal.com.br/{s}
dle rae	Diccionario de la lengua española, 23.ª Edición, RAE	dle.rae.es/?w={s}
dme	DMM英会話なんてuKnow?	eikaiwa.dmm.com/uknow/search/?keyword={s}
dmf	Dictionnaire du Moyen Français	www.cnrtl.fr/definition/dmf/{s}
dnv	Diccionari Normatiu Valencià	www.avl.gva.es/lexicval/dnv?paraula={s}
doe	Das Örtliche	www.dasoertliche.de/Controller?form_name=search_inv&page=5&context=4&action=43&ph={s}
dpd	Diccionario panhispánico de dudas	lema.rae.es/dpd/?key={s}
drw	Deutsches Rechtswörterbuch	drw-www.adw.uni-heidelberg.de/drw-cgi/zeige?term={s}&index=lemmata
dsn retskriv	Dansk Sprognævn	dsn.dk/?retskriv={s}&ae=0
dsv	DSV SU	dsv.su.se/sök?q={s}
dwb	Deutsches Wörterbuch von Jacob Grimm und Wilhelm Grimm	woerterbuchnetz.de/DWB/?lemma={s}
dwe	DW - Actualidad en español	www.dw.com/search/es?languageCode=es&item={s}
e2u	Англійсько-українські словники	e2u.org.ua/s?w={s}&dicts=all&highlight=on
eir	Encyclopædia Iranica	www.iranicaonline.org/articles/search/keywords:{s}
ekk	ebay Kleinanzeigen Köln	www.ebay-kleinanzeigen.de/s-koeln/{s}/k0l945
ekm	eBay Kleinanzeigen München	www.ebay-kleinanzeigen.de/s-muenchen/{s}/k0l6411
eow	英辞郎 on the WEB Pro	eowp.alc.co.jp/search?q={s}
fcb	FC Bayern München	www.fcbayern.de/de/search#search={s}&chronology=chrono
fdb	Filmová Databáze	www.fdb.cz/vyhledavani.php?co=vsechno&hledat={s}
fes	Eesti fraseologismide elektrooniline alussõnastik	www.folklore.ee/justkui/sonastik/?otsing={s}&paring=Otsi
gaf	Gaffiot latin -> français	www.lexilogos.com/latin/gaffiot.php?q={s}
gai гии googleai	Google AI Mode	www.google.com/search?q={s}&udm=50
gbg гбг	Google BG	www.google.bg/search?q={s}
gdz	Göttinger Digitalsieriungszentrum	gdz.sub.uni-goettingen.de/en/dms/suche/?tx_goobit3_search[formquery]={s}&tx_goobit3_search[order]=1&tx_goobit3_search[default]=METADATA&tx_goobit3_search[orderfield]=BYCREATOR&tx_goobit3_search[link]=0
gic гкк	Google Images Classic	www.google.com/search?q={s}&tbm=isch&sout=1
goe	Stadtportal Göttingen	www.goettingen.de/portalsuche.html?keyword={s}
goo	goo検索	search.goo.ne.jp/web.jsp?MT={s}&IE=UTF-8&OE=UTF-8
gre брэ bigenc	Большая российская энциклопедия	bigenc.ru/search?q={s}
gue guenstiger	Günstiger.de	www.guenstiger.de/Katalog/Preis.pl?suche={s}
gyk kerdes	Gyakorikérdések.hu	www.gyakorikerdesek.hu/kereses.php?keres={s}
ijp ujc	Internetová jazyková příručka	prirucka.ujc.cas.cz/?slovo={s}
isl	İslam Ansiklopedisi	islamansiklopedisi.org.tr/arama/?q={s}&p=m
jlm	Jean-Luc Mélenchon	www.jean-luc-melenchon.fr/?s={s}
kji	漢字辞典オンライン (Online kanji dictionary)	kanji.jitenon.jp/cat/search.php?getdata={s}
liu	Linköping University	search.liu.se/en/?query={s}
lmc	Les maîtres composeurs	les-maitres-composeurs.fr/?s={s}&post_type=product
lmu	Universitätsbibliothek der Ludwig-Maximilians-Universität (LMU) München	opac.ub.uni-muenchen.de/TouchPoint/start.do?View=sunrise&Language=de&Query=-1="{s}"
lnu	Linnéuniversitetet Bibliotek LNU	lnu-se-primo.hosted.exlibrisgroup.com/primo-explore/search?query=any,contains,{s}&search_scope=default_scope&sortby=rank&vid=primo-custom-lnu&pcAvailability=false&lang=sv_SE
lor лор	Linux.org.ru	www.linux.org.ru/search.jsp?q={s}&range=ALL&interval=ALL&user=&_usertopic=on
lpo	La Política Online	www.lapoliticaonline.com/0/buscar/index.vnc?id={s}
lsf	Librerías Santa Fe	www.lsf.com.ar/resulta.aspx?key={s}
mdu	Manual do Usuário	manualdousuario.net/?s={s}
mdz	Münchener DigitalisierungsZentrum	digitale-sammlungen.de/search?query={s}
mfx morfix מורפיקס	Morfix	www.morfix.co.il/{s}
mgm	Türkiye Cumhuriyeti Orman ve Su İşleri Bakanlığı Meteoroloji Genel Müdürlüğü	www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx?il={s}
mkp	Městská knihovna v Praze	search.mlp.cz/cz/?query={s}
mrw	MRW España	www.mrw.es/seguimiento_envios/MRW_resultados_consultas.asp?modo=nacional&envio={s}
mvv	Münchner Verkehrs- und Tarifbund (MVV)	efa.mvv-muenchen.de/index.html?name_destination={s}
myo	Medios y Opinión	www.plazademayo.com/mediosyopinion/?s={s}
myt ytm ютм ytmu ytmusic	YouTube Music	music.youtube.com/search?q={s}
nbd bokmålsordboka	Bokmålsordboka	ordbokene.no/nob/bm/{s}
nem m163	网易云音乐	music.163.com/#/search/m/?s={s}
ngü	NGÜ auf Bibleserver	www.bibleserver.com/search/NGÜ/{s}
nls	National Library of Scotland=Leabharlann Nàiseanta na h-Alba	search.nls.uk/discovery/search?query=any,contains,{s}&tab=MainCatalogue&search_scope=MainCatalogue&vid=44NLS_INST:44NLS_VU1&offset=0
nlw	Nolife-Wiki	nolife-wiki.fr/index.php?title=Spécial:Recherche&go=Lire&search={s}
noi	CCF NOI 官网	www.noi.cn/search.html?q={s}
noz	Neue Osnabrücker Zeitung	www.noz.de/suche/?q={s}
nzz	Neue Zürcher Zeitung	www.nzz.ch/suche?form[q]={s}
oas	Offres à Saisir	www.offresasaisir.fr/recherche?q={s}
ole	Olé	buscador.ole.com.ar/{s}
oqc	OùQuoiComment	www.ouquoicomment.ch/?s={s}&search_by=all
ord	Norstedts ordböcker	ne.ord.se/ordbok/svenska/engelska/sök/{s}
oru	Örebro University	www.oru.se/funktioner/sokresultat/?query={s}
pap	Papskubber.dk	www.papskubber.dk/?q={s}&s=search&submitbutton=Søg
pkb пкб pikabu пикабу	Pikabu.ru	pikabu.ru/search.php?q={s}
por	Poradnia Języka Polskiego	sjp.pwn.pl/poradnia/szukaj/{s}.html
qes	Quora Español	es.quora.com/search?q={s}
qim qimartiste quebecinfomusique	Québec Info Musique	www.qim.com/artistes/artiste.asp?search={s}
qun	群点科技	qunwang6.github.io/?q={s}
r2u	Російсько-українські словники	r2u.org.ua/s?w={s}&scope=all&dicts=all&highlight=on
rcf	RCF, Radio Chrétienne Francophone	rcf.fr/rechercher/{s}
rex	REX – The Royal Library and Copenhagen University Library Service	rex.kb.dk/primo_library/libweb/action/search.do?fn=search&vl(freeText0)={s}
rkn	Роскомсвобода (rublacklist)	reestr.rublacklist.net/search/?q={s}
rte	Raidió Teilifís Éireann	www.rte.ie/search/?query={s}
rts	Radio télévision suisse	www.rts.ch/services/recherche/?q={s}
rxp рукс руксперт	Ruxpert	ruxpert.ru/index.php?search={s}
scz	ABZ.cz: slovník cizích slov	slovnik-cizich-slov.abz.cz/web.php/hledat?typ_hledani=prefix&cizi_slovo={s}
sin sinonimos	Dicionário de Sinônimos	www.sinonimos.com.br/{s}
sjp	Słownik Języka Polskiego	sjp.pwn.pl/szukaj/{s}.html
sk1	Sk1er’s Stats	sk1er.club/stats/{s}
skd korpus slovak slovniky	Slovenské slovníky	slovnik.juls.savba.sk/?w={s}
sys	Sünonüümisõnastik	www.eki.ee/dict/sys/index.cgi?Q={s}&F=M&C06=en
tåg	Tåginformation Sverige (Trafikverket)	www.trafikverket.se/trafikinformation/tag/?&TrainOrStation={s}
tdg	Tribune de Genève	www.tdg.ch/services/recherche/?order=date&q={s}&submitSearch=Chercher&date=alle
tdk	Türk Dil Kurumu	sozluk.gov.tr/?kelime={s}
thb	THBWiki	thwiki.cc/特殊:搜索?search={s}&go=前往&searchToken=d3hpaqueyzu0cl5im2izrofz8
tib	TIB/UB-OPAC (Library of Leibniz Universität Hannover)	opac.tib.uni-hannover.de/DB=1/CHARSET=UTF-8/SRCH?IKT=1016&TRM={s}
tmk	Temátika	www.tematika.com/catalogsearch/result/?q={s}
ubl	Universitätsbibliothek Leipzig	katalog.ub.uni-leipzig.de/Search/Results?lookfor={s}
ubt	Universitätsbibliothek Tübingen	rds-tue.ibs-bw.de/opac/RDSIndex/Search?lookfor={s}
ubu	UbuWeb	search.freefind.com/find.html?si=61902956&pid=r&n=0&_charset_=UTF-8&bcd=÷&query={s}
ugo	UGO decoración	www.ugodecoracion.com/buscar?controller=search&orderby=position&orderway=desc&search-cat-select=0&search_query={s}&submit_search=
uib norsk ordbok	Bokmålsordboka og Nynorskordboka	ordbokene.no/nob/bm,nn/{s}
uio	UiO emnesøk	www.uio.no/studier/emner/?course-query={s}&vrtx=search&searchMode=emne
uja	Universidad de Jaén	www.ujaen.es/search?s={s}
ulb	Bibliothèques de l'Université Libre de Bruxelles	cibleplus.ulb.ac.be/primo-explore/search?query=any,contains,{s}&tab=default_tab&search_scope=default_scope&vid=32ULB_VU1&lang=fr_FR&offset=0
vcp	VCP Sanitärfachhandel	shop.vcp-san.at/index.php?main_page=advanced_search_result&search_in_description=1&keyword={s}
vgn	Ver­kehrs­ver­bund Groß­raum Nürn­berg	www.vgn.de/verbindungen/?td={s}
vkv вкв	Vkontakte video	vk.com/video?q={s}
wbj	Wikibooks JP	ja.wikibooks.org/w/index.php?search={s}&title=特別:検索&go=表示
whe ויקי hewiki wikihe hebwiki	Hebrew Wikipedia	he.wikipedia.org/w/index.php?search={s}
wob	World of Boardgames	www.worldofboardgames.com/webshop-sok.php?searchString={s}&search=S�k
woo воо	WooordHunt	wooordhunt.ru/word/{s}
wse	Wikipedia – Friddje diehtosátnegirji	se.wikipedia.org/w/index.php?search={s}
zhi zhihu	知乎	www.zhihu.com/search?type=content&q={s}
zli	ZLI Zürich	www.zli.ch/service/suche/?q={s}
ςγρ	greek wikipedia	el.wikipedia.org/wiki/?search={s}
днс dnsshop	DNS	www.dns-shop.ru/search/?q={s}
лео leor leoru	LEO Dictionary Russian	dict.leo.org/russisch-deutsch/{s}
сцп scpru	SCP foundation --- Russian branch	scpfoundation.net/search:site/q/{s}
тст te-st теплица	Теплица социальных технологий	te-st.ru/?s={s}
юла youla	Youla / Юла	youla.ru/?q={s}
яму yamu yamusic	Yandex Music	music.yandex.ru/search?text={s}
նայ	Nayiri	nayiri.com/search?l=hy_LB&dt=HY_HY&r=0&query={s}
חוק	Israeli Open Law project at Hebrew Wikisource	he.wikisource.org/w/index.php?search=חוק+{s}
1177	1177 Vårdguiden	www.1177.se/Sok/?q={s}
11st	11번가	search.11st.co.kr/SearchPrdAction.tmall?method=getTotalSearchSeller&kwd={s}
2gis 2гис двагис дубльгис	2GIS	2gis.ru/search/{s}
abol	Åbo Alma-Finna	abo.finna.fi/Search/Results?lookfor={s}&type=AllFields
acad акад академик	Словари и энциклопедии на Академике	dic.academic.ru/searchall.php?SWord={s}
adme адми	Adme.ru	www.adme.ru/search/?q={s}
agri	Agri-Réseau	www.agrireseau.net/documents?r={s}
banq	Bibliothèque et Archives Nationales du Québec	www.banq.qc.ca/techno/recherche/rms.html?keyword={s}&Recherche=tout&fonction=chercher&afficherPortail=checked&afficherIris=checked&afficherPistard=checked&afficherColNum=checked
bdtr	百度翻译	fanyi.baidu.com/#en/zh/{s}
bfde	babelfish.de	www.babelfish.de/dict?query={s}&src=auto&dst=en&submit=übersetzen
bsag	Bremer Straßenbahn AG	www.bsag.de/index.php?q={s}
bund	Bund für Umwelt und Naturschutz	www.bund.net/service/suchergebnis/?L=0&q={s}
bup8	Université Paris 8 (Bibliothèque)	catalogue.bu.univ-paris8.fr/cgi-bin/koha/opac-search.pl?idx=&q={s}
cnne	CNN en español	cnnespanol.cnn.com/?s={s}
csfd	ČSFD	www.csfd.cz/hledat/?q={s}
cybl кибл киберленинка	Киберленинка	cyberleninka.ru/search?q={s}
ddic 다음사전 daumdic	Daum 어학사전	dic.daum.net/search.do?q={s}
deco	Decoración 2.0	decoracion2.com/search/{s}
defr	dict.cc Deutsch-Französisch	defr.dict.cc/?s={s}
denl	Dict.cc Deutsch-Niederländisch	denl.dict.cc/?s={s}
dhbb	Dicionário Histórico e Biográfico Brasileiro do CPDOC	www.fgv.br/cpdoc/acervo/arquivo?busca={s}&TipoUD=0&MacroTipoUD=0&nItens=100
dplg	Dicionário de Pronúncia da Língua Galega	ilg.usc.es/pronuncia/?pq=&q={s}&l=1&c[]=0
drae	Diccionario de la Lengua Española	dle.rae.es/srv/fetch?w={s}&m=30
drom дром	drom.ru	www.drom.ru/search/?q={s}
eksi ekşi sozluk eksisozluk	Ekşi Sözlük	eksisozluk.com/?q={s}
ekss	Eesti keele seletav sõnaraamat	www.eki.ee/dict/ekss/index.cgi?Q={s}&F=M
fass	Fass allmänhet	www.fass.se/m/sok/{s}/public
ffch	admin.ch - Feuille fédérale	www.admin.ch/opc/search/?lang=fr&language[]=fr&product[]=fg&text={s}&lang=fr
finf	Finf-Forum (Forum des Fachrats Informatik der Leibniz Universität Hannover)	forum.finf.uni-hannover.de/index.php?form=Search&q={s}
fran	Slovarji Inštituta za slovenski jezik Frana Ramovša ZRC SAZU	www.fran.si/iskanje?View=2&Query={s}
g100 г100	Google Search 100 Results	www.google.com/search?q={s}&tbo=1&num=100
gael	Fóclair.ie New English-Irish Dictionary	www.focloir.ie/en/spellcheck/ei/?q={s}
gcal гкал calendar календарь	Google Calendar	calendar.google.com/calendar/b/0/r/search?q={s}
ggif ггиф	Google Images (Animated)	www.google.com/search?q={s}&site=webhp&tbm=isch&tbs=itp:animated
gnbe	Google news België	news.google.com/news/search/section/q/{s}/?gl=BE&ned=nl_be&hl=nl
gode	goo 辞書 英和/和英 (en)	dictionary.goo.ne.jp/word/en/{s}/
godj	goo 辞書 英和/和英	dictionary.goo.ne.jp/srch/jn/{s}/m1u/
gods	goo 辞書 類語	dictionary.goo.ne.jp/thsrs/3913/meaning/m1u/{s}/
gwes	Games Workshop Webstore España	www.games-workshop.com/es-ES/searchResults?_dyncharset=UTF-8&_dynSessConf=7453102396832862391&qty=&sorting=&view=&Ntt={s}
habr хабр	HabraHabr	habr.com/ru/search/?&q={s}
huma	L'Humanité	www.humanite.fr/search/{s}
igif	Imgur — gifs	imgur.com/search/score?q=ext:gif+{s}
ikso	Ikso Kantaro	kantaro.ikso.net/?do=search&id={s}&fulltext=Serĉo
inah	Instituto Nacional de Antropología e Historia	www.inah.gob.mx/buscador?searchword={s}
juls	Slovníkový portál	slovniky.juls.savba.sk/?w={s}&s=exact&c=608a&d=kssj4&d=psp&d=sssj&d=scs&d=sss&d=peciar&d=ma&d=hssjV&d=bernolak&d=obce&d=priezviska&d=un&d=locutio&d=pskcs&d=psken&d=noundb&ie=utf-8&oe=utf-8#
jwde	Jehovas Zeugen — Offizielle Website: jw.org	www.jw.org/de/suche/?q={s}
jwes	Sitio oficial de los testigos de Jehová: jw.org	www.jw.org/es/búsquedas/?q={s}:
keel	e-keelenõu	kn.eki.ee/?Q={s}
kirp	Krajowa Izba Radców Prawnych	kirp.pl/?s={s}
kwzf	묻지마 검색	kwzf.net/#search={s}&page=1
laec	LAEC.fr – Le programme de Jean-Luc Mélenchon en ligne – L'Avenir En Commun	laec.fr/recherche?termes={s}
leof leofr	LEO Dictionary French	dict.leo.org/französisch-deutsch/{s}
libe	Libération	www.liberation.fr/recherche/?q={s}
lidf lingf	Linguee Deutsch <-> Français (German <-> French)	www.linguee.de/deutsch-franzoesisch/search?source=auto&query={s}
lifd linfd	Linguee Français <-> Deutsch (German <-> French) with French interface	www.linguee.fr/francais-allemand/search?source=auto&query={s}
love	LÖVE	love2d.org/w/index.php?title=Special:Search&search={s}&go=Go
lsdh	La sombra del helicóptero	lasombradelhelicoptero.com/?s={s}
medf	Mechanical Engineering » Discussion Forum » Questions & Answers	mechanicalsite.com/?s={s}
mlmx mercadolibremx	Mercadolibre México	listado.mercadolibre.com.mx/{s}
mmnt ммнт mamont мамонт	Mamont	www.mmnt.ru/get?st={s}&in=w
mppb	Medienpädagogik Praxis-Blog	www.medienpaedagogik-praxis.de/?s={s}
naob	NAOB – Det Norske Akademis ordbok	naob.no/søk?q={s}
osaa	OSAA Wiki	osaa.dk/wiki/index.php?title=Speciel:Search&search={s}&go=Gå+til
ozon озон	OZON	www.ozon.ru/search/?text={s}
pmfe	Pale Moon forum en español	forum.palemoon.org/search.php?keywords={s}&fid[0]=9
pwde pokewiki	PokéWiki.de	www.pokewiki.de/index.php?search={s}&button=&title=Spezial:Suche
qima qimalbum	Québec Info Musique (album)	www.qim.com/albums/albums.asp?search={s}
rsch	admin.ch - Recueil systématique	www.admin.ch/opc/search/?text={s}&lang=fr&product[]=cc&date_range_min=&date_range_max=&d_compilation=both&d_is_in_force=yes&thesaurus=1
rtes	RT en Español	actualidad.rt.com/search?q={s}
rtve	Corporación de Radio y Televisión Española	www.rtve.es/buscador/?q={s}
ruen кгут руан руен	Google Translate (ruen)	translate.google.com/#ru/en/{s}
rufr кгак руфр	Google Translate RU-FR	translate.google.com/#ru/fr/{s}
sack	Sackmühle	www.sackmuehle.de/?s=({s})
saob svenska	Svenska Akademiens Ordböcker	svenska.se/tre/?sok={s}&pz=1
sbrm	slounik.org: беларускія слоўнікі і энцыкляпэдыі	www.slounik.org/search?dict=&search={s}
sezs	Seznam.cz Slovník En-Cz	slovnik.seznam.cz/en-cz/word/?q={s}
siec	Sinònims - Institut d'Estudis Catalans	sinonims.iec.cat/sinonims_cerca_sin.asp?pclau2={s}&button=Cerca+arreu
sokr сокр	Sokr.ru - словарь сокращений	sokr.ru/{s}/
sopt	Stack Overflow em Português	pt.stackoverflow.com/search?q={s}
sqfa скфа	Square Faction	squarefaction.ru/main/search/google?searchQuery={s}
srde	Saarländischer Rundfunk	www.sr.de/sr/suche.jsp?phrase={s}
ssjc	Slovník spisovného jazyka českého	ssjc.ujc.cas.cz/search.php?heslo={s}
sued	süddeutsche.de	www.sueddeutsche.de/news?search={s}
suub	Staats- und Universitätsbibliothek Bremen	suche.suub.uni-bremen.de/cgi-bin/CiXbase/brewis/CiXbase_search?act=search&INDEXINFO=awCN&LAN=DE&ORDER=&IHITS=15&FHITS=15&PRECISION=220&RELEVANCE=40&NO_RBITS=&n_dtyp=1LZ&n_rtyp=ceEdX&index=L&XML_STYLE=/styles/cns-DE.xml?20130610&dtyp=&mtyp=&section=&term={s}&CID=&x=0&y=0
svwe	Stardew Valley Wiki Español	es.stardewvalleywiki.com/{s}
thme	Thomann en Español	www.thomann.de/es/search_dir.html?sw={s}&smcs=80cfba
ubfr	Universitätsbibliothek Freiburg	katalog.ub.uni-freiburg.de/opac/RDSIndex/Search?lookfor={s}&source=homepage
ubhd	Universitätsbibliothek Heidelberg	www.ub.uni-heidelberg.de/suche/suche.html?q={s}
ubks	Universitätsbibliothek Kassel	hds.hebis.de/ubks/Discover/EBSCO?lookfor={s}
ulbd	Universitätsbibliothek Düsseldorf	katalog.ulb.hhu.de/Search/Results?lookfor={s}&type=AllFields
unja	アンサイクロペディア	ja.uncyclopedia.info/wiki/{s}
uxul	Ein Templatesystem Für Templatesysteme	uxul.de/find?search={s}
vdfn	Vandale français-néerlandais	www.vandale.nl/opzoeken?pattern={s}&lang=fn
waru worldart ворлдарт	World-Art.ru	www.world-art.ru/search.php?public_search={s}&global_sector=all
whes whowes	Wikihow Español	es.wikihow.com/wikiHowTo?search={s}
wifr wtfr wiktfr fr.wiktionary	Wiktionary Français	fr.wiktionary.org/wiki/{s}
wjvf	Wiki de JV Flux	wiki.jvflux.com/index.php?title=Spécial:Recherche&search={s}
wklt	Lithuanian Wiktionary (Vikižodynas)	lt.wiktionary.org/w/index.php?search={s}
wqes	Wikiquote Español	es.wikiquote.org/w/?search={s}
wqpl	Wikiquote Polish	pl.wikiquote.org/w/index.php?search={s}&title=Specjalna:Szukaj&go=Przejdź
wsfr	Wikisource (FR)	fr.wikisource.org/w/index.php?search={s}&title=Spécial:Recherche&go=Lire
wsjp	Wielki Słownik Języka Polskiego	wsjp.pl/index.php?szukaj={s}&pwh=0
wtbg	Уикиречник	bg.wiktionary.org/wiki/{s}
wtpt wiktpt	Wikcionário (PT)	pt.wiktionary.org/wiki/{s}
wtsv	Wiktionary (SV)	sv.wiktionary.org/w/index.php?search={s}&button=&title=Special:Sök
wtta	விக்சனரி (Wiktionary Tamil)	ta.wiktionary.org/wiki/Special:Search?search={s}&go=Go
wtvi	Wiktionary tiếng Việt	vi.wiktionary.org/w/index.php?search={s}
wves	Wikivoyage español	es.wikivoyage.org/w/index.php?search={s}
wvfr	Wikivoyage Français	fr.wikivoyage.org/w/index.php?search={s}
wvpt	Wikivoyage Português	pt.wikivoyage.org/w/index.php?search={s}
wwes	WikiWand en Español	www.wikiwand.com/es/{s}
wwpt	Wikiwand em Portugês	www.wikiwand.com/pt/{s}
wwtr	WikiWand Türkçe	www.wikiwand.com/tr/{s}
yttv юттв	YouTube TV	tv.youtube.com/search/{s}
ytwd	Yahoo奇摩字典	tw.dictionary.search.yahoo.com/search?p={s}
zdic	汉典	www.zdic.net/search/?q={s}
βικι	Βικιπαίδεια	el.m.wikipedia.org/wiki/{s}
гост	docs.cntd.ru	docs.cntd.ru/search/intellectual?q={s}
лица faces	Google Images (Faces)	www.google.com/search?tbm=isch&tbs=itp:face&q={s}
мапс	Google Maps BG	www.google.bg/maps/search/{s}/
нпсд	НПСД	npsd.party/?s={s}
обои wallpaper	Google Images (wallpapers)	google.com/search?tbm=isch&imgsz=xxlarge&gbv=2&safe=off&q={s}+wallpaper&btnG=Search+Images&tbs=imgo:1
уики	Wikipedia (BG)	bg.wikipedia.org/wiki/{s}
хайн hinews хайньюс	Hi-News.ru	hi-news.ru/?s={s}
360so	360搜索	www.so.com/s?q={s}
adefb	Amazon.de Fremdsprachige Bücher	www.amazon.de/s?k={s}&i=english-books
aladi	Catàleg de la Xarxa de Biblioteques Municipals de la Diputació de Barcelona	aladi.diba.cat/search*cat/-{s}
altbe	Alternate België	www.alternate.be/html/search.html?query={s}
argep	ÁrGép	www.argep.hu/main.aspx?suche={s}&x=0&y=0
asahi	朝日新聞	sitesearch.asahi.com/.cgi/sitesearch/sitesearch.pl?Keywords={s}
atilf	Académie Française	academie.atilf.fr/9/consulter/{s}?page=1
avito авито	Avito	www.avito.ru/?q={s}
bazos	Bazoš.cz	www.bazos.cz/search.php?hledat={s}
bbusp	Biblioteca Brasiliana Guita e José Mindiin	digital.bbm.usp.br/simple-search?location=&query={s}&rpp=100
bdimg	百度图片	image.baidu.com/search/index?tn=baiduimage&ipn=r&ct=201326592&cl=2&lm=-1&st=-1&fm=index&fr=&hs=0&xthttps=111111&sf=1&fmq=&pv=&ic=0&nc=1&z=&se=1&showtab=0&fb=0&width=&height=&face=0&istype=2&ie=utf-8&word={s}&oq=test&rsp=-1
bilka	Bilka	www.bilka.dk/søg?tekst={s}
brreg	Brønnøysundregistrene	w2.brreg.no/enhet/sok/treffliste.jsp?navn={s}&orgform=0&fylke=0&kommune=0
cisne	Catálogo Cisne UCM	cisne.sim.ucm.es/search*spi~S/X?SEARCH={s}
ddgal	DuckDuckGo América Latina con Pale Moon	duckduckgo.com/?t=palemoon&kl=xl-es&ko=1&k1=1&q={s}
dhnet	La Dernière Heure	www.dhnet.be/search/?query={s}
dicpt infopedia	Dicionário Infopédia da Língua Portuguesa	www.infopedia.pt/dicionarios/lingua-portuguesa/{s}
drive гдиск драйв gdrive	Google Drive	drive.google.com/drive/search?q={s}
earth земля	Google Earth	earth.google.com/web/search/{s}
enfoc gafoc	Foclóir	www.focloir.ie/en/dictionary/ei/{s}
enges	Engadget en español	es.engadget.com/search/?q={s}
eo2en	glosbe eo › en	glosbe.com/eo/en/{s}
eorfr	Base de données d'Éorzéa	fr.finalfantasyxiv.com/lodestone/playguide/db/search/?q={s}
etnet	ETNet 經濟通	etnet.com.hk/?q={s}
fassv	Fass Vårdpersonal	www.fass.se/LIF/result?userType=0&query={s}
fbbva fundeu	Fundéu BBVA	www.fundeu.es/?s={s}
ffinv	파판14 인벤	ff14.inven.co.kr/dataninfo/item/?itemname={s}&datagroup=search
futar	BKK Futár	futar.bkk.hu/search/query/?query={s}
gagol	Graf-Anton-Günther Schule	gymnasium-gag.de/?s={s}
gizes	Gizmodo en español	es.gizmodo.com/search?q={s}
gw2fr	Guild Wars 2 Wiki Français	wiki-fr.guildwars2.com/index.php?search={s}
heidi	Universitätsbibliothek Heiedelberg OPAC	katalog.ub.uni-heidelberg.de/cgi-bin/search.cgi?fsubmit=1&query={s}
hitta	Hitta.se	www.hitta.se/sök?vad={s}
hmiku	初音ミク Wiki	www5.atwiki.jp/hmiku/?cmd=search&keyword={s}
horor horory horormagoria	Horormagória	horormagoria.sk/?s={s}
iciba	爱词霸	www.iciba.com/{s}
inbox гмейл гпочта	Inbox by Gmail	inbox.google.com/search/{s}
jrady	IDS JMK – jízdní řády Brno a Jihomoravský kraj	www.idsjmk.cz/jrady/{s}.pdf
kbors	Kuldne Börs	kuldnebors.ee/search/search.mec?search_evt=onsearch&pob_action=search&search_O_string={s}
kkbib	Københavns Biblioteker ( Copenhagen Libraries)	bibliotek.kk.dk/search/ting/{s}
köket	Köket	www.koket.se/search?searchtext={s}
libre	리브레 위키	librewiki.net/wiki/Special:Search?search={s}&go=Go
lugat	Kubbealtı Lugatı	www.lugatim.com/s/{s}
luxor	Knihkupectví NeoLuxor	neoluxor.cz/vyhledavani/?query={s}
malid	Málið	malid.is/leit/{s}
maori māori maoridictionary	Māori Dictionary	maoridictionary.co.nz/search?keywords={s}
mc-pl	Minecraft wiki poland	minecraft-pl.gamepedia.com/index.php?search={s}&title=Specjalna:Szukaj&go=Przejdź
msdjp	MSD Manual Japanese	www.msdmanuals.com/ja-jp/ホーム/SearchResults?query={s}
ne.se	Svenska Nationalencyklopedin	www.ne.se/sök/?t=uppslagsverk&q={s}
nifty	Nifty	search.nifty.com/websearch/search?cflg=検索&q={s}
opacp	Universitätsbibliothek Potsdam	opac.ub.uni-potsdam.de/DB=1/SET=4/TTL=1/CMD?ACT=SRCHA&IKT=1016&SRT=YOP&TRM={s}
orell	Orell Füssli	www.orellfuessli.ch/suche?utf8=%E2%9C%93&filterPATHROOT=&sq={s}
pkmce pocewiki	Pokémon Central Wiki	wiki.pokemoncentral.it/index.php?search={s}
platt	Plattdeutsch-Hochdeutsches Wörterbuch	www.platt-wb.de/platt-hoch/?term={s}
proff	Proff	www.proff.no/rollesøk?q={s}
pucsp	PUC-SP - Pontifícia Universidade Católica de São Paulo	www.pucsp.br/buscar?search_api_fulltext={s}&field_area_de_conhecimento=All&field_escola=&type=All
rconj спряжение	Bab.la Russian Verbs Conjugation	bab.la/conjugaison/russe/{s}
renpl	Reverso Context (enpl)	context.reverso.net/tłumaczenie/angielski-polski/{s}
rplen	context.reverso.net	context.reverso.net/tłumaczenie/polski-angielski/{s}
scdpo	SCD de l'Université de Poitiers (bibliothèques universitaires)	scd.summon.serialssolutions.com/search?s.q={s}
sesli	Sesli Sözlük	www.seslisozluk.net/?ssQBy=0&word={s}
smzdm	什么值得买	search.smzdm.com/?c=home&s={s}
sogou sougou	搜狗	www.sogou.com/web?query={s}
sspai	少数派	sspai.com/search/article?q={s}
tieba	百度贴吧	tieba.baidu.com/f?ie=utf-8&kw={s}
tmall	天猫	list.tmall.com/search_product.htm?q={s}
türen	tuerenmarkt24	tuerenmarkt24.de/suche?controller=search&orderby=position&orderway=desc&search_query=deur{s}
twpro	ツイプロ	twpro.jp/search?word={s}
ubjgu	Universitätsbibliothek Mainz	hds.hebis.de/ubmz/Search/Results?lookfor={s}&trackSearchEvent=Einfache+Suche&type=allfields&search=new&submit=Suchen
ufind	u:find - Universität Wien	ufind.univie.ac.at/de/search.html?filter=all&query={s}
ufret	U-フレット	www.ufret.jp/search.php?key={s}
unbri	Universidade de Brasília / Repositório Institucional	repositorio.unb.br/simple-search?query={s}&submit=Ir
unigö	Georg-August-Universität Göttingen	www.uni-goettingen.de/de/suche.html?query={s}
unimc	Università degli Studi di Macerata	www.unimc.it/@@search?SearchableText={s}
varle	Varlė	www.varle.lt/search/?q={s}
vdisk	微盘	vdisk.weibo.com/search/?type=public&keyword={s}
vegas	Vegas	find.vegas.com/search?entqr=1&output=xml_no_dtd&sort=date:D:L:d1&entsp=0&client=vegas&ud=1&oe=UTF-8&ie=UTF-8&proxystylesheet=vegas&site=vegas&q={s}&btnG=⌕
vkdia	Vikidia	fr.vikidia.org/w/index.php?search={s}&title=Spécial:Recherche&go=Trouver
w3scn	w3school中文	www.google.com/search?q={s}+site:w3school.com.cn
waapt	We Are All Pokémon Trainers Wiki	waapt.wiki.tropi.us/wiki/Special:Search/{s}
witgr λεξικό	Wiktionary(GR)	el.m.wiktionary.org/wiki/{s}
zbozi	Zboží.cz	www.zbozi.cz/hledani/?q={s}
айрек irecommend айрекомменд	IRecommend	irecommend.ru/srch?query={s}
гфото gphotos	Google Photos	photos.google.com/search/{s}
кплюс consplus консультант	Consultant Plus	www.consultant.ru/search/?q={s}
ასტრო	Astronet.Ge	astronet.ge/?s={s}
تبسيط	موقع تبسيط	tapseet.com/?s={s}
360iso	360图片	image.so.com/i?q={s}
akakce	Akakçe	www.akakce.com/arama/?q={s}
alibro abretelibro	Ábretelibro	www.abretelibro.com/foro/search.php?keywords={s}&sf=titleonly
appinn	小众软件	www.appinn.com/?s={s}
archfr	archlinux.fr	wiki.archlinux.fr/index.php?title=Spécial:Recherche&profile=default&search={s}&fulltext=Search
aulete	iDicionário Aulete	www.aulete.com.br/{s}
baneks	Анекдоты категории Б	baneks.site/search/{s}
banglg	Pons (dela)	de.pons.com/übersetzung?q={s}&l=dela&in=&lf=de
beinsa	beinsa.bg	beinsa.bg/search.php?q={s}&submit=ТЪРСИ&s_type=all&id=&status=1
cbdbcz	Československá bibliografická databáze	cbdb.cz/hledat?text={s}
clanky	Seznam Články	clanky.seznam.cz/?q={s}
clarin	Clarín	www.clarin.com/buscador/?q={s}
climed	Climed Seviços de Saude	www.climedweb.com/?s={s}
cnrtle	cnrtl étymologie	www.cnrtl.fr/etymologie/{s}
coccoc	Cốc Cốc	coccoc.com/search#query={s}
diddal	Encyclopédie de Diderot et d'Alembert	portail.atilf.fr/cgi-bin/search2e?title={s}&author=&class=&speech=&objtype=&word=&CONJUNCT=PHRASE&PROXY=moins+de&DISTANCE=3&OUTPUT=conc&SYSTEM_DIR=/var/artfla/encyclopedie/textdata/IMAGE/
dörner	Bücher Dörner Onlineshop	buecher-doerner.buchhandlung.de/shop/quickSearch?searchString={s}
evesta	EVESTA KASHI KENSAKU	www.evesta.jp/lyric/search2.php?ct=1&go=検索&a=&ca=0&l=&cl=0&k=&t={s}
exodus	εxodus Privacy	reports.exodus-privacy.eu.org/reports/search/{s}
gandhi gdhimx	Librerías Gandhi	www.gandhi.com.mx/catalogsearch/result/?q={s}
gbooks гкниги	Books.google.com	www.google.com/search?nfpr=1&tbm=bks&q={s}
gdmaps	高德地图	ditu.amap.com/search?query={s}
ggrlaw	gulden röttger rechtsanwälte - wir schätzen die Kraft achtsamer Kommunikation in Wort und Bild	ggr-law.com/suche/?id=1843&tx_kesearch_pi1[sword]={s}
icones	Icônes	icones.js.org/collection/all?s={s}
imaths	Images des mathématiques	images.math.cnrs.fr/spip.php?page=recherche&page=recherche&recherche={s}
inkeri	Inkeri Klubi – Клуб Ингрия	inkeri-klubi.radioviola.net/system/app/pages/search?scope=search-site&q={s}
itnews	IT-NEWS: Новости Интернета	it-news.space/#gsc.q={s}
kotoba kotobank	コトバンク	kotobank.jp/word/{s}
lesnum lesnumeriques	Les Numériques	www.lesnumeriques.com/recherche?q={s}
lingpl	Linguee PL	www.linguee.pl/angielski-polski/tłumaczenie/{s}.html
lingvo лингво	Lingvo Live	lingvolive.ru/translate/en-ru/{s}
litres литрес	Litres	www.litres.ru/pages/rmd_search/?q={s}
littre	Dictionnaire Littré	www.littre.org/definition/{s}
maajim	معاجم	www.maajim.com/dictionary/{s}
mailru мейлру	go.mail.ru	go.mail.ru/search?fm=1&q={s}
meyers	Meyers Großes Konversationslexikon	woerterbuchnetz.de/Meyers/?lemme={s}
nikkei	日経新聞	r.nikkei.com/search?keyword={s}
npedia dicnico	ニコニコ大百科	dic.nicovideo.jp/a/{s}
opachu	Universitätsbibliothek Humboldt (Grimmzentrum)	hu-berlin.hosted.exlibrisgroup.com/primo-explore/search?query=any,contains,{s}&search_scope=default_scope&displayField=all&pcAvailabiltyMode=false&dum=true&vid=hub_ub&displayMode=full&bulkSize=30&mode=Basic&tab=default_tab&highlight=true&institution=HUB_UB&sortby=rank&lang=de_DE
paxgal	Páxinas Galegas	www.paxinasgalegas.es/resultados.aspx?tipo=0&texto={s}
pcasio	Planète Casio	www.planet-casio.com/Fr/aide/recherche.php?q={s}
persee	Persée	www.persee.fr/search?q={s}
peru21	Perú21	peru21.pe/buscar/?query={s}
pokedb pokemondb	Pokémon Database	pokemondb.net/search?q={s}
ponsde ponsge ponsende	Pons (deen)	de.pons.com/übersetzung?q={s}&l=deen&in=&lf=de
rcplde	Reverso dictionary Polish- German	context.reverso.net/tłumaczenie/niemiecki-polski/{s}
shopee	shopee 蝦皮	shopee.tw/search/?keyword={s}
stream	Internetová televize Stream	www.stream.cz/vyhledavani?dotaz={s}
sznsde	slovnik.seznam.cz němčina	slovnik.seznam.cz/de/?q={s}
sznsfr	Seznam.cz slovník Fr-Cz	slovnik.seznam.cz/fr-cz/?q={s}
szotar	Szótár.net	www.szotar.net/mind/{s}/
sztaki	SZTAKI Szótár	szotar.sztaki.hu/search?searchWord={s}
tesoro	Tesoro lexicográfico del español de Puerto Rico	tesoro.pr/busqueda?q={s}
tuwlib	TUW Library	catalogplus.tuwien.ac.at/primo_library/libweb/action/dlSearch.do?queryfield=&x=0&y=0&institution=UTW&vid=UTW&tab=default_tab&search_scope=UTW&mode=Basic&indx=1&bulkSize=10&dum=true&highlight=true&pcAvailabiltyMode=false&prefLang=en_US&dummyChar=♥&query=any,contains,{s}&displayField=title
verbes	VERBES - Conjugaison française	www.les-verbes.com/conjuguer.php?verbe={s}
webref вебреф вэбреф	WebReference	webref.ru/search/?s={s}
wfdehu	Webfordítás de-hu	www.webforditas.hu/szotar.php?S={s}&l1=de&l2=hu
wfenhu	Webfordítás en-hu	www.webforditas.hu/szotar.php?S={s}&l1=en&l2=hu
wfhude	Webfordítás hu-de	www.webforditas.hu/szotar.php?S={s}&l1=hu&l2=de
wfhuen	Webfordítás hu-en	www.webforditas.hu/szotar.php?S={s}&l1=hu&l2=en
wiktde	Wiktionary, das freie Wörterbuch	de.wiktionary.org/wiki/Special:Search?search={s}&go=Go
wikthu	Wiktionary (hu)	hu.wiktionary.org/w/index.php?search={s}&title=Speciális:Keresés
wiktko	위키낱말사전	ko.wiktionary.org/wiki/{s}
wiktsv	Swedish Wiktionary	sv.wiktionary.org/w/index.php?search={s}&title=Special:Sök
wowhes	Wowhead (Español)	es.wowhead.com/search?q={s}
wrptes	WordReference Português-Español	www.wordreference.com/ptes/{s}
yamaps yxmaps якарты yandexmaps	Yandex Maps	ya.ru/maps/?text={s}
zakony	Zákony pre ľudí	www.zakonypreludi.sk/main/search.aspx?text={s}
zaycev	Зайцев.нет!	zaycev.net/search.html?query_search={s}
англяз	Вики-учебник Английского Языка	engramm.su/start?do=search&id={s}
письмо compose	Compose Email (Gmail)	mail.google.com/mail/?view=cm&to=&su={s}
موبايل	أكاديمية الموبايل	mobilesacademy.com/?s={s}
adelung	Adelung: Grammatisch-Kritisches Wörterbuch der Hochdeutschen Mundart	woerterbuchnetz.de/Adelung/?lemma={s}
alibros	Ábrete libro	www.abretelibro.com/foro/search.php?keywords={s}
bdbaike	百度百科	baike.baidu.com/item/{s}
buscape	Buscapé	www.buscape.com.br/cprocura?produto={s}
correos	Localizados Correos de España	www.correos.es/ss/Satellite/site/aplicacion-4000003383089-herramientas_y_apps/detalle_app-sidioma=es_ES?numero={s}
coupang	쿠팡	www.coupang.com/np/search?component=&q={s}
cuspide	Cúspide	www.cuspide.com/resultados.aspx?c={s}
deuturk	Deutsch-Türkisch.net	deutsch-tuerkisch.net/suche/{s}
dicinfo	Dicionário Informal	www.dicionarioinformal.com.br/{s}/
dict-ua	Dictionary of Ukrainian Language (Словник української мови)	sum.in.ua/?swrd={s}
divazus	Divazus ®	divazus.com/?s={s}
e-words	IT用語辞典 e-Words	e-words.jp/?q={s}
fantlab фантлаб	Лаборатория Фантастики	fantlab.ru/searchmain?searchstr={s}
ffbbunt	Fürstenfeldbruck ist bunt!	ffbbunt.wordpress.com/?s={s}
fravega	Frávega	www.fravega.com/{s}
gramota грамота	gramota.ru	gramota.ru/slovari/dic/?word={s}&all=x
hapshoe	Hapshoe.com | Aklındaki Ayakkabı, Tıkla Ayağına Gelsin !	www.hapshoe.com/Arama?1&kelime={s}
hdrapin	LES MISCELLANÉES NUMÉRIQUES	hdrapin.com/?s={s}
iacobus	Catálogo Iacobus - Universidade de Santiago de Compostela	iacobus.usc.gal/discovery/search?query=any,contains,{s}&tab=Everything&search_scope=MyInst_and_CI&vid=34CISUG_USC:VU1&offset=0
jofogas	Jófogás	www.jofogas.hu/magyarorszag?q={s}
justice	Justice - obchodní rejstřík	or.justice.cz/ias/ui/rejstrik-$firma?jenPlatne=PLATNE&nazev={s}
khamsat	Khamsat | خمسات	khamsat.com/search?utf8=%E2%9C%93&q={s}
kkbruce	KingKong Bruce記事	www.google.com/cse?cx=002209521788924011185:wzz9w-qvlhi&q={s}
legisqc	Légis Québec	legisquebec.gouv.qc.ca/fr/result?command=search&length=10&search_type=all&title_search_type=any&corpus=all&corpusType=c&langCont=fr&fragment={s}&shorttitle=&stemmed=stemmed
lugatım	Kubbealtı Lugati	lugatim.com/s/{s}
maedler	MÄDLER	www.maedler.de/ShopSearch?query={s}
meneame	Menéame	www.meneame.net/search?q={s}
meteofr	Météo-France	www.meteofrance.com/recherche/resultats?facet=previsions&lieuId=&lieuType=&search-type=previsions&query={s}
mostaql	Mostaql | مستقل	mostaql.com/freelancers?keyword={s}
moxo.ir	موکسو	www.moxo.ir/?s={s}
muragon	Muragon	muragon.com/search/?ie=UTF-8&q={s}&sa=検索
obrazky	Seznam Obrázky	www.obrazky.cz/?q={s}
opennet опеннет	OpenNET	www.opennet.ru/search.shtml?exclude=index|/man.shtml&words={s}
panstwo	Moje Państwo	mojepanstwo.pl/?q={s}
raparts	Reliable Aftermarket Parts, Inc®	www.reliableaftermarketparts.com/search?q={s}
skapiec	Skąpiec.pl	www.skapiec.pl/szukaj/w_calym_serwisie/{s}
slovnik	Seznam Slovník	slovnik.seznam.cz/en/?q={s}
szpravy	Seznam Zprávy	www.seznam.cz/zpravy/hledani?q={s}&search--active=1
tenkijp	tenki.jp(日本気象協会/)	www.tenki.jp/search/zip/?keyword={s}
tezaurs	Tēzaurs	tezaurs.lv/#/sv/?{s}
tiebaid	贴吧id	passport.baidu.com/v2/?regnamesugg&username={s}
weblioe	weblio 英和辞典	ejje.weblio.jp/content/{s}
хтмлбук htmlbook	htmlbook.ru	htmlbook.ru/search/?as_q={s}
الاخبار	صحيفة تيفي	www.sahifatv.com/category/{s}
931women	臭い女性から卒業宣言	931women.com/?s={s}:
aktualne	Aktuálně.cz	www.aktualne.cz/hledani/?query={s}
bangfren ponsenfr	Pons.eu (enfr)	de.pons.com/übersetzung?q={s}&l=enfr&in=&lf=fr
bibparis	catalogue des bibliothèques de Paris	bibliotheques.paris.fr/Default/search.aspx?SC=CATALOGUE&QUERY={s}
clinicas	Clínicas y Hospitales	clinicasyhospitales.com.co/buscar?q={s}
conversa	Conversa de Sofá	www.conversadesofa.com/?s={s}
duckgoes	Duck Duck Go Español	duckduckgo.com/?q={s}&kp=-1&k5=1&kah=wt-wt&kl=xl-es&kad=es_ES
edpanama	El Digital Panamá	eldigitalpanama.com/?s={s}
lateinde	Latein Wörterbuch	www.albertmartin.de/latein/?q={s}
lovewiki	LÖVE Wiki	love2d.org/w/index.php?search={s}
naturvin	Naturvin – The Sound of Soil	naturvin.wordpress.com/?s={s}
nisanyan	Nişanyan Etimolojik Sözlük	www.nisanyansozluk.com/?k={s}
ponsdees	Pons de<>es	de.pons.com/übersetzung?q={s}&l=dees&in=&lf=de
ponsdefr	Pons de<>fr	de.pons.com/übersetzung?q={s}&l=defr&in=&lf=de
ponsdeit	Pons de<>it	de.pons.com/übersetzung?q={s}&l=deit&in=&lf=de
ponsdela	Pons Online-Wörterbuch Latein	de.pons.com/übersetzung?q={s}&l=dela
ponsdesv	pons.com	de.pons.com/übersetzung?q={s}&l=desv&in=&lf=de
ponsitpl	Pons it<>pl	pl.pons.com/tłumaczenie?q={s}&l=itpl
ponsplde	Pons pl-de	pl.pons.com/tłumaczenie?q={s}&l=depl&in=&lf=de
ponsples	Pons Polish->Spanish	pl.pons.com/tłumaczenie?q={s}&l=espl&in=&lf=es
pravidla	Pravidla českého pravopisu	www.pravidla.cz/hledej/?qr={s}
protocol פרוטוקול	Protocol	www.protocol.co.il/?s={s}
qcubbrux	Qui connaît un bon : Bruxelles	www.qcunbon.be/bruxelles?q={s}
showdown	Pokémon Showdown	dex.pokemonshowdown.com/?q={s}
sonaveeb	Sõnaveeb	sonaveeb.ee/search/est-est/detail/{s}/
synonyma	ABZ slovník českých synonym	www.slovnik-synonym.cz/web.php/hledat?typ_hledani=prefix&cizi_slovo={s}
telerama	Télérama	www.telerama.fr/recherche/recherche.php?query={s}
thesetel	TEL - Thèses en ligne	tel.archives-ouvertes.fr/search/index/?q={s}
ubuntutr	Ubuntu Türkiye	forum.ubuntu-tr.net/index.php?action=search;q={s}
vartoslo	VårtOslo	www.vartoslo.no/cse?q={s}
wikimini	Wikimini	fr.wikimini.org/w/index.php?search={s}&title=Spécial:Recherche&fulltext=Rechercher
yomikata	読み方は？	yomikatawa.com/kanji/{s}
викивояж wikivoyageru	Wikivoyage (Русский)	ru.wikivoyage.org/wiki/Special:Search?search={s}&go=Go
alexshoes	AlexShoes Calçados	www.alexshoes.com.br/buscacomfab.asp?chaves={s}
antonimos	Antônimos.com.br	www.antonimos.com.br/busca.php?q={s}
berlinmap	Berlin.de – Stadtplan	www.berlin.de/stadtplan/?ADR_STREET={s}
biberfurt	Katalog der Universitäts- und Forschungsbibliothek Erfurt/Gotha	www.uni-erfurt.de/suche?tx_solr[q]={s}
bookinges	Booking España	www.booking.com/search.es.html?ss={s}
citizenes	Citizen España	www.citizen.es/search?s={s}
denicheur	Le Dénicheur	ledenicheur.fr/search?query={s}
direncnet	Direnç.net	www.direnc.net/arama?q={s}
expressio	Expressio Français	www.expressio.fr/search.php?q={s}&lang=
gookokugo	Goo国語辞典検索	dictionary.goo.ne.jp/srch/jn/{s}/m0u/
librewiki	LibreWiki	librewiki.net/index.php?title=특수:검색&search={s}
licentium	자유인사전(Licentium Wiki)	licentium.net/w/index.php?search={s}
michaelis	Michaelis - Português - Inglês	michaelis.uol.com.br/busca?r=1&f=0&t=1&palavra={s}
noiseless	ノイズレスサーチ	pasokatu.com/nsearch#gsc.q={s}
odpiralni	Odpiralni časi	odpiralnicasi.com/spots?utf8=%E2%9C%93&q={s}
ordnet.dk	Ordnet	ordnet.dk/ddo/ordbog?query={s}+&search=Søg
planetebd	Planète BD	www.planetebd.com/recherche?mot-clef={s}
saiyasune	最安値.com	www.saiyasune.com/I1W{s}.html
sirogohan	白ごはん.com	www.sirogohan.com/recipe/index/keyword:{s}
waschbaer	Waschbär	www.waschbaer.de/shop/frontend/search/result?q={s}
папазнает daddyknows	Папа знает	daddyknows.ru/?s={s}
bomnegocio	Bom Negócio	www.bomnegocio.com/brasil?q={s}
conjugacao	conjugação.com.br	www.conjugacao.com.br/busca.php?q={s}
coolbluebe	Coolblue België	www.coolblue.be/zoeken?query={s}
cppsamples	C++​Samples	www.cppsamples.com/#/search/{s}
dobreknihy	Dobré Knihy.cz	www.dobre-knihy.cz/vyhledavani/?q={s}
elcomercio elcomerciope	El Comercio Perú	elcomercio.pe/buscar/?query={s}
gjensidige	Gjensidige	www.gjensidige.no/søk?query={s}
goettingen	Wiki Göttingen	www.wiki-goettingen.de/index.php?search={s}
kakosepise	Како се пише	kakosepise.com/?s={s}
naointendo	Não Intendo	www.naointendo.com.br/blog/busca?utf8=%E2%9C%93&q={s}
nosdeputes	NosDéputés.Fr	www.nosdeputes.fr/recherche/{s}
recettesqc	Recettes du Québec	www.recettes.qc.ca/recettes/recherche?search[query]={s}&search[sort]=
rensoruigo	連想類語辞典	renso-ruigo.com/word/{s}
simplicite	Simplicité.io	www.simplicite.io/resources/search?q={s}
wikilengua	Wikilengua del español	www.wikilengua.org/index.php/Especial:Buscar?search={s}&fulltext=Buscar
archlinuxfr	Wiki Français Archlinux	wiki.archlinux.fr/index.php?title=Spécial:Recherche&profile=default&fulltext=Search&search={s}
decathlones	Decathlon España	www.decathlon.es/Comprar/{s}
seslisozluk	sesli sözlük	www.seslisozluk.com/?word={s}
thnuernberg	TH Nürnberg	www.th-nuernberg.de/suche/?id=1&L=0&q={s}
universalis	Encyclopædia Universalis	www.universalis.fr/recherche/q/{s}
ahmetcadirci	Ahmet Çadırcı	ahmetcadirci.com.tr/search/?q={s}
ciberduvidas	Ciberdúvidas da Língua Portuguesa	ciberduvidas.iscte-iul.pt/pesquisa?termo={s}
comptoirsecu	Le Comptoir Sécu	www.comptoirsecu.fr/?s={s}
cuantocabron	Cuánto Cabrón	www.cuantocabron.com/busqueda/0/{s}
databaze-her	Databáze her	www.databaze-her.cz/hledani/?fraze={s}
educalingofr	Educalingo Français	educalingo.com/fr/dic-fr/{s}
strefasluchu	Strefa Słuchu	www.strefasluchu.pl/?s={s}
uludagsozluk	uludağ sözlük	www.uludagsozluk.com/?q={s}
wikivoyageel	Wikivoyage (Ελληνικά)	el.wikivoyage.org/wiki/Special:Search?search={s}&go=Go
wikivoyagees	Wikivoyage (Español)	es.wikivoyage.org/wiki/Special:Search?search={s}&go=Go
wikivoyagefr	Wikivoyage (français)	fr.wikivoyage.org/wiki/Special:Search?search={s}&go=Go
wikivoyagehe	Wikivoyage (עברית)	he.wikivoyage.org/wiki/Special:Search?search={s}&go=Go
wikivoyagept	Wikivoyage (português)	pt.wikivoyage.org/wiki/Special:Search?search={s}&go=Go
wikivoyagero	Wikivoyage (Română)	ro.wikivoyage.org/wiki/Special:Search?search={s}&go=Go
wikivoyageuk	Wikivoyage (Українська)	uk.wikivoyage.org/wiki/Special:Search?search={s}&go=Go
wikivoyagevi	Wikivoyage (Tiếng Việt)	vi.wikivoyage.org/wiki/Special:Search?search={s}&go=Go
wikivoyagezh	Wikivoyage (中文)	zh.wikivoyage.org/wiki/Special:Search?search={s}&go=Go
davetiyebaski	davetiye baskı	www.davetiyebaski.net/arama?q={s}
pokecommunity	Pokécommunity	www.pokecommunity.com/search.php?do=q{s}
annex.931women	なんぽるとこわ別館	annex.931women.com/?s={s}:
arbeitsagentur	Agentur für Arbeit	www.arbeitsagentur.de/jobsuche/suche?sort=Relevanz&angebotsart=1&was={s}
filmaffinityes	filmaffinity españa	m.filmaffinity.com/es/search.php?stext={s}
jornaldaparaiba	Jornal da Paraíba	www.jornaldaparaiba.com.br/?s={s}
pokebrickbronze	Pokémon Brick Bronze Wikia	brickbronze.wikia.com/wiki/Special:Search?query={s}
woerterbuchnetz	Wörterbuchnetz	woerterbuchnetz.de/cgi-bin/WBNetz/startGlobalSearch.tcl?stichwort={s}
bibliotekkavlinge	Kävlinge Bibliotek	bibliotek.kavlinge.se/search?query={s}
manutancollectives	Manutan Collectivès	www.manutan-collectivites.fr/catalogsearch/result/?q={s}
glutenfreerecipebox	Carla’s Gluten Free Recipe Box	glutenfreerecipebox.com/?s={s}`;

});
globalThis.ArdiaCore = __require("packages/core/src/mobile.ts");
})();
