import test from 'node:test';
import assert from 'node:assert/strict';
import {ridgeCheckpoint} from '../dist/ridge-progression.js';
import {installStubs,stubCanvas,stubCallbacks} from './ridge-planner.mjs';
import {SIM_STEP} from '../dist/rng.js';
import {replayRidge} from '../tools/replay.mjs';
import {verifySegment,RejectedRun} from '../arcade/server/verify.mjs';
installStubs();
const {RidgeEngine,hitsVial,SequenceEngine}=await import('../dist/tryout-games.js');
test('Ridge colour checkpoints change exactly at 50 gates and have bounded harder courses',()=>{
 const e=new RidgeEngine(stubCanvas(),stubCallbacks().cb,{seed:123,motion:false});assert.equal(e.courseV,6);
 for(const n of [50,100,150,200,250,300]){assert.notEqual(ridgeCheckpoint(n).name,ridgeCheckpoint(n-1).name);assert.ok(e.speedFor(n)>e.speedFor(n-1));assert.ok(e.gapFor(n)<e.gapFor(n-1));}
 assert.equal(ridgeCheckpoint(49).stage,0);assert.equal(ridgeCheckpoint(50).next,100);assert.ok(e.gapFor(10000)>=130);assert.ok(e.speedFor(10000)<400);e.destroy();
});
test('Revive is offered once, freezes the crash, retains score, and waits for an intentional tap',()=>{
 const out=stubCallbacks();let offers=0;out.cb.revive=()=>offers++;const e=new RidgeEngine(stubCanvas(),out.cb,{seed:7,motion:false});
 assert.equal(e.revive(),false);e.action();for(let t=0;t<1000&&!e.rescueOffered;t++)e.step(SIM_STEP);
 assert.equal(offers,1);assert.equal(e.paused,true);assert.equal(e.ended,false);const score=e.score;
 assert.equal(e.revive(),true);assert.equal(e.waiting,true);assert.equal(e.score,score);assert.equal(e.shield,1.25);assert.equal(e.revive(),false);e.action();assert.equal(e.waiting,false);
 e.crash();for(let i=0;i<110&&!e.ended;i++)e.step(SIM_STEP);assert.equal(e.ended,true);assert.equal(offers,1);assert.equal(e.replay().revives.length,1);e.destroy();
});
test('a real flight with a revive and a pause is reproduced by the server',async()=>{
 const out=stubCallbacks();out.cb.revive=()=>{};const e=new RidgeEngine(stubCanvas(),out.cb,{seed:42,motion:false});e.action();
 for(let i=0;i<1000&&!e.rescueOffered;i++)e.step(SIM_STEP);assert.ok(e.rescueOffered);assert.ok(e.revive());e.action();
 for(let t=0;t<3000&&!e.ended;t++){if(t===100){e.pause(true);e.pause(false);}const g=e.gates.find(g=>!g.passed);if(!e.dead&&(e.waiting||e.py>(g?.cy??300)+10))e.action();e.step(SIM_STEP);}
 e.finish();const rep=e.replay(),r=await replayRidge(rep);assert.equal(r.score,e.score);assert.equal(r.unusedInputs,0);assert.equal(r.ticks,e.ticks);e.destroy();
});
test('invented or repeated revives and course downgrades cannot count on the leaderboard',async()=>{
 const rep={v:6,game:'ridge',seed:42,step:SIM_STEP,taps:[0],resumes:[],revives:[0],endTick:0};
 await assert.rejects(verifySegment({game:'ridge',replay:rep,seed:42,level:1,rulesVersion:6}),RejectedRun);
 await assert.rejects(replayRidge({...rep,revives:[0,0]}),/one revive/);
 await assert.rejects(verifySegment({game:'ridge',replay:{...rep,v:5,revives:[]},seed:42,level:1,rulesVersion:6}),/different course rules/);
});
test('a locked Sequence crystal explains its padlock without spending a move or altering the board',()=>{
 const out=stubCallbacks(),messages=[];out.cb.message=m=>messages.push(m);const e=new SequenceEngine(stubCanvas(),out.cb,{seed:123,level:7,rulesVersion:3,motion:false});
 const i=e.progress.locks.findIndex(Boolean),board=e.board.slice(),moves=e.moves;assert.ok(i>=0);e.choose(i);assert.match(messages.at(-1),/match beside its padlock/i);assert.equal(e.moves,moves);assert.deepEqual(e.board,board);e.destroy();
});

test('all six harder Ridge checkpoints leave reachable courses through gate 350',async()=>{
 const {reachStart,reachThroughGate}=await import('../dist/ridge-reach.js');
 for(let seed=0;seed<24;seed++){
  const e=new RidgeEngine(stubCanvas(),stubCallbacks().cb,{seed,motion:false,version:6});while(e.index<352)e.addGate();let states=reachStart(e.C),t=0;
  for(let i=0;i<350;i++){const out=reachThroughGate(states,e.gates[i],e.C,e.speedFor(i),e.px,hitsVial,t);states=out.states;t=out.t;assert.ok(states.length>0,`seed ${seed}, gate ${i}: reachable flight`);}e.destroy();
 }
});


// ---------- Ridge Run zones, steps and revive ----------
import {RIDGE_REGIONS} from '../dist/ridge-progression.js';

