// The two sounds Billy picked: the Peak Blocks combo cascades and the Ridge Run jump.
// The cascades are chosen by combo level through the hook added for the milestone work, and the jump is
// pitched by a plain Math.random spread. That last part is the one with teeth: the spread must never come
// from the engine's seeded RNG, or every run would sound its own physics and no replay would verify.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {clearEvent,cueFor,COMBO_LEVELS} from '../dist/game-audio.js';
import {SIM_STEP} from '../dist/rng.js';
import {installStubs,stubCanvas,stubCallbacks} from './ridge-planner.mjs';

const NEW_FILES=['blk-combo-1','blk-combo-2','blk-combo-3','blk-combo-4','blk-combo-5','blk-combo-big','ridge-jump'];
const audioPath=name=>fileURLToPath(new URL(`../dist/assets/audio/${name}.wav`,import.meta.url));

test('every new sample exists and is 16-bit 44.1 kHz mono, like the rest of the set',()=>{
 for(const name of NEW_FILES){
  const path=audioPath(name);
  assert.ok(existsSync(path),`${name}.wav is missing — run tools/make-blocks-sfx.py and tools/make-ridge-sfx.py`);
  const head=readFileSync(path).subarray(0,44);
  assert.equal(head.subarray(0,4).toString('latin1'),'RIFF',name);
  assert.equal(head.subarray(8,12).toString('latin1'),'WAVE',name);
  assert.equal(head.readUInt16LE(22),1,`${name} is mono`);
  assert.equal(head.readUInt32LE(24),44100,`${name} is 44.1 kHz`);
  assert.equal(head.readUInt16LE(34),16,`${name} is 16-bit`);
 }
});

test('the cascade really does run longer with each combo, and the big clear is the longest',()=>{
 const length=name=>statSync(audioPath(name)).size;
 for(let level=2;level<=COMBO_LEVELS;level++){
  assert.ok(length(`blk-combo-${level}`)>length(`blk-combo-${level-1}`),
   `blk-combo-${level} should last longer than blk-combo-${level-1}`);
 }
 assert.ok(length('blk-combo-big')>length(`blk-combo-${COMBO_LEVELS}`),'the big clear is the longest of all');
 // And the jump is a blip, not a tune.
 assert.ok(length('ridge-jump')<length('blk-combo-1')/3,'the jump is short');
});

test('the combo level picks the right cascade, and the big clear beats any combo',()=>{
 const file=(combo,big=false)=>cueFor('blocks',clearEvent({combo,big})).file;
 assert.equal(file(1),'blk-combo-1');
 assert.equal(file(2),'blk-combo-2');
 assert.equal(file(3),'blk-combo-3');
 assert.equal(file(4),'blk-combo-4');
 assert.equal(file(5),'blk-combo-5');
 assert.equal(file(9),'blk-combo-5','a streak past the top level keeps the longest cascade');
 assert.equal(file(40),'blk-combo-5');
 // Two or more lines at once is a big clear whatever the streak is.
 for(const combo of [1,3,5,9])assert.equal(file(combo,true),'blk-combo-big',`big beats combo ${combo}`);
 // The cascades are already in tune, so no per-game pitch is laid on top of them.
 for(let level=1;level<=COMBO_LEVELS;level++)assert.equal(cueFor('blocks',`clear${level}`).rate,1);
 assert.equal(cueFor('blocks','bigClear').rate,1);
});

test('Ridge Run flaps the new jump, and nothing else does',()=>{
 const jump=cueFor('ridge','flap');
 assert.equal(jump.file,'ridge-jump');
 // 6% either side of 1 is exactly the 0.94 to 1.06 asked for, and play() applies it with Math.random.
 assert.equal(jump.jitter,.06);
 assert.equal(jump.rate,1,'no game pitch on top, or the spread would not be centred on 1');
 for(const game of ['tower','merge','sort','blocks','mahjong','orbit','bond','sequence']){
  assert.equal(cueFor(game,'flap').file,'whoosh',`${game} keeps the old flap`);
 }
 // The other Ridge sounds are untouched.
 assert.equal(cueFor('ridge','perfect').file,'clear');
 assert.equal(cueFor('ridge','miss').file,'fail');
 assert.equal(cueFor('ridge','bond').file,'score');
});

// A context that records what was started, so the rate a flap really plays at can be read back.
function harness(){
 const starts=[],stops=[];
 const context={
  state:'running',currentTime:0,
  createBufferSource(){return {buffer:null,playbackRate:{value:1},connect(){},
   start(at){starts.push({at,rate:this.playbackRate.value});},stop(){stops.push(1);},disconnect(){}};},
  createGain(){return {gain:{value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};},
  createOscillator(){return {type:'',frequency:{setValueAtTime(){}},connect(){},start(){},stop(){},disconnect(){}};},
  decodeAudioData(){return Promise.resolve({});},
  resume(){return Promise.resolve();},
  addEventListener(){},removeEventListener(){},
 };
 globalThis.window??={};
 globalThis.window.AudioContext=class{constructor(){return context;}};
 globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});
 return {starts,stops};
}
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setTimeout(resolve,0));};

