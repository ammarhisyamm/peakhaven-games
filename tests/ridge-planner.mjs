// A planning bot for Ridge Run: it plays the real engine on the fixed 1/120 s step and, every few ticks,
// searches tap / wait with a lookahead long enough to cover the next gate and the one after it. The search
// re-simulates the engine's own physics and the gates' bob (cy = gy + amp*sin(phase + rate*runTime)), with a
// hair of extra radius so float drift between the model and the engine can never matter.
// Used by tests/ridge-clearability.test.js and tools/ridge-clearability.mjs; not a test file itself.
import {SIM_STEP} from '../dist/rng.js';

export function installStubs(){
  globalThis.window??={devicePixelRatio:1};
  globalThis.requestAnimationFrame??=()=>1;
  globalThis.cancelAnimationFrame??=()=>{};
  globalThis.Image??=class{complete=false;naturalWidth=0;};
}
const noop=()=>{};
export function stubCanvas(width=480,height=720){const ctx=new Proxy({},{get:(t,k)=>k in t?t[k]:()=>ctx,set:(t,k,v)=>(t[k]=v,true)});return {getContext:()=>ctx,getBoundingClientRect:()=>({width,height,left:0,top:0}),addEventListener:noop,removeEventListener:noop,setPointerCapture:noop};}
export function stubCallbacks(){const out={result:null};out.cb={hud:noop,message:noop,sound:noop,effect:noop,progress:noop,ready:noop,topTier:noop,place:noop,end(r){out.result??=r;}};return out;}

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// One model tick, in the same order as RidgeEngine.update. Returns false on a crash.
function tick(s,gates,R,hitsVial){
  const dt=SIM_STEP,G=R.GRAVITY;
  s.vy+=G*dt;s.py+=s.vy*dt;
  const sp=R.SPEED+R.SPEED_GAIN*clamp(s.passed/60,0,1);
  s.rt+=dt;s.d+=sp*dt;
  for(let i=s.first;i<gates.length;i++){const g=gates[i];if(g.x0-s.d+R.PW<s.px-R.R){s.passed++;s.first=i+1;}else break;}
  if(s.py<R.R){s.py=R.R;s.vy=0;}
  if(s.py+R.R>R.GROUND)return false;
  const r=R.R+s.margin;
  for(let i=s.first0;i<gates.length;i++){const g=gates[i],x=g.x0-s.d;if(x>s.px+r)break;if(!(s.px+r>x&&s.px-r<x+R.PW))continue;
    const cy=g.gy+g.amp*Math.sin(g.phase+g.rate*s.rt),cx=x+R.PW/2;
    if(hitsVial(s.px,s.py,r,cx,cy+g.gap/2,1)||hitsVial(s.px,s.py,r,cx,cy-g.gap/2,-1))return false;}
  return true;
}

// Depth-first search over tap/wait every `every` ticks out to `horizon` ticks. States already shown to fail
// are remembered by (decision, py, vy) so the tree collapses to a few hundred nodes.
function search(start,gates,R,hitsVial,{every,horizon,hint}){
  const depth=Math.ceil(horizon/every),seen=new Set(),plan=[];let best=0,nodes=0;
  const dfs=(s,k)=>{
    if(k===depth)return true;
    let target=300;for(let i=s.first;i<gates.length;i++){const g=gates[i];target=g.gy+g.amp*Math.sin(g.phase+g.rate*(s.rt+.15))+8;break;}
    const pref=hint&&k<hint.length?hint[k]:s.py>target;
    for(const tap of [pref,!pref]){
      nodes++;const n={...s};if(tap)n.vy=-R.FLAP;let ok=true,t=0;
      for(;t<every;t++)if(!tick(n,gates,R,hitsVial)){ok=false;break;}
      if(!ok){best=Math.max(best,k*every+t);continue;}
      const key=k*1e9+Math.round(n.py*2)*1e3+Math.round(n.vy/4);
      if(seen.has(key))continue;seen.add(key);
      plan[k]=tap;if(dfs(n,k+1))return true;
    }
    return false;
  };
  const ok=dfs(start,0);
  return {ok,plan:ok?plan.slice(0,depth):null,best,nodes};
}

// The planner as a player: call decide(engine) at a decision tick, tap if it says so, then step `every` ticks.
// It keeps the rest of its last plan as the first line to try next time, so most decisions are one extension.
export function createPlanner(RIDGE,hitsVial,{every=5,horizon=300,margin=.35}={}){
  let hint=null;
  const planner={every,stuckAt:null,nodes:0,
    reset(){hint=null;},
    decide(e){
      const gates=e.gates.map(g=>({x0:g.x,gy:g.gy,amp:g.amp,phase:g.phase,rate:g.rate,gap:g.gap}));
      let first=0;while(first<gates.length&&e.gates[first].passed)first++;
      const s={py:e.py,vy:e.vy,rt:e.runTime,d:0,passed:e.gatesPassed,first,first0:0,px:e.px,margin};
      const r=search(s,gates,RIDGE,hitsVial,{every,horizon,hint});planner.nodes+=r.nodes;
      if(r.ok){hint=r.plan.slice(1);return r.plan[0];}
      // No safe line within the horizon: note where, then fall back to holding the next gate's centre.
      planner.stuckAt??={tick:e.ticks,gate:e.gatesPassed,survives:r.best};hint=null;return e.py>(gates[first]?.gy??300);
    }};
  return planner;
}

// Plays one seed with the planning bot until `targetGates` are passed or the run ends.
// Returns {cleared, gates, score, stuckAt}; stuckAt is the first moment no safe plan existed.
export function playPlanned(RidgeEngine,RIDGE,hitsVial,{seed,targetGates=150,view=[480,720],maxTicks=120*60*15,...opts}){
  const out=stubCallbacks(),e=new RidgeEngine(stubCanvas(...view),out.cb,{seed,motion:false}),bot=createPlanner(RIDGE,hitsVial,opts);
  e.action();
  while(!e.ended&&!e.dead&&e.gatesPassed<targetGates&&e.ticks<maxTicks){
    if(bot.decide(e))e.action();
    for(let t=0;t<bot.every&&!e.dead&&!e.ended;t++)e.step(SIM_STEP);
  }
  const cleared=e.gatesPassed>=targetGates;
  e.destroy();
  return {cleared,gates:e.gatesPassed,score:e.score,stuckAt:bot.stuckAt,nodes:bot.nodes};
}
