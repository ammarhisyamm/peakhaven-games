// Replays a finished run from its `replay` record and returns the score it really earned.
// This is the server half of anti-cheat: a client can claim any score, but it can't fake a seed and
// input log that replays to that score. Runs headless in Node (or Deno) with tiny canvas stubs.
import {SIM_STEP} from '../dist/rng.js';

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

export async function replayRidge(rep){
  installStubs();
  if(rep?.game!=='ridge'||rep.step!==SIM_STEP)throw new Error('Not a Ridge Run replay for this build');
  const {RidgeEngine}=await import('../dist/tryout-games.js');
  const canvas=stubCanvas([...rep.view]),out=collector(),e=new RidgeEngine(canvas,out.cb,{seed:rep.seed,motion:false});
  const taps=[...rep.taps],resizes=(rep.resizes||[]).map(x=>x),resumes=[...(rep.resumes||[])];
  for(let i=1;i<taps.length;i++)if(taps[i]<taps[i-1])throw new Error('Taps out of order');
  while(!e.ended&&e.ticks<MAX_TICKS){
    while(resizes.length&&resizes[0][0]===e.ticks){canvas.view=[...resizes.shift()[1]];e.resize();}
    while(resumes.length&&resumes[0]===e.ticks){resumes.shift();e.pause(true);e.pause(false);}
    while(taps.length&&taps[0]===e.ticks){taps.shift();e.action();}
    if(!e.started&&!taps.length)break; // waiting for a tap that never comes
    e.step(SIM_STEP);
  }
  e.destroy();
  return {score:e.score,ended:e.ended,ticks:e.ticks,unusedInputs:taps.length};
}

export async function replayBond(rep){
  installStubs();
  if(rep?.game!=='bond'||rep.step!==SIM_STEP)throw new Error('Not a Bond replay for this build');
  const {BondEngine}=await import('../dist/tryout-games.js');
  const out=collector(),e=new BondEngine(stubCanvas([...rep.view]),out.cb,{seed:rep.seed,motion:false});
  const taps=[...rep.taps];let rejected=0;
  while(!e.ended&&e.ticks<MAX_TICKS){
    while(taps.length&&taps[0]===e.ticks){taps.shift();const before=e.inputs.length;e.action();if(e.inputs.length===before)rejected++;}
    if(!taps.length&&!e.flights.length)break; // nothing left in the air and no more taps: the run was finished from pause
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

export {replayBlocks} from '../dist/blocks-core.js';
