import Foundation
import WebKit

public enum ReadableContentError: Error, Equatable {
  case pageNotLoaded
  case notReadable
}

public struct ReadableContent: Codable, Equatable, Sendable {
  public var url: String
  public var title: String
  public var siteName: String
  public var byline: String?
  public var excerpt: String?
  public var leadImage: String?
  public var language: String?
  public var paragraphs: [String]
  public var html: String
  public var wordCount: Int
  public var isArticle: Bool

  public var text: String { paragraphs.joined(separator: "\n\n") }

  @MainActor static let world = WKContentWorld.world(name: "ArdiaReader")

  @MainActor
  public static func extract(from webView: WKWebView) async throws -> ReadableContent {
    let raw = try await webView.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: world)
    guard let json = raw as? String, let data = json.data(using: .utf8) else { throw ReadableContentError.notReadable }
    return try JSONDecoder().decode(ReadableContent.self, from: data)
  }

  static let script = #"""
  const MAX_CHARS = 200000;
  const POSITIVE = /article|body|content|entry|main|page|post|text|blog|story|prose|recipe|instructions|ingredients/i;
  const NEGATIVE = /comment|footer|foot|nav|sidebar|side-bar|aside|ad-|ads|advert|promo|related|share|social|cookie|consent|banner|modal|popup|menu|subscribe|newsletter|breadcrumb|masthead|header|widget|sponsor|outbrain|taboola|toolbar|tabs|pagination|print|jump/i;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "NAV", "FOOTER", "ASIDE", "FORM", "BUTTON", "SVG", "IFRAME", "HEADER", "DIALOG", "SELECT", "TEXTAREA", "INPUT", "LINK", "META", "OBJECT", "EMBED", "CANVAS", "VIDEO", "AUDIO", "MATH", "TABLE"]);
  const JUNK = [
    ".mw-editsection", "sup.reference", ".reference", ".mw-ref", ".noprint", ".navbox", ".vertical-navbox", ".infobox", ".sidebar",
    ".metadata", ".ambox", ".hatnote", ".mw-empty-elt", "#toc", ".toc", ".reflist", ".references", ".mw-references-wrap", ".mw-jump-link",
    ".catlinks", ".printfooter", ".mw-cite-backlink", ".thumbcaption", ".page-actions-menu", ".minerva__tab-container", ".pre-content",
    "[role=navigation]", "[role=complementary]", "[role=dialog]", "[aria-hidden=true]", ".sr-only", ".visually-hidden", ".screen-reader-text",
    ".wprm-recipe-jump", ".wprm-recipe-print", ".tasty-recipes-buttons", ".comments", "#comments", ".comment-list",
  ].join(", ");
  const BLOCK_CHILDREN = "p, div, li, h1, h2, h3, h4, h5, h6, table, blockquote, pre, ul, ol, section, article, figure, header, footer";
  const MARKERS = /\[(?:\d{1,3}|[a-z]|note \d+|nb \d+|citation needed|edit|update)\]/gi;

  const clean = (text) => text.replace(MARKERS, "").replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  const classOf = (el) => (typeof el.className === "string" ? el.className : "") + " " + (el.id || "");
  const isJunk = (el) => {
    if (SKIP_TAGS.has(el.tagName) || el.hidden) return true;
    if (el.matches(JUNK)) return true;
    const style = el.getAttribute("style") || "";
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return true;
    const name = classOf(el);
    return NEGATIVE.test(name) && !POSITIVE.test(name);
  };
  const textOf = (el) => {
    if (!el) return "";
    let out = "";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.nodeType === 3 ? NodeFilter.FILTER_ACCEPT : (node !== el && isJunk(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) out += node.nodeValue;
    return clean(out);
  };
  const meta = (selector) => {
    const el = document.querySelector(selector);
    const value = el && (el.getAttribute("content") || el.getAttribute("value") || el.textContent);
    return value ? clean(value) : null;
  };
  const absolute = (src) => { try { return new URL(src, document.baseURI).href; } catch { return null; } };
  const linkText = (el) => [...el.querySelectorAll("a")].reduce((n, a) => n + (a.textContent || "").trim().length, 0);

  const host = location.hostname.replace(/^www\./, "");
  const siteName = meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]') || host;
  const h1 = [...document.querySelectorAll("h1")].map((el) => textOf(el)).find((t) => t.length > 1) || "";
  const rawTitle = meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || clean(document.title || "") || h1 || host;
  const stripSite = (title) => {
    const parts = title.split(/\s+[|\-\u2013\u2014\u00b7\u00bb:]\s+/);
    const site = siteName.toLowerCase();
    const isSite = (part) => { const p = part.toLowerCase().trim(); return p.length >= 3 && (p === site || p === host || site.includes(p) || p.includes(site) || p === host.split(".")[0]); };
    while (parts.length > 1 && isSite(parts[parts.length - 1])) parts.pop();
    while (parts.length > 1 && isSite(parts[0])) parts.shift();
    return parts.join(" - ").trim();
  };

  const declared = [".mw-parser-output", '[itemprop="articleBody"]', ".entry-content", ".post-content", ".article-body", ".article__body", ".story-body", ".wprm-recipe-container", "article", "main", '[role="main"]'];
  let root = null;
  for (const selector of declared) {
    const candidates = [...document.querySelectorAll(selector)].filter((el) => !isJunk(el));
    const best = candidates.sort((a, b) => (b.textContent || "").length - (a.textContent || "").length)[0];
    if (best && (best.textContent || "").trim().length > 400) { root = best; break; }
  }
  if (!root) {
    const scores = new Map();
    let visited = 0;
    for (const p of document.querySelectorAll("p, pre, blockquote")) {
      if (++visited > 6000) break;
      const length = (p.textContent || "").trim().length;
      if (length < 25) continue;
      const points = 1 + Math.min(Math.floor(length / 100), 3) + ((p.textContent || "").match(/[,،、，]/g) || []).length;
      for (const [node, share] of [[p.parentElement, 1], [p.parentElement && p.parentElement.parentElement, 0.5]]) {
        if (!node || node === document.documentElement) continue;
        if (!scores.has(node)) scores.set(node, (POSITIVE.test(classOf(node)) ? 25 : 0) - (NEGATIVE.test(classOf(node)) ? 25 : 0));
        scores.set(node, scores.get(node) + points * share);
      }
    }
    let bestScore = 0;
    for (const [node, score] of scores) {
      const adjusted = score * (1 - Math.min(linkText(node) / ((node.textContent || "").length || 1), 0.9));
      if (adjusted > bestScore) { root = node; bestScore = adjusted; }
    }
  }
  root = root || document.body;
  const articleHeading = (() => {
    const scope = root.closest("article") || root;
    const el = scope.querySelector("h1");
    const text = el ? textOf(el) : "";
    return text.length >= 3 && text.length < 300 ? text : "";
  })();
  const title = articleHeading || (h1 && h1.length < 300 && rawTitle.toLowerCase().includes(h1.toLowerCase()) ? h1 : stripSite(rawTitle));

  const isNavigationList = (list) => {
    const items = [...list.children].filter((el) => el.tagName === "LI");
    if (items.length < 2) return false;
    const texts = items.map((li) => (li.textContent || "").trim());
    const total = texts.reduce((n, t) => n + t.length, 0) || 1;
    return texts.every((t) => t.length < 40) && linkText(list) / total > 0.7;
  };

  const entries = [];
  const seen = new Set([title.toLowerCase()]);
  let chars = 0;
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const push = (text, markup, isItem, isHeading) => {
    const key = text.toLowerCase();
    if (seen.has(key) && text.length < 200) return;
    seen.add(key);
    entries.push({ kind: isHeading ? "heading" : isItem ? "item" : "text", text: isItem ? "• " + text : text, markup });
    chars += text.length;
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (el) => {
      if (el !== root && isJunk(el)) return NodeFilter.FILTER_REJECT;
      if ((el.tagName === "UL" || el.tagName === "OL") && isNavigationList(el)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let el = walker.nextNode(); el && chars < MAX_CHARS; el = walker.nextNode()) {
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const text = textOf(el);
      if (text.length < 2 || text.length > 300) continue;
      const level = Math.min(Math.max(Number(tag[1]), 2), 4);
      push(text, `<h${level}>${escape(text)}</h${level}>`, false, true);
    } else if (tag === "P" || tag === "BLOCKQUOTE" || tag === "PRE") {
      if (el.parentElement && el.parentElement.closest("p, blockquote, pre, li") && root.contains(el.parentElement.closest("p, blockquote, pre, li"))) continue;
      const text = tag === "PRE" ? (el.textContent || "").trim() : textOf(el);
      if (text.length < 2) continue;
      const name = tag.toLowerCase();
      push(text, `<${name}>${escape(text)}</${name}>`, false);
    } else if (tag === "LI") {
      if (el.querySelector("p, li")) continue;
      const text = textOf(el);
      if (text.length < 2) continue;
      push(text, `<li>${escape(text)}</li>`, true);
    } else if ((tag === "DIV" || tag === "SECTION" || tag === "SPAN") && !el.querySelector(BLOCK_CHILDREN)) {
      if (el.parentElement && el.parentElement.closest("p, blockquote, pre, li, h1, h2, h3, h4, h5, h6")) continue;
      const text = textOf(el);
      if (text.length < 80) continue;
      push(text, `<p>${escape(text)}</p>`, false);
    } else if (tag === "IMG" && entries.length > 0) {
      const src = absolute(el.currentSrc || el.getAttribute("src") || "");
      const width = el.naturalWidth || Number(el.getAttribute("width")) || 0;
      if (!src || src.startsWith("data:") || (width && width < 200)) continue;
      entries.push({ kind: "image", text: "", markup: `<figure><img src="${escape(src)}" alt="${escape(el.getAttribute("alt") || "")}"></figure>` });
    }
  }

  const recipe = (() => {
    const found = [];
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);
      const type = node["@type"];
      if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) found.push(node);
      if (node["@graph"]) visit(node["@graph"]);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { visit(JSON.parse(script.textContent || "")); } catch (e) {}
    }
    return found[0] || null;
  })();
  if (recipe) {
    const textAll = entries.map((e) => e.text).join("\n").toLowerCase();
    const ingredients = (recipe.recipeIngredient || []).map((s) => clean(String(s))).filter(Boolean);
    const steps = [];
    const addStep = (step) => {
      if (!step) return;
      if (typeof step === "string") return steps.push(clean(step));
      if (Array.isArray(step)) return step.forEach(addStep);
      if (step.itemListElement) return addStep(step.itemListElement);
      if (step.text) steps.push(clean(String(step.text)));
    };
    addStep(recipe.recipeInstructions);
    if (ingredients.length && !textAll.includes(ingredients[0].toLowerCase())) {
      push("Ingredients", "<h2>Ingredients</h2>", false, true);
      for (const item of ingredients) push(item, `<li>${escape(item)}</li>`, true);
    }
    if (steps.length && !textAll.includes(steps[0].toLowerCase().slice(0, 60))) {
      push("Instructions", "<h2>Instructions</h2>", false, true);
      steps.forEach((step, index) => push(`${index + 1}. ${step}`, `<p>${escape(`${index + 1}. ${step}`)}</p>`, false));
    }
  }

  const kept = entries.filter((entry, index) => {
    if (entry.kind !== "heading") return true;
    const next = entries.slice(index + 1).find((e) => e.kind !== "image");
    return Boolean(next) && next.kind !== "heading";
  });
  let blocks = kept.filter((e) => e.kind !== "image").map((e) => e.text);
  if (blocks.join(" ").split(/\s+/).length < 60) {
    const fallback = (document.body ? document.body.innerText || "" : "").split(/\n\s*\n/).map(clean).filter((t) => t.length > 30 && !seen.has(t.toLowerCase()));
    if (fallback.join(" ").length > blocks.join(" ").length * 2) {
      blocks = fallback.slice(0, 400);
      kept.length = 0;
      for (const t of blocks) kept.push({ kind: "text", text: t, markup: `<p>${escape(t)}</p>` });
    }
  }
  const html = [];
  let inList = false;
  for (const entry of kept) {
    if (entry.kind === "item" && !inList) { html.push("<ul>"); inList = true; }
    if (entry.kind !== "item" && inList) { html.push("</ul>"); inList = false; }
    html.push(entry.markup);
  }
  if (inList) html.push("</ul>");
  const text = blocks.join(" ");
  const words = text ? text.split(/\s+/).length : 0;
  const lead = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || meta('meta[property="og:image:url"]');
  const proseBlocks = blocks.filter((b) => b.length > 80).length;
  return JSON.stringify({
    url: location.href,
    title,
    siteName,
    byline: meta('meta[name="author"]') || meta('[rel="author"]') || meta('[itemprop="author"] [itemprop="name"]') || meta('[itemprop="author"]') || meta(".byline") || null,
    excerpt: meta('meta[property="og:description"]') || meta('meta[name="description"]') || null,
    leadImage: lead ? absolute(lead) : null,
    language: document.documentElement.lang || null,
    paragraphs: blocks,
    html: html.join(""),
    wordCount: words,
    isArticle: (proseBlocks >= 3 && words >= 150) || Boolean(recipe),
  });
  """#
}
