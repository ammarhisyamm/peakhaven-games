// Scenario tests for the Peak Blocks, Ridge Run and Vial Merge fixes: stuck boards, undo re-rolls,
// unreachable gates, frame-rate independence, spawn tiers, and replays that reproduce the real score.
import test from 'node:test';
import assert from 'node:assert/strict';
let rafCalls=0;
globalThis.window={devicePixelRatio:1};
globalThis.requestAnimationFrame=()=>{rafCalls++;return 1;};
globalThis.cancelAnimationFrame=()=>{};
globalThis.Image=class{complete=false;naturalWidth=0;};
const {createBlocks,blocksPlace,blocksBomb,blocksUndo,blocksShuffle,blocksHint,blocksResult,replayBlocks,anyFit}=await import('../dist/blocks-core.js');
const {SHAPES,PIECES,makeTray,emptyGrid,placements,placeBlock,RAMP_MOVES}=await import('../dist/puzzle-rules.js');
const {RidgeEngine,RIDGE_V4}=await import('../dist/tryout-games.js');
const {MergeEngine,MERGE_SPAWN_TIERS}=await import('../dist/engines.js');
const {SIM_STEP,createRandom}=await import('../dist/rng.js');
const {replayRidge,replayMerge}=await import('../tools/replay.mjs');

const noop=()=>{};
function canvas(width=480,height=720){const ctx=new Proxy({},{get:(t,k)=>k in t?t[k]:()=>ctx,set:(t,k,v)=>(t[k]=v,true)});return {getContext:()=>ctx,getBoundingClientRect:()=>({width,height,left:0,top:0}),addEventListener:noop,removeEventListener:noop,setPointerCapture:noop};}
function callbacks(onEnd){const out={result:null};out.cb={hud:noop,message:noop,sound:noop,effect:noop,progress:noop,ready:noop,topTier:noop,place:noop,end(r){out.result??=r;onEnd?.(r);}};return out;}

// ---------- Peak Blocks ----------
const I4=PIECES.find(p=>p.name==='line4'&&p.shape.every(([,y])=>y===0)).shape;
function checker(){return Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>(r+c)%2?1:0));}

test('Blocks ends when the last Bomb leaves no piece that fits, instead of freezing',()=>{
  const g=createBlocks(1);g.state.grid=checker();g.state.tray=[{shape:I4,color:1},null,null];g.tools.shuffle=0;g.tools.bomb=1;
  assert.equal(anyFit(g),false);assert.equal(g.ended,false,'a Bomb is still available');
  assert.equal(blocksBomb(g,0,0),true);assert.equal(g.ended,true,'corner bomb opens only 3 in a row, so the I4 still has nowhere to go');
});
test('Blocks ends when Undo returns to a stuck board with no space tools left',()=>{
  const g=createBlocks(2);g.history.push({...structuredClone(g.state),grid:checker(),tray:[{shape:I4,color:1},null,null]});g.tools.bomb=0;g.tools.shuffle=0;
  assert.equal(blocksUndo(g),true);assert.equal(g.ended,true);
});
test('Blocks never sits stuck with no space tools across 300 random games, and every run replays to its score',()=>{
  for(let seed=1;seed<=300;seed++){
    const g=createBlocks(seed),rand=createRandom(seed*7919);
    for(let turn=0;turn<400&&!g.ended;turn++){
      const roll=rand();
      if(roll<.03)blocksShuffle(g);else if(roll<.05)blocksUndo(g);else if(roll<.07)blocksBomb(g,Math.floor(rand()*8),Math.floor(rand()*8));else if(roll<.08)blocksHint(g);
      else{const options=[];g.state.tray.forEach((p,i)=>{if(!p)return;for(let r=0;r<8;r++)for(let c=0;c<8;c++)options.push([i,r,c]);});
        for(let k=0;k<options.length;k++){const [i,r,c]=options[Math.floor(rand()*options.length)];if(blocksPlace(g,i,r,c))break;}}
      assert.ok(g.ended||anyFit(g)||g.tools.bomb||g.tools.shuffle,`seed ${seed}: stuck board left running`);
      assert.ok(g.history.length<=3);
    }
    const result=blocksResult(g);assert.equal(replayBlocks(result.replay).score,result.score,`seed ${seed}`);
  }
});
test('Undo cannot re-roll the next tray',()=>{
  const g=createBlocks(42);g.state.tray=[{shape:SHAPES[0],color:1},null,null];
  blocksPlace(g,0,0,0);const dealt=JSON.stringify(g.state.tray);
  blocksUndo(g);blocksPlace(g,0,0,0);assert.equal(JSON.stringify(g.state.tray),dealt);
});
test('A tampered Blocks log is rejected',()=>{
  const g=createBlocks(5);blocksPlace(g,0,0,0);const rep=blocksResult(g).replay;
  assert.throws(()=>replayBlocks({...rep,log:[...rep.log,['p',0,0,0]]}),/Illegal step/);
});
test('Blocks trays deal Block Blast style pieces in proportion to their weights, with no difficulty ramp',()=>{
  const rand=createRandom(9),counts=new Map(),deals=30000;
  for(let i=0;i<deals/3;i++)for(const p of makeTray(emptyGrid(),rand))counts.set(p.shape,(counts.get(p.shape)||0)+1);
  const total=PIECES.reduce((s,p)=>s+p.weight,0);
  for(const p of PIECES){const share=(counts.get(p.shape)||0)/deals,want=p.weight/total;assert.ok(Math.abs(share-want)<want*.25+.004,`${p.name} share ${share.toFixed(4)} vs ${want.toFixed(4)}`);}
  for(const p of PIECES)assert.ok(p.color>=1,'every piece has a colour');
});
test('A Blocks tray is never dead on arrival when something can fit',()=>{
  const rand=createRandom(4);
  for(let i=0;i<2000;i++){const g=emptyGrid().map(row=>row.map(()=>rand()<.72?1:0));const tray=makeTray(g,rand);
    const anything=PIECES.some(p=>placements(g,p.shape).length);if(anything)assert.ok(tray.some(p=>placements(g,p.shape).length));}
});