test('every flap plays at its own rate, between 0.94 and 1.06',async()=>{
 const {starts,stops}=harness();
 const {GameAudio}=await import('../dist/game-audio.js');
 const session={resume(){return true;},release(){},claim(){return true;},listen(){return()=>{};}};
 const audio=new GameAudio(()=>true,session);
 audio.prepare();await flush();
 const real=Math.random;
 try{
  // The two ends of Math.random's range are the two ends of the spread.
  Math.random=()=>0;audio.play('ridge','flap');await flush();
  Math.random=()=>1-Number.EPSILON;audio.play('ridge','flap');await flush();
  assert.equal(starts.length,2);
  assert.ok(Math.abs(starts[0].rate-.94)<1e-9,`floor should be 0.94, got ${starts[0].rate}`);
  assert.ok(Math.abs(starts[1].rate-1.06)<1e-6,`ceiling should be 1.06, got ${starts[1].rate}`);
  Math.random=real;
  starts.length=0;
  for(let i=0;i<60;i++)audio.play('ridge','flap');
  await flush();
  assert.equal(starts.length,60,'every tap is heard');
  for(const {rate} of starts)assert.ok(rate>=.94&&rate<=1.06,`rate ${rate} is outside 0.94 to 1.06`);
  assert.ok(new Set(starts.map(s=>s.rate)).size>50,'and each one is pitched a little differently');
  // Those 60 ran with nothing ever finishing, which is not how a 0.14 s sample behaves. Let them end the
  // way a browser ends them, then test the overlap on its own.
  for(const source of [...audio.sources])source.onended();
  assert.equal(audio.sources.size,0,'a finished voice is let go, so a long run cannot leak them');
  const stopsBefore=stops.length;
  // A dozen in flight at once is well past what a human can tap at a 0.14 s sample, and none of them
  // cuts off the one before it.
  for(let i=0;i<12;i++)audio.play('ridge','flap');
  await flush();
  assert.equal(audio.sources.size,12,'twelve flaps overlap');
  assert.equal(stops.length,stopsBefore,'no flap cuts the one before it off');
  for(const source of [...audio.sources])source.onended();
  assert.equal(audio.sources.size,0);
  // And in the case that cannot happen but must not break anything either — nothing ever ending — the
  // voices are capped rather than growing without end.
  for(let i=0;i<200;i++)audio.play('ridge','flap');
  await flush();
  assert.ok(audio.sources.size<=32,`voices stay capped, got ${audio.sources.size}`);
  audio.stop();
  assert.equal(audio.sources.size,0);
 }finally{Math.random=real;}
});

test('muting silences the jump, and the cue is still the new one when sound comes back',async()=>{
 harness();
 const {GameAudio}=await import('../dist/game-audio.js');
 let enabled=false;
 let claims=0;
 const session={resume(){claims++;return true;},release(){},claim(){return true;},listen(){return()=>{};}};
 const audio=new GameAudio(()=>enabled,session);
 // play() reports the cue as handled so the caller does not fall back to its own synth, but nothing sounds
 // and the audio session is left alone.
 assert.equal(audio.play('ridge','flap'),true);
 assert.equal(claims,0);
 enabled=true;
 audio.prepare();
 assert.equal(claims,1);
 audio.stop();
});

installStubs();
const {RidgeEngine}=await import('../dist/tryout-games.js');

test('the jump rate cannot reach the run: the same taps replay identically, sound or no sound',async()=>{
 const {GameAudio}=await import('../dist/game-audio.js');
 const session={resume(){return true;},release(){},claim(){return true;},listen(){return()=>{};}};
 const taps=[14,52,96,150,210,280,355,430,510,590];
 const play=(version,withSound)=>{
  const audio=withSound?new GameAudio(()=>true,session):null;
  const cb=stubCallbacks().cb;
  let flaps=0;
  if(withSound)cb.sound=type=>{if(type==='flap')flaps++;audio.play('ridge',type);};
  const engine=new RidgeEngine(stubCanvas(),cb,{seed:2024,motion:true,version});
  const left=[...taps];
  while(!engine.ended&&engine.ticks<900){
   while(left.length&&left[0]===engine.ticks){left.shift();engine.action();}
   engine.step(SIM_STEP);
  }
  if(!engine.ended)engine.finish();
  const out={score:engine.score,gates:engine.gatesPassed,py:engine.py,vy:engine.vy,ticks:engine.ticks,
   replay:engine.result().replay,random:engine.random(),flaps};
  engine.destroy();
  audio?.stop();
  return out;
 };
 for(const version of [4,5,6]){
  const silent=play(version,false),sounding=play(version,true);
  assert.ok(sounding.flaps>=4,`v${version} should have flapped, got ${sounding.flaps} flaps`);
  assert.deepEqual(sounding.replay,silent.replay,`v${version} replay is identical with the jump sound`);
  assert.equal(sounding.score,silent.score);
  assert.equal(sounding.gates,silent.gates);
  assert.equal(sounding.ticks,silent.ticks);
  // Bit for bit, and the seeded stream is at exactly the same place afterwards: the pitch spread drew
  // from Math.random, never from the course's own RNG.
  assert.equal(sounding.py,silent.py,`v${version} position is bit for bit identical`);
  assert.equal(sounding.vy,silent.vy);
  assert.equal(sounding.random,silent.random,`v${version} seeded RNG is untouched by the sound`);
 }
});
