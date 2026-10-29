import { connect } from "node:net";
import { isAbsolute, join } from "node:path";
import { until } from "./util.mjs";

export const BTN_LEFT = 0x110;
export const BTN_RIGHT = 0x111;
export const BTN_MIDDLE = 0x112;
export const AXIS_SOURCE_FINGER = 1;

export function encodeString(text) {
  const bytes = Buffer.from(`${text}\0`, "utf8");
  const padded = Buffer.alloc(4 + Math.ceil(bytes.length / 4) * 4);
  padded.writeUInt32LE(bytes.length, 0);
  bytes.copy(padded, 4);
  return padded;
}

export function encodeMessage(objectId, opcode, args = []) {
  const parts = args.map((arg) => {
    if (Buffer.isBuffer(arg)) return arg;
    const word = Buffer.alloc(4);
    if (arg < 0) word.writeInt32LE(arg, 0);
    else word.writeUInt32LE(arg >>> 0, 0);
    return word;
  });
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32LE(objectId, 0);
  header.writeUInt32LE(((8 + body.length) << 16) | opcode, 4);
  return Buffer.concat([header, body]);
}

export function decodeMessages(buffer) {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= 8) {
    const objectId = buffer.readUInt32LE(offset);
    const word = buffer.readUInt32LE(offset + 4);
    const size = word >>> 16;
    if (size < 8 || buffer.length - offset < size) break;
    messages.push({ objectId, opcode: word & 0xffff, body: buffer.subarray(offset + 8, offset + size) });
    offset += size;
  }
  return { messages, rest: buffer.subarray(offset) };
}

export function fingerScrollFrame(pointer, time, dx, dy = 0) {
  const parts = [encodeMessage(pointer, 5, [AXIS_SOURCE_FINGER])];
  if (dy) parts.push(encodeMessage(pointer, 3, [time, 0, Math.round(dy * 256)]));
  if (dx) parts.push(encodeMessage(pointer, 3, [time, 1, Math.round(dx * 256)]));
  parts.push(encodeMessage(pointer, 4));
  return Buffer.concat(parts);
}

export function fingerLiftFrame(pointer, time) {
  return Buffer.concat([encodeMessage(pointer, 5, [AXIS_SOURCE_FINGER]), encodeMessage(pointer, 6, [time, 0]), encodeMessage(pointer, 6, [time, 1]), encodeMessage(pointer, 4)]);
}

export function decodeGlobal(body) {
  const name = body.readUInt32LE(0);
  const length = body.readUInt32LE(4);
  const iface = body.subarray(8, 8 + length - 1).toString("utf8");
  const version = body.readUInt32LE(8 + Math.ceil(length / 4) * 4);
  return { name, iface, version };
}

export async function openVirtualPointer({ runtime, display, width, height }) {
  const socket = connect({ path: isAbsolute(display) ? display : join(runtime, display) });
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  let pending = Buffer.alloc(0);
  const globals = [];
  const errors = [];
  let synced = 0;
  socket.on("data", (chunk) => {
    const { messages, rest } = decodeMessages(Buffer.concat([pending, chunk]));
    pending = rest;
    for (const m of messages) {
      if (m.objectId === 2 && m.opcode === 0) globals.push(decodeGlobal(m.body));
      else if (m.objectId === 1 && m.opcode === 0) errors.push(m.body.toString("latin1"));
      else if (m.objectId === 3 && m.opcode === 0) synced++;
    }
  });
  const send = (buffer) => new Promise((resolve, reject) => socket.write(buffer, (error) => (error ? reject(error) : resolve())));
  await send(Buffer.concat([encodeMessage(1, 1, [2]), encodeMessage(1, 0, [3])]));
  await until(() => synced > 0, { timeout: 5000, label: "the Wayland registry" });
  const seat = globals.find((g) => g.iface === "wl_seat");
  const manager = globals.find((g) => g.iface === "zwlr_virtual_pointer_manager_v1");
  if (!seat || !manager) {
    socket.destroy();
    throw new Error(`the compositor offers no ${!seat ? "wl_seat" : "zwlr_virtual_pointer_manager_v1"}`);
  }
  await send(Buffer.concat([
    encodeMessage(2, 0, [seat.name, encodeString("wl_seat"), Math.min(seat.version, 1), 4]),
    encodeMessage(2, 0, [manager.name, encodeString("zwlr_virtual_pointer_manager_v1"), 1, 5]),
    encodeMessage(5, 0, [4, 6]),
  ]));
  const started = Date.now();
  const time = () => (Date.now() - started) >>> 0;
  const pointer = {
    errors,
    async move(x, y) {
      await send(Buffer.concat([encodeMessage(6, 1, [time(), Math.max(0, Math.round(x)), Math.max(0, Math.round(y)), width, height]), encodeMessage(6, 4)]));
    },
    async button(button, pressed) {
      await send(Buffer.concat([encodeMessage(6, 2, [time(), button, pressed ? 1 : 0]), encodeMessage(6, 4)]));
    },
    async scroll(dy, dx = 0) {
      const parts = [];
      if (dy) parts.push(encodeMessage(6, 3, [time(), 0, Math.round(dy * 256)]));
      if (dx) parts.push(encodeMessage(6, 3, [time(), 1, Math.round(dx * 256)]));
      parts.push(encodeMessage(6, 4));
      await send(Buffer.concat(parts));
    },
    async fingerScroll(dx, dy = 0) {
      await send(fingerScrollFrame(6, time(), dx, dy));
    },
    async fingerLift() {
      await send(fingerLiftFrame(6, time()));
    },
    async close() {
      if (socket.destroyed) return;
      await send(encodeMessage(6, 8)).catch(() => {});
      socket.end();
      socket.destroy();
    },
  };
  return pointer;
}