// ---------- Ridge Run ----------
const {RIDGE,RIDGE_VIAL,vialHalfWidth,hitsVial}=await import('../dist/tryout-games.js');
// A simple bot that keeps the vial a little below the next gate's centre.
function ridgeBot(e){const next=e.gates.find(g=>g.x+RIDGE.PW>e.px-RIDGE.R);const target=next?next.gy+12:300;return e.py>target&&e.vy>-60;}
function playRidge({seed,hz,view=[480,720],maxSeconds=900}){
  const c=canvas(...view),out=callbacks(),e=new RidgeEngine(c,out.cb,{seed,motion:false});
  let now=1000;e.frame(now);e.action();
  for(let f=0;f<maxSeconds*hz&&!e.ended;f++){now+=1000/hz;e.frame(now);if(!e.ended&&!e.dead&&ridgeBot(e))e.action();}
  if(!e.ended)e.finish();e.destroy();return {result:out.result,engine:e};
}
// The reference ramps, written out as flap.ts has them: the box-era gap less the room the vial outline
// hands back, so the reskin is not also a difficulty change.
const refGap=i=>(150-RIDGE.SLACK)-((150-RIDGE.SLACK)-(118-RIDGE.SLACK))*Math.min(1,Math.max(0,(i-10)/40));
const refJump=i=>120+100*Math.min(1,Math.max(0,i/40));
test('Ridge Run builds the Tryout Arcade course: 210 apart, openings 147.4 to 115.4, steps up to 120 rising to 220',()=>{
  for(let seed=1;seed<=50;seed++){const e=new RidgeEngine(canvas(),callbacks().cb,{seed,motion:false,version:4});
    while(e.index<90)e.addGate();
    for(let i=0;i<e.gates.length;i++){const g=e.gates[i],gap=refGap(i);
      assert.ok(Math.abs(g.gap-gap)<1e-9,`gap at ${i}`);assert.ok(g.gy>=RIDGE.EDGE+gap/2-1e-9&&g.gy<=RIDGE.GROUND-RIDGE.EDGE-gap/2+1e-9);
      if(i){assert.ok(Math.abs(g.x-e.gates[i-1].x-210)<1e-9);assert.ok(Math.abs(g.gy-e.gates[i-1].gy)<=refJump(i)+1e-9);}}
    e.destroy();}
});
test('Ridge openings give back exactly the room the vial outline takes, and the first gate waits at 450',()=>{
  assert.equal(RIDGE.SLACK,2.6);assert.equal(RIDGE.GROUND,570);assert.equal(RIDGE.R,13);assert.equal(RIDGE.FIRST_X,450);
  const e=new RidgeEngine(canvas(),callbacks().cb,{seed:3,motion:false,version:4});
  assert.ok(Math.abs(e.gapFor(0)-147.4)<1e-9);assert.ok(Math.abs(e.gapFor(50)-115.4)<1e-9);assert.ok(Math.abs(e.gapFor(90)-115.4)<1e-9);
  assert.equal(e.gates[0].x,450);assert.ok(Math.abs(e.gates[1].x-660)<1e-9);e.destroy();
});
test('Ridge collision follows the vial outline: the neck is forgiving, the cap and body are not',()=>{
  // Half-widths straight off the profile: cap 22, neck 15, shoulder ramping to 30, body 30.
  assert.equal(vialHalfWidth(-1),-1);assert.equal(vialHalfWidth(0),RIDGE_VIAL.capW);assert.equal(vialHalfWidth(20),RIDGE_VIAL.neckW);
  assert.equal(vialHalfWidth(RIDGE_VIAL.shoulder),RIDGE_VIAL.bodyW);assert.equal(vialHalfWidth(400),RIDGE_VIAL.bodyW);
  assert.ok(Math.abs(vialHalfWidth(31)-(15+15*(31-24)/14))<1e-9,'shoulder ramps');
  // How close the node may pass at each height. The neck is the most forgiving part of the glass, and
  // every part of it is kinder than the 31-half-width box the outline replaced.
  const capY=200,cx=100,clearance=d=>{let dx=0;while(dx<80&&hitsVial(cx+dx,capY+d,RIDGE.R,cx,capY,1))dx+=.1;return dx;};
  const neck=clearance(20),body=clearance(60),cap=clearance(8),box=31+RIDGE.R*.9;
  assert.ok(neck<cap&&neck<body,`neck ${neck.toFixed(1)} is the forgiving part (cap ${cap.toFixed(1)}, body ${body.toFixed(1)})`);
  assert.ok(body<box,`even the body ${body.toFixed(1)} clears inside the old box ${box.toFixed(1)}`);
  assert.equal(hitsVial(cx+28,capY+60,RIDGE.R,cx,capY,1),true,'the body still stops a close pass');
  // Direction flips for the hanging vial, whose body runs up off the top of the screen.
  assert.equal(hitsVial(cx,capY-60,RIDGE.R,cx,capY,-1),true);assert.equal(hitsVial(cx,capY+60,RIDGE.R,cx,capY,-1),false);
});
test('A Ridge gate is only scored once the whole gate is behind the vial',()=>{
  const out=callbacks(),e=new RidgeEngine(canvas(),out.cb,{seed:4,motion:false});
  for(const g of e.gates)g.x=1e6;e.nextX=1e7;
  const g=e.gates[0];g.x=e.px-RIDGE.PW+1;g.gy=e.py;g.gap=300; // wide open, still overlapping the vial
  e.action();e.step(SIM_STEP);assert.equal(e.score,0,'not scored while the gate still overlaps');
  g.x=e.px-RIDGE.PW-RIDGE.R-1;e.step(SIM_STEP);assert.equal(e.score,1);e.destroy();
});
test('Ridge Run speed rises from 165 to 230 by gate 60, with Tryout Arcade gravity and flap',()=>{
  const e=new RidgeEngine(canvas(),callbacks().cb,{seed:1,motion:false,version:4});assert.equal(e.speed,165);e.gatesPassed=30;assert.equal(e.speed,197.5);e.gatesPassed=90;assert.equal(e.speed,230);e.gatesPassed=0;
  e.action();assert.equal(e.vy,-430);e.step(SIM_STEP);assert.ok(Math.abs(e.vy-(-430+1450*SIM_STEP))<1e-9);e.destroy();
});
test('Every screen gets the same Ridge course',()=>{
  const course=view=>{const e=new RidgeEngine(canvas(...view),callbacks().cb,{seed:9,motion:false});while(e.index<40)e.addGate();const out=e.gates.map(g=>[Math.round(g.gy*1000),g.gap]);e.destroy();return JSON.stringify(out);};
  assert.equal(course([480,720]),course([390,844]));assert.equal(course([480,720]),course([1280,800]));
});
test('The Ridge ceiling stops the vial; the ground ends the run after a short fall',()=>{
  const out=callbacks(),e=new RidgeEngine(canvas(),out.cb,{seed:2,motion:false});for(const g of e.gates)g.x=1e6;e.nextX=1e7;e.action();e.py=5;e.vy=-400;e.step(SIM_STEP);
  assert.equal(e.dead,false);assert.equal(e.py,RIDGE.R);
  e.py=RIDGE.GROUND;e.step(SIM_STEP);assert.equal(e.dead,true);assert.equal(e.py,RIDGE.GROUND-RIDGE.R,'settles on the ground');assert.equal(out.result,null,'falls for a moment first');
  for(let i=0;i<120;i++)e.step(SIM_STEP);assert.ok(out.result);assert.equal(out.result.score,0);e.destroy();
});
test('Ridge Run replays to the same score at 30, 60 and 144 Hz, on any screen',async()=>{
  for(const [hz,view] of [[30,[480,720]],[60,[390,844]],[144,[1280,800]]])for(const seed of [11,22,33]){
    const {result}=playRidge({seed,hz,view});const again=await replayRidge(result.replay);
    assert.equal(again.score,result.score,`seed ${seed} at ${hz} Hz`);assert.equal(again.unusedInputs,0);
  }
});
test('The Ridge bot clears plenty of gates, so the course is playable',()=>{
  let total=0;for(const seed of [1,2,3,4,5]){const {result}=playRidge({seed,hz:60,maxSeconds:60});total+=result.score;}
  assert.ok(total/5>=15,`average ${total/5} gates`);
});
test('Ridge Run waits for a tap after resuming instead of falling straight away',()=>{
  const e=new RidgeEngine(canvas(),callbacks().cb,{seed:3,motion:false});e.action();for(let i=0;i<30;i++)e.step(SIM_STEP);
  e.pause(true);e.pause(false);const y=e.py,vy=e.vy,xs=e.gates.map(g=>g.x);for(let i=0;i<240;i++)e.step(SIM_STEP);
  assert.equal(e.py,y,'holds still where it was');assert.deepEqual(e.gates.map(g=>g.x),xs,'the course waits too');assert.equal(e.ended,false);
  e.action();assert.equal(e.vy,vy,'the tap picks the flight back up');e.step(SIM_STEP);assert.notEqual(e.py,y,'and it moves again');e.destroy();
});
test('The tap that resumes Ridge Run carries on the paused flight instead of forcing a flap into the glass',()=>{
  // Paused (say the tab went hidden) while threading a gate just under the hanging vial. A forced flap on
  // resume used to throw the vial into the glass: the run was lost to the pause, not to the player.
  const e=new RidgeEngine(canvas(),callbacks().cb,{seed:3,motion:false});e.action();
  const g={x:e.px-RIDGE.PW/2,gy:300,cy:300,gap:115.4,amp:0,phase:0,rate:0,passed:false};e.gates=[g];e.nextX=1e7;e.orbs=[];
  e.py=g.cy-g.gap/2+RIDGE.R+4;e.vy=120;const vy=e.vy;
  e.pause(true);e.pause(false);e.pause(false);assert.equal(e.vy,vy,'velocity kept through the pause, even if resumed twice');
  for(let i=0;i<30;i++)e.step(SIM_STEP);assert.equal(e.vy,vy,'still waiting');
  e.action();assert.equal(e.vy,vy,'the resuming tap does not flap');assert.equal(e.waiting,false);
  for(let i=0;i<6;i++)e.step(SIM_STEP);assert.equal(e.dead,false,'falls on through the gap');
  e.action();assert.equal(e.vy,-430,'the next tap flaps as usual');e.destroy();
  const f=new RidgeEngine(canvas(),callbacks().cb,{seed:3,motion:false});f.action();f.gates=[{...g}];f.nextX=1e7;f.orbs=[];f.py=g.cy-g.gap/2+RIDGE.R+4;f.vy=120;
  f.action();for(let i=0;i<6;i++)f.step(SIM_STEP);assert.equal(f.dead,true,'a flap from that spot is fatal, which is what resuming used to force');f.destroy();
});
test('A Ridge run with pauses replays to the same score, and an old-format replay is refused',async()=>{
  const out=callbacks(),e=new RidgeEngine(canvas(),out.cb,{seed:21,motion:false});e.action();
  for(let t=0;t<120*20&&!e.ended;t++){if(t%300===150){e.pause(true);e.pause(false);}const next=e.gates.find(g=>!g.passed);if(e.waiting&&t%300===170)e.action();else if(!e.waiting&&next&&e.py>next.cy+12&&e.vy>-60)e.action();e.step(SIM_STEP);}
  e.finish();const rep=out.result.replay;assert.equal(rep.v,6);assert.ok(rep.resumes.length>0);
  assert.equal((await replayRidge(rep)).score,out.result.score);
  await assert.rejects(replayRidge({...rep,v:3}),/Not a Ridge Run replay/);e.destroy();
});
test('Ending a run inside a frame does not schedule another frame',()=>{
  let e;const out=callbacks(()=>e.destroy());e=new RidgeEngine(canvas(),out.cb,{seed:4,motion:false});
  e.action();e.py=RIDGE.GROUND;e.dead=true;e.deadT=.79;e.frame(5000);const before=rafCalls;e.frame(5100);
  assert.ok(out.result);assert.equal(rafCalls,before,'no rAF after destroy');
});
test('A doctored Ridge score does not survive replay',async()=>{
  const {result}=playRidge({seed:77,hz:60});assert.notEqual((await replayRidge(result.replay)).score,result.score+50);
});

