// Runs the Ridge Run planning bot over many seeds and reports which courses it clears to a target gate.
// For each failure it prints the gate the bot could not get through and the geometry of the pair leading in.
// Usage: node tools/ridge-clearability.mjs [seeds=100] [gates=150] [firstSeed=1]
// EVERY (ticks between decisions), HORIZON (lookahead ticks) and MARGIN (extra radius) env vars make the
// bot coarser or more cautious, to see how much slack the course leaves a human.
import {installStubs,playPlanned,stubCanvas,stubCallbacks} from '../tests/ridge-planner.mjs';
installStubs();
const {RidgeEngine,RIDGE,hitsVial}=await import('../dist/tryout-games.js');
const [seeds=100,gates=150,firstSeed=1]=process.argv.slice(2).map(Number);
const course=seed=>{const e=new RidgeEngine(stubCanvas(),stubCallbacks().cb,{seed,motion:false});while(e.index<gates+5)e.addGate();e.destroy();return e.gates;};
const f1=v=>Math.round(v*10)/10;
const describe=g=>g&&{gy:f1(g.gy),amp:f1(g.amp),gap:f1(g.gap),rate:f1(g.rate),phase:f1(g.phase)};
const env=process.env,opts={};if(env.EVERY)opts.every=+env.EVERY;if(env.HORIZON)opts.horizon=+env.HORIZON;if(env.MARGIN)opts.margin=+env.MARGIN;
const t0=Date.now();let cleared=0;const failures=[];
for(let seed=firstSeed;seed<firstSeed+seeds;seed++){
  const r=playPlanned(RidgeEngine,RIDGE,hitsVial,{seed,targetGates:gates,...opts});
  if(r.cleared){cleared++;continue;}
  const all=course(seed),at=r.stuckAt?.gate??r.gates,speed=RIDGE.SPEED+RIDGE.SPEED_GAIN*Math.min(1,at/60);
  failures.push({seed,diedAtGate:r.gates,stuckAtGate:at,speed:f1(speed),prev:describe(all[at-1]),next:describe(all[at]),after:describe(all[at+1])});
}
console.log(`cleared ${cleared}/${seeds} seeds to gate ${gates} in ${((Date.now()-t0)/1000).toFixed(1)} s`);
for(const f of failures)console.log(JSON.stringify(f));
process.exitCode=failures.length?1:0;
