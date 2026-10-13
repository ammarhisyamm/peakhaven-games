// Ridge Run courses are clearable, and the engine holds its invariants under random play.
// The heavy sweep (100+ seeds to gate 150) lives in tools/ridge-clearability.mjs; this is the light version.
import test from 'node:test';
import assert from 'node:assert/strict';
import {installStubs,stubCanvas,stubCallbacks,createPlanner,playPlanned} from './ridge-planner.mjs';
installStubs();
const {RidgeEngine,RIDGE,hitsVial}=await import('../dist/tryout-games.js');
const {SIM_STEP,createRandom}=await import('../dist/rng.js');
const {replayRidge}=await import('../tools/replay.mjs');

test('A planning bot clears every Ridge course it is given, moving vials and all',()=>{
  // Taps are decided every 5 ticks (24 a second) with 2.5 s of lookahead and a third of a unit of extra
  // radius, so these are lines a skilled player can fly, not pixel-perfect ones. Gate 120 is well past
  // every ramp (speed by 60, gap by 50, bob by 45), so the hardest settings get 60+ gates of play.
  for(let seed=1;seed<=16;seed++){
    const r=playPlanned(RidgeEngine,RIDGE,hitsVial,{seed,targetGates:120});
    assert.ok(r.cleared,`seed ${seed}: stuck at gate ${r.stuckAt?.gate}, died at gate ${r.gates}`);
  }
  const wide=playPlanned(RidgeEngine,RIDGE,hitsVial,{seed:17,targetGates:80,view:[1280,800]});
  assert.ok(wide.cleared,'a wide screen gets the same clearable course');
});

test('The Ridge planning bot really is judged by the engine: a careless line does crash',()=>{
  // Guard against a planner that "clears" because its model and the engine disagree.
  const out=stubCallbacks(),e=new RidgeEngine(stubCanvas(),out.cb,{seed:3,motion:false});e.action();
  for(let t=0;t<120*20&&!e.ended;t++)e.step(SIM_STEP);
  assert.ok(e.ended&&e.gatesPassed<2,'never tapping falls out of the course');e.destroy();
});

test('Ridge Run holds its invariants under 300 seeds of random, heuristic and planned play, with pauses, and every run replays',async()=>{
  const views=[[480,720],[390,844],[1280,800],[320,480]];let best=0;
  for(let seed=1;seed<=300;seed++){
    const kind=seed%3,rand=createRandom(seed*31+7),out=stubCallbacks(),e=new RidgeEngine(stubCanvas(...views[seed%4]),out.cb,{seed,motion:seed%2===0});
    const bot=createPlanner(RIDGE,hitsVial,{horizon:200});let deadAt=-1,planned=false;
    for(let t=0;t<120*45&&!e.ended;t++){
      if(rand()<.0008){e.pause(true);e.pause(false);bot.reset();}
      let tap;
      if(e.waiting)tap=rand()<.05;
      else if(kind===0)tap=rand()<.07;
      else if(kind===1){if(e.ticks%5===0&&!e.dead)planned=bot.decide(e);tap=e.ticks%5===0&&planned;if(rand()<.0015){tap=true;bot.reset();}}
      else{const next=e.gates.find(g=>!g.passed);tap=(next?e.py>next.cy+12&&e.vy>-60:false)||rand()<.004;}
      if(tap)e.action();
      e.step(SIM_STEP);
      const at=`seed ${seed} tick ${e.ticks}`;
      assert.ok(Number.isFinite(e.py)&&Number.isFinite(e.vy)&&Number.isFinite(e.score),`${at}: finite state`);
      assert.equal(e.score,e.gatesPassed+2*e.orbsTaken,`${at}: score is gates + 2 per orb`);
      assert.ok(e.gates.length>0&&e.gates.length<30,`${at}: ${e.gates.length} gates`);
      assert.ok(e.orbs.length<30,`${at}: ${e.orbs.length} orbs`);
      if(e.dead&&deadAt<0)deadAt=e.ticks;
      assert.ok(deadAt<0||e.ended||e.ticks-deadAt<=120,`${at}: run still going a second after the crash`);
    }
    if(!e.ended)e.finish();
    const result=out.result,again=await replayRidge(result.replay);best=Math.max(best,result.score);
    assert.equal(again.score,result.score,`seed ${seed}: replay score`);assert.equal(again.unusedInputs,0,`seed ${seed}: replay inputs`);
    e.destroy();
  }
  assert.ok(best>=40,`the planned runs reach the moving-vial stretch (best ${best})`);
});