function ridgeRun(options={}){
 const out=stubCallbacks(),effects=[],sounds=[],haptics=[];
 out.cb.effect=(label,game,meta)=>effects.push({label,game,meta});
 out.cb.sound=cue=>sounds.push(cue);
 out.cb.haptic=(cue,force)=>haptics.push({cue,force});
 out.cb.checkpoint=()=>{};
 const e=new RidgeEngine(stubCanvas(),out.cb,{seed:9,motion:false,...options});
 return {e,out,effects,sounds,haptics};
}
// Crossing a zone boundary without flying 50 gates: the announcement is driven by gatesPassed, which
// the gate loop increments, so the cheapest honest way to reach it is to fly a gate at the boundary.
function passGateAt(run,gates){
 const {e}=run;e.gatesPassed=gates-1;e.score=gates-1;
 const gate=e.gates.find(g=>!g.passed);
 gate.x=e.px-e.C.R-e.C.PW-1;
 e.started=true;e.step(SIM_STEP);
 return e.gatesPassed;
}

test('every 50 gates opens a numbered zone, with its own chime and buzz',()=>{
 for(const [gates,zone] of [[50,2],[100,3],[150,4]]){
  const run=ridgeRun();
  assert.equal(passGateAt(run,gates),gates,`flew gate ${gates}`);
  const banner=run.effects.filter(x=>/^ZONE /.test(x.label));
  assert.deepEqual(banner.map(b=>b.label),[`ZONE ${zone}!`]);
  assert.equal(banner[0].meta.zone,zone);
  assert.equal(banner[0].meta.name,RIDGE_REGIONS[(zone-1)%RIDGE_REGIONS.length].name);
  assert.ok(run.sounds.includes('win'),'a chime of its own, over the per-gate tick');
  assert.deepEqual(run.haptics.filter(h=>h.cue==='win'),[{cue:'win',force:true}]);
  run.e.destroy();
 }
});
test('an ordinary gate inside a zone announces nothing',()=>{
 const run=ridgeRun();
 assert.equal(passGateAt(run,30),30);
 assert.deepEqual(run.effects.filter(x=>/^ZONE /.test(x.label)),[]);
 assert.ok(!run.sounds.includes('win'));
 assert.deepEqual(run.haptics.filter(h=>h.cue==='win'),[]);
 run.e.destroy();
});
test('the older courses keep their gate milestones and never announce a zone',()=>{
 for(const version of [4,5]){
  const run=ridgeRun({version});
  passGateAt(run,50);
  assert.deepEqual(run.effects.filter(x=>/^ZONE /.test(x.label)),[],`v${version} stays as it was`);
  run.e.destroy();
 }
});
test('the zone step is a real step: speed up and gap down, at every boundary, then capped',()=>{
 const {e}=ridgeRun();
 for(const n of [50,100,150,200,250,300]){
  assert.ok(e.speedFor(n)>e.speedFor(n-1),`gate ${n} is faster than ${n-1}`);
  assert.ok(e.gapFor(n)<e.gapFor(n-1),`gate ${n} is tighter than ${n-1}`);
 }
 // A step the player can feel, not a rounding difference.
 assert.ok(e.speedFor(50)/e.speedFor(49)>1.05,'the first step is worth noticing');
 assert.ok(e.speedFor(100)/e.speedFor(99)>1.05,'and so is the second');
 // And bounded, so gate 10000 is hard rather than impossible.
 assert.ok(e.speedFor(10000)<e.speedFor(300)*1.3);
 assert.ok(e.gapFor(10000)>=130);
 e.destroy();
});
test('a v6 run that never revives carries an empty revive list and still verifies',async()=>{
 const out=stubCallbacks();out.cb.revive=()=>{};
 const e=new RidgeEngine(stubCanvas(),out.cb,{seed:2024,motion:false,version:6});
 e.action();
 for(let t=0;t<120*40&&!e.ended;t++){const g=e.gates.find(g=>!g.passed);if(!e.dead&&e.py>(g?.cy??300)+10)e.action();e.step(SIM_STEP);}
 if(!e.ended)e.finish();
 const rep=e.replay();
 assert.equal(rep.v,6);
 assert.deepEqual(rep.revives,[],'the field is there and empty, not missing');
 const replayed=await replayRidge(rep);
 assert.equal(replayed.score,e.score);
 assert.equal(replayed.unusedInputs,0);
 e.destroy();
});
test('the revive restores a deterministic point, and only the first crash may use it',()=>{
 const scores=[],spots=[];
 for(let run=0;run<2;run++){
  const out=stubCallbacks();out.cb.revive=()=>{};
  const e=new RidgeEngine(stubCanvas(),out.cb,{seed:31,motion:false,version:6});
  e.action();
  for(let t=0;t<2000&&!e.rescueOffered;t++)e.step(SIM_STEP);
  assert.ok(e.rescueOffered,'a crash offers the revive');
  assert.equal(e.paused,true,'and freezes the flight while it is offered');
  const before=e.score;
  assert.equal(e.revive(),true);
  scores.push([before,e.score]);spots.push([e.py,e.vy,e.ticks]);
  assert.equal(e.vy,0,'velocity is zeroed');
  assert.ok(e.shield>0,'and a shield covers the restart');
  assert.equal(e.waiting,true,'it waits for a tap');
  assert.equal(e.revive(),false,'a second revive in the same run is refused');
  e.destroy();
 }
 assert.deepEqual(scores[0],scores[1],'the score is kept, identically both times');
 assert.deepEqual(spots[0],spots[1],'and the restore point is the same from the same seed');
});
