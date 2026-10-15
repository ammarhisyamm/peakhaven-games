// One shared sound set for every game and the menus, taken from the Tryout Arcade (tools/make-sfx.py).
// Each event maps to a file plus a gain and pitch; a game can override a cue or shift its pitch so the
// nine games share one voice but don't all sound the same.
const files=['tap','whoosh','score','swish','rim','thunk','clank','fail','clear','blk-pick','blk-place','blk-clear','blk-big','blk-invalid','blk-over'];
// Gains even out the files' different loudness. `jitter` varies the pitch slightly on repeats.
const cues={
 select:{file:'tap',gain:.5,jitter:.04},toggle:{file:'tap',gain:.5,rate:1.2},hint:{file:'tap',gain:.5,rate:1.35},
 tool:{file:'whoosh',gain:.45},undo:{file:'whoosh',gain:.45,rate:.8},launch:{file:'whoosh',gain:.45,jitter:.05},flap:{file:'whoosh',gain:.4,rate:1.4,jitter:.06},
 drop:{file:'thunk',gain:.25,jitter:.06},invalid:{file:'clank',gain:.45},
 bond:{file:'score',gain:.55,jitter:.03},crystal:{file:'score',gain:.5,rate:1.2,jitter:.04},merge:{file:'score',gain:.55,jitter:.03},
 perfect:{file:'clear',gain:.5},win:{file:'clear',gain:.55},
 swish:{file:'swish',gain:.2},rim:{file:'rim',gain:.5},miss:{file:'fail',gain:.8},
 // Peak Blocks has its own set (tools/make-blocks-sfx.py). `own` cues skip the per-game pitch shift.
 blkPick:{file:'blk-pick',gain:.55,jitter:.03,own:true},blkPlace:{file:'blk-place',gain:.5,jitter:.04,own:true},blkClear:{file:'blk-clear',gain:.7,own:true},
 blkBig:{file:'blk-big',gain:.8,own:true},blkSparkle:{file:'blk-pick',gain:.35,own:true},blkInvalid:{file:'blk-invalid',gain:.65,own:true},blkOver:{file:'blk-over',gain:.7,own:true},
};
const pitch={mahjong:1.12,merge:.88,sequence:1.08,blocks:.95};
const overrides={sort:{drop:'launch'},mahjong:{drop:'crystal'},blocks:{select:'blkPick',drop:'blkPlace',perfect:'blkClear',merge:'blkClear',big:'blkBig',sparkle:'blkSparkle',invalid:'blkInvalid',miss:'blkOver'}};
export function cueFor(game,event){const name=overrides[game]?.[event]??event,cue=cues[name];return cue?{...cue,rate:(cue.rate||1)*(cue.own?1:pitch[game]||1)}:null;}

export class GameAudio{
 constructor(enabled){this.enabled=enabled;this.context=null;this.buffers=new Map();this.failed=new Set();this.sources=new Set();this.generation=0;}
 prepare(){
  if(!this.enabled())return;
  try{this.context??=new(window.AudioContext||window.webkitAudioContext)();this.context.resume().catch(()=>{});
   for(const file of files)if(!this.buffers.has(file)){
    // A failed download is forgotten so the next prepare() retries it, and play() reports it so the
    // synthesised fallback can sound instead (before, one network error silenced the game for good).
    const pending=fetch(`assets/audio/${file}.wav`).then(r=>{if(!r.ok)throw new Error('Audio unavailable');return r.arrayBuffer();}).then(bytes=>this.context.decodeAudioData(bytes)).then(buffer=>{this.failed.delete(file);return buffer;}).catch(()=>{this.buffers.delete(file);this.failed.add(file);return null;});
    this.buffers.set(file,pending);}
  }catch{/* Effects are optional when audio is unavailable. */}
 }
 // opts.rate raises the pitch (Blocks combos climb), opts.delay schedules it slightly later (layered sparkles).
 play(game,event,opts={}){
  const cue=cueFor(game,event);if(!cue)return false;if(!this.enabled())return true;
  if(this.failed.has(cue.file)){this.prepare();return false;}
  this.prepare();const pending=this.buffers.get(cue.file);if(!pending)return false;
  const generation=this.generation,rate=cue.rate*(opts.rate||1)*(1+(Math.random()*2-1)*(cue.jitter||0)),delay=Math.max(0,opts.delay||0);
  pending.then(buffer=>{if(generation!==this.generation||!buffer||!this.enabled()||this.context.state!=='running')return;const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=buffer;source.playbackRate.value=rate;gain.gain.value=cue.gain;source.connect(gain);gain.connect(this.context.destination);this.sources.add(source);source.onended=()=>this.sources.delete(source);source.start(this.context.currentTime+delay);});return true;
 }
 stop(){this.generation++;for(const source of this.sources){try{source.stop();}catch{/* Already ended. */}}this.sources.clear();}
}
