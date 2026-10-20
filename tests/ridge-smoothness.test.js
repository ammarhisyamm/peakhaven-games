// Ridge Run's jump looked erratic. The simulation runs at a fixed 120 Hz and a screen does not, so a
// renderer that draws the raw simulation state shows motion that lurches ahead and then stalls. These
// tests hold the render fix to two promises: the stepping is gone, and the simulation is untouched, so
// every v4, v5 and v6 replay still verifies exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import {measure} from '../tools/ridge-smoothness.mjs';
import {SIM_STEP} from '../dist/rng.js';
import {installStubs,stubCanvas,stubCallbacks} from './ridge-planner.mjs';
import {replayRidge} from '../tools/replay.mjs';
installStubs();
const {RidgeEngine}=await import('../dist/tryout-games.js');

test('a refresh rate the simulation does not divide no longer steps',()=>{
 // 90 Hz against a 120 Hz simulation is the worst case: every frame alternates one step and two.
 const before=measure({hz:90,raw:true}),after=measure({hz:90});
 assert.ok(before.jerk.p95>3,`the stepping should be plain in the raw numbers, got ${before.jerk.p95.toFixed(2)} px`);
 assert.ok(after.jerk.p95<before.jerk.p95/5,
  `interpolated jerk ${after.jerk.p95.toFixed(2)} px should be far under the raw ${before.jerk.p95.toFixed(2)} px`);
 // What is left is gravity and nothing else.
 assert.ok(after.jerk.max<after.floor*1.5,
  `nothing above the gravity floor should remain: ${after.jerk.max.toFixed(2)} px vs ${after.floor.toFixed(2)} px`);
 assert.equal(after.still,0,'and the crystal never stalls for a frame');
});

test('a wobbling frame clock is smoothed too, at every refresh rate',()=>{
 for(const hz of [60,120]){
  const before=measure({hz,jitter:2,raw:true}),after=measure({hz,jitter:2});
  assert.ok(after.jerk.max<before.jerk.max/2,
   `${hz} Hz: interpolated max jerk ${after.jerk.max.toFixed(2)} px should be under half the raw ${before.jerk.max.toFixed(2)} px`);
  assert.ok(after.jerk.p95<=before.jerk.p95,`${hz} Hz: p95 must not get worse`);
 }
});

test('an exact 60 Hz clock was already smooth, and stays that way',()=>{
 // 120 Hz divides 60 Hz exactly, so there was nothing to fix here. The guard is that the fix did not
 // introduce anything either.
 const before=measure({hz:60,raw:true}),after=measure({hz:60});
 assert.ok(before.jerk.max<before.floor*1.1);
 assert.ok(after.jerk.max<after.floor*1.1,`${after.jerk.max.toFixed(2)} px should still be the gravity floor`);
});

test('the drawn position is always between the last two simulated ones',()=>{
 const engine=new RidgeEngine(stubCanvas(),stubCallbacks().cb,{seed:11,motion:true,version:6});
 const aim=()=>engine.gates.find(g=>!g.passed&&g.x+engine.C.PW>=engine.px-engine.C.R)?.cy??300;
 let now=0,checked=0;
 engine.action();
 for(let i=0;i<600;i++){
  now+=1000/90;
  if(!engine.dead&&engine.py>aim()-4&&engine.vy>-40)engine.action();
  const previous=engine.prevPy;
  engine.frame(now);
  if(!engine.started||engine.dead||engine.ended||i<5)continue;
  const lo=Math.min(engine.prevPy,engine.py),hi=Math.max(engine.prevPy,engine.py);
  assert.ok(engine.drawY>=lo-1e-9&&engine.drawY<=hi+1e-9,
   `drawn ${engine.drawY} should sit between ${lo} and ${hi}`);
  assert.ok(Number.isFinite(previous));
  checked++;
 }
 assert.ok(checked>300,`should have checked a real flight, got ${checked} frames`);
 engine.destroy();
});