// ---------- Vial Merge ----------
function playMerge({seed,hz,drops}){
  const out=callbacks(),e=new MergeEngine(canvas(),out.cb,{seed,motion:false});const plan=drops.map(d=>[...d]);
  let now=1000;e.frame(now);
  for(let f=0;f<120*hz&&!e.ended;f++){
    while(plan.length&&e.ticks>=plan[0][0]){const [,x]=plan.shift();e.x=x;e.action();}
    now+=1000/hz;e.frame(now);
  }
  if(!e.ended)e.finish();e.destroy();return out.result;
}
const mergePlan=seed=>{const r=createRandom(seed);return Array.from({length:60},(_,i)=>[60+i*140,Math.round((90+r()*300)*100)/100]);};
test('Vial Merge gives the same result at 60, 120 and 240 Hz for the same drops',()=>{
  for(const seed of [1,2,3]){
    const scores=[60,120,240].map(hz=>playMerge({seed,hz,drops:mergePlan(seed)}).score);
    assert.equal(new Set(scores).size,1,`seed ${seed}: ${scores}`);
  }
});
test('Vial Merge replays to the same score',async()=>{
  for(const seed of [5,6]){const live=playMerge({seed,hz:60,drops:mergePlan(seed)});const again=await replayMerge(live.replay);assert.equal(again.score,live.score);assert.equal(again.unusedInputs,0);}
});
test('Vial Merge never spawns tiers that cannot merge',()=>{
  const e=new MergeEngine(canvas(),callbacks().cb,{seed:8,motion:false});const seen=new Set();
  for(let i=0;i<2000;i++){e.cooldown=0;e.bodies.length=0;e.action();seen.add(e.preview);seen.add(e.next);}
  assert.ok(Math.max(...seen)<MERGE_SPAWN_TIERS,`spawned ${[...seen]}`);e.destroy();
});

