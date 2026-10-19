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
