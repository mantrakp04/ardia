package com.ardia.phone

internal class SyncEventRoute(
    private val inbox: PhoneInbox,
    private val send: (Map<String, Any?>) -> Unit,
    private val statusWith: (String) -> Map<String, Any?>?,
) : PhoneInbox.Listener {
    @Volatile
    private var open = true

    init {
        inbox.listen(this)
    }

    fun emit(event: Map<String, Any?>) {
        if (!open) return
        runCatching { send(event) }
    }

    override fun changed(count: Int) = emit(mapOf("name" to "sync.inbox", "count" to count))

    override fun problem(message: String) {
        if (!open) return
        statusWith(message)?.let { emit(mapOf("name" to "sync.status", "status" to it)) }
    }

    fun close() {
        open = false
        inbox.stopListening(this)
    }
}