// ---------- Bond ----------
const {BondEngine,BOND_HIT,BOND_MAX_FIXED,BOND_FIXED_GAP,bondVials,bondClock,bondCapacity}=await import('../dist/tryout-games.js');
const {replayBond}=await import('../tools/replay.mjs');
const angDist=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
// The ring's wobble follows run time from chain 4 (stage 3) on, exactly as the engine does.
const bondWobble=(e,t)=>e.index>=3?Math.sin(t*1.15)*1.3+.35:1;
// Fires only when the vial, 0.12 s from now, would land clear of every vial on the ring.
function bondSafe(e,margin=.04){let t=e.time,rot=e.rotation,p=0;while(p<1){t+=SIM_STEP;rot+=e.base*bondWobble(e,t)*SIM_STEP;p+=SIM_STEP/.12;} // same steps as the engine
  return e.pins.every(a=>angDist(a,Math.PI/2-rot)>=BOND_HIT+margin);}
// About to be timed out: one tick of clock left.
const urgent=e=>e.clockLive&&e.clock<=.15;
// A careful player: throws into a clear gap, and rather than let the shot clock run out, throws anyway.
function playBond(e,seconds,chance=0){const rand=createRandom(99);
  for(let i=0;i<seconds*120&&!e.ended;i++){
    if(!e.flights.length&&e.clearT<=0&&(bondSafe(e)||(e.clockLive&&e.clock<=.15)||rand()<chance))e.action();
    e.step(SIM_STEP);}}
test('Bond chains follow the Tryout Arcade stage rules: 5 + stage vials, seeded fixed vials, faster spin, wobble from chain 4',()=>{
  for(let seed=1;seed<=40;seed++){const e=new BondEngine(canvas(),callbacks().cb,{seed,motion:false});
    for(let chain=1;chain<=9;chain++){const s=chain-1;
      assert.equal(e.stage,chain);assert.equal(e.index,s);assert.equal(e.left,bondVials(s));
      assert.ok(e.pins.length<=BOND_MAX_FIXED,`fixed vials ${e.pins.length}`);assert.equal(e.fixed,e.pins.length);
      for(let i=0;i<e.pins.length;i++)for(let j=i+1;j<e.pins.length;j++)assert.ok(angDist(e.pins[i],e.pins[j])>BOND_FIXED_GAP,'fixed vials start a gap apart');
      assert.ok(Math.abs(Math.abs(e.base)-(1.7+.22*s))<1e-9,`spin at chain ${chain}`);
      if(s<3)assert.equal(e.wobble,1);else assert.ok(e.wobble>=-.95-1e-9&&e.wobble<=1.65+1e-9,`wobble ${e.wobble}`);
      e.left=0;e.clearT=.001;e.step(SIM_STEP);}
    e.destroy();}
});
test('Bond vial counts keep climbing past the knee, so a run always ends eventually',()=>{
  assert.deepEqual([...Array(11).keys()].map(bondVials),[5,6,7,8,9,10,11,12,13,14,15]);
});
test('Bond shot clock eases from 4 s to 2.5 s, and does not run until the first throw',()=>{
  assert.equal(bondClock(0),4);assert.equal(bondClock(5),4);assert.equal(bondClock(20),2.5);assert.equal(bondClock(30),2.5);
  assert.ok(Math.abs(bondClock(10)-3.5)<1e-9);
  // Idle before the first throw: the clock is dead, so reading the tutorial cannot spend the run.
  const idle=new BondEngine(canvas(),callbacks().cb,{seed:4,motion:false});
  for(let i=0;i<120*10;i++)idle.step(SIM_STEP);
  assert.equal(idle.ended,false,'idle before the first throw is free');assert.equal(idle.clockLive,false);idle.destroy();
  // After a throw it runs, and a player who never throws again is timed out.
  const out=callbacks(),e=new BondEngine(canvas(),out.cb,{seed:4,motion:false});e.pins=[];e.fixed=0;e.action();
  assert.equal(e.clockLive,true);assert.equal(e.clock,e.clockLimit,'a throw refills the clock');
  const during=e.clock;for(let i=0;i<10;i++)e.step(SIM_STEP);
  assert.equal(e.clock,during,'paused while the vial flies');
  while(e.flights.length)e.step(SIM_STEP);
  assert.equal(e.clock,during,'still full when the vial lands');
  for(let i=0;i<120*(e.clockLimit+1)&&!e.ended;i++)e.step(SIM_STEP);
  assert.equal(e.ended,true,'the shot clock ends a run that stalls');
  assert.equal(out.result.timeout,true,'the result says it was the clock');e.destroy();
});
test('Bond completes a chain when every vial is used, then starts the next after the 0.45 s pause',()=>{
  const e=new BondEngine(canvas(),callbacks().cb,{seed:5,motion:false});const start=e.left;
  while(e.stage===1&&!e.ended){if(!e.flights.length&&e.clearT<=0&&(bondSafe(e)||urgent(e)))e.action();e.step(SIM_STEP);}
  assert.equal(e.ended,false);assert.equal(e.stage,2);assert.equal(e.bonds,start);assert.equal(e.score,start*100);e.destroy();
});
test('Only one Bond vial flies at a time, so a double tap cannot hit itself',()=>{
  const e=new BondEngine(canvas(),callbacks().cb,{seed:2,motion:false});e.action();e.action();assert.equal(e.flights.length,1);assert.equal(e.inputs.length,1);e.destroy();
});
// The Tryout Arcade's ring runs out of safe arc as the vial count climbs, so a run ends however well it is
// played. What matters is that careful play is rewarded with a long run, not that it survives for ever.
test('A careful Bond player clears chain after chain until the ring runs out of room',()=>{
  for(const seed of [12,5,99]){const e=new BondEngine(canvas(),callbacks().cb,{seed,motion:false});playBond(e,180);
    assert.ok(e.stage>=10,`seed ${seed} only reached chain ${e.stage}`);
    assert.ok(e.bonds>=100,`seed ${seed} landed ${e.bonds} vials`);e.destroy();}
});
test('Bond replays to the same score at 30, 60 and 144 Hz',async()=>{
  for(const hz of [30,60,144])for(const seed of [1,2]){
    const out=callbacks(),e=new BondEngine(canvas(),out.cb,{seed,motion:false});const rand=createRandom(seed);let now=1000;e.frame(now);
    for(let f=0;f<60*hz&&!e.ended;f++){now+=1000/hz;e.frame(now);if(!e.ended&&!e.flights.length&&e.clearT<=0&&(bondSafe(e)||urgent(e)||rand()<.004))e.action();}
    if(!e.ended)e.finish();e.destroy();
    const again=await replayBond(out.result.replay);assert.equal(again.score,out.result.score,`seed ${seed} at ${hz} Hz`);
  }
});

