package com.ardia.browsing

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import kotlin.concurrent.thread

class BrowsingTestServer : AutoCloseable {
    private val socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    private val pages = Collections.synchronizedMap(HashMap<String, String>())

    init {
        thread(isDaemon = true, name = "browsing-test-server") {
            while (!socket.isClosed) {
                val client = try {
                    socket.accept()
                } catch (error: Exception) {
                    break
                }
                thread(isDaemon = true) { runCatching { client.use(::serve) } }
            }
        }
    }

    fun url(path: String): String = "http://127.0.0.1:${socket.localPort}$path"

    fun page(path: String, html: String) {
        pages[path] = html
    }

    private fun serve(client: Socket) {
        client.soTimeout = 15_000
        val reader = BufferedReader(InputStreamReader(client.getInputStream(), Charsets.ISO_8859_1))
        val line = reader.readLine() ?: return
        while (!reader.readLine().isNullOrEmpty()) Unit
        val path = line.split(' ').getOrNull(1)?.substringBefore('?') ?: return
        val html = pages[path]
        val body = (html ?: "<title>Missing</title>").toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 ${if (html == null) "404 Missing" else "200 OK"}\r\n" +
            "Content-Type: text/html; charset=utf-8\r\nContent-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        val output = client.getOutputStream()
        output.write(head.toByteArray(Charsets.ISO_8859_1))
        output.write(body)
        output.flush()
    }

    override fun close() {
        runCatching { socket.close() }
    }
}
