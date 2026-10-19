import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio,cueFor} from '../dist/game-audio.js';
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