// Skips straight to a chain: the stage generator is the only thing that draws from the seed.
function bondAt(chain,seed,out=callbacks()){const e=new BondEngine(canvas(),out.cb,{seed,motion:false});while(e.stage<chain){e.left=0;e.clearT=.001;e.step(SIM_STEP);}return e;}
test('Bond refills the shot clock to this chain\'s limit after a landing, not the next chain\'s',()=>{
  for(const chain of [6,10,15,20]){const e=bondAt(chain,3);e.pins=[];e.fixed=0;e.action();assert.equal(e.clock,bondClock(chain-1));
    while(e.flights.length)e.step(SIM_STEP);
    assert.equal(e.bonds,1);assert.equal(e.clock,e.clockLimit,`chain ${chain}`);assert.equal(e.clock,bondClock(chain-1));e.destroy();}
});
test('Bond ring capacity counts the vials that still fit a hit-width apart',()=>{
  const TAU=Math.PI*2;assert.equal(bondCapacity([]),Math.floor(TAU/BOND_HIT));assert.equal(bondCapacity([]),36);
  assert.equal(bondCapacity([0]),35);assert.equal(bondCapacity([0,Math.PI]),Math.floor(Math.PI/BOND_HIT-1e-9)*2-2);
  assert.equal(bondCapacity([0,BOND_HIT*2.5]),1+Math.floor((TAU-BOND_HIT*2.5)/BOND_HIT)-1);
  assert.equal(bondCapacity([-1,TAU-1]),bondCapacity([-1]),'angles are taken round the ring');
});
// Fixed vials used to be seeded with no thought for the shots still to come, so from chain 25 a seed could
// open a chain that even perfectly spaced throws could not clear (0.9% of seeds at chain 25, 49% at chain 30).
test('Every Bond chain up to 32 starts with room for all its shots; chains before 25 seed exactly as before',()=>{
  const TAU=Math.PI*2;
  for(let seed=1;seed<=300;seed++){const e=new BondEngine(canvas(),callbacks().cb,{seed,motion:false});const old=createRandom(seed);
    for(let chain=1;chain<=34;chain++){const s=chain-1;
      if(chain<=32)assert.ok(bondCapacity(e.pins)>=e.left,`seed ${seed} chain ${chain}: room for ${bondCapacity(e.pins)} of ${e.left}`);
      for(let i=0;i<e.pins.length;i++)for(let j=i+1;j<e.pins.length;j++)assert.ok(angDist(e.pins[i],e.pins[j])>BOND_FIXED_GAP);
      if(chain<25){// the original generator, step for step
        const pins=[],want=Math.floor(old()*(BOND_MAX_FIXED+1));
        for(let i=0;i<want;i++)for(let t=0;t<24;t++){const a=old()*TAU;if(pins.every(p=>angDist(p,a)>BOND_FIXED_GAP)){pins.push(a);break;}}
        const base=(1.7+s*.22)*(old()<.5?-1:1),rotation=old()*TAU;
        assert.deepEqual(e.pins,pins,`seed ${seed} chain ${chain}`);assert.equal(e.base,base);assert.equal(e.rotation,rotation);}
      e.left=0;e.clearT=.001;e.step(SIM_STEP);}
    e.destroy();}
});
test('Bond: the last shot thrown on the final tick of the clock completes the chain instead of timing out',()=>{
  const out=callbacks(),e=bondAt(2,8,out);e.pins=[];e.fixed=0;e.left=1;e.clockLive=true;e.clock=e.clockLimit;
  while(e.clock>SIM_STEP*1.5)e.step(SIM_STEP);
  assert.equal(e.ended,false);e.action();assert.equal(e.flights.length,1);
  while(e.stage===2&&!e.ended)e.step(SIM_STEP);
  assert.equal(e.ended,false,'not timed out');assert.equal(e.stage,3);assert.equal(e.clock,e.clockLimit);e.destroy();
});
test('Bond pause holds a vial in flight and the chain-clear pause, and finish mid-flight ends once and replays',async()=>{
  const out=callbacks(),e=new BondEngine(canvas(),out.cb,{seed:6,motion:false});e.pins=[];e.fixed=0;e.left=1;let now=1000;e.frame(now);
  e.action();for(let i=0;i<3;i++){now+=1000/60;e.frame(now);}
  const t=e.ticks,progress=e.flights[0].progress,rotation=e.rotation;e.pause();for(let i=0;i<120;i++){now+=1000/60;e.frame(now);}
  assert.equal(e.ticks,t);assert.equal(e.flights[0].progress,progress);assert.equal(e.rotation,rotation);
  e.pause(false);while(e.clearT<=0){now+=1000/60;e.frame(now);}
  const clearT=e.clearT;e.pause();for(let i=0;i<120;i++){now+=1000/60;e.frame(now);}assert.equal(e.clearT,clearT);assert.equal(e.stage,1);
  e.pause(false);while(e.stage===1){now+=1000/60;e.frame(now);}
  // A throw and a quit in the same frame: the replay must use the throw too.
  e.pins=[];e.action();e.finish();e.finish();
  assert.equal(out.result.score,100);const again=await replayBond(out.result.replay);
  assert.deepEqual([again.score,again.ticks,again.unusedInputs],[100,e.ticks,0]);e.destroy();
});
// Bots of four kinds over hundreds of seeds, with the invariants checked on every step and every run replayed.
const BOND_FLIGHT=(()=>{let p=0,n=0;while(p<1){p+=SIM_STEP/.12;n++;}return n;})();
function bondTargets(e,n){let t=e.time,rot=e.rotation;const rots=[];for(let i=0;i<n+BOND_FLIGHT;i++){t+=SIM_STEP;rot=(rot+e.base*bondWobble(e,t)*SIM_STEP)%(Math.PI*2);rots.push(rot);}
  return rots.slice(BOND_FLIGHT-1,BOND_FLIGHT-1+n).map(r=>Math.PI/2-r);}
function clockTicks(e){if(!e.clockLive)return 240;let c=e.clock,n=0;while(c>0){c-=SIM_STEP;n++;}return n;}
function bondBot(style,seed){const r=createRandom(seed*7+1);let fireAt=null,key='';
  return e=>{if(e.flights.length||e.clearT>0)return false;
    if(style==='random')return r()<.02;if(style==='rapid')return true;
    if(style==='late')return e.clockLive?clockTicks(e)<=1:r()<.05;
    const k=`${e.stage}/${e.left}`;if(k!==key){key=k;const ts=bondTargets(e,clockTicks(e));let best=-1,most=-1;
      for(let i=0;i<ts.length;i++){const c=Math.min(Infinity,...e.pins.map(p=>angDist(p,ts[i])));if(c>=BOND_HIT&&c>most){most=c;best=i;}}
      fireAt=best<0?-1:e.ticks+best;}
    return fireAt===e.ticks||(fireAt<0&&clockTicks(e)<=1);};}
