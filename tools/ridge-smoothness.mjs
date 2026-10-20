// Measures how smooth Ridge Run's flight actually looks, frame by frame.
//
// The simulation runs at a fixed 120 Hz; a screen does not. Whatever is left over at the end of a frame
// (0 to 8.3 ms) is motion the player has not been shown yet, so a renderer that draws the raw simulation
// state hands the eye a position that lurches ahead and then stalls. This measures that directly: it drives
// real frames at a display rate, records the vertical position the renderer drew, and reports
//
//   step  — how far the crystal moved between two frames (device pixels)
//   jerk  — how much that step CHANGED from one frame to the next. This is the jitter. Under gravity alone
//           it is a small constant (GRAVITY / hz^2); every pixel above that floor is the stepping.
//           Frames at a tap are left out: a flap changes vy in one step on purpose, and that
//           discontinuity is the game, not jitter.
//   still — frames that drew the crystal exactly where the frame before did, while flying.
//
// Usage:  node tools/ridge-smoothness.mjs [--hz 60] [--frames 1200] [--jitter 0] [--seed 7] [--raw]
//   --raw  records the un-interpolated simulation state: what the renderer drew before this fix.
//          Run with and without it for a before/after on exactly the same flight.
import {SIM_STEP} from '../dist/rng.js';

const argv=process.argv.slice(2);
const flag=(name,fallback)=>{const i=argv.indexOf(`--${name}`);return i<0?fallback:Number(argv[i+1]);};
const hz=flag('hz',60),frames=flag('frames',1200),jitter=flag('jitter',0),seed=flag('seed',7);
const raw=argv.includes('--raw');

globalThis.window??={devicePixelRatio:1};
globalThis.requestAnimationFrame??=()=>0;
globalThis.cancelAnimationFrame??=()=>{};
globalThis.Image??=class{complete=false;naturalWidth=0;};
const noop=()=>{};
function stubCanvas(width,height){
 const ctx=new Proxy({},{get:(t,k)=>k in t?t[k]:()=>ctx,set:(t,k,v)=>(t[k]=v,true)});
 return {getContext:()=>ctx,getBoundingClientRect:()=>({width,height,left:0,top:0}),addEventListener:noop,removeEventListener:noop,setPointerCapture:noop};
}
const {RidgeEngine}=await import('../dist/tryout-games.js');

export function measure({hz=60,frames=1200,jitter=0,seed=7,raw=false}={}){
 const engine=new RidgeEngine(stubCanvas(480,720),{hud:noop,message:noop,sound:noop,effect:noop,haptic:noop,checkpoint:noop,revive:noop,end:noop},{seed,motion:true,version:6});
 // A deterministic wobble on the frame clock, so this is not measuring one artificially perfect cadence.
 let rng=(seed>>>0)||1;const wobble=()=>{rng=(rng*1664525+1013904223)>>>0;return (rng/4294967296-.5)*2*jitter;};
 // A plain reactive flyer: aim at the next gate's opening and tap once the crystal has fallen below it.
 const aim=()=>engine.gates.find(g=>!g.passed&&g.x+engine.C.PW>=engine.px-engine.C.R)?.cy??300;
 // The first frames are a start-up transient (no elapsed time on frame one), not flight.
 const WARMUP=5;
 const samples=[];let now=0;
 engine.action();
 for(let i=0;i<frames;i++){
  now+=1000/hz+wobble();
  let tapped=false;
  if(!engine.dead&&engine.py>aim()-4&&engine.vy>-40){engine.action();tapped=true;}
  engine.frame(now);
  if(!engine.started||engine.dead||engine.ended||i<WARMUP)continue;
  samples.push({y:(raw?engine.py:engine.drawY)*engine.ws,tapped});
 }
 const gates=engine.gatesPassed;engine.destroy();

 const steps=[],jerks=[];
 for(let i=1;i<samples.length;i++)steps.push({d:samples[i].y-samples[i-1].y,tapped:samples[i].tapped||samples[i-1].tapped});
 for(let i=1;i<steps.length;i++)if(!steps[i].tapped&&!steps[i-1].tapped)jerks.push(Math.abs(steps[i].d-steps[i-1].d));
 const abs=steps.map(s=>Math.abs(s.d));
 const mean=list=>list.length?list.reduce((a,b)=>a+b,0)/list.length:0;
 const pct=(list,q)=>{if(!list.length)return 0;const s=[...list].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.round(q*(s.length-1)))];};
 return {
  frames:samples.length,gates,
  step:{mean:mean(abs),p95:pct(abs,.95),max:Math.max(0,...abs)},
  jerk:{mean:mean(jerks),p95:pct(jerks,.95),max:Math.max(0,...jerks),count:jerks.length},
  still:abs.filter(v=>v<1e-9).length,of:abs.length,
  // Gravity alone, over one frame: the smallest jerk the flight can physically have at this frame rate.
  floor:1450/(hz*hz)*1.0596,
 };
}

// Run directly for a report; imported by tests/ridge-smoothness.test.js for the numbers themselves.
if(process.argv[1]?.endsWith('ridge-smoothness.mjs')){
 const m=measure({hz,frames,jitter,seed,raw});
 const n=(v,unit='px')=>`${v.toFixed(2)} ${unit}`;
 console.log(`Ridge Run flight smoothness — ${raw?'raw simulation state (BEFORE)':'interpolated render (AFTER)'}`);
 console.log(`  ${hz} Hz display, ${m.frames} flying frames, ${m.gates} gates, frame-clock wobble ±${jitter} ms, seed ${seed}, sim step ${(SIM_STEP*1000).toFixed(2)} ms`);
 console.log(`  step  mean ${n(m.step.mean)}   p95 ${n(m.step.p95)}   max ${n(m.step.max)}`);
 console.log(`  jerk  mean ${n(m.jerk.mean)}   p95 ${n(m.jerk.p95)}   max ${n(m.jerk.max)}   over ${m.jerk.count} non-tap frames (gravity-only floor ${n(m.floor)})`);
 console.log(`  still ${m.still} of ${m.of} frames (${(m.still/Math.max(1,m.of)*100).toFixed(1)}%) drew the crystal where the frame before did`);
}
