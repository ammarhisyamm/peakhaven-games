// Shared samples keep the existing PH sound. Every known cue also has a same-context
// fallback: a late/failed download or an interrupted mobile AudioContext cannot swallow it.
const files=['tap','whoosh','score','swish','rim','thunk','clank','fail','clear','blk-pick','blk-place','blk-clear','blk-big','blk-invalid','blk-over'];
const cues={
 select:{file:'tap',gain:.5,jitter:.04},toggle:{file:'tap',gain:.5,rate:1.2},hint:{file:'tap',gain:.5,rate:1.35},
 tool:{file:'whoosh',gain:.45},undo:{file:'whoosh',gain:.45,rate:.8},shuffle:{file:'swish',gain:.55,rate:1.15},launch:{file:'whoosh',gain:.45,jitter:.05},flap:{file:'whoosh',gain:.4,rate:1.4,jitter:.06},
 drop:{file:'thunk',gain:.25,jitter:.06},invalid:{file:'clank',gain:.45},
 bond:{file:'score',gain:.55,jitter:.03},crystal:{file:'score',gain:.5,rate:1.2,jitter:.04},merge:{file:'score',gain:.55,jitter:.03},
 perfect:{file:'clear',gain:.5},win:{file:'clear',gain:.55},
 swish:{file:'swish',gain:.2},rim:{file:'rim',gain:.5},miss:{file:'fail',gain:.8},
 blkPick:{file:'blk-pick',gain:.55,jitter:.03,own:true},blkPlace:{file:'blk-place',gain:.5,jitter:.04,own:true},blkClear:{file:'blk-clear',gain:.7,own:true},
 blkBig:{file:'blk-big',gain:.8,own:true},blkSparkle:{file:'blk-pick',gain:.35,own:true},blkInvalid:{file:'blk-invalid',gain:.65,own:true},blkOver:{file:'blk-over',gain:.7,own:true},
};
const pitch={mahjong:1.12,merge:.88,sequence:1.08,blocks:.95};
const overrides={sort:{drop:'launch'},mahjong:{drop:'crystal'},blocks:{select:'blkPick',drop:'blkPlace',perfect:'blkClear',merge:'blkClear',big:'blkBig',sparkle:'blkSparkle',invalid:'blkInvalid',miss:'blkOver'}};
export function cueFor(game,event){const name=overrides[game]?.[event]??event,cue=cues[name];return cue?{...cue,rate:(cue.rate||1)*(cue.own?1:pitch[game]||1)}:null;}
const notes={select:[7],drop:[0],undo:[7,3,0],shuffle:[0,7,12],hint:[5,9],invalid:[0,-4],miss:[0,-3,-7],perfect:[0,7],merge:[0,4,7],big:[0,4,7,12],win:[0,4,7,12,16],sparkle:[12]};
export class GameAudio{
 constructor(enabled){this.enabled=enabled;this.context=null;this.buffers=new Map();this.decoded=new Map();this.failed=new Set();this.sources=new Set();this.generation=0;}
 wake(){
  const ctx=this.context;if(!ctx||ctx.state==='running')return Promise.resolve();
  // A resume requested before user activation can remain pending. Always make a
  // fresh attempt in the current gesture; reusing that old promise traps Safari.
  try{return Promise.resolve(ctx.resume()).catch(()=>{});}catch{return Promise.resolve();}
 }

 prepare(){
  if(!this.enabled())return;
  try{
   if(!this.context||this.context.state==='closed'){
    this.generation++;this.context=new(window.AudioContext||window.webkitAudioContext)();this.buffers.clear();this.decoded.clear();
   }
   this.wake();const ctx=this.context;
   for(const file of files)if(!this.buffers.has(file)){
    const pending=fetch(`assets/audio/${file}.wav`).then(r=>{if(!r.ok)throw new Error('Audio unavailable');return r.arrayBuffer();}).then(bytes=>ctx.decodeAudioData(bytes)).then(buffer=>{if(this.context===ctx){this.decoded.set(file,buffer);this.failed.delete(file);}return buffer;}).catch(()=>{if(this.context===ctx){this.buffers.delete(file);this.failed.add(file);}return null;});
    this.buffers.set(file,pending);
   }
  }catch{/* The caller can still use its optional synth if Web Audio itself is unavailable. */}
 }
 track(source,gain){
  // Clear/combination cues can overlap, but an old voice must never accumulate for a long session.
  if(this.sources.size>=32){const oldest=this.sources.values().next().value;try{oldest.stop();}catch{}this.sources.delete(oldest);}
  this.sources.add(source);source.onended=()=>{this.sources.delete(source);source.disconnect?.();gain.disconnect?.();};
 }
 fallback(ctx,event,rate,delay){
  if(!ctx.createOscillator)return;
  for(const [i,note]of (notes[event]||notes.select).entries()){
   const source=ctx.createOscillator(),gain=ctx.createGain(),at=ctx.currentTime+delay+i*.045;
   source.type='triangle';source.frequency.setValueAtTime(392*2**(note/12)*rate,at);
   gain.gain.setValueAtTime(.0001,at);gain.gain.linearRampToValueAtTime(.025,at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+.11);
   source.connect(gain);gain.connect(ctx.destination);this.track(source,gain);source.start(at);source.stop(at+.12);
  }
 }
 play(game,event,opts={}){
  const cue=cueFor(game,event);if(!cue)return false;if(!this.enabled())return true;
  this.prepare();const ctx=this.context;if(!ctx)return false;
  const generation=this.generation,rate=cue.rate*(opts.rate||1)*(1+(Math.random()*2-1)*(cue.jitter||0)),delay=Math.max(0,opts.delay||0);
  const ready=this.decoded.get(cue.file),pending=this.buffers.get(cue.file);
  const deliver=async()=>{
   await this.wake();let timer;
   // A slow first download should sound now, not several seconds after the player's action.
   const buffer=ready??await Promise.race([pending??Promise.resolve(null),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),90);})]);
   clearTimeout(timer);
   if(generation!==this.generation||!this.enabled()||ctx!==this.context||ctx.state!=='running')return;
   if(!buffer){this.fallback(ctx,event,rate,delay);return;}
   const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.playbackRate.value=rate;gain.gain.value=cue.gain;source.connect(gain);gain.connect(ctx.destination);this.track(source,gain);source.start(ctx.currentTime+delay);
  };
  deliver().catch(()=>{});return true;
 }
 stop(){this.generation++;for(const source of this.sources){try{source.stop();source.disconnect?.();}catch{}}this.sources.clear();}
}
