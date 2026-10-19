import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio,cueFor} from '../dist/game-audio.js';
import {existsSync} from 'node:fs';

const starts=[],stops=[];
globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});
globalThis.window={AudioContext:class{
 state='running';destination={};resume(){return Promise.resolve();}decodeAudioData(){return Promise.resolve({});}
 createGain(){return {gain:{value:0},connect(){}};}
 createBufferSource(){return {playbackRate:{value:1},connect(){},start(){starts.push(this);},stop(){stops.push(this);}};}
}};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

test('muting cancels a pending decoded effect and stops effects already playing',async()=>{
 let enabled=true;const audio=new GameAudio(()=>enabled);audio.prepare();await flush();
 audio.play('orbit','launch');enabled=false;audio.stop();await flush();assert.equal(starts.length,0);
 enabled=true;audio.play('ridge','flap');await flush();assert.equal(starts.length,1);audio.stop();assert.equal(stops.length,1);
});

test('switching away invalidates pending sounds and unmapped cues use the existing fallback',async()=>{
 const audio=new GameAudio(()=>true);audio.prepare();await flush();const before=starts.length;
 audio.play('sequence','crystal');audio.stop();await flush();assert.equal(starts.length,before);
 assert.equal(audio.play('tower','not-a-cue'),false);
});

const EVENTS=['bond','crystal','drop','flap','hint','invalid','launch','merge','miss','perfect','rim','select','swish','toggle','tool','undo','win'];
test('every game and the menus have a sound for every event they use, and every file exists',()=>{
 for(const game of [null,'tower','merge','sort','blocks','mahjong','orbit','ridge','bond','sequence'])for(const event of EVENTS){
  const cue=cueFor(game,event);assert.ok(cue,`${game} ${event}`);assert.ok(cue.gain>0&&cue.gain<=1);assert.ok(cue.rate>.5&&cue.rate<2);
  assert.ok(existsSync(new URL(`../dist/assets/audio/${cue.file}.wav`,import.meta.url)),cue.file);
 }
});
test('a failed download falls back to the synth and is retried next time',async()=>{
 let fail=true;const realFetch=globalThis.fetch;globalThis.fetch=async()=>fail?{ok:false}:{ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};
 const audio=new GameAudio(()=>true);audio.prepare();await flush();
 assert.equal(audio.play('ridge','flap'),true,'the same AudioContext supplies the fallback');
 fail=false;await flush();audio.prepare();await flush();
 const before=starts.length;assert.equal(audio.play('ridge','flap'),true);await flush();assert.equal(starts.length,before+1);
 globalThis.fetch=realFetch;
});
test('Peak Blocks uses its own sound set, unshifted, and the files exist',()=>{
 const want={select:'blk-pick',drop:'blk-place',perfect:'blk-clear',big:'blk-big',sparkle:'blk-pick',invalid:'blk-invalid',miss:'blk-over'};
 for(const [event,file] of Object.entries(want)){const cue=cueFor('blocks',event);assert.equal(cue.file,file,event);assert.equal(cue.rate,1,event);
  assert.ok(existsSync(new URL(`../dist/assets/audio/${file}.wav`,import.meta.url)),file);}
 assert.equal(cueFor('blocks','tool').rate,.95,'shared cues keep the Blocks pitch');
});
test('a cue can be pitched up and delayed for combos',async()=>{
 const realFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});
 const started=[];const source=()=>({playbackRate:{value:1},connect(){},start(at){started.push({at,rate:this.playbackRate.value});},stop(){}});
 globalThis.window={AudioContext:class{constructor(){this.state='running';this.currentTime=10;this.destination={};}resume(){return Promise.resolve();}decodeAudioData(){return Promise.resolve({});}createBufferSource(){return source();}createGain(){return {gain:{value:1},connect(){}};}}};
 try{const audio=new GameAudio(()=>true);audio.play('blocks','sparkle',{rate:1.5,delay:.1});await new Promise(r=>setTimeout(r,10));
  assert.equal(started.length,1);assert.equal(started[0].rate,1.5);assert.ok(Math.abs(started[0].at-10.1)<1e-9);}
 finally{globalThis.fetch=realFetch;delete globalThis.window;}
});
