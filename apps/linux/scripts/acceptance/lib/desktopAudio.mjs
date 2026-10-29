import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { until } from "./util.mjs";

export const NULL_SINK = "ardia_acceptance_null";
export const AUDIO_TOOLS = ["pipewire", "pipewire-pulse", "wireplumber", "pactl", "parec"];

export const WIREPLUMBER_HEADLESS = `wireplumber.profiles = {
  main = {
    monitor.alsa = disabled
    monitor.alsa-midi = disabled
    monitor.bluez = disabled
    monitor.bluez.midi = disabled
    monitor.v4l2 = disabled
    monitor.libcamera = disabled
    support.portal = disabled
    support.reserve-device = disabled
  }
}
`;

export function rms(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

export function pcm16(buffer) {
  const out = new Int16Array(Math.floor(buffer.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = buffer.readInt16LE(i * 2);
  return out;
}

export async function startAudio(desktop) {
  const home = desktop.home;
  const conf = join(home, ".config", "wireplumber", "wireplumber.conf.d");
  await mkdir(conf, { recursive: true });
  await writeFile(join(conf, "90-ardia-acceptance-headless.conf"), WIREPLUMBER_HEADLESS);
  const env = { PIPEWIRE_RUNTIME_DIR: desktop.runtime, PULSE_RUNTIME_PATH: join(desktop.runtime, "pulse") };
  const daemon = desktop.spawn("pipewire", [], { name: "pipewire", env });
  await until(() => access(join(desktop.runtime, "pipewire-0")).then(() => true, () => false), { timeout: 10000, label: "the private PipeWire socket", abort: () => (daemon.state.exited ? `pipewire exited (${daemon.state.code})` : null) });
  const manager = desktop.spawn("wireplumber", [], { name: "wireplumber", env });
  const pulse = desktop.spawn("pipewire-pulse", [], { name: "pipewire-pulse", env });
  const socket = join(desktop.runtime, "pulse", "native");
  await until(() => access(socket).then(() => true, () => false), { timeout: 10000, label: "the private PulseAudio socket", abort: () => (pulse.state.exited ? `pipewire-pulse exited (${pulse.state.code})` : manager.state.exited ? `wireplumber exited (${manager.state.code})` : null) });
  const pulseEnv = { ...env, PULSE_SERVER: `unix:${socket}` };
  const pactl = (args) => desktop.run("pactl", args, { env: pulseEnv, timeout: 10000 });
  await until(() => pactl(["info"]).then(() => true, () => false), { timeout: 10000, label: "the private PulseAudio server to answer" });
  await pactl(["load-module", "module-null-sink", `sink_name=${NULL_SINK}`, "rate=48000", "channels=2"]);
  await pactl(["set-default-sink", NULL_SINK]);
  const audio = {
    env: pulseEnv,
    pactl,
    async sinkInputs() {
      const list = JSON.parse(await pactl(["-f", "json", "list", "sink-inputs"]));
      return list.map((s) => ({ index: s.index, sink: s.sink, mute: s.mute, corked: s.corked, application: s.properties?.["application.name"] ?? null }));
    },
    level(seconds = 1.5) {
      return new Promise((resolve, reject) => {
        const child = spawn("parec", ["-d", `${NULL_SINK}.monitor`, "--format=s16le", "--rate=16000", "--channels=1", "--raw", "--latency-msec=50"], { env: { ...desktop.env, ...pulseEnv }, stdio: ["ignore", "pipe", "pipe"] });
        const chunks = [];
        let stderr = "";
        child.stdout.on("data", (chunk) => chunks.push(chunk));
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        const timer = setTimeout(() => child.kill("SIGTERM"), seconds * 1000);
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", () => {
          clearTimeout(timer);
          const samples = pcm16(Buffer.concat(chunks));
          if (samples.length < 1000) return reject(new Error(`parec captured ${samples.length} samples: ${stderr.trim()}`));
          resolve(Math.round(rms(samples.subarray(Math.floor(samples.length / 4)))));
        });
      });
    },
  };
  return audio;
}
