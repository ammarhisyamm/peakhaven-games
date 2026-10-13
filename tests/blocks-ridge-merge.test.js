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
const {SHAPES,makeTray,emptyGrid}=await import('../dist/puzzle-rules.js');
const {RidgeEngine}=await import('../dist/tryout-games.js');
const {MergeEngine,MERGE_SPAWN_TIERS}=await import('../dist/engines.js');
const {SIM_STEP,createRandom}=await import('../dist/rng.js');
const {replayRidge,replayMerge}=await import('../tools/replay.mjs');

const noop=()=>{};
function canvas(width=480,height=720){const ctx=new Proxy({},{get:(t,k)=>k in t?t[k]:()=>ctx,set:(t,k,v)=>(t[k]=v,true)});return {getContext:()=>ctx,getBoundingClientRect:()=>({width,height,left:0,top:0}),addEventListener:noop,removeEventListener:noop,setPointerCapture:noop};}
function callbacks(onEnd){const out={result:null};out.cb={hud:noop,message:noop,sound:noop,effect:noop,progress:noop,ready:noop,topTier:noop,place:noop,end(r){out.result??=r;onEnd?.(r);}};return out;}

// ---------- Peak Blocks ----------
const I4=SHAPES[8];
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
test('Late Blocks trays draw evenly instead of piling onto the 2×3 block',()=>{
  const rand=createRandom(9),counts=new Map();
  for(let i=0;i<3000;i++)for(const p of makeTray(emptyGrid(),rand,60))counts.set(SHAPES.indexOf(p.shape),(counts.get(SHAPES.indexOf(p.shape))||0)+1);
  for(const [index,n] of counts){assert.ok(index>=5,'smallest shapes retire late');assert.ok(n/9000>.15&&n/9000<.25,`shape ${index} share ${n/9000}`);}
});

