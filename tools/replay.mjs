// Replays a finished run from its `replay` record and returns the score it really earned.
// This is the server half of anti-cheat: a client can claim any score, but it can't fake a seed and
// input log that replays to that score. Runs headless in Node (or Deno) with tiny canvas stubs.
import {SIM_STEP} from '../dist/rng.js';
import {SEQ_LOG} from '../dist/sequence-v3.js';

function installStubs(){
  globalThis.window??={devicePixelRatio:1};
  globalThis.requestAnimationFrame??=()=>0;
  globalThis.cancelAnimationFrame??=()=>{};
  globalThis.Image??=class{complete=false;naturalWidth=0;};
}
const noop=()=>{};
function stubCanvas(view){
  const ctx=new Proxy({},{get:(t,k)=>k in t?t[k]:noop,set:(t,k,v)=>(t[k]=v,true)});
  return {view,getContext:()=>ctx,getBoundingClientRect(){return {width:this.view[0],height:this.view[1],left:0,top:0};},addEventListener:noop,removeEventListener:noop,setPointerCapture:noop};
}
function collector(){let result=null;return {cb:{hud:noop,message:noop,sound:noop,effect:noop,progress:noop,ready:noop,topTier:noop,place:noop,end(r){result??=r;}},result:()=>result};}
const MAX_TICKS=120*60*60; // one hour of play

function replayClock(rep,inputs){
 if(!Number.isSafeInteger(rep.endTick)||rep.endTick<0||rep.endTick>MAX_TICKS)throw new Error('Bad replay duration');
 if(!Array.isArray(inputs)||!inputs.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=rep.endTick))throw new Error('Bad input clock');
 for(let i=1;i<inputs.length;i++)if(inputs[i]<inputs[i-1])throw new Error('Inputs out of order');
}

export async function replayRidge(rep){
  installStubs();
  if(rep?.game!=='ridge'||![4,5,6].includes(rep.v)||rep.step!==SIM_STEP)throw new Error('Not a Ridge Run replay for this build');
  replayClock(rep,rep.taps);replayClock(rep,rep.resumes??[]);
  if(rep.v===6){replayClock(rep,rep.revives??[]);if((rep.revives??[]).length>1)throw new Error('Only one revive per run');}
  else if(rep.revives?.length)throw new Error('This course has no revive');
  const {RidgeEngine}=await import('../dist/tryout-games.js');
  // The course runs in fixed world units, so the screen size doesn't matter here.
  const cb=collector().cb;if(rep.v===6)cb.revive=noop;
  const e=new RidgeEngine(stubCanvas([480,720]),cb,{seed:rep.seed,motion:false,version:rep.v});
  const taps=[...rep.taps],resumes=[...(rep.resumes||[])],revives=[...(rep.revives||[])];let rejected=0;const stop=Math.min(MAX_TICKS,rep.endTick??MAX_TICKS);
  for(let i=1;i<taps.length;i++)if(taps[i]<taps[i-1])throw new Error('Taps out of order');
  while(!e.ended){
    while(revives.length&&revives[0]===e.ticks){revives.shift();if(!e.revive())rejected++;}
    while(resumes.length&&resumes[0]===e.ticks){resumes.shift();e.pause(true);e.pause(false);}
    while(taps.length&&taps[0]===e.ticks){taps.shift();const before=e.inputs.length;e.action();if(rep.v===6&&e.inputs.length===before)rejected++;}
    if(e.ticks>=stop)break;
    e.step(SIM_STEP);
  }
  if(rep.v===6&&!e.ended)e.finish();
  e.destroy();
  return {score:e.score,ended:e.ended,ticks:e.ticks,unusedInputs:taps.length+resumes.length+revives.length+rejected};
}

