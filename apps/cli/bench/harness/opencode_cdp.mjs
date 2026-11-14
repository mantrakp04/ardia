const usage = `Usage: node opencode_cdp.mjs <command> <cdp-port> [args]

Drives the scratch Chrome for Testing over its DevTools port for the OpenCode Browse side of the bench.

  pair <cdp-port> <extension-id> <relay-port> <code>   point the extension at the relay and give it the pairing code
  paired <cdp-port> <extension-id> <relay-port>        print whether the extension holds a token for that relay
  open <cdp-port> <url>                                open <url> as the only tab, active, loaded
  lend <cdp-port> <extension-id> <url>                 press the extension's toolbar button on the tab showing <url>`

const [command, port, ...args] = process.argv.slice(2)
if (!command || !port || command === "-h" || command === "--help") {
  console.log(usage)
  process.exit(command ? 0 : 2)
}

const deadline = (ms) => Date.now() + ms
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
const socket = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = () => reject(new Error(`no DevTools socket on port ${port}`))
})
let nextId = 0
const waiting = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (waiting.has(message.id)) {
    waiting.get(message.id)(message)
    waiting.delete(message.id)
  }
}
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 15_000)
    waiting.set(id, (message) => {
      clearTimeout(timer)
      if (message.error) reject(new Error(`${method}: ${message.error.message}`))
      else resolve(message.result)
    })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

const targets = async (type) => (await send("Target.getTargets", type ? { filter: [{ type }] } : {})).targetInfos

async function workerSession(extensionId) {
  const until = deadline(20_000)
  while (Date.now() < until) {
    const worker = (await targets()).find(
      (t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${extensionId}/`),
    )
    if (worker) return (await send("Target.attachToTarget", { targetId: worker.targetId, flatten: true })).sessionId
    await sleep(250)
  }
  throw new Error(`extension ${extensionId} has no service worker`)
}

async function inWorker(extensionId, expression) {
  const session = await workerSession(extensionId)
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, session)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "worker evaluation failed")
  return result.result.value
}

async function pageLoaded(targetId) {
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true })
  try {
    const until = deadline(20_000)
    while (Date.now() < until) {
      const state = await send(
        "Runtime.evaluate",
        { expression: "[document.readyState, document.title]", returnByValue: true },
        sessionId,
      ).catch(() => undefined)
      const [ready, title] = state?.result?.value ?? []
      if (ready === "complete" && title) return title
      await sleep(200)
    }
    throw new Error("page did not finish loading")
  } finally {
    await send("Target.detachFromTarget", { sessionId }).catch(() => undefined)
  }
}

async function tabFor(url) {
  const until = deadline(10_000)
  while (Date.now() < until) {
    const tab = (await targets("tab")).find((t) => t.url === url)
    if (tab) return tab
    await sleep(200)
  }
  throw new Error(`no tab shows ${url}`)
}

const out = (value) => console.log(JSON.stringify(value))

try {
  if (command === "pair") {
    const [extensionId, relayPort, code] = args
    out(
      await inWorker(
        extensionId,
        `chrome.storage.local.set({agentRelayPort: ${Number(relayPort)}, agentRelayPairingCode: ${JSON.stringify(code)}}).then(() => true)`,
      ),
    )
  } else if (command === "paired") {
    const [extensionId, relayPort] = args
    out(
      await inWorker(
        extensionId,
        `chrome.storage.local.get("agentRelayTokens").then((s) => Boolean((s.agentRelayTokens || {})["127.0.0.1:${Number(relayPort)}"]))`,
      ),
    )
  } else if (command === "open") {
    const [url] = args
    const before = await targets("tab")
    const { targetId } = await send("Target.createTarget", { url })
    const title = await pageLoaded(targetId)
    const pageTab = await tabFor(url)
    for (const tab of before) await send("Target.closeTarget", { targetId: tab.targetId }).catch(() => undefined)
    await send("Target.activateTarget", { targetId: pageTab.targetId })
    const until = deadline(10_000)
    let tabs = await targets("tab")
    while (tabs.length !== 1 && Date.now() < until) {
      for (const tab of tabs) if (tab.targetId !== pageTab.targetId) await send("Target.closeTarget", { targetId: tab.targetId }).catch(() => undefined)
      await sleep(250)
      tabs = await targets("tab")
    }
    out({ title, tabs: tabs.map((t) => [t.url, t.title]) })
  } else if (command === "lend") {
    const [extensionId, url] = args
    const tab = await tabFor(url)
    await send("Target.activateTarget", { targetId: tab.targetId })
    await send("Extensions.triggerAction", { id: extensionId, targetId: tab.targetId })
    out({ lent: tab.targetId, url: tab.url })
  } else {
    console.error(usage)
    process.exitCode = 2
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  socket.close()
}