// ---------- Ridge Run ----------
const {RIDGE}=await import('../dist/tryout-games.js');
// A simple bot that keeps the vial a little below the next gate's centre.
function ridgeBot(e){const next=e.gates.find(g=>g.x+RIDGE.PW>e.px-RIDGE.HALF_W);const target=next?next.gy+12:300;return e.py>target&&e.vy>-60;}
function playRidge({seed,hz,view=[480,720],maxSeconds=90}){
  const c=canvas(...view),out=callbacks(),e=new RidgeEngine(c,out.cb,{seed,motion:false});
  let now=1000;e.frame(now);e.action();
  for(let f=0;f<maxSeconds*hz&&!e.ended;f++){now+=1000/hz;e.frame(now);if(!e.ended&&!e.dead&&ridgeBot(e))e.action();}
  if(!e.ended)e.finish();e.destroy();return {result:out.result,engine:e};
}
test('Ridge Run builds the Tryout Arcade course: 210 apart, openings 150 to 118, steps up to 120 rising to 220',()=>{
  for(let seed=1;seed<=50;seed++){const e=new RidgeEngine(canvas(),callbacks().cb,{seed,motion:false});
    while(e.index<90)e.addGate();
    for(let i=0;i<e.gates.length;i++){const g=e.gates[i],gap=150-32*Math.min(1,Math.max(0,(i-10)/40));
      assert.ok(Math.abs(g.gap-gap)<1e-9);assert.ok(g.gy>=60+gap/2-1e-9&&g.gy<=RIDGE.GROUND-60-gap/2+1e-9);
      if(i){assert.ok(Math.abs(g.x-e.gates[i-1].x-210)<1e-9);assert.ok(Math.abs(g.gy-e.gates[i-1].gy)<=120+100*Math.min(1,i/40)+1e-9);}}
    e.destroy();}
});
test('Ridge Run speed rises from 165 to 230 by gate 60, with Tryout Arcade gravity and flap',()=>{
  const e=new RidgeEngine(canvas(),callbacks().cb,{seed:1,motion:false});assert.equal(e.speed,165);e.score=30;assert.equal(e.speed,197.5);e.score=90;assert.equal(e.speed,230);e.score=0;
  e.action();assert.equal(e.vy,-430);e.step(SIM_STEP);assert.ok(Math.abs(e.vy-(-430+1450*SIM_STEP))<1e-9);e.destroy();
});
test('Every screen gets the same Ridge course',()=>{
  const course=view=>{const e=new RidgeEngine(canvas(...view),callbacks().cb,{seed:9,motion:false});while(e.index<40)e.addGate();const out=e.gates.map(g=>[Math.round(g.gy*1000),g.gap]);e.destroy();return JSON.stringify(out);};
  assert.equal(course([480,720]),course([390,844]));assert.equal(course([480,720]),course([1280,800]));
});
test('The Ridge ceiling stops the vial; the ground ends the run after a short fall',()=>{
  const out=callbacks(),e=new RidgeEngine(canvas(),out.cb,{seed:2,motion:false});for(const g of e.gates)g.x=1e6;e.nextX=1e7;e.action();e.py=5;e.vy=-400;e.step(SIM_STEP);
  assert.equal(e.dead,false);assert.equal(e.py,RIDGE.HALF_H);
  e.py=RIDGE.GROUND;e.step(SIM_STEP);assert.equal(e.dead,true);assert.equal(out.result,null,'falls for a moment first');
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
  e.pause(true);e.pause(false);const y=e.py,xs=e.gates.map(g=>g.x);for(let i=0;i<240;i++)e.step(SIM_STEP);
  assert.equal(e.py,y,'holds still where it was');assert.deepEqual(e.gates.map(g=>g.x),xs,'the course waits too');assert.equal(e.ended,false);e.action();assert.equal(e.vy,-430);e.destroy();
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
const {BondEngine,BOND_MAX_VIALS,BOND_HIT,bondClock}=await import('../dist/tryout-games.js');
const {replayBond}=await import('../tools/replay.mjs');
const angDist=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
// Fires only when the vial, 0.12 s from now, would land clear of every vial on the ring.
function bondSafe(e,margin=.04){let t=e.stageTime,rot=e.rotation,p=0;while(p<1){t+=SIM_STEP;rot+=e.base*(1+e.wob*Math.sin(t*1.4))*SIM_STEP;p+=SIM_STEP/.12;} // same steps as the engine
  return e.pins.every(a=>angDist(a,Math.PI/2-rot)>=BOND_HIT+margin);}
const urgent=e=>e.clock!==null&&e.clock<.05;
function playBond(e,seconds,chance=0){const rand=createRandom(99);for(let i=0;i<seconds*120&&!e.ended;i++){if(!e.flights.length&&e.clearT<=0&&(bondSafe(e)||urgent(e)||rand()<chance))e.action();e.step(SIM_STEP);}}
test('Bond chains follow the Tryout Arcade design: 5 + chain vials, up to 3 fixed vials, faster spin, wobble from chain 3',()=>{
  for(let seed=1;seed<=40;seed++){const e=new BondEngine(canvas(),callbacks().cb,{seed,motion:false});
    for(let stage=1;stage<=9;stage++){
      assert.equal(e.stage,stage);assert.equal(e.left,Math.min(5+stage,BOND_MAX_VIALS));assert.ok(e.pins.length<=Math.min(3,stage-1),'fixed vials');
      assert.ok(Math.abs(Math.abs(e.base)-(1.6+.2*stage))<1e-9);assert.equal(e.wob>0,stage>=3);if(stage>=3)assert.ok(e.wob>=.6&&e.wob<=1.7);
      e.left=0;e.clearT=.001;e.step(SIM_STEP);}
    e.destroy();}
});
test('Bond completes a chain when every vial is used, then starts the next after a short pause',()=>{
  const e=new BondEngine(canvas(),callbacks().cb,{seed:5,motion:false});const start=e.left;
  while(e.stage===1&&!e.ended){if(!e.flights.length&&e.clearT<=0&&(bondSafe(e)||urgent(e)))e.action();e.step(SIM_STEP);}
  assert.equal(e.ended,false);assert.equal(e.stage,2);assert.equal(e.bonds,start);assert.equal(e.score,start*100);e.destroy();
});
test('Only one Bond vial flies at a time, so a double tap cannot hit itself',()=>{
  const e=new BondEngine(canvas(),callbacks().cb,{seed:2,motion:false});e.action();e.action();assert.equal(e.flights.length,1);assert.equal(e.inputs.length,1);e.destroy();
});
test('A careful Bond player clears several chains inside the shot clock',()=>{
  let best=0;for(const seed of [12,13,14,15,16]){const e=new BondEngine(canvas(),callbacks().cb,{seed,motion:false});playBond(e,180);best=Math.max(best,e.stage);e.destroy();}
  assert.ok(best>=6,`best run reached chain ${best}`);
});
test('Bond shot clock: starts on the first shot, refills on landing, pauses mid-flight and between chains, ends the run at zero',()=>{
  const out=callbacks(),e=new BondEngine(canvas(),out.cb,{seed:3,motion:false});
  for(let i=0;i<120*10;i++)e.step(SIM_STEP);assert.equal(e.clock,null,'no clock before the first shot');assert.equal(e.ended,false);
  e.action();assert.equal(e.clock,6);const during=e.clock;for(let i=0;i<10;i++)e.step(SIM_STEP);assert.equal(e.clock,during,'paused while the vial flies');
  while(e.flights.length)e.step(SIM_STEP);assert.equal(e.clock,6,'refilled on landing');
  for(let i=0;i<120*3;i++)e.step(SIM_STEP);assert.ok(Math.abs(e.clock-3)<.02);
  for(let i=0;i<120*3+2&&!e.ended;i++)e.step(SIM_STEP);assert.ok(e.ended);assert.equal(out.result.timeout,true);e.destroy();
  assert.equal(bondClock(1),6);assert.equal(bondClock(4),4.5);assert.equal(bondClock(20),2.5);
});
test('Bond replays to the same score at 30, 60 and 144 Hz',async()=>{
  for(const hz of [30,60,144])for(const seed of [1,2]){
    const out=callbacks(),e=new BondEngine(canvas(),out.cb,{seed,motion:false});const rand=createRandom(seed);let now=1000;e.frame(now);
    for(let f=0;f<60*hz&&!e.ended;f++){now+=1000/hz;e.frame(now);if(!e.ended&&!e.flights.length&&e.clearT<=0&&(bondSafe(e)||urgent(e)||rand()<.004))e.action();}
    if(!e.ended)e.finish();e.destroy();
    const again=await replayBond(out.result.replay);assert.equal(again.score,out.result.score,`seed ${seed} at ${hz} Hz`);
  }
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
