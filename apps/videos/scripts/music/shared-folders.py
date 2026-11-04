"""Mix the Shared Folders film audio from cuts.json: the edited Eleven Music take, the sound effects and the voiceover.

usage: python3 scripts/music/shared-folders.py [--check]

Writes public/music/shared-folders/shared-folders-16x9.wav, shared-folders-9x16.wav (identical) and
shared-folders-16x9-novo.wav (no voiceover): 48 kHz stereo 24-bit, exactly cuts.beats long, cuts.lufs integrated,
true peak at most -2.0 dBTP. --check also prints ffmpeg's EBU R128 readings, short-term loudness per section,
the voiceover table, the duck envelope and the cue timing table.
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

MUSIC_TAKE = "music-take4.mp3"
TAKE_LATENCY_S = 0.0265
MUSIC_EDIT = [(0, 0, 20), (20, 28, 20), (40, 48, 12), (52, 44, 4), (56, 48, 8), (64, 44, 2), (66, 48, 31), (97, 12, 4)]
SPLICE_FADE_S = 0.008
TAIL_SOURCE_BEAT = 96
TAIL_KEEP_S = 0.5
TAIL_JOIN_S = 0.04
AIR_SECTION = "air"
AIR_DB = -14.0
AIR_LOWPASS_HZ = 600.0
AIR_IN_S = 0.08
AIR_OUT_S = 0.01
MUSIC_SECTION_GAIN_DB = {"swell": 1.5, "explain": -2.5, "montage": -2.5, "callback": -2.0}
SECTION_GAIN_RAMP_S = 0.4
RING_OUT_DB_PER_S = 4.0
RING_OUT_MAX_BOOST_DB = 18.0

PEAK_ALIGNED_KINDS = {"whoosh"}
SFX_TARGET_LU = {"arrive": -16.0}
SFX_MIX_FLOOR_LU = {"arrive": -17.8}
DEFAULT_SFX_TARGET_LU = -23.0
SFX_MEASURE_S = 0.2
SILENCE_EXEMPT_KINDS = {"thud"}
EXEMPT_DECAY_S = 0.165
EXEMPT_FADE_S = 0.06

VO_REFERENCE_LUFS = -20.0
VO_OVER_BED_LU = 3.0
VO_LEVEL_SPREAD_DB = 3.5
VO_MIN_GAP_S = 0.35
DUCK_DB = -1.5
DUCK_LEAD_S = 0.2
DUCK_ATTACK_S = 0.8
DUCK_HOLD_S = 0.4
DUCK_RELEASE_S = 1.2

SUB_HIGHPASS_HZ = 35.0
TARGET_LUFS = -16.0
CEILING_DBTP = -2.0
TAIL_FADE_S = 0.4


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
    return place_tail(out, take)


def stretch(x, factor):
    r = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "f64le", "-ar", str(SR), "-ac", "2", "-i", "-",
                        "-af", f"atempo={factor:.6f}", "-f", "f64le", "-"], input=x.astype("<f8").tobytes(),
                       capture_output=True, check=True).stdout
    return np.frombuffer(r, "<f8").reshape(-1, 2).copy()


def place_tail(out, take):
    t0 = at(CUTS.get("endHit", CUTS["beats"]))
    s0 = at(TAIL_SOURCE_BEAT)
    tail = take[s0:]
    tail = tail[:len(tail) - int(np.argmax(np.abs(tail[::-1]).max(axis=1) > 1e-6))]
    keep, join = int(TAIL_KEEP_S * SR), int(TAIL_JOIN_S * SR)
    room = LENGTH - t0
    factor = (len(tail) - keep) / (room - keep)
    rest = stretch(tail[keep - join:], factor) if factor < 1 else tail[keep - join:]
    seg = np.zeros((room + join, 2))
    seg[:keep] = tail[:keep]
    fade = raised_cosine(join)[:, None]
    seg[keep - join:keep] = tail[keep - join:keep] * (1 - fade) + rest[:join] * fade
    n = min(len(rest) - join, room - keep)
    seg[keep:keep + n] = rest[join:join + n]
    lead = int(SPLICE_FADE_S * SR)
    out[t0 - lead:t0] += take[s0 - lead:s0] * np.sqrt(raised_cosine(lead))[:, None]
    out[t0:] += seg[:room]
    return out


def air_dip(x):
    sec = next((s for s in CUTS["sections"] if s["name"] == AIR_SECTION), None)
    if sec is None:
        return x
    a, b = at(sec["at"]), at(sec["at"] + sec["beats"])
    m = np.zeros(LENGTH)
    n_in, n_out = int(AIR_IN_S * SR), int(AIR_OUT_S * SR)
    m[a:b] = 1.0
    m[a:a + n_in] = raised_cosine(n_in)
    m[b - n_out:b] = raised_cosine(n_out)[::-1]
    sos = signal.butter(4, AIR_LOWPASS_HZ, "lowpass", fs=SR, output="sos")
    low = signal.sosfiltfilt(sos, x[max(0, a - SR):b + SR], axis=0)
    filtered = np.zeros_like(x)
    filtered[max(0, a - SR):b + SR] = low
    return x * (1 - m)[:, None] + filtered * (m * 10 ** (AIR_DB / 20))[:, None]


def section_gains(x, gains):
    db = np.zeros(LENGTH)
    for sec in CUTS["sections"]:
        db[at(sec["at"]):at(sec["at"] + sec["beats"])] = gains.get(sec["name"], 0.0)
    w = np.hanning(int(SECTION_GAIN_RAMP_S * SR))
    db = np.convolve(db, w / w.sum(), "same")
    return x * 10 ** (db / 20)[:, None]


def ring_out(x):
    a = at(CUTS.get("endHit", CUTS["beats"]))
    win = int(0.1 * SR)
    env = 10 * np.log10(ndimage.uniform_filter1d((x ** 2).sum(axis=1), win) + 1e-20)
    peak_at = a + int(np.argmax(env[a:a + SR // 2]))
    t = (np.arange(LENGTH) - peak_at) / SR
    target = env[peak_at] - RING_OUT_DB_PER_S * t
    boost = np.where(t > 0.25, np.clip(target - env, 0, RING_OUT_MAX_BOOST_DB), 0.0)
    boost = ndimage.uniform_filter1d(ndimage.maximum_filter1d(boost, int(0.2 * SR)), int(0.3 * SR))
    return x * 10 ** (boost / 20)[:, None]


def anchor(x, kind):
    m = (x ** 2).sum(axis=1)
    if kind in PEAK_ALIGNED_KINDS:
        return int(np.argmax(ndimage.uniform_filter1d(m, int(0.02 * SR))))
    a = np.abs(x).max(axis=1)
    return int(np.argmax(a > a.max() * 10 ** (-30 / 20)))


def load_sfx():
    bank = {}
    for kind in sorted({c["kind"] for c in CUTS["sfx"]}):
        x = decode(os.path.join(AUDIO, f"sfx-{kind}.wav"))
        bank[kind] = (x, anchor(x, kind))
    return bank


def place(out, x, start):
    a, b = max(0, start), min(LENGTH, start + len(x))
    if b > a:
        out[a:b] += x[a - start:b - start]


def sfx_gain(cue, cue_db):
    return 10 ** (cue_db[id(cue)] / 20)


def cue_level(x, anc, cue, bed):
    one = np.zeros((LENGTH, 2))
    place(one, x, at(cue["beat"]) - anc)
    c = at(cue["beat"])
    n = int(SFX_MEASURE_S * SR)
    return window_loudness(one, c, c + n) - window_loudness(bed, c, c + n)


def calibrate_sfx(bank, bed, mix):
    cue_db = {}
    for kind, (x, anc) in bank.items():
        cues = [c for c in CUTS["sfx"] if c["kind"] == kind]
        mid = float(np.median([c.get("gain", 1.0) for c in cues]))
        for c in cues:
            offset = 20 * np.log10(c.get("gain", 1.0) / mid)
            db = SFX_TARGET_LU.get(kind, DEFAULT_SFX_TARGET_LU) + offset - cue_level(x, anc, c, bed)
            if kind in SFX_MIX_FLOOR_LU:
                db = max(db, SFX_MIX_FLOOR_LU[kind] - cue_level(x, anc, c, mix))
            cue_db[id(c)] = db
    return cue_db


def gate_after(x, end):
    y = x[:end].copy()
    n = min(len(y), int(EXEMPT_FADE_S * SR))
    y[len(y) - n:] *= raised_cosine(n)[::-1, None]
    return y


def in_silence(beat):
    return any(a <= beat < b for a, b in CUTS["silences"])


def render_sfx(bank, cue_db):
    bus = np.zeros((LENGTH, 2))
    exempt = np.zeros((LENGTH, 2))
    for cue in CUTS["sfx"]:
        x, anc = bank[cue["kind"]]
        if cue["kind"] in SILENCE_EXEMPT_KINDS and in_silence(cue["beat"]):
            place(exempt, gate_after(x, anc + int(EXEMPT_DECAY_S * SR)) * sfx_gain(cue, cue_db), at(cue["beat"]) - anc)
        else:
            place(bus, x * sfx_gain(cue, cue_db), at(cue["beat"]) - anc)
    return bus, exempt


def speech_edges(x):
    a = np.abs(x).max(axis=1)
    thr = a.max() * 10 ** (-40 / 20)
    return int(np.argmax(a > thr)), len(a) - int(np.argmax(a[::-1] > thr))


def render_vo():
    spans = []
    free_from = 0
    for line in sorted(CUTS["vo"], key=lambda v: v["beat"]):
        x = decode(os.path.join(AUDIO, f"vo-{line['id']}.wav"))
        x = x * 10 ** ((VO_REFERENCE_LUFS - lufs(x)) / 20)
        lead, last = speech_edges(x)
        wanted = at(line["beat"])
        start = max(wanted, free_from)
        end = start + (last - lead)
        spans.append({"id": line["id"], "text": line["text"], "beat": line["beat"], "start": start, "end": end,
                      "pushed": start - wanted, "audio": x, "offset": start - lead})
        free_from = end + int(VO_MIN_GAP_S * SR)
    return spans


def level_vo(spans, bed):
    gains = []
    for sp in spans:
        alone = np.zeros((LENGTH, 2))
        place(alone, sp["audio"], sp["offset"])
        gains.append(window_loudness(bed, sp["start"], sp["end"]) + VO_OVER_BED_LU - window_loudness(alone, sp["start"], sp["end"]))
    mid = float(np.median(gains))
    bus = np.zeros((LENGTH, 2))
    for sp, g in zip(spans, gains):
        sp["gain_db"] = float(np.clip(g, mid - VO_LEVEL_SPREAD_DB, mid + VO_LEVEL_SPREAD_DB))
        place(bus, sp["audio"] * 10 ** (sp["gain_db"] / 20), sp["offset"])
    return bus


def vo_envelope(spans):
    t = np.arange(LENGTH)
    db = np.zeros(LENGTH)
    lead, att = int(DUCK_LEAD_S * SR), int(DUCK_ATTACK_S * SR)
    hold, rel = int(DUCK_HOLD_S * SR), int(DUCK_RELEASE_S * SR)
    for s in spans:
        full_from, full_to = s["start"] - lead, s["end"] + hold
        rise = np.clip((t - (full_from - att)) / att, 0, 1)
        fall = np.clip(1 - (t - full_to) / rel, 0, 1)
        shape = np.where(t < full_from, 0.5 - 0.5 * np.cos(np.pi * rise),
                         np.where(t > full_to, 0.5 - 0.5 * np.cos(np.pi * fall), 1.0))
        db = np.maximum(db, shape)
    return db


def duck_db(spans):
    return DUCK_DB * vo_envelope(spans)


def bed_under_vo(music, spans):
    return music * 10 ** (duck_db(spans) / 20)[:, None]


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
    z = z[-0.691 + 10 * np.log10(z + 1e-20) > -70]
    rel = -0.691 + 10 * np.log10(z.mean()) - 10
    z = z[-0.691 + 10 * np.log10(z) > rel]
    return -0.691 + 10 * np.log10(z.mean())


def true_peak(x):
    return np.abs(signal.resample_poly(x, 4, 1, axis=0)).reshape(-1, 4, 2).max(axis=(1, 2))[:len(x)]


def limiter_gain(x, ceiling):
    need = np.minimum(1.0, ceiling / np.maximum(true_peak(x), 1e-12))
    look = int(0.0015 * SR) | 1
    rel = int(0.02 * SR) | 1
    g = ndimage.minimum_filter1d(ndimage.minimum_filter1d(need, look), rel)
    w = np.hanning(rel + 2)[1:-1]
    return np.convolve(g, w / w.sum(), "same")


def exempt_support(exempt):
    sounding = (np.abs(exempt).max(axis=1) > 0).astype(np.float64)
    w = np.hanning(int(0.01 * SR))
    return np.minimum(1.0, np.convolve(sounding, w / w.max(), "same"))


def master(bed, exempt):
    sos = signal.butter(2, SUB_HIGHPASS_HZ, "highpass", fs=SR, output="sos")
    bed = signal.sosfilt(sos, bed, axis=0) * silence_mask()[:, None]
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
        bed = bed_under_vo(music, spans) + sfx_bus + vo_bus
    else:
        bed = music + sfx_bus
    return master(bed, sfx_exempt)


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
    for k in range(max(off, 9), off + (b - a) // hop):
        if env[k] - env[max(0, k - 40):k - 8].max() >= 6 and env[k:k + 40].max() >= top - 12:
            return ((max(0, a - pre) + k * hop) - c) / SR * 1000
    return None


def peak_ms(x, beat):
    e = ndimage.uniform_filter1d((x ** 2).sum(axis=1), int(0.02 * SR))
    c = at(beat)
    a, b = max(0, c - int(0.4 * SR)), min(len(e), c + int(0.4 * SR))
    return (a + int(np.argmax(e[a:b])) - c) / SR * 1000


def momentary(x):
    p = (k_weight(x) ** 2).sum(axis=1)
    c = np.concatenate([[0.0], np.cumsum(p)])
    w, hop = int(0.4 * SR), int(0.1 * SR)
    ends = np.arange(w, len(p) + 1, hop)
    return ends / SR, -0.691 + 10 * np.log10((c[ends] - c[ends - w]) / w + 1e-20)


def window_loudness(x, a, b):
    seg = k_weight(x[a:b])
    return -0.691 + 10 * np.log10((seg ** 2).mean(axis=0).sum() + 1e-20)


def duck_stats(db, spans):
    first = spans[0]
    gaps = [(spans[i + 1]["start"] if i + 1 < len(spans) else LENGTH) - sp["end"] for i, sp in enumerate(spans)]
    last = spans[int(np.argmax(gaps))]
    lo, hi = 0.1 * DUCK_DB, 0.9 * DUCK_DB
    window = np.arange(max(0, first["start"] - 3 * SR), first["start"])
    a10 = window[np.argmax(db[window] <= lo)]
    a90 = window[np.argmax(db[window] <= hi)]
    after = np.arange(last["end"], min(LENGTH, last["end"] + 3 * SR))
    r90 = after[np.argmax(db[after] > hi)]
    r10 = after[np.argmax(db[after] > lo)]
    return {"attack_line": first["id"], "release_line": last["id"], "depth": db.min(), "attack": (a90 - a10) / SR,
            "full_before_speech": (first["start"] - a90) / SR, "release": (r10 - r90) / SR,
            "release_starts_after_speech": (r90 - last["end"]) / SR}


def check(paths, music, bank, cue_db, sfx_bus, spans, vo_bus):
    for p in paths:
        i, lra, tp = ebur128(p)
        print(f"{os.path.basename(p)}: I {i:.1f} LUFS, LRA {lra:.1f} LU, true peak {tp:.1f} dBTP")
    for p in paths[::2]:
        print(f"short-term max of 3 s windows inside each section, {os.path.basename(p)}: {loudest_short_term(p)}")
    full = decode(paths[0])
    print(f"length {len(full)} samples = {len(full) / SR:.3f} s; last frame rms "
          f"{20 * np.log10(np.sqrt((full[-SR // 30:] ** 2).mean()) + 1e-12):.1f} dBFS")
    for a, b in CUTS["silences"]:
        seg = np.abs(full[at(a):at(b)]).max(axis=1)
        live = np.flatnonzero(seg > 0)
        end = live[-1] + 1 if len(live) else 0
        print(f"silence beats {a}-{b}: sound until +{end / SR * 1000:.0f} ms, then {(len(seg) - end) / SR * 1000:.0f} ms of digital zero")
    ons = [o for o in (onset_ms(music, k) for k in range(1, CUTS["beats"])) if o is not None]
    downs = []
    for sec in CUTS["sections"][1:]:
        o = onset_ms(music, sec["at"])
        downs.append(f"{sec['name']}@{sec['at']} {'soft' if o is None else f'{o:+.1f} ms'}")
    downs = ", ".join(downs)
    print(f"music onsets vs grid: median {np.median(ons):+.1f} ms over {len(ons)} beats; section downbeats {downs}")
    print("line  beat  start    end   length  words  wpm  next starts  gap   pushed")
    for i, s in enumerate(spans):
        words = len(re.findall(r"[A-Za-z']+", s["text"]))
        dur = (s["end"] - s["start"]) / SR
        nxt = spans[i + 1]["start"] / SR if i + 1 < len(spans) else LENGTH / SR
        print(f"{s['id']:4s} {s['beat']:5.1f} {s['start'] / SR:6.2f} {s['end'] / SR:6.2f}  {dur:5.2f}s  {words:5d} {words / dur * 60:4.0f}  "
              f"{nxt:9.2f}  {nxt - s['end'] / SR:+5.2f}  {s['pushed'] / SR:+.2f} s")
    db = duck_db(spans)
    d = duck_stats(db, spans)
    print(f"duck: depth {d['depth']:.1f} dB; attack ({d['attack_line']}) 10-90% {d['attack']:.2f} s, full {d['full_before_speech']:.2f} s "
          f"before speech; release ({d['release_line']}) 90-10% {d['release']:.2f} s, starting {d['release_starts_after_speech']:.2f} s after speech")
    duck = bed_under_vo(music, spans)
    print("line  VO over bed  bed under VO vs 1.5 s before  VO gain")
    for sp in spans:
        over = window_loudness(vo_bus, sp["start"], sp["end"]) - window_loudness(duck, sp["start"], sp["end"])
        pre = max(0, sp["start"] - int(1.5 * SR) - int((DUCK_LEAD_S + DUCK_ATTACK_S) * SR))
        ride = window_loudness(duck, sp["start"], sp["end"]) - window_loudness(duck, pre, pre + int(1.5 * SR))
        print(f"{sp['id']:4s}  {over:+6.1f} LU   {ride:+6.1f} dB                     {sp['gain_db']:+.1f} dB")
    for p in paths[::2]:
        x = decode(p)
        t, mom = momentary(x)
        a = at(CUTS.get("endHit", CUTS["beats"]))
        sel = t >= a / SR
        k0 = int(np.argmax(np.where(sel & (t <= a / SR + 1.0), mom, -999)))
        below = np.flatnonzero(sel & (t > t[k0]) & (mom <= mom[k0] - 20))
        ring = (t[below[0]] - t[k0]) if len(below) else float("nan")
        print(f"ring-out {os.path.basename(p)}: peak {mom[k0]:.1f} LUFS at {t[k0]:.1f} s, -20 dB {ring:.1f} s later, "
              f"{LENGTH / SR - t[k0]:.1f} s of audio after it")
    if CUTS["sfx"]:
        print("cue        beat   on its beat (placed stem)   vs bed    vs mix")
    pre_master = duck + vo_bus + sfx_bus
    n = int(SFX_MEASURE_S * SR)
    for cue in CUTS["sfx"]:
        one = np.zeros((LENGTH, 2))
        x, anc = bank[cue["kind"]]
        place(one, x * sfx_gain(cue, cue_db), at(cue["beat"]) - anc)
        c = at(cue["beat"])
        rel = window_loudness(one, c, c + n) - window_loudness(duck, c, c + n)
        rel_mix = window_loudness(one, c, c + n) - window_loudness(pre_master, c, c + n)
        s0 = peak_ms(one, cue["beat"]) if cue["kind"] in PEAK_ALIGNED_KINDS else onset_ms(one, cue["beat"])
        label = "peak " if cue["kind"] in PEAK_ALIGNED_KINDS else "onset"
        where = "soft (no transient)" if s0 is None else f"{label} {s0:+6.1f} ms"
        print(f"{cue['kind']:8s} {cue['beat']:6.2f}  {where:26s}  {rel:+6.1f} LU {rel_mix:+6.1f} LU")


def main():
    if {"-h", "--help"} & set(sys.argv):
        print(__doc__.strip())
        return
    music = ring_out(section_gains(air_dip(edit_music()), MUSIC_SECTION_GAIN_DB))
    bank = load_sfx()
    spans = render_vo()
    bed = bed_under_vo(music, spans)
    vo_bus = level_vo(spans, bed)
    cue_db = calibrate_sfx(bank, bed, bed + vo_bus)
    sfx_bus, sfx_exempt = render_sfx(bank, cue_db)
    for s in spans:
        if s["pushed"]:
            print(f"warning: {s['id']} overlaps the line before it; placed {s['pushed'] / SR:.2f} s after beat {s['beat']} "
                  f"(beat {s['start'] / SR / BEAT:.2f})")
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
        check(paths, music, bank, cue_db, sfx_bus, spans, vo_bus)


if __name__ == "__main__":
    main()