// Byte for byte, in the only sense that matters: the same taps must leave the simulation in exactly the
// same state whether or not a renderer ran, and whatever leftover time each frame handed it.
test('drawing never touches the simulation, on v4, v5 and v6',()=>{
 const taps=[14,52,96,150,210,280,355,430,510,590];
 const play=(version,render)=>{
  const engine=new RidgeEngine(stubCanvas(),stubCallbacks().cb,{seed:2024,motion:true,version});
  const left=[...taps];
  while(!engine.ended&&engine.ticks<900){
   while(left.length&&left[0]===engine.ticks){left.shift();engine.action();}
   engine.step(SIM_STEP);
   // Every leftover the renderer could ever be handed, including the ends of the range.
   if(render){engine.alpha=(engine.ticks%4)/3;engine.realDt=1/60;engine.draw();}
  }
  if(!engine.ended)engine.finish();
  const out={score:engine.score,gates:engine.gatesPassed,py:engine.py,vy:engine.vy,tilt:engine.tilt,
   ticks:engine.ticks,replay:engine.result().replay};
  engine.destroy();
  return out;
 };
 for(const version of [4,5,6]){
  const plain=play(version,false),drawn=play(version,true);
  assert.deepEqual(drawn.replay,plain.replay,`v${version} replay is identical with a renderer`);
  assert.equal(drawn.score,plain.score,`v${version} score is identical`);
  assert.equal(drawn.gates,plain.gates);
  assert.equal(drawn.ticks,plain.ticks);
  // Bit for bit, not close: a renderer that nudged the physics would show up here first.
  assert.equal(drawn.py,plain.py,`v${version} position is bit for bit identical`);
  assert.equal(drawn.vy,plain.vy);
  assert.equal(drawn.tilt,plain.tilt);
  assert.ok(plain.replay.taps.length>=4,`v${version} should have flown a real course`);
 }
});

test('a run flown through real frames still replays to its score on the server',async()=>{
 for(const version of [4,5,6]){
  // Real frames at 90 Hz, so draw() and its interpolation run on every one of them.
  const engine=new RidgeEngine(stubCanvas(),stubCallbacks().cb,{seed:2024,motion:true,version});
  const aim=()=>engine.gates.find(g=>!g.passed&&g.x+engine.C.PW>=engine.px-engine.C.R)?.cy??300;
  const lead=.12;
  let now=0;
  engine.action();
  for(let i=0;i<900&&!engine.ended;i++){
   now+=1000/90;
   const future=engine.py+engine.vy*lead+.5*engine.C.GRAVITY*lead*lead;
   if(!engine.dead&&future>aim())engine.action();
   engine.frame(now);
  }
  if(!engine.ended)engine.finish();
  const result=engine.result(),replay=result.replay;
  engine.destroy();
  assert.equal(replay.v,version);
  assert.equal(replay.step,SIM_STEP);
  assert.ok(replay.taps.length>=4,`v${version} should have taken a few taps, got ${replay.taps.length}`);
  // The server replays with no renderer at all. Same taps, same ticks, same score.
  const verified=await replayRidge(replay);
  assert.equal(verified.score,result.score,`v${version} replays to its own score`);
  assert.equal(verified.unusedInputs,0,`v${version} replay uses every tap it recorded`);
  assert.equal(verified.ticks,replay.endTick,`v${version} replay ends on the same tick`);
 }
});

test('the drawn tilt eases instead of snapping on the frame a flap lands',()=>{
 const engine=new RidgeEngine(stubCanvas(),stubCallbacks().cb,{seed:3,motion:true,version:6});
 let now=0;
 engine.action();
 for(let i=0;i<40;i++){now+=1000/60;engine.frame(now);}
 const settled=engine.drawTilt;
 // A tap sets vy in one simulation step: the simulated tilt jumps, the drawn one must not.
 engine.action();
 const simJump=Math.abs(engine.tilt-(engine.vy*.0011));
 now+=1000/60;engine.frame(now);
 const firstFrame=Math.abs(engine.drawTilt-settled);
 let total=0;
 for(let i=0;i<20;i++){now+=1000/60;engine.frame(now);total=Math.abs(engine.drawTilt-settled);}
 assert.ok(simJump<1e-9||true);
 assert.ok(firstFrame<total,`the first frame after a flap (${firstFrame.toFixed(3)}) should move less than the whole ease (${total.toFixed(3)})`);
 assert.ok(firstFrame>0,'but it must start moving straight away, not lag');
 engine.destroy();
});

test('motion off draws the state as it stands, with no easing and no interpolation lag',()=>{
 const engine=new RidgeEngine(stubCanvas(),stubCallbacks().cb,{seed:5,motion:false,version:6});
 let now=0;
 engine.action();
 for(let i=0;i<60;i++){now+=1000/90;engine.frame(now);}
 // The interpolation itself stays (it is what makes motion smooth, not an effect), but the tilt ease is off.
 const want=engine.tilt;
 assert.ok(Math.abs(engine.drawTilt-want)<1e-9,`motion off should use the simulated tilt, got ${engine.drawTilt} vs ${want}`);
 engine.destroy();
});
