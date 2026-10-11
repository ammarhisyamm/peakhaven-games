"""Generate short original arcade effects without third-party recordings."""
import math, random, wave, struct
from pathlib import Path
random.seed(19)
rate=22050
out=Path(__file__).resolve().parents[1]/'dist/assets/audio'
out.mkdir(parents=True,exist_ok=True)

def write(name,duration,voice):
 samples=[]
 for i in range(round(rate*duration)):
  t=i/rate
  samples.append(max(-1,min(1,voice(t,duration))))
 peak=max(map(abs,samples)) or 1
 with wave.open(str(out/f'{name}.wav'),'wb') as f:
  f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate)
  f.writeframes(b''.join(struct.pack('<h',round(v/peak*18000)) for v in samples))

def env(t,d,decay=8):return min(1,t/.008)*math.exp(-decay*t/d)*min(1,(d-t)/.025)
def noise():return random.uniform(-1,1)
def chime(t,d,notes):
 value=0
 for start,freq in notes:
  u=t-start
  if u>=0:value+=env(u,d-start,5)*(math.sin(2*math.pi*freq*u)+.25*math.sin(2*math.pi*freq*2.003*u))
 return value*.25
write('launch',.24,lambda t,d:env(t,d,3)*(noise()*.22+math.sin(2*math.pi*(180*t+850*t*t))*.2))
write('flap',.12,lambda t,d:env(t,d,4)*(math.sin(2*math.pi*(320*t-650*t*t))*.3+noise()*.08))
write('bond',.4,lambda t,d:chime(t,d,[(0,587),(.04,880),(.09,1174)])+noise()*.045*env(t,d))
write('crystal',.42,lambda t,d:chime(t,d,[(0,740),(.045,988),(.09,1480)]))
write('swish',.5,lambda t,d:noise()*.15*env(t,d,4)+chime(t,d,[(.08,659),(.15,988),(.23,1318)]))
write('rim',.26,lambda t,d:env(t,d,7)*(math.sin(2*math.pi*311*t)*.2+math.sin(2*math.pi*783*t)*.12))
write('drop',.16,lambda t,d:env(t,d,6)*(math.sin(2*math.pi*(210*t-180*t*t))*.4+noise()*.1))
write('clear',.46,lambda t,d:chime(t,d,[(0,523),(.06,659),(.12,784),(.18,1046)]))
print('Generated 8 original effects')
