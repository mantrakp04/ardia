package com.ardia.browser

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import kotlin.concurrent.thread

class TestServer : AutoCloseable {
    data class Request(val method: String, val path: String, val headers: Map<String, String>)

    data class Response(
        val status: Int = 200,
        val body: String = "",
        val contentType: String = "text/html; charset=utf-8",
        val headers: Map<String, String> = emptyMap(),
        val endlessBody: Boolean = false,
    )

    private val socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    private val routes = Collections.synchronizedMap(HashMap<String, (Request) -> Response>())
    val requests: MutableList<Request> = Collections.synchronizedList(ArrayList())
    val failures: MutableList<Throwable> = Collections.synchronizedList(ArrayList())
    val port: Int get() = socket.localPort

    init {
        thread(isDaemon = true, name = "test-server") {
            while (!socket.isClosed) {
                val client = try {
                    socket.accept()
                } catch (error: Exception) {
                    break
                }
                thread(isDaemon = true, name = "test-server-connection") { serveSafely(client) }
            }
        }
    }

    fun url(path: String): String = "http://127.0.0.1:$port$path"

    fun page(path: String, html: String) {
        routes[path] = { Response(body = html) }
    }

    fun route(path: String, handler: (Request) -> Response) {
        routes[path] = handler
    }

    fun requested(path: String): Boolean = synchronized(requests) { requests.any { it.path.substringBefore('?') == path } }

    private fun serveSafely(client: Socket) {
        try {
            client.use { serve(it) }
        } catch (error: Throwable) {
            failures += error
        }
    }

    private fun serve(client: Socket) {
        client.soTimeout = READ_TIMEOUT_MILLIS
        val reader = BufferedReader(InputStreamReader(client.getInputStream(), Charsets.ISO_8859_1))
        val line = reader.readLine() ?: return
        val parts = line.split(' ')
        if (parts.size < 2) return
        val headers = HashMap<String, String>()
        while (true) {
            val header = reader.readLine() ?: break
            if (header.isEmpty()) break
            val colon = header.indexOf(':')
            if (colon > 0) headers[header.substring(0, colon).trim().lowercase()] = header.substring(colon + 1).trim()
        }
        val request = Request(parts[0], parts[1], headers)
        requests += request
        val handler = routes[request.path.substringBefore('?')]
        val response = handler?.invoke(request) ?: Response(404, "<title>Missing</title>")
        val body = response.body.toByteArray(Charsets.UTF_8)
        val head = buildString {
            append("HTTP/1.1 ${response.status} ${if (response.status == 200) "OK" else "Status"}\r\n")
            append("Content-Type: ${response.contentType}\r\n")
            if (!response.endlessBody) append("Content-Length: ${body.size}\r\n")
            append("Cache-Control: no-store\r\n")
            append("Connection: close\r\n")
            for ((name, value) in response.headers) append("$name: $value\r\n")
            append("\r\n")
        }
        val output = client.getOutputStream()
        output.write(head.toByteArray(Charsets.ISO_8859_1))
        if (response.endlessBody) {
            val chunk = ByteArray(64 * 1024) { 7 }
            while (!socket.isClosed) output.write(chunk)
            return
        }
        output.write(body)
        output.flush()
    }

    override fun close() {
        runCatching { socket.close() }
    }

    private companion object {
        const val READ_TIMEOUT_MILLIS = 15_000
    }
}
