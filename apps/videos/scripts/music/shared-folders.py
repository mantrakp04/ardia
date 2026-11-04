"""Mix the Shared Folders film audio from cuts.json: the edited Eleven Music take, the sound effects and the voiceover.

usage: python3 scripts/music/shared-folders.py [--check]

Writes public/music/shared-folders/shared-folders-16x9.wav, shared-folders-9x16.wav (identical) and
shared-folders-16x9-novo.wav (no voiceover): 48 kHz stereo 24-bit, exactly cuts.beats long, -11 LUFS,
true peak at most -1.5 dBTP. --check also prints ffmpeg's EBU R128 readings and the cue timing table.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import wave

import numpy as np
from scipy import ndimage, signal

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CUTS = json.load(open(os.path.join(ROOT, "src", "lib", "sf-film", "cuts.json")))
AUDIO = os.path.join(ROOT, "public", "music", "shared-folders")
SR = 48000
BEAT = 60.0 / CUTS["bpm"]
LENGTH = int(round(CUTS["beats"] * BEAT * SR))

MUSIC_TAKE = "music-take2.mp3"
TAKE_LATENCY_S = 0.0234
MUSIC_EDIT = [(0, 0, 16), (16, 8, 6), (22, 15, 1), (24, 32, 16), (40, 28, 4), (44, 48, 4), (48, 48, 16)]
SPLICE_FADE_S = 0.006
BUILD_SWEEP_BEATS = (16, 23)
BUILD_SWEEP_HZ = (25.0, 320.0)
BUILD_RAMP_BEATS = (8, 23)
BUILD_RAMP_DB = (-5.5, -2.0)
DROP_MUSIC_RAMP_DB = (1.5, -2.5)
SECTION_BUS_GAIN_DB = {"hook": -5.5, "build": -5.0, "lift": -4.5, "end": -1.0}
SECTION_GAIN_RAMP_S = 0.03

PEAK_ALIGNED_KINDS = {"whoosh"}
SFX_GAIN_DB = {
    "chatPop": -10.0, "slam": -7.0, "whoosh": -8.0, "click": -6.0, "tick": -6.0, "sheet": -17.0,
    "lift": -10.0, "drag": -12.0, "thud": -5.0, "type": -6.0, "arrive": 1.0,
}
SILENCE_EXEMPT_KINDS = {"thud"}
EXEMPT_DECAY_S = 0.165
EXEMPT_FADE_S = 0.06
VO_GAIN_DB = -1.0
DUCK_DB = -8.0
DUCK_RAMP_S = 0.1
DUCK_HOLD_S = 0.08
SUB_HIGHPASS_HZ = 35.0
TARGET_LUFS = float(CUTS.get("lufs", -11))
CEILING_DBTP = -2.0
TAIL_FADE_S = 0.25


def at(beat):
    return int(round(beat * BEAT * SR))


def decode(path):
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, "<f4").reshape(-1, 2).astype(np.float64)


def write24(path, x):
    y = np.clip(np.round(x * (2 ** 23 - 1)), -2 ** 23, 2 ** 23 - 1).astype("<i4")
    b = np.frombuffer(y.reshape(-1).tobytes(), np.uint8).reshape(-1, 4)[:, :3].tobytes()
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(b)


def raised_cosine(n):
    return 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n))


def edit_music():
    take = decode(os.path.join(AUDIO, MUSIC_TAKE))
    take = take[int(round(TAKE_LATENCY_S * SR)):]
    take = np.concatenate([take, np.zeros((LENGTH, 2))])
    out = np.zeros((LENGTH, 2))
    xf = int(SPLICE_FADE_S * SR)
    for target, source, beats in MUSIC_EDIT:
        t0, t1 = at(target), min(LENGTH, at(target + beats))
        s0 = at(source)
        lead = min(xf, t0, s0)
        seg = take[s0 - lead:s0 + (t1 - t0)].copy()
        env = np.ones(len(seg))
        if lead:
            env[:lead] = np.sqrt(raised_cosine(lead))
        if t1 < LENGTH:
            env[-xf:] *= np.sqrt(raised_cosine(xf))[::-1]
        out[t0 - lead:t1] += seg * env[:, None]
    return out


def build_sweep(x):
    a, b = at(BUILD_SWEEP_BEATS[0]), at(BUILD_SWEEP_BEATS[1])
    nper, hop = 2048, 256
    seg = x[a - nper:b + nper]
    f, t, Z = signal.stft(seg.T, SR, nperseg=nper, noverlap=nper - hop)
    pos = np.clip((t - nper / SR) / ((b - a) / SR), 0, 1)
    cutoff = BUILD_SWEEP_HZ[0] * (BUILD_SWEEP_HZ[1] / BUILD_SWEEP_HZ[0]) ** pos
    ratio = (f[:, None] / cutoff[None, :]) ** 4
    gain = np.sqrt(ratio / (1 + ratio))
    gain[:, pos <= 0] = 1.0
    _, y = signal.istft(Z * gain[None], SR, nperseg=nper, noverlap=nper - hop)
    out = x.copy()
    out[a:b] = y.T[nper:nper + (b - a)]
    return out


def build_ramp(x):
    a, b = at(BUILD_RAMP_BEATS[0]), at(BUILD_RAMP_BEATS[1])
    db = np.linspace(BUILD_RAMP_DB[0], BUILD_RAMP_DB[1], b - a)
    out = x.copy()
    out[a:b] *= 10 ** (db / 20)[:, None]
    return out


def drop_ramp(x):
    sec = next(s for s in CUTS["sections"] if s["name"] == "drop")
    a, b = at(sec["at"]), at(sec["at"] + sec["beats"])
    db = np.zeros(LENGTH)
    db[a:b] = np.linspace(DROP_MUSIC_RAMP_DB[0], DROP_MUSIC_RAMP_DB[1], b - a)
    w = np.hanning(int(SECTION_GAIN_RAMP_S * SR))
    db = np.convolve(db, w / w.sum(), "same")
    return x * 10 ** (db / 20)[:, None]


def section_gains(x, gains):
    db = np.zeros(LENGTH)
    for sec in CUTS["sections"]:
        db[at(sec["at"]):at(sec["at"] + sec["beats"])] = gains.get(sec["name"], 0.0)
    w = np.hanning(int(SECTION_GAIN_RAMP_S * SR))
    db = np.convolve(db, w / w.sum(), "same")
    return x * 10 ** (db / 20)[:, None]


def anchor(x, kind):
    m = (x ** 2).sum(axis=1)
    if kind in PEAK_ALIGNED_KINDS:
        return int(np.argmax(ndimage.uniform_filter1d(m, int(0.02 * SR))))
    a = np.abs(x).max(axis=1)
    return int(np.argmax(a > a.max() * 10 ** (-30 / 20)))


def load_sfx():
    kinds = {c["kind"] for c in CUTS["sfx"]}
    bank = {}
    for kind in sorted(kinds):
        x = decode(os.path.join(AUDIO, f"sfx-{kind}.wav"))
        bank[kind] = (x, anchor(x, kind))
    return bank


def place(out, x, start):
    a, b = max(0, start), min(LENGTH, start + len(x))
    if b > a:
        out[a:b] += x[a - start:b - start]


def render_sfx(bank):
    bus = np.zeros((LENGTH, 2))
    exempt = np.zeros((LENGTH, 2))
    for cue in CUTS["sfx"]:
        x, anc = bank[cue["kind"]]
        g = 10 ** (SFX_GAIN_DB[cue["kind"]] / 20) * cue.get("gain", 1.0)
        if cue["kind"] in SILENCE_EXEMPT_KINDS and in_silence(cue["beat"]):
            place(exempt, gate_after(x, anc + int(EXEMPT_DECAY_S * SR)) * g, at(cue["beat"]) - anc)
        else:
            place(bus, x * g, at(cue["beat"]) - anc)
    return bus, exempt


def gate_after(x, end):
    y = x[:end].copy()
    n = min(len(y), int(EXEMPT_FADE_S * SR))
    y[len(y) - n:] *= raised_cosine(n)[::-1, None]
    return y


def in_silence(beat):
    return any(a <= beat < b for a, b in CUTS["silences"])


def render_vo():
    bus = np.zeros((LENGTH, 2))
    spans = []
    for line in CUTS["vo"]:
        x = decode(os.path.join(AUDIO, f"vo-{line['id']}.wav"))
        a = np.abs(x).max(axis=1)
        lead = int(np.argmax(a > a.max() * 10 ** (-40 / 20)))
        start = at(line["beat"]) - lead
        place(bus, x * 10 ** (VO_GAIN_DB / 20), start)
        last = len(a) - int(np.argmax(a[::-1] > a.max() * 10 ** (-40 / 20)))
        spans.append((line["id"], start + lead, start + last))
    return bus, spans


def duck_gain(spans):
    mask = np.zeros(LENGTH)
    ramp = int(DUCK_RAMP_S * SR)
    hold = int(DUCK_HOLD_S * SR)
    for _, a, b in spans:
        mask[max(0, a - ramp // 2):min(LENGTH, b + hold + ramp // 2)] = 1.0
    w = np.hanning(ramp)
    mask = np.convolve(mask, w / w.sum(), "same")
    return 10 ** (DUCK_DB * mask / 20)


def silence_mask():
    keep = np.ones(LENGTH)
    ramp = int(0.0005 * SR)
    for a, b in CUTS["silences"]:
        keep[at(a):at(b)] = 0.0
        keep[at(b):at(b) + ramp] = raised_cosine(ramp)
    return keep


def k_weight(x):
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=0), axis=0)


def lufs(x):
    p = (k_weight(x) ** 2).sum(axis=1)
    c = np.concatenate([[0.0], np.cumsum(p)])
    w, hop = int(0.4 * SR), int(0.1 * SR)
    ends = np.arange(w, len(p) + 1, hop)
    z = (c[ends] - c[ends - w]) / w
    lk = -0.691 + 10 * np.log10(z + 1e-20)
    z = z[lk > -70]
    rel = -0.691 + 10 * np.log10(z.mean()) - 10
    z = z[-0.691 + 10 * np.log10(z) > rel]
    return -0.691 + 10 * np.log10(z.mean())


def true_peak(x):
    return np.abs(signal.resample_poly(x, 4, 1, axis=0)).reshape(-1, 4, 2).max(axis=(1, 2))[:len(x)]


def limiter_gain(x, ceiling):
    tp = true_peak(x)
    need = np.minimum(1.0, ceiling / np.maximum(tp, 1e-12))
    look = int(0.0015 * SR) | 1
    rel = int(0.02 * SR) | 1
    g = ndimage.minimum_filter1d(need, look)
    g = ndimage.minimum_filter1d(g, rel)
    w = np.hanning(rel + 2)[1:-1]
    return np.convolve(g, w / w.sum(), "same")


def exempt_support(exempt):
    sounding = (np.abs(exempt).max(axis=1) > 0).astype(np.float64)
    w = np.hanning(int(0.01 * SR))
    return np.minimum(1.0, np.convolve(sounding, w / w.max(), "same"))


def master(bed, exempt):
    sos = signal.butter(2, SUB_HIGHPASS_HZ, "highpass", fs=SR, output="sos")
    keep = silence_mask()[:, None]
    bed = signal.sosfilt(sos, bed, axis=0) * keep
    exempt = signal.sosfilt(sos, exempt, axis=0) * exempt_support(exempt)[:, None]
    x = bed + exempt
    ceiling = 10 ** (CEILING_DBTP / 20)
    scale = 10 ** ((TARGET_LUFS - lufs(x)) / 20)
    for _ in range(12):
        y = x * scale
        y = y * limiter_gain(y, ceiling)[:, None]
        miss = TARGET_LUFS - lufs(y)
        if abs(miss) < 0.03:
            break
        scale *= 10 ** (miss / 20)
    n = int(TAIL_FADE_S * SR)
    y[-n:] *= raised_cosine(n)[::-1, None]
    lead = int(0.001 * SR)
    y[:lead] *= raised_cosine(lead)[:, None]
    return y


def mix(with_vo, music, sfx_bus, sfx_exempt, vo_bus, spans):
    if with_vo:
        bed = music * duck_gain(spans)[:, None] + sfx_bus + vo_bus
    else:
        bed = music + sfx_bus
    return master(section_gains(bed, SECTION_BUS_GAIN_DB), sfx_exempt)


def ebur128(path):
    r = subprocess.run(["ffmpeg", "-nostats", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    tail = r[r.rfind("Summary:"):]
    get = lambda k: float(re.search(k + r":\s+(-?[\d.]+)", tail).group(1))
    return get("I"), get("LRA"), get("Peak")


def short_term(path):
    r = subprocess.run(["ffmpeg", "-nostats", "-hide_banner", "-loglevel", "verbose", "-i", path, "-af", "ebur128", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    rows = re.findall(r"t:\s*([\d.]+)\s+TARGET.*?S:\s*(-?[\d.]+|-inf)", r)
    t = np.array([float(a) for a, _ in rows])
    st = np.array([float(b) if b != "-inf" else -120.0 for _, b in rows])
    return t, st


def loudest_short_term(path):
    t, st = short_term(path)
    rows = []
    for sec in CUTS["sections"]:
        a, b = sec["at"] * BEAT, (sec["at"] + sec["beats"]) * BEAT
        sel = (t - 3.0 >= a - 1e-3) & (t <= b + 1e-3)
        if sel.any():
            k = np.argmax(np.where(sel, st, -999))
            rows.append(f"{sec['name']} {st[k]:.1f} @ {t[k]:.1f}s")
    k = int(np.argmax(st))
    return " | ".join(rows) + f" | film max {st[k]:.1f} @ {t[k]:.1f}s"


def onset_ms(x, beat, search=0.05):
    m = np.abs(x).max(axis=1) if x.ndim == 2 else np.abs(x)
    hop = 12
    c = at(beat)
    a, b = max(0, c - int(search * SR)), min(len(m), c + int(search * SR))
    pre = 40 * hop
    seg = m[max(0, a - pre):b + 80 * hop]
    env = 20 * np.log10(seg[:len(seg) // hop * hop].reshape(-1, hop).max(axis=1) + 1e-9)
    off = (a - max(0, a - pre)) // hop
    top = env.max()
    for k in range(off, off + (b - a) // hop):
        if env[k] - env[max(0, k - 40):k - 8].max() >= 6 and env[k:k + 40].max() >= top - 12:
            return ((max(0, a - pre) + k * hop) - c) / SR * 1000
    return None


def peak_ms(x, beat):
    e = ndimage.uniform_filter1d((x ** 2).sum(axis=1), int(0.02 * SR))
    c = at(beat)
    a, b = max(0, c - int(0.4 * SR)), min(len(e), c + int(0.4 * SR))
    return (a + int(np.argmax(e[a:b])) - c) / SR * 1000


def window_loudness(x, a, b):
    seg = k_weight(x[a:b])
    return -0.691 + 10 * np.log10((seg ** 2).mean(axis=0).sum() + 1e-20)


def mix_lag_ms(full, stem, c):
    a, b = max(0, c - int(0.1 * SR)), min(LENGTH, c + int(0.5 * SR))
    f, s = full[a:b].mean(axis=1), stem[a:b].mean(axis=1)
    r = signal.correlate(f, s, mode="full", method="fft")
    lags = np.arange(-len(s) + 1, len(f))
    sel = np.abs(lags) <= int(0.05 * SR)
    return lags[sel][np.argmax(r[sel])] / SR * 1000


def check(paths, music, bank, spans, vo_bus):
    for p in paths:
        i, lra, tp = ebur128(p)
        print(f"{os.path.basename(p)}: I {i:.1f} LUFS, LRA {lra:.1f} LU, true peak {tp:.1f} dBTP")
    for p in paths[::2]:
        print(f"short-term max of 3 s windows inside each section, {os.path.basename(p)}: {loudest_short_term(p)}")
    full = decode(paths[0])
    print(f"length {len(full)} samples = {len(full) / SR:.3f} s")
    exempt = [c for c in CUTS["sfx"] if c["kind"] in SILENCE_EXEMPT_KINDS and in_silence(c["beat"])]
    for a, b in CUTS["silences"]:
        names = ", ".join(f"{c['kind']}@{c['beat']}" for c in exempt) or "none"
        seg = np.abs(full[at(a):at(b)]).max(axis=1)
        live = np.flatnonzero(seg > 0)
        zero_run = len(seg) - (live[-1] + 1 if len(live) else 0)
        print(f"silence beats {a}-{b}: exempt cues {names}; sound ends +{(live[-1] + 1 if len(live) else 0) / SR * 1000:.0f} ms, then {zero_run / SR * 1000:.0f} ms of digital zero")
    print(f"last frame rms {20 * np.log10(np.sqrt((full[-SR // 30:] ** 2).mean()) + 1e-12):.1f} dBFS")
    drop = [onset_ms(music, k) for k in range(24, 44)]
    drop = [d for d in drop if d is not None]
    print(f"music beats 24-43 onset vs grid: median {np.median(drop):+.1f} ms (n={len(drop)}); beat 24 {onset_ms(music, 24):+.1f} ms")
    duck = music * duck_gain(spans)[:, None]
    print("cue        beat   stem onset  lag in mix  lands at   vs music")
    worst = 0.0
    for cue in CUTS["sfx"]:
        one = np.zeros((LENGTH, 2))
        x, anc = bank[cue["kind"]]
        place(one, x * 10 ** (SFX_GAIN_DB[cue["kind"]] / 20) * cue.get("gain", 1.0), at(cue["beat"]) - anc)
        c = at(cue["beat"])
        rel = window_loudness(one, c, c + int(0.3 * SR)) - window_loudness(duck, c, c + int(0.3 * SR))
        lag = mix_lag_ms(full, one, c)
        if cue["kind"] in PEAK_ALIGNED_KINDS:
            s = peak_ms(one, cue["beat"])
            label = "peak"
        else:
            s = onset_ms(one, cue["beat"])
            label = "onset"
            if s is None:
                print(f"{cue['kind']:8s} {cue['beat']:6.2f}  soft (no transient)           {rel:+5.1f} LU")
                continue
            if cue["kind"] in ("arrive", "slam"):
                worst = max(worst, abs(s + lag))
        print(f"{cue['kind']:8s} {cue['beat']:6.2f}  {label} {s:+6.1f}   {lag:+6.1f} ms   {s + lag:+6.1f} ms   {rel:+5.1f} LU")
    print(f"worst arrive/slam offset {worst:.1f} ms (limit 33 ms)")
    for vid, a, b in spans:
        print(f"{vid}: {a / SR:6.3f}-{b / SR:6.3f} s, VO {window_loudness(vo_bus, a, b) - window_loudness(duck, a, b):+.1f} LU over the ducked music")


def main():
    if {"-h", "--help"} & set(sys.argv):
        print(__doc__.strip())
        return
    music = drop_ramp(build_ramp(build_sweep(edit_music())))
    bank = load_sfx()
    sfx_bus, sfx_exempt = render_sfx(bank)
    vo_bus, spans = render_vo()
    outs = {
        "shared-folders-16x9.wav": mix(True, music, sfx_bus, sfx_exempt, vo_bus, spans),
        "shared-folders-16x9-novo.wav": mix(False, music, sfx_bus, sfx_exempt, vo_bus, spans),
    }
    for name, x in outs.items():
        write24(os.path.join(AUDIO, name), x)
    shutil.copyfile(os.path.join(AUDIO, "shared-folders-16x9.wav"), os.path.join(AUDIO, "shared-folders-9x16.wav"))
    paths = [os.path.join(AUDIO, n) for n in ("shared-folders-16x9.wav", "shared-folders-9x16.wav", "shared-folders-16x9-novo.wav")]
    for name, x in outs.items():
        print(f"{name}: {lufs(x):.2f} LUFS, true peak {20 * np.log10(true_peak(x).max()):.2f} dBTP")
    if "--check" in sys.argv:
        check(paths, music, bank, spans, vo_bus)


if __name__ == "__main__":
    main()
