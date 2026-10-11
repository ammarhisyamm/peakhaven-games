import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio} from '../dist/game-audio.js';

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
 assert.equal(audio.play('tower','win'),false);
});
