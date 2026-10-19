import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio,cueFor} from '../dist/game-audio.js';
import {existsSync} from 'node:fs';
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
function harness({state='running',resumeDelay=false,fail=false,slow=false}={}){
 const starts=[],contexts=[],waiting=[],downloads=[];
 globalThis.fetch=()=>slow?new Promise(resolve=>downloads.push(resolve)):Promise.resolve({ok:!fail,arrayBuffer:async()=>new ArrayBuffer(1)});
 globalThis.window={AudioContext:class{
  constructor(){this.state=state;this.currentTime=10;this.destination={};contexts.push(this);}
  resume(){if(resumeDelay)return new Promise(resolve=>waiting.push(()=>{this.state='running';resolve();}));this.state='running';return Promise.resolve();}
  decodeAudioData(){return Promise.resolve({sample:true});}
  createGain(){return {gain:{value:1,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  source(type){const s={type,playbackRate:{value:1},frequency:{setValueAtTime(){}},connect(){},disconnect(){},start:at=>starts.push({type,at}),stop(){}};return s;}
  createBufferSource(){return this.source('sample');}createOscillator(){return this.source('synth');}
 }};
 return {starts,contexts,wake:()=>waiting.splice(0).forEach(f=>f()),downloads};
}
test('an interrupted context resumes before its queued sound is started',async()=>{
 const h=harness({state:'interrupted',resumeDelay:true}),audio=new GameAudio(()=>true);
 assert.equal(audio.play('blocks','drop'),true);await flush();assert.equal(h.starts.length,0);h.wake();await flush();assert.equal(h.starts.length,1);assert.equal(h.starts[0].type,'sample');
});
test('muting or leaving during resume cancels queued effects',async()=>{
 const h=harness({state:'suspended',resumeDelay:true});let enabled=true;const audio=new GameAudio(()=>enabled);audio.play('blocks','perfect');enabled=false;audio.stop();h.wake();await flush();assert.equal(h.starts.length,0);
});
test('a failed sample plays a synth in the same context, and later actions recover the sample',async()=>{
 const h=harness({fail:true}),audio=new GameAudio(()=>true);audio.play('blocks','drop');await flush();assert.deepEqual(h.starts.map(s=>s.type),['synth']);assert.equal(h.contexts.length,1);
 globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});audio.prepare();await flush();audio.play('blocks','drop');await flush();assert.deepEqual(h.starts.map(s=>s.type),['synth','sample']);
});
test('a slow sample falls back promptly and does not play a second sound when it finally arrives',async()=>{
 const h=harness({slow:true}),audio=new GameAudio(()=>true);audio.play('blocks','drop');await new Promise(r=>setTimeout(r,120));assert.deepEqual(h.starts.map(s=>s.type),['synth']);
 h.downloads.forEach(resolve=>resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}));await flush();assert.equal(h.starts.length,1);audio.play('blocks','drop');await flush();assert.equal(h.starts.at(-1).type,'sample');
});
test('a closed context can be recreated without losing the saved sound preference',async()=>{
 const h=harness(),audio=new GameAudio(()=>true);audio.prepare();await flush();audio.context.state='closed';audio.play('blocks','drop');await flush();assert.equal(h.contexts.length,2);assert.equal(h.starts.length,1);
});
test('Undo and Shuffle use different samples, not merely different volumes',()=>{
 assert.notEqual(cueFor('blocks','undo').file,cueFor('blocks','shuffle').file);
});

test('a resume blocked before the first gesture cannot trap later gesture activation',async()=>{
 const h=harness();let userGesture=false;
 const Original=window.AudioContext;window.AudioContext=class extends Original{resume(){if(!userGesture)return new Promise(()=>{});this.state='running';return Promise.resolve();}};
 const audio=new GameAudio(()=>true);audio.context=new window.AudioContext();audio.context.state='suspended';audio.prepare();await flush();assert.equal(h.starts.length,0);
 userGesture=true;audio.play('blocks','drop');await flush();assert.equal(h.starts.length,1);assert.equal(h.starts[0].type,'sample');
});


// The sounds players heard dropping in and out: Safari settles resume() on an interrupted context
// without making it current, so the state reaches 'running' only on a later statechange. play() has
// already told app.js it handled the cue, so a cue discarded here is silent rather than degraded.
function lagging({flipAfterMs}){
 const starts=[];
 class Ctx{
  constructor(){this.state='suspended';this.destination={};this.currentTime=10;this._on=new Set();}
  addEventListener(t,f){if(t==='statechange')this._on.add(f);}
  removeEventListener(t,f){if(t==='statechange')this._on.delete(f);}
  resume(){setTimeout(()=>{this.state='running';for(const f of [...this._on])f();},flipAfterMs);return Promise.resolve();}
  decodeAudioData(){return Promise.resolve({sample:true});}
  createGain(){return {gain:{value:1,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  _src(kind){return {playbackRate:{value:1},frequency:{setValueAtTime(){}},type:'',connect(){},disconnect(){},start(){starts.push(kind);},stop(){}};}
  createBufferSource(){return this._src('sample');}createOscillator(){return this._src('synth');}
 }
 globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});
 globalThis.window={AudioContext:Ctx};
 return starts;
}
const settle=ms=>new Promise(r=>setTimeout(r,ms));
test('a cue played while the context is still coming back is heard, not dropped',async()=>{
 const starts=lagging({flipAfterMs:0}),audio=new GameAudio(()=>true);
 audio.prepare();await settle(20);
 audio.context.state='interrupted';
 for(let i=0;i<6;i++)audio.play('blocks','drop');
 await settle(60);
 assert.equal(starts.length,6,'every cue sounded');
});
test('a cue survives a short interruption, and is dropped rather than played long after it',async()=>{
 const starts=lagging({flipAfterMs:200}),audio=new GameAudio(()=>true);
 audio.prepare();await settle(20);
 audio.context.state='interrupted';audio.play('blocks','drop');
 await settle(340);
 assert.equal(starts.length,1,'a notification-length gap still sounds');
 const late=lagging({flipAfterMs:1500}),slow=new GameAudio(()=>true);
 slow.prepare();await settle(20);
 slow.context.state='interrupted';slow.play('blocks','drop');
 await settle(1700);
 assert.equal(late.length,0,'a cue from before a long call is not replayed afterwards');
});
test('rapid taps during one interruption share a single statechange wait',async()=>{
 const starts=lagging({flipAfterMs:120}),audio=new GameAudio(()=>true);
 audio.prepare();await settle(20);
 audio.context.state='interrupted';
 for(let i=0;i<20;i++)audio.play('blocks','select');
 assert.equal(audio.context._on.size,1,'one listener, however many cues are waiting');
 await settle(240);
 assert.equal(starts.length,20);assert.equal(audio.context._on.size,0,'the listener is removed again');
});
test('Undo and Shuffle have their own Peak Blocks samples',()=>{
 const undo=cueFor('blocks','undo'),shuffle=cueFor('blocks','shuffle');
 assert.equal(undo.file,'blk-undo');assert.equal(shuffle.file,'blk-shuffle');
 assert.equal(undo.rate,1,'an own sample is not pitch-shifted');assert.equal(shuffle.rate,1);
 for(const file of ['blk-undo','blk-shuffle'])assert.ok(existsSync(new URL('../dist/assets/audio/'+file+'.wav',import.meta.url)),file);
 assert.notEqual(cueFor('mahjong','undo').file,'blk-undo','only Peak Blocks gets its own pair');
});
