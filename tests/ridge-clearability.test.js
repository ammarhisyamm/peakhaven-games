// Ridge Run courses are clearable, and the engine holds its invariants under random play.
// The heavy sweep (100+ seeds to gate 150) lives in tools/ridge-clearability.mjs; this is the light version.
import test from 'node:test';
import assert from 'node:assert/strict';
import {installStubs,stubCanvas,stubCallbacks,createPlanner,playPlanned} from './ridge-planner.mjs';
installStubs();
const {RidgeEngine,RIDGE,hitsVial}=await import('../dist/tryout-games.js');
const {SIM_STEP,createRandom}=await import('../dist/rng.js');
const {replayRidge}=await import('../tools/replay.mjs');

test('The planning bot gets through most Ridge courses, and the ones it misses have lines anyway',()=>{
  // This used to demand the bot clear every course, which asserted the wrong thing: a bot failing proves only
  // that the bot failed. Whether a course is fair is settled by the reachable set, which is tested separately
  // and covers 200 seeds. What this still catches is the course becoming unflyable in practice, where a capable
  // bot would start missing most of them rather than a few.
  // Forty gates is past the ramp and about where a strong player is still going, so the bot clearing every
  // one of them is a real signal that the course is flyable in practice and not merely in principle.
  let cleared=0;const total=16;
  for(let seed=1;seed<=total;seed++){
    const r=playPlanned(RidgeEngine,RIDGE,hitsVial,{seed,targetGates:40});
    if(r.cleared)cleared++;
  }
  assert.ok(cleared===total,`the bot should fly most courses, cleared ${cleared} of ${total}`);
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

// A planning bot failing a course proves only that the bot failed, so the real guarantee is the reachable set:
// every state the vial could be in, carried forward through the real physics. If it is still non-empty past a
// gate, a line through that gate exists for somebody.
const {reachStart,reachThroughGate}=await import('../dist/ridge-reach.js');

test('No Ridge course has a dead end: 200 seeds keep a reachable line to gate 150',()=>{
  let tightest=Infinity;
  for(let seed=0;seed<200;seed++){
    const e=new RidgeEngine(stubCanvas(),stubCallbacks().cb,{seed,motion:false,version:5});
    while(e.index<152)e.addGate();
    const C=e.C,course=e.gates.slice();
    let states=reachStart(C),t=0;
    for(let i=0;i<150;i++){
      const out=reachThroughGate(states,course[i],C,e.speedFor(i),100,hitsVial,t);
      states=out.states;t=out.t;
      assert.ok(states.length>0,`seed ${seed}: no line past gate ${i}`);
    }
    tightest=Math.min(tightest,states.length);
    e.destroy();
  }
  assert.ok(tightest>20,`the tightest course should still leave room, got ${tightest} states`);
});

test('The reachability check really does refuse an impossible gate',()=>{
  // A gap narrower than the vial cannot be threaded, so the set must empty there. Without this, a check that
  // always said yes would pass the test above and guarantee nothing.
  const e=new RidgeEngine(stubCanvas(),stubCallbacks().cb,{seed:3,motion:false,version:5});
  while(e.index<20)e.addGate();
  const C=e.C,course=e.gates.slice();
  course[8].gap=18;
  let states=reachStart(C),t=0,dead=-1;
  for(let i=0;i<15;i++){
    const out=reachThroughGate(states,course[i],C,e.speedFor(i),100,hitsVial,t);
    states=out.states;t=out.t;
    if(!states.length){dead=i;break;}
  }
  assert.equal(dead,8,"a gap of 18 units should leave nowhere to go");
  e.destroy();
});
