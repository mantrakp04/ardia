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

  static let script = #"""
  const MAX_CHARS = 200000;
  const POSITIVE = /article|body|content|entry|main|page|post|text|blog|story|prose|recipe|instructions/i;
  const NEGATIVE = /comment|footer|foot|nav|sidebar|side-bar|aside|ad-|ads|advert|promo|related|share|social|cookie|consent|banner|modal|popup|menu|subscribe|newsletter|breadcrumb|masthead|header|widget|sponsor|outbrain|taboola/i;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "NAV", "FOOTER", "ASIDE", "FORM", "BUTTON", "SVG", "IFRAME", "HEADER", "DIALOG", "TEMPLATE", "SELECT", "TEXTAREA", "INPUT"]);
  const meta = (selector) => {
    const el = document.querySelector(selector);
    const value = el && (el.getAttribute("content") || el.getAttribute("value") || el.textContent);
    return value ? value.trim() : null;
  };
  const clean = (text) => text.replace(/\s+/g, " ").trim();
  const absolute = (src) => { try { return new URL(src, document.baseURI).href; } catch { return null; } };
  const classWeight = (el) => {
    let w = 0;
    const name = (el.className && typeof el.className === "string" ? el.className : "") + " " + (el.id || "");
    if (POSITIVE.test(name)) w += 25;
    if (NEGATIVE.test(name)) w -= 25;
    if (el.tagName === "ARTICLE" || el.tagName === "MAIN") w += 30;
    if (el.getAttribute("role") === "main" || el.getAttribute("itemprop") === "articleBody") w += 40;
    return w;
  };
  const excluded = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      if (SKIP_TAGS.has(node.tagName)) return true;
      if (node.getAttribute("aria-hidden") === "true" || node.hidden) return true;
      const role = node.getAttribute("role");
      if (role === "navigation" || role === "complementary" || role === "dialog" || role === "banner" || role === "contentinfo") return true;
    }
    return false;
  };

  const scores = new Map();
  const paragraphs = document.querySelectorAll("p, pre, td, blockquote, li, div > br + br");
  let visited = 0;
  for (const p of paragraphs) {
    if (++visited > 6000) break;
    const text = clean(p.textContent || "");
    if (text.length < 25) continue;
    const parent = p.parentElement;
    if (!parent || excluded(p)) continue;
    const grand = parent.parentElement;
    const points = 1 + Math.min(Math.floor(text.length / 100), 3) + (text.match(/[,،、，]/g) || []).length;
    for (const [node, share] of [[parent, 1], [grand, 0.5]]) {
      if (!node || node === document.documentElement) continue;
      if (!scores.has(node)) scores.set(node, classWeight(node));
      scores.set(node, scores.get(node) + points * share);
    }
  }
  let best = null;
  let bestScore = 0;
  for (const [node, score] of scores) {
    const links = [...node.querySelectorAll("a")].reduce((n, a) => n + (a.textContent || "").length, 0);
    const length = (node.textContent || "").length || 1;
    const adjusted = score * (1 - Math.min(links / length, 0.9));
    if (adjusted > bestScore) { best = node; bestScore = adjusted; }
  }
  const declared = document.querySelector('[itemprop="articleBody"], article, main, [role="main"]');
  if (declared && (!best || (declared.textContent || "").length > (best.textContent || "").length * 0.8 && declared.contains(best))) best = declared;
  const root = best || document.body;

  const blocks = [];
  const html = [];
  let chars = 0;
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (el) => {
      if (SKIP_TAGS.has(el.tagName) || el.getAttribute("aria-hidden") === "true" || el.hidden) return NodeFilter.FILTER_REJECT;
      const name = (el.className && typeof el.className === "string" ? el.className : "") + " " + (el.id || "");
      if (el !== root && NEGATIVE.test(name) && !POSITIVE.test(name)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let inList = false;
  const closeList = () => { if (inList) { html.push("</ul>"); inList = false; } };
  for (let el = walker.nextNode(); el && chars < MAX_CHARS; el = walker.nextNode()) {
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const text = clean(el.textContent || "");
      if (text.length < 2 || text.length > 300) continue;
      closeList();
      blocks.push(text);
      const level = Math.min(Math.max(Number(tag[1]), 2), 4);
      html.push(`<h${level}>${escape(text)}</h${level}>`);
      chars += text.length;
    } else if (tag === "P" || tag === "BLOCKQUOTE" || tag === "PRE") {
      if (el.parentElement && el.parentElement.closest("p, blockquote, pre, li") ) continue;
      const text = tag === "PRE" ? (el.textContent || "").trim() : clean(el.textContent || "");
      if (text.length < 2) continue;
      closeList();
      blocks.push(text);
      html.push(tag === "P" ? `<p>${escape(text)}</p>` : `<${tag.toLowerCase()}>${escape(text)}</${tag.toLowerCase()}>`);
      chars += text.length;
    } else if (tag === "LI") {
      if (el.querySelector("p, li")) continue;
      const text = clean(el.textContent || "");
      if (text.length < 2) continue;
      if (!inList) { html.push("<ul>"); inList = true; }
      blocks.push("• " + text);
      html.push(`<li>${escape(text)}</li>`);
      chars += text.length;
    } else if (tag === "IMG" && blocks.length > 0) {
      const src = absolute(el.currentSrc || el.getAttribute("src") || "");
      const width = el.naturalWidth || Number(el.getAttribute("width")) || 0;
      if (!src || src.startsWith("data:") || (width && width < 200)) continue;
      closeList();
      html.push(`<figure><img src="${escape(src)}" alt="${escape(el.getAttribute("alt") || "")}"></figure>`);
    }
  }
  closeList();

  const host = location.hostname.replace(/^www\./, "");
  const title = meta('meta[property="og:title"]') || clean(document.title || "") || meta("h1") || host;
  const text = blocks.join(" ");
  const words = text ? text.split(/\s+/).length : 0;
  const lead = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || meta('meta[property="og:image:url"]');
  const proseBlocks = blocks.filter((b) => b.length > 80).length;
  return JSON.stringify({
    url: location.href,
    title,
    siteName: meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]') || host,
    byline: meta('meta[name="author"]') || meta('[rel="author"]') || meta('[itemprop="author"] [itemprop="name"]') || meta('[itemprop="author"]') || meta(".byline") || null,
    excerpt: meta('meta[property="og:description"]') || meta('meta[name="description"]') || null,
    leadImage: lead ? absolute(lead) : null,
    language: document.documentElement.lang || null,
    paragraphs: blocks,
    html: html.join(""),
    wordCount: words,
    isArticle: proseBlocks >= 3 && words >= 150,
  });
  """#
}
