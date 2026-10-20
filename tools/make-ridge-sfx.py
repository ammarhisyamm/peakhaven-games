"""Synthesises the Ridge Run jump sound: a soft, low water-drop bloop.
Run: python3 tools/make-ridge-sfx.py [out_dir]   (defaults to dist/assets/audio)"""
import os, sys, wave
import numpy as np

SR = 44100
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "dist", "assets", "audio")

def t(d): return np.arange(int(SR * d)) / SR
def env(d, a, dec):
    x = t(d); return np.clip(x / a, 0, 1) ** 1.5 * np.exp(-np.maximum(x - a, 0) / dec)
def soften(y, fc=5000):  # one-pole low-pass
    k = np.exp(-2 * np.pi * fc / SR); o = np.empty_like(y); z = 0.0
    for i, v in enumerate(y): z = (1 - k) * v + k * z; o[i] = z
    return o
def write(name, y, gain=.7):
    y = soften(y); y = y / (np.abs(y).max() + 1e-9) * gain; f = int(SR * .01); y[-f:] *= np.linspace(1, 0, f)
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((y * 32767).astype("<i2").tobytes())

# Jump: a sine that rises 70% over 50 ms from about 288 Hz, with a soft attack and quick fade.
d = .14; x = t(d)
f = 523.25 * .55 * np.exp(np.minimum(x, .05) / .05 * np.log(1.7))
write("ridge-jump", np.sin(2 * np.pi * np.cumsum(f) / SR) * env(d, .004, .03))
print("wrote Ridge Run sounds to", os.path.abspath(OUT))
