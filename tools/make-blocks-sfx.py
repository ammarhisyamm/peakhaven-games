"""Synthesises the Peak Blocks sounds: clean, digital and a little bubbly.
Run: python3 tools/make-blocks-sfx.py [out_dir]   (defaults to dist/assets/audio)
blk-place.wav is not made here: it is drop_002 from Kenney's Interface Sounds (CC0, kenney.nl)."""
import os, sys, wave
import numpy as np

SR = 44100
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "dist", "assets", "audio")
rng = np.random.default_rng(3)
P = [523.25, 587.33, 659.26, 783.99, 880.0, 1046.5, 1174.7, 1318.5, 1568.0, 1760.0, 2093.0]  # C major pentatonic

def n(d): return int(SR * d)
def env(N, a, dec):
    x = np.arange(N) / SR
    return np.minimum(1, x / max(a, 1e-4)) * np.exp(-x / dec)
def sweep(f0, f1, d, curve=6):
    x = np.arange(n(d)) / SR; k = 1 - np.exp(-x / d * curve)
    return 2 * np.pi * np.cumsum(f0 * (f1 / f0) ** (k / (1 - np.exp(-curve)))) / SR
def tone(f0, f1, d, dec, a=.001, vol=1, shape="sine", curve=6):
    ph = sweep(f0, f1, d, curve); s = np.sin(ph)
    if shape == "tri": s = 2 / np.pi * np.arcsin(np.sin(ph))
    if shape == "soft": s = np.tanh(2.2 * np.sin(ph)) / np.tanh(2.2)
    return vol * s * env(len(s), a, dec)
def noise(d, dec, lo, hi, vol=1):
    N = n(d); sp = np.fft.rfft(rng.uniform(-1, 1, N)); fr = np.fft.rfftfreq(N, 1 / SR); sp[(fr < lo) | (fr > hi)] = 0
    y = np.fft.irfft(sp, N); y /= np.abs(y).max() + 1e-9; return vol * y * env(N, .0005, dec)
def bubble(f, d=.09, dec=.03, vol=1): return tone(f * .55, f, d, dec, vol=vol, curve=8)  # quick upward glide
def grains(t0, count, span, lo, hi, vol):  # tiny high sparkle ticks
    r = np.random.default_rng(11); out = []
    for _ in range(count):
        f = r.uniform(lo, hi); out.append((t0 + r.uniform(0, span), tone(f, f * 1.1, .03, .008, vol=vol * r.uniform(.5, 1))))
    return out
def mix(parts, d):
    o = np.zeros(n(d))
    for at, s in parts:
        i = n(at); o[i:i + len(s)] += s[:len(o) - i]
    return o
def write(name, y, gain=.9):
    y = y / (np.abs(y).max() + 1e-9) * gain; f = min(len(y), n(.004)); y[-f:] *= np.linspace(1, 0, f)
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((y * 32767).astype("<i2").tobytes())

# Picking a piece up: a tiny bubble blip with a click. Also used for the combo sparkle notes.
write("blk-pick", mix([(0, bubble(1500, .05, .012)), (0, noise(.01, .002, 4000, 12000, .15))], .05), .45)
# A line clear: a low pop, a burst of noise and one bubble note, with sparkles on top.
write("blk-clear", mix([(0, tone(220, 90, .07, .02, vol=1.2)), (0, noise(.05, .012, 800, 6000, .8)), (.02, bubble(P[6], .08, .03, .8))]
                       + grains(.03, 12, .2, 3500, 8000, .3), .35), .85)
# A big clear (two or more lines): a deeper pop, a rising run of bubbles and more sparkle.
write("blk-big", mix([(0, tone(200, 70, .12, .04, vol=1.3)), (0, noise(.1, .025, 600, 7000, .9)), (.03, bubble(P[5], .1, .04)),
                      (.07, bubble(P[7], .1, .04, .9)), (.11, bubble(P[9], .12, .05, .8))] + grains(.04, 25, .35, 3500, 9000, .3), .6), .9)
# A piece that won't fit: two soft falling bumps.
write("blk-invalid", mix([(0, tone(300, 220, .09, .03, shape="soft")), (.07, tone(260, 190, .09, .03, shape="soft", vol=.8))], .18), .5)
# Out of moves: three gentle falling notes.
write("blk-over", mix([(0, tone(P[4], P[4] * .97, .35, .12, shape="tri")), (.16, tone(P[2], P[2] * .97, .35, .12, shape="tri", vol=.85)),
                       (.32, tone(P[0] * .75, P[0] * .73, .6, .2, shape="tri", vol=.8))], .95), .6)
# Undo: two soft bubbles stepping back down the scale.
write("blk-undo", mix([(0, tone(P[7], P[7] * .55, .09, .03, curve=8)), (.07, tone(P[4], P[4] * .55, .09, .03, curve=8))], .2), .6)
# Shuffle: six quick notes tumbling over each other, with a little riffle of noise at the end.
write("blk-shuffle", mix([(i * .03, tone(f, f, .04, .012, shape="tri", vol=.8)) for i, f in enumerate([P[4], P[7], P[3], P[8], P[5], P[9]])] + [(.2, noise(.03, .006, 3000, 10000, .3))], .32), .55)
# Combo clears (Marimba cascade): a woody arpeggio that gets longer and higher with each combo in a row.
def semi(f, k): return f * 2 ** (k / 12)
def bell(f, d, dec, vol=1):
    return sum(tone(f * m, f * m, d, dec / (1 + i * .6), vol=vol * v) for i, (m, v) in enumerate([(1, 1), (2.0, .45), (3.01, .25), (4.2, .12)]))
def marimba(f, vol=1):
    return mix([(0, tone(f, f, .35, .09, vol=vol)), (0, tone(f * 4, f * 4, .08, .012, vol=.25 * vol)), (0, tone(f * 10, f * 10, .03, .004, vol=.1 * vol))], .35)
CASCADE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]
def combo(c, big=False):
    k = 2 + c + (3 if big else 0)
    parts = [(0, tone(200, 80, .08, .025, vol=1.1)), (0, noise(.03, .008, 1000, 6000, .6))]
    parts += [(i * .045, marimba(semi(P[2], CASCADE[min(i + c - 1, 10)]), .8)) for i in range(k)]
    if big: parts += [(k * .045, bell(semi(P[2], 24), .6, .2, .6)), (0, tone(150, 45, .3, .06, vol=1.1))]
    return mix(parts, k * .045 + .5)
for c in range(1, 6): write(f"blk-combo-{c}", combo(c), .85)
write("blk-combo-big", combo(3, True), .92)
print("wrote Peak Blocks sounds to", os.path.abspath(OUT))
