"""Generates the game's sound effects as small WAV files (no external assets needed).
Run: python3 scripts/make-sfx.py"""
import math, random, struct, wave, os
SR = 22050
OUT = os.path.join(os.path.dirname(__file__), "..", "dist", "assets", "audio")

def osc(kind, phase):
    p = phase % 1.0
    if kind == "sine": return math.sin(2 * math.pi * p)
    if kind == "square": return 1.0 if p < 0.5 else -1.0
    if kind == "triangle": return 4 * abs(p - 0.5) - 1
    if kind == "saw": return 2 * p - 1
    return 0.0

def tone(f, dur, kind="square", vol=0.15, slide=None, start=0.0):
    n = int(SR * dur); out = []; ph = 0.0
    for i in range(n):
        t = i / n
        freq = f * ((slide / f) ** t) if slide else f
        ph += freq / SR
        env = vol * (0.001 / vol) ** t  # exponential decay like the web version
        out.append(osc(kind, ph) * env)
    return start, out

def noise(dur, vol=0.2, freq=2000, start=0.0):
    n = int(SR * dur); out = []; lp = 0.0; hp = 0.0
    a = min(1.0, 2 * math.pi * freq / SR)
    for i in range(n):
        t = i / n
        x = random.uniform(-1, 1)
        lp += a * (x - lp)          # crude band-pass: low-pass then remove slow drift
        hp += 0.05 * (lp - hp)
        out.append((lp - hp) * 2.2 * vol * (0.001 / vol) ** t)
    return start, out

def mix(*parts):
    length = max(int(s * SR) + len(p) for s, p in parts)
    buf = [0.0] * length
    for s, p in parts:
        o = int(s * SR)
        for i, v in enumerate(p): buf[o + i] += v
    return buf

def save(name, buf):
    with wave.open(os.path.join(OUT, name + ".wav"), "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v * 1.6)) * 32767)) for v in buf))

random.seed(7)
save("tap", mix(tone(520, .08, "square", .07, 800)))
save("whoosh", mix(noise(.18, .18, 1400)))
save("score", mix(tone(660, .08, "triangle", .18), tone(990, .12, "triangle", .18, start=.07)))
save("swish", mix(noise(.3, .22, 3800), tone(880, .1, "triangle", .15), tone(1320, .2, "triangle", .15, start=.08)))
save("rim", mix(tone(330, .14, "square", .1, 180), tone(1250, .08, "triangle", .06)))
save("thunk", mix(tone(150, .12, "sine", .4, 60), noise(.06, .2, 900)))
save("clank", mix(tone(1500, .18, "square", .09, 900), tone(2300, .12, "triangle", .08)))
save("fail", mix(tone(320, .5, "saw", .1, 60)))
save("clear", mix(*[tone(f, .14, "triangle", .16, start=i * .07) for i, f in enumerate([523, 659, 784, 1046])]))
print("ok")
