import { createHash } from "node:crypto";
import http from "node:http";
import { once } from "node:events";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : payload.length < 65536 ? Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]) : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(payload.length)); return b; })()]);
  return Buffer.concat([header, payload]);
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const opcode = buffer[offset] & 0x0f;
    let length = buffer[offset + 1] & 0x7f;
    let cursor = offset + 2;
    if (length === 126) { if (buffer.length < cursor + 2) break; length = buffer.readUInt16BE(cursor); cursor += 2; }
    else if (length === 127) { if (buffer.length < cursor + 8) break; length = Number(buffer.readBigUInt64BE(cursor)); cursor += 8; }
    const masked = buffer[offset + 1] & 0x80;
    const mask = masked ? buffer.subarray(cursor, cursor + 4) : null;
    if (masked) cursor += 4;
    if (buffer.length < cursor + length) break;
    const data = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    frames.push({ opcode, data });
    offset = cursor + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

export async function startMockCdp({ targets = [], handlers = {} } = {}) {
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    if (request.url === "/json/list") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(mock.targets.map((t) => ({ ...t, webSocketDebuggerUrl: `ws://127.0.0.1:${mock.port}/devtools/page/${t.id}` }))));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.on("upgrade", (request, socket) => {
    const accept = createHash("sha1").update(`${request.headers["sec-websocket-key"]}${GUID}`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    const targetId = request.url.split("/").pop();
    const peer = {
      targetId,
      send: (message) => socket.write(encodeFrame(JSON.stringify(message))),
      event: (method, params = {}) => peer.send({ method, params }),
      close: () => socket.destroy(),
    };
    mock.peers.push(peer);
    let pending = Buffer.alloc(0);
    socket.on("data", async (chunk) => {
      const { frames, rest } = decodeFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const frame of frames) {
        if (frame.opcode === 8) { socket.end(); continue; }
        if (frame.opcode !== 1) continue;
        const message = JSON.parse(frame.data.toString("utf8"));
        mock.received.push({ targetId, ...message });
        const handler = handlers[message.method] ?? handlers["*"];
        if (!handler) { peer.send({ id: message.id, result: {} }); continue; }
        try {
          const result = await handler(message.params ?? {}, { targetId, peer, method: message.method });
          if (result === mock.NO_REPLY) continue;
          peer.send({ id: message.id, result: result ?? {} });
        } catch (error) {
          peer.send({ id: message.id, error: { code: -32000, message: error.message } });
        }
      }
    });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const mock = {
    port: server.address().port,
    targets,
    peers: [],
    received: [],
    NO_REPLY: Symbol("no reply"),
    url: (path = "/devtools/browser/mock") => `ws://127.0.0.1:${server.address().port}${path}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
  return mock;
}