async function fuzzBond(seed,style,ticks){const out=callbacks();let ends=0;const cb={...out.cb,end(r){ends++;out.cb.end(r);}};
  const c=canvas(),e=new BondEngine(c,cb,{seed,motion:false}),bot=bondBot(style,seed);
  for(let i=0;i<ticks&&!e.ended;i++){
    if(i===400&&seed%2){const w=c.getBoundingClientRect;c.getBoundingClientRect=()=>({...w(),width:320,height:568});e.resize();}
    if(bot(e))e.action();
    const stage=e.stage,left=e.left,clock=e.clock,flying=e.flights.length>0,clearing=e.clearT>0,live=e.clockLive;
    e.step(SIM_STEP);const at=`seed ${seed} ${style} tick ${e.ticks}`;
    for(const k of ['rotation','time','clock','base','clearT','score'])assert.ok(Number.isFinite(e[k]),`${at}: ${k}`);
    assert.ok(e.pins.every(Number.isFinite),at);
    assert.equal(e.score,e.bonds*100,at);assert.ok(e.left>=0&&e.flights.length<=1&&e.clock>=0,at);
    assert.ok(e.pins.length<=BOND_MAX_FIXED+bondVials(e.index),at);
    if(e.stage!==stage){assert.equal(left,0,at);assert.equal(e.stage,stage+1,at);assert.equal(e.left,bondVials(e.index),at);}
    if(e.left===0&&!e.ended)assert.ok(e.clearT>0,at);
    if(e.ended)continue;
    if(!live||flying||clearing)assert.ok(e.clock===clock||e.clock===e.clockLimit,`${at}: clock ran while it should not`);
    else if(e.flights.length===0)assert.ok(Math.abs(clock-SIM_STEP-e.clock)<1e-9,`${at}: clock should run`);}
  if(!e.ended)e.finish();
  assert.equal(ends,1);const again=await replayBond(out.result.replay);
  assert.deepEqual([again.score,again.ticks,again.unusedInputs],[out.result.score,e.ticks,0],`seed ${seed} ${style} replay`);
  e.destroy();return e;}
test('Bond fuzz: random, rapid, last-moment and careful bots keep every invariant and replay exactly',async()=>{
  for(let seed=1;seed<=300;seed++)for(const style of ['random','rapid','late'])await fuzzBond(seed,style,120*120);
  let chains=0;for(let seed=1;seed<=30;seed++){const e=await fuzzBond(seed,'careful',120*400);chains+=e.stage;assert.ok(e.stage>=10,`careful seed ${seed} reached ${e.stage}`);}
  assert.ok(chains/30>=15,`careful bots average chain ${chains/30}`);
});

// ---------- Sequence feel ----------
const {SequenceEngine}=await import('../dist/tryout-games.js');
const {sequenceExchange,sequenceMatches}=await import('../dist/sequence-rules.js');
function seqGame(){const handlers={},c=canvas();c.addEventListener=(n,h)=>{handlers[n]=h;};const out=callbacks(),e=new SequenceEngine(c,out.cb,{seed:1,motion:true});return {e,handlers};}
test('Sequence swaps as soon as a drag crosses a third of a tile, before the finger lifts',()=>{
  const {e,handlers}=seqGame(),[i,to]=e.findMove(),g=e.geometry();
  const at=k=>({clientX:(g.x+(k%7+.5)*g.cell)*e.scale,clientY:(g.y+(Math.floor(k/7)+.5)*g.cell)*e.scale,pointerId:1});
  handlers.pointerdown(at(i));const dest=at(to),from=at(i);
  handlers.pointermove({clientX:from.clientX+(dest.clientX-from.clientX)*.4,clientY:from.clientY+(dest.clientY-from.clientY)*.4});
  assert.equal(e.phase,'swap','swap started mid-drag');e.destroy();
});
test('Sequence matches shrink out before the gap opens, and longer drops take longer',()=>{
  const {e}=seqGame(),[i,to]=e.findMove();e.choose(i,to);
  while(e.phase==='swap')e.step(SIM_STEP);
  assert.equal(e.phase,'clear');const cleared=[...e.clearing];assert.ok(cleared.every(k=>e.board[k]>=0),'tiles still drawn while popping');
  assert.equal(e.popups.length,1);assert.match(e.popups[0].text,/^\+\d+$/);
  while(e.phase==='clear')e.step(SIM_STEP);
  assert.equal(e.phase,'fall');const longest=Math.max(...[...e.falls.values()].map(Math.abs));assert.ok(Math.abs(e.fallDur-(.12+.05*longest))<1e-9);e.destroy();
});
test('Sequence shows a working hint after 5 idle seconds and clears it on the next touch',()=>{
  const {e,handlers}=seqGame();for(let t=0;t<4.9;t+=SIM_STEP)e.step(SIM_STEP);assert.equal(e.hintPair,null);
  for(let t=0;t<.3;t+=SIM_STEP)e.step(SIM_STEP);assert.ok(e.hintPair);const [a,b]=e.hintPair;assert.ok(sequenceMatches(sequenceExchange(e.board,a,b)).size>0);
  handlers.pointerdown({clientX:0,clientY:0,pointerId:1});assert.equal(e.hintPair,null);e.destroy();
});

// ---------- Ridge Run: moving vials and peptide orbs ----------
test('Ridge vials start moving at gate 15, swing further by gate 45, stay inside the playfield and stay reachable',()=>{
  for(let seed=1;seed<=40;seed++){const e=new RidgeEngine(canvas(),callbacks().cb,{seed,motion:false,version:4});while(e.index<80)e.addGate();
    for(let i=0;i<e.gates.length;i++){const g=e.gates[i],lo=RIDGE.EDGE+g.gap/2,hi=RIDGE.GROUND-RIDGE.EDGE-g.gap/2;
      if(i<RIDGE_V4.MOVE_START)assert.equal(g.amp,0,`gate ${i} still`);
      assert.ok(g.amp<=RIDGE_V4.MOVE_AMP_TO+1e-9);assert.ok(g.gy-g.amp>=lo-1e-9&&g.gy+g.amp<=hi+1e-9,'never bobs past the edges');
      if(i){const p=e.gates[i-1];assert.ok(Math.abs(g.gy-p.gy)+g.amp+p.amp<=Math.max(40+g.amp+p.amp,e.jumpFor(i))+1e-9,'reachable at any phase');}}
    const late=e.gates.slice(50),moving=late.filter(g=>g.amp>0).length;assert.ok(moving/late.length>.6,'most late gates move');e.destroy();}
});
test('Moving Ridge vials really move, and the hit test follows them',()=>{
  const e=new RidgeEngine(canvas(),callbacks().cb,{seed:4,motion:false,version:4});const g={x:e.px-RIDGE.PW/2,gy:300,cy:300,gap:80,amp:50,phase:0,rate:2,passed:true};assert.equal(e.hits(g),false,"safe before it moves");
  e.gates=[g];e.nextX=1e7;e.orbs=[];e.action();e.py=300;e.vy=0;e.runTime=Math.PI/4-SIM_STEP;e.step(SIM_STEP);
  assert.ok(Math.abs(g.cy-(300+50*Math.sin(Math.PI/2)))<1,'gap centre moved down by the swing');assert.ok(e.dead,'the vial now hits the top glass');e.destroy();
});
test('Peptide orbs appear from gate 3, sit between gates, and pay 2 points when collected',()=>{
  const e=new RidgeEngine(canvas(),callbacks().cb,{seed:6,motion:false,version:4});while(e.index<200)e.addGate();
  assert.ok(e.orbs.length>40&&e.orbs.length<100,`${e.orbs.length} orbs in 200 gates`);
  for(const o of e.orbs){assert.ok(o.y>=RIDGE.EDGE&&o.y<=RIDGE.GROUND-RIDGE.EDGE);assert.ok(!e.gates.some(g=>o.x>g.x-RIDGE.ORB_R&&o.x<g.x+RIDGE.PW+RIDGE.ORB_R),'never inside a gate');}
  const f=new RidgeEngine(canvas(),callbacks().cb,{seed:6,motion:false,version:4});for(const g of f.gates)g.x=1e6;f.nextX=1e7;f.orbs=[{x:f.px+4,y:f.py,taken:false}];f.action();f.step(SIM_STEP);
  assert.equal(f.orbsTaken,1);assert.equal(f.score,2);assert.equal(f.gatesPassed,0,'orbs are not gates');e.destroy();f.destroy();
});

