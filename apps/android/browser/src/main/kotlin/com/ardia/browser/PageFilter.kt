package com.ardia.browser

interface PageFilter {
    fun blocks(requestUrl: String, pageUrl: String?, isMainFrame: Boolean): Boolean
    fun scriptsAtDocumentStart(pageUrl: String): List<String>
    fun scriptsAtDocumentEnd(pageUrl: String): List<String>
}
