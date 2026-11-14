package com.ardia.browser

import android.content.res.AssetManager

object PageScripts {
    const val BRIDGE_NAME = "ardiaPage"
    const val NIGHT_SHADE_MESSAGE = "nightShade"

    fun mainFrameOnly(script: String): String = "if (window === window.top) {\n$script\n}"

    fun filterBundle(start: List<String>, end: List<String>): String? {
        if (start.isEmpty() && end.isEmpty()) return null
        val builder = StringBuilder("(() => {\nif (window !== window.top) return;\n")
        for (script in start) builder.append("try {\n").append(script).append("\n} catch (error) {}\n")
        if (end.isNotEmpty()) {
            builder.append("const runAtDocumentEnd = () => {\n")
            for (script in end) builder.append("try {\n").append(script).append("\n} catch (error) {}\n")
            builder.append("};\n")
            builder.append("if (document.readyState === \"loading\") document.addEventListener(\"DOMContentLoaded\", runAtDocumentEnd, { once: true });\n")
            builder.append("else runAtDocumentEnd();\n")
        }
        return builder.append("})();").toString()
    }

    const val DESKTOP_LAYOUT_WIDTH = 980

    val desktopViewport: String = """
(() => {
  if (window !== window.top || window.__ardiaDesktopViewport) return;
  window.__ardiaDesktopViewport = true;
  const isViewport = (node) => node.nodeType === 1 && node.tagName === "META" && (node.getAttribute("name") || "").toLowerCase() === "viewport";
  const desktopContent = (declared) => {
    const width = /(?:^|[,;\s])width\s*=\s*(\d+)/i.exec(declared || "");
    return "width=" + Math.max($DESKTOP_LAYOUT_WIDTH, width ? Number(width[1]) : 0);
  };
  const pin = (meta) => {
    const content = meta.getAttribute("content");
    if (/^width=\d+${'$'}/.test(content || "") && Number(content.slice(6)) >= $DESKTOP_LAYOUT_WIDTH) return;
    meta.setAttribute("content", desktopContent(content));
  };
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") { if (isViewport(record.target)) pin(record.target); continue; }
      for (const node of record.addedNodes) if (isViewport(node)) pin(node);
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["content", "name"] });
  for (const meta of document.getElementsByTagName("meta")) if (isViewport(meta)) pin(meta);
})();
""".trim()

    fun nightShadeCall(mode: NightShadeMode): String = "window.__ardiaNightShade && window.__ardiaNightShade(\"${mode.raw}\")"

    fun readerCall(readerScript: String): String = "(() => {\n$readerScript\n})()"

    fun decodeEvaluationResult(result: String?): String? {
        if (result == null || result == "null" || result == "undefined") return null
        return runCatching { org.json.JSONTokener(result).nextValue() as? String }.getOrNull()
    }
}

internal class PageScriptSources(private val assets: AssetManager) {
    val nightShade: String by lazy { read("night-shade.js") }
    val reader: String by lazy { read("readable-content.js") }
    val pageLook: String by lazy { read("page-look.js") }

    fun preload() {
        nightShade
        pageLook
        reader
    }

    private fun read(name: String): String = assets.open("ardia-browser/$name").bufferedReader().use { it.readText() }
}