test('Blocks scores like Block Blast: 1 per block placed, 10 per cleared block with line and combo multipliers',async()=>{
  const {BLOCK_SCORE,clearPoints}=await import('../dist/blocks-core.js');
  assert.equal(clearPoints(8,1,1),80);assert.equal(clearPoints(16,2,1),480);assert.equal(clearPoints(24,3,1),1440);assert.equal(clearPoints(32,4,1),3200);
  assert.equal(clearPoints(8,1,3),160,'a third clear in a streak doubles the points');
  // Fill row 0 except one cell, then drop a dot there: one line, combo 1.
  const line=PIECES.find(p=>p.name==='dot').shape;
  const g=createBlocks(3);g.state.grid=emptyGrid();for(let c=0;c<7;c++)g.state.grid[0][c]=1;g.state.grid[5][5]=1;
  g.state.tray=[{shape:line,color:3},{shape:line,color:3},{shape:line,color:3}];
  let out=blocksPlace(g,0,0,7);assert.equal(out.lines,1);assert.equal(out.combo,1);assert.equal(out.points,1+80);
  // Two placements without a clear keep the streak; a clear on the next one makes it combo 2.
  out=blocksPlace(g,1,7,0);assert.equal(out.combo,1);out=blocksPlace(g,2,7,1);assert.equal(out.combo,1);
  for(let c=0;c<7;c++)g.state.grid[3][c]=1;g.state.tray=[{shape:line,color:3},{shape:line,color:3},{shape:line,color:3}];
  out=blocksPlace(g,0,3,7);assert.equal(out.combo,2);assert.equal(out.points,1+clearPoints(8,1,2));
  // Three placements without a clear end it.
  blocksPlace(g,1,6,6);blocksPlace(g,2,6,7);g.state.tray=[{shape:line,color:3},null,null];out=blocksPlace(g,0,6,5);assert.equal(out.combo,0);assert.equal(g.state.chain,0);
  // Emptying the board adds the perfect clear bonus.
  const h=createBlocks(4);h.state.grid=emptyGrid();for(let c=0;c<7;c++)h.state.grid[2][c]=1;h.state.tray=[{shape:line,color:3},null,null];
  out=blocksPlace(h,0,2,7);assert.equal(out.perfect,true);assert.equal(out.points,1+80+BLOCK_SCORE.perfect);
});

// --- difficulty curve -------------------------------------------------------------------------------------
// Plays whatever fits first, so a run can be driven without caring how well it is played.
function firstLegal(g){for(let i=0;i<g.state.tray.length;i++){const p=g.state.tray[i];if(!p)continue;const spot=placements(g.state.grid,p.shape)[0];if(spot)return [i,spot[0],spot[1]];}return null;}
const trayRun=seed=>{const g=createBlocks(seed);const seen=[];for(let i=0;i<24;i++){seen.push(g.state.tray.map(p=>p&&p.shape.length).join(''));const move=firstLegal(g);if(!move)break;blocksPlace(g,...move);}return seen;};

test('Blocks tray generation is deterministic from the seed and the game state',()=>{
  assert.deepEqual(trayRun(90210),trayRun(90210),'the same seed must deal the same run twice');
  assert.notDeepEqual(trayRun(90210),trayRun(90211),'different seeds should not deal the same run');
});

test('Early Blocks trays are smaller on average than late trays',()=>{
  // An empty board has no line to complete, so this measures the ramp on its own, with no assist in the way.
  const average=moves=>{let cells=0,pieces=0;for(let seed=0;seed<160;seed++){const rand=createRandom((seed*2654435761)>>>0);for(const p of makeTray(emptyGrid(),rand,{version:2,moves})){cells+=p.shape.length;pieces++;}}return cells/pieces;};
  const early=average(0),late=average(RAMP_MOVES*2);
  assert.ok(early<late-.8,`early trays ${early.toFixed(2)} cells should sit well under late ${late.toFixed(2)}`);
  assert.ok(early<3,`early trays should be gentle, got ${early.toFixed(2)} cells a piece`);
});

test('The near-clear assist fires more often early than late',()=>{
  // Row 0 is filled to column 3, so the only piece that completes a line is the flat 4-line across columns 4-7.
  // That piece is rare in an early deal, which makes a high early hit rate the assist's doing rather than the ramp's.
  const nearly=()=>{const g=emptyGrid();for(let c=0;c<4;c++)g[0][c]=1;return g;};
  const clears=(grid,p)=>placements(grid,p.shape).some(([r,c])=>placeBlock(grid,p.shape,r,c,1).lines>0);
  const rate=moves=>{const runs=400;let hits=0;for(let seed=0;seed<runs;seed++){const grid=nearly(),rand=createRandom((seed*40503+moves*7919)>>>0);
    if(makeTray(grid,rand,{version:2,moves}).some(p=>clears(grid,p)))hits++;}return hits/runs;};
  const early=rate(0),late=rate(RAMP_MOVES*2);
  assert.ok(early>late+.15,`the assist should fade over a run: early ${early.toFixed(2)} vs late ${late.toFixed(2)}`);
  assert.ok(early>.5,`the assist should be common early, got ${early.toFixed(2)}`);
});

