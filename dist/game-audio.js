const files=['launch','flap','bond','crystal','swish','rim','drop','clear'];
const voices={tower:{drop:'drop',perfect:'clear'},merge:{drop:'drop',merge:'bond'},sort:{drop:'launch',perfect:'clear'},blocks:{drop:'drop',merge:'clear'},mahjong:{drop:'crystal',merge:'clear'},orbit:{launch:'launch',swish:'swish',rim:'rim'},ridge:{flap:'flap',perfect:'clear'},bond:{launch:'launch',bond:'bond'},sequence:{drop:'drop',crystal:'crystal'}};
export class GameAudio{
 constructor(enabled){this.enabled=enabled;this.context=null;this.buffers=new Map();this.sources=new Set();this.generation=0;}
 prepare(){
  if(!this.enabled())return;
  try{this.context??=new(window.AudioContext||window.webkitAudioContext)();this.context.resume().catch(()=>{});for(const file of files)if(!this.buffers.has(file)){const pending=fetch(`assets/audio/${file}.wav`).then(r=>{if(!r.ok)throw new Error('Audio unavailable');return r.arrayBuffer();}).then(bytes=>this.context.decodeAudioData(bytes)).catch(()=>null);this.buffers.set(file,pending);}}catch{/* Effects are optional when audio is unavailable. */}
 }
 play(game,event){
  const file=voices[game]?.[event];if(!file)return false;if(!this.enabled())return true;this.prepare();const pending=this.buffers.get(file);if(!pending)return true;
  const generation=this.generation;pending.then(buffer=>{if(generation!==this.generation||!buffer||!this.enabled()||this.context.state!=='running')return;const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=buffer;source.playbackRate.value=game==='mahjong'?1.12:game==='merge'?.88:1;gain.gain.value=.24;source.connect(gain);gain.connect(this.context.destination);this.sources.add(source);source.onended=()=>this.sources.delete(source);source.start();});return true;
 }
 stop(){this.generation++;for(const source of this.sources){try{source.stop();}catch{/* Already ended. */}}this.sources.clear();}
}