export async function replayBond(rep){
  installStubs();
  if(rep?.game!=='bond'||rep.step!==SIM_STEP)throw new Error('Not a Bond replay for this build');
  const {BondEngine}=await import('../dist/tryout-games.js');
  const out=collector(),e=new BondEngine(stubCanvas([...rep.view]),out.cb,{seed:rep.seed,motion:false});
  const taps=[...rep.taps];let rejected=0;
  const stop=Math.min(MAX_TICKS,rep.endTick??MAX_TICKS);
  // Taps on the final tick still count: finish() can follow a throw in the same frame, before any step.
  while(!e.ended){
    while(taps.length&&taps[0]===e.ticks){taps.shift();const before=e.inputs.length;e.action();if(e.inputs.length===before)rejected++;}
    if(e.ticks>=stop)break;
    e.step(SIM_STEP);
  }
  e.destroy();
  return {score:e.score,ended:e.ended,ticks:e.ticks,unusedInputs:taps.length+rejected};
}

export async function replayMerge(rep){
  installStubs();
  if(rep?.game!=='merge'||rep.step!==SIM_STEP)throw new Error('Not a Vial Merge replay for this build');
  const {MergeEngine}=await import('../dist/engines.js');
  const out=collector(),e=new MergeEngine(stubCanvas([480,720]),out.cb,{seed:rep.seed,motion:false});
  const drops=rep.drops.map(d=>[...d]);let rejected=0;
  while(!e.ended&&e.ticks<Math.min(MAX_TICKS,rep.endTick??MAX_TICKS)){
    while(drops.length&&drops[0][0]===e.ticks){const [,x]=drops.shift();e.x=x;const before=e.drops;e.action();if(e.drops===before)rejected++;}
    e.step(SIM_STEP);
  }
  if(!e.ended)e.finish();
  e.destroy();
  return {score:e.score,ended:true,ticks:e.ticks,unusedInputs:drops.length+rejected};
}

// One entry of a Sequence move log. A swap is two cells on the board; from v4 a negative `from` is a
// tool, which no swap can produce. Anything else is a log this build cannot have written.
function validSequenceEntry(entry,version){
  if(!Array.isArray(entry)||entry.length!==3||!entry.every(Number.isInteger))return false;
  const [,from,to]=entry;
  if(from>=0)return from<49&&to>=0&&to<49;
  if(version<4)return false;
  if(from===SEQ_LOG.hammer)return to>=0&&to<49;
  if(from===SEQ_LOG.shuffle)return to===-1;
  return false;
}
export async function replaySequence(rep){
  installStubs();
  if(rep?.game!=='sequence'||![1,2,3,4].includes(rep.v)||rep.step!==SIM_STEP)throw new Error('Not a Sequence replay for this build');
  const level=rep.level;if(!Number.isInteger(level)||level<1)throw new Error('Bad Sequence level');
  if(!Array.isArray(rep.moves)||!rep.moves.every(m=>validSequenceEntry(m,rep.v)))throw new Error('Bad Sequence move log');
  replayClock(rep,rep.moves.map(m=>m[0]));
  for(let i=1;i<rep.moves.length;i++)if(rep.moves[i][0]<rep.moves[i-1][0])throw new Error('Moves out of order');
  const {SequenceEngine}=await import('../dist/tryout-games.js');
  // The board is laid out in cells, so the screen size doesn't change the run.
  const out=collector(),e=new SequenceEngine(stubCanvas([480,720]),out.cb,{seed:rep.seed,level,motion:false,rulesVersion:rep.v});
  const moves=rep.moves.map(m=>[...m]);let rejected=0;
  const stop=Math.min(MAX_TICKS,rep.endTick??MAX_TICKS);
  while(!e.ended){
    while(moves.length&&moves[0][0]===e.ticks){
      const [,from,to]=moves.shift(),before=e.inputs.length;
      // The engine's own guards do the verifying: a tool it cannot spend on this tick logs nothing, and an
      // unlogged entry is counted as unused, which rejects the whole run.
      if(from===SEQ_LOG.hammer)e.useHammer(to);
      else if(from===SEQ_LOG.shuffle)e.useShuffle();
      else e.choose(from,to);
      if(e.inputs.length===before)rejected++;
    }
    if(e.ticks>=stop)break;
    e.step(SIM_STEP);
  }
  if(!e.ended)e.finish();
  e.destroy();
  const result=out.result();
  return {score:e.score,won:result.won,level,ended:true,ticks:e.ticks,unusedInputs:moves.length+rejected};
}

export {replayBlocks} from '../dist/blocks-core.js';