test('A v2 tray is still never dead on arrival',()=>{
  for(const moves of [0,10,RAMP_MOVES,RAMP_MOVES*2]){
    for(let seed=0;seed<250;seed++){
      const rand=createRandom((seed*2246822519+moves)>>>0);
      const grid=emptyGrid().map(row=>row.map(()=>rand()<.72?1:0));
      if(!grid.flat().includes(0))continue;
      const tray=makeTray(grid,rand,{version:2,moves});
      assert.ok(tray.some(p=>placements(grid,p.shape).length>0),`dead tray at moves ${moves}, seed ${seed}`);
    }
  }
});

test('Both v1 and v2 Blocks replays verify, each with the generator it was played on',()=>{
  for(const version of [1,2]){
    const g=createBlocks(31337,version);
    for(let i=0;i<40;i++){const move=firstLegal(g);if(!move)break;blocksPlace(g,...move);}
    const result=blocksResult(g);
    assert.equal(result.replay.v,version,'a replay carries the version it was played under');
    assert.equal(replayBlocks(result.replay).score,result.score,`a v${version} replay should reproduce its score`);
    assert.ok(result.moves>5,`the v${version} run should get going, got ${result.moves} moves`);
  }
  // The two generators really do deal differently, which is why the version has to travel with the replay.
  assert.notEqual(
    createBlocks(31337,1).state.tray.map(p=>p.shape.length).join(','),
    createBlocks(31337,2).state.tray.map(p=>p.shape.length).join(','));
  const rep=blocksResult(createBlocks(5,2)).replay;
  assert.throws(()=>replayBlocks({...rep,v:3}),/Unknown Peak Blocks replay version/);
});

// --- Ridge Run difficulty curve (v5) -----------------------------------------------------------------------
const ridgeCourse=(seed,version,count=90)=>{const e=new RidgeEngine(canvas(),callbacks().cb,{seed,motion:false,version});
 while(e.index<count)e.addGate();const out=e.gates.map(g=>({gy:g.gy,gap:g.gap,amp:g.amp,x:g.x}));const orbs=e.orbs.map(o=>({x:o.x,y:o.y}));e.destroy();return {out,orbs};};

test('The Ridge course is deterministic from its seed',()=>{
  assert.deepEqual(ridgeCourse(4242,5),ridgeCourse(4242,5),'the same seed must build the same course twice');
  assert.notDeepEqual(ridgeCourse(4242,5).out,ridgeCourse(4243,5).out,'different seeds should differ');
  // The two course versions are genuinely different, which is why the version travels with the replay.
  assert.notDeepEqual(ridgeCourse(4242,4).out,ridgeCourse(4242,5).out);
});

test('Ridge pickups start at gate 4, never fill two gaps running, and land near one gap in five',()=>{
  let gaps=0,orbs=0,adjacent=0,earliest=1e9;
  for(let seed=0;seed<60;seed++){
    const e=new RidgeEngine(canvas(),callbacks().cb,{seed,motion:false,version:5});
    while(e.index<120)e.addGate();
    const gateX=e.gates.map(g=>g.x),where=[];
    for(const o of e.orbs){const idx=gateX.findIndex(x=>x>o.x);if(idx>0)where.push(idx);}
    where.sort((a,b)=>a-b);
    for(let i=1;i<where.length;i++)if(where[i]-where[i-1]<2)adjacent++;
    if(where.length)earliest=Math.min(earliest,where[0]);
    orbs+=where.length;gaps+=e.gates.length-1;e.destroy();
  }
  assert.equal(adjacent,0,'no two gaps in a row may hold a pickup');
  assert.ok(earliest>=4,`pickups start at gate 4, saw one at ${earliest}`);
  const rate=orbs/gaps;
  // The roll is ORB_CHANCE (0.2); the no-two-in-a-row rule trims what actually lands to about one gap in six.
  assert.ok(rate>.12&&rate<.22,`pickup rate ${(rate*100).toFixed(1)}% should sit near one gap in five`);
});

test('Ridge moving columns arrive in stages off the RAMP knob, and every column stays reachable',()=>{
  // The gate numbers come from RIDGE.RAMP rather than being written down, so retuning the knob retunes the test.
  const start=RIDGE.MOVE_START,full=RIDGE.MOVE_FULL,half=Math.round((start+full)/2);
  const share={},swing={};let firstMover=Infinity;
  for(let seed=0;seed<60;seed++){
    const e=new RidgeEngine(canvas(),callbacks().cb,{seed,motion:false,version:5});
    while(e.index<full+15)e.addGate();
    e.gates.forEach((g,i)=>{share[i]??={m:0,n:0};swing[i]??=[];share[i].n++;
      if(g.amp>0){share[i].m++;swing[i].push(g.amp);if(i<firstMover)firstMover=i;}
      const lo=RIDGE.EDGE+g.gap/2,hi=RIDGE.GROUND-RIDGE.EDGE-g.gap/2;
      assert.ok(g.gy-g.amp>=lo-1e-6&&g.gy+g.amp<=hi+1e-6,`gate ${i} swings out of the playfield`);});
    e.destroy();
  }
  const shareAt=i=>share[i].m/share[i].n;
  const meanSwing=i=>{const all=[];for(let j=Math.max(0,i-2);j<=i+2;j++)all.push(...(swing[j]??[]));return all.length?all.reduce((a,b)=>a+b,0)/all.length:0;};
  assert.ok(firstMover>=start,`nothing may move before gate ${start}, saw one at ${firstMover}`);
  assert.equal(shareAt(Math.max(0,start-2)),0,'the gates before the first mover hold still');
  assert.ok(shareAt(half)>.25,`about a third should move by the midpoint, got ${(shareAt(half)*100).toFixed(0)}%`);
  assert.ok(shareAt(full+8)>.8,`nearly all should move past RAMP, got ${(shareAt(full+8)*100).toFixed(0)}%`);
  assert.ok(meanSwing(full+8)>meanSwing(half),'and they should swing further than they did at the midpoint');
});

test('All supported Ridge replays verify, each on the course it was flown',async()=>{
  for(const version of [4,5,6]){
    const out=callbacks(),e=new RidgeEngine(canvas(),out.cb,{seed:777,motion:false,version});
    e.action();
    for(let t=0;t<120*40&&!e.ended;t++){if(ridgeBot(e)&&!e.dead)e.action();e.step(SIM_STEP);}
    if(!e.ended)e.finish();
    const rep=out.result.replay;
    assert.equal(rep.v,version,'a replay carries the course it was flown on');
    const again=await replayRidge(rep);
    assert.equal(again.score,out.result.score,`a v${version} replay must reproduce its score`);
    e.destroy();
  }
  // Anything else is refused rather than quietly replayed on the wrong course.
  const out=callbacks(),e=new RidgeEngine(canvas(),out.cb,{seed:5,motion:false});
  e.action();for(let t=0;t<600&&!e.ended;t++)e.step(SIM_STEP);
  e.finish();
  await assert.rejects(replayRidge({...out.result.replay,v:7}),/Not a Ridge Run replay/);
  e.destroy();
});
