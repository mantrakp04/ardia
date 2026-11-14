import Foundation

public enum ReaderPrintMarkup {
  static let style = """
    body { font: 12pt ui-serif, "New York", Georgia, serif; line-height: 1.5; color: #1c1c1e; margin: 0; }
    h1 { font-size: 22pt; line-height: 1.2; margin: 0 0 12pt; }
    h2, h3, h4 { line-height: 1.25; margin: 18pt 0 6pt; }
    .source { font: 10pt -apple-system, sans-serif; color: #6c6c70; margin: 0 0 6pt; }
    figure { margin: 12pt 0; }
    img { max-width: 100%; height: auto; }
    blockquote { margin: 12pt 0; padding-left: 12pt; border-left: 2pt solid #c7c7cc; }
    pre { white-space: pre-wrap; font-size: 10pt; }
    """

  public static func html(for content: ReadableContent) -> String {
    let source = [content.siteName, content.byline ?? ""].filter { !$0.isEmpty }.map(escape).joined(separator: " · ")
    let article = content.html.isEmpty ? content.paragraphs.map { "<p>\(escape($0))</p>" }.joined() : content.html
    let language = content.language.map { " lang=\"\(escape($0))\"" } ?? ""
    return """
      <!doctype html><html\(language)><head><meta charset="utf-8"><title>\(escape(content.title))</title><style>\(style)</style></head>\
      <body>\(source.isEmpty ? "" : "<p class=\"source\">\(source)</p>")<h1>\(escape(content.title))</h1>\(article)</body></html>
      """
  }

  static func escape(_ text: String) -> String {
    text
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\"", with: "&quot;")
  }
}
