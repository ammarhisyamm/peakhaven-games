import {SEQUENCE_RULES_VERSION,sequenceLevel,createSequenceProgress,sequenceGoals,sequenceComplete,sequenceBrief,applySequenceWave,progressionExchange,progressionMove,settleProgression,createProgressionBoard} from './sequence-progression.js';
import {createSequenceBoard,sequenceMatches,sequenceExchange,settleSequence,sequenceTarget,sequencePalette,SEQUENCE_MOVES,boardFit} from './sequence-rules.js';
import {SEQUENCE_V3_VERSION,SEQUENCE_V4_VERSION,SEQUENCE_LATEST_VERSION,SEQUENCE_TOOLS,SEQ_LOG,v3Level,createV3Progress,createV3Board,v3Goals,v3AllGoals,v3Complete,v3Brief,v3Exchange,v3SwapKind,v3Move,v3Moves,planV3Wave,applyV3Wave,settleV3,v3BonusPick,v3RemainingSpecials,kindOf,colourOf,isSpecial,PLAIN,STRIPE_V,STRIPE_H,WRAP,BOMB} from './sequence-v3.js';
import {drawSprite,drawSequenceCrystal,drawBottleObstacle,vialSprites} from './gameplay-art.js';
import {orbitVelocity,crossesHoop,ORBIT_GRAVITY} from './orbit-rules.js';
import {reachStart,reachThroughGate,REACH} from './ridge-reach.js';
import {RIDGE_LATEST,ridgeCheckpoint} from './ridge-progression.js';
import {SIM_STEP,MAX_STEPS_PER_FRAME,makeSeed,createRandom} from './rng.js';

const TAU=Math.PI*2;
export const BOND_HIT=.17,BOND_KNEE=6,BOND_MAX_FIXED=5,BOND_FIXED_GAP=.55,BOND_CLOCK_MAX=4,BOND_CLOCK_MIN=2.5,BOND_CLOCK_FROM=5,BOND_CLOCK_TO=20;
const SEQ_SWAP=.16,SEQ_CLEAR=.18,SEQ_HINT_AFTER=5,SEQ_BONUS_RATE=.4,SEQ_CRACK=.42,fallTime=d=>.12+.05*Math.abs(d);
// What a v3 combo is called when it goes off. The bigger the blast, the louder the word.
const COMBO_LABELS={stripeStripe:'CROSS BLAST!',stripeWrap:'MEGA CROSS!',wrapWrap:'DOUBLE BLAST!',bombStripe:'COLOUR STRIPES!',bombWrap:'COLOUR BLAST!',bombBomb:'BOARD CLEAR!'};
// Ridge Run constants, from the Tryout Arcade (world units; the world is 640 tall).
// Every number here is the Tryout Arcade's Flap Dash, in its fixed 360x640 world: ground H-70, a node of
// radius 13 at x 100, and gates whose openings are the box-era 150..118 less VIAL_SLACK, the room the
// vial-shaped collision below hands back. Shrinking the gap by exactly that keeps the vial a reskin
// rather than an easier game.
const RIDGE_V4=Object.freeze({H:640,W:360,GROUND:570,FLOOR_PAD:6,CLOSE:7,GRAVITY:1450,FLAP:430,PW:62,SPACE:210,SPEED:165,SPEED_GAIN:65,
 SLACK:2.6,GAP:150,GAP_TO:118,GAP_START:10,GAP_END:50,JUMP:120,JUMP_TO:220,JUMP_END:40,EDGE:60,R:13,FIRST_X:450,
 // Moving vials and peptide orbs (additions on top of the Tryout Arcade course).
 MOVE_START:15,MOVE_FULL:45,MOVE_AMP:18,MOVE_AMP_TO:55,MOVE_SPEED:1.2,MOVE_SPEED_TO:2.2,
 ORB_START:3,ORB_CHANCE:.35,ORB_R:10,ORB_POINTS:2,ORB_OFFSET:30,ORB_OFFSET_TO:60});
// v5 of the course. Physics (gravity, flap, vial size, spacing) is untouched, so a v4 replay still flies the same;
// only the shaping changes. Every ramp point is derived from RAMP, the gate where the course reaches full
// difficulty, so the whole curve retunes by moving one number.
const ridgeCourse=(RAMP)=>Object.freeze({...RIDGE_V4,RAMP,
 // The opening is wider for the first few gates only, and is a normal gap by the time the player has a rhythm.
 GAP:252,GAP_TO:182,GAP_OPEN:340,GAP_OPEN_END:Math.max(2,Math.round(RAMP*.13)),
 GAP_START:Math.max(1,Math.round(RAMP*.17)),GAP_END:RAMP,
 JUMP:36,JUMP_TO:124,JUMP_END:RAMP,
 // Full speed by RAMP, then a last 10% over the same distance again so a long run keeps tightening.
 // Full speed by RAMP. SPEED_LATE adds a further rise over the same distance again; it is 0 because any
  // value above it produced courses the planning bot cannot fly, and a reachable course comes first.
 SPEED:145,SPEED_GAIN:40,SPEED_LATE:.1,
 // The first column moves at about a quarter of the way in, half of them are moving by halfway, and by RAMP
 // nearly all of them are, at full swing.
 MOVE_START:Math.max(1,Math.round(RAMP*.27)),MOVE_FULL:RAMP,MOVE_AMP:9,MOVE_AMP_TO:32,
 MOVE_SPEED:.85,MOVE_SPEED_TO:1.6,STEP_MAX:80,MOVE_SHARE:.25,MOVE_SHARE_TO:.95,
 ORB_START:4,ORB_CHANCE:.2,ORB_GAP:2,ORB_OFFSET_END:Math.round(RAMP*4/3)});
const RIDGE=ridgeCourse(30);
// How fast the drawn tilt chases the simulated one, in seconds. Short enough to still read as a reaction
// to the tap, long enough that a single step's change in vy is not a visible snap.
const RIDGE_TILT_EASE=.07;
// The vial profile in pixels down from the crimp cap: cap 0-16 at half-width 22, neck 16-24 at 15,
// shoulder 24-38 ramping 15 to 30, body 30 beyond. The drawing and the collision read the same numbers.
export const RIDGE_VIAL=Object.freeze({cap:16,neck:24,shoulder:38,capW:22,neckW:15,bodyW:30});
export function vialHalfWidth(d){if(d<0)return -1;const V=RIDGE_VIAL;
 if(d<V.cap)return V.capW;if(d<V.neck)return V.neckW;
 if(d<V.shoulder)return V.neckW+(V.bodyW-V.neckW)*((d-V.neck)/(V.shoulder-V.neck));
 return V.bodyW;}
// Twelve points round the node's rim, slightly inside it, against the profile above: cheap, deterministic,
// and forgiving at the neck, which is where threading a gate close to the glass should be possible.
const RIDGE_SAMPLES=12,RIDGE_INSET=.9;
export function hitsVial(bx,by,r,cx,capY,dir){
 for(let i=0;i<RIDGE_SAMPLES;i++){const a=i*TAU/RIDGE_SAMPLES,px=bx+Math.cos(a)*r*RIDGE_INSET,py=by+Math.sin(a)*r*RIDGE_INSET;
  const hw=vialHalfWidth((py-capY)*dir);if(hw>0&&Math.abs(px-cx)<hw)return true;}
 return false;}
export {RIDGE,RIDGE_V4};
// Gate counts that get a big on-screen callout in Ridge Run.
const RIDGE_MILESTONES=[10,25,50,75,100,150,200];
const colors=['#0ea5ff','#27d8f3','#ffd24d','#ba75ff','#24d58b','#ff609a','#f2fbff'];
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const angularDistance=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
// Bond stage rules, taken from the Tryout Arcade's Log Hit. `s` is its 0-based stage, which is
// chain number - 1 here. Vials climb by one a stage and never stop climbing: past the knee the ring
// runs out of safe arc, which is what ends a run however well it is played.
export const bondVials=s=>s<=BOND_KNEE?5+s:5+BOND_KNEE+(s-BOND_KNEE);
// Seconds allowed per vial: 4 s until stage 5, easing to 2.5 s flat from stage 20.
export const bondClock=s=>clamp(BOND_CLOCK_MAX-(BOND_CLOCK_MAX-BOND_CLOCK_MIN)*(s-BOND_CLOCK_FROM)/(BOND_CLOCK_TO-BOND_CLOCK_FROM),BOND_CLOCK_MIN,BOND_CLOCK_MAX);
// The most vials that still fit between `pins` (angles on the ring), each at least BOND_HIT from every other:
// a gap g between neighbours holds floor(g / BOND_HIT) - 1 more. An empty ring holds floor(TAU / BOND_HIT), 36.
export function bondCapacity(pins){if(!pins.length)return Math.floor(TAU/BOND_HIT);
 const s=pins.map(a=>((a%TAU)+TAU)%TAU).sort((a,b)=>a-b);let n=0;
 for(let i=0;i<s.length;i++){const g=(i+1<s.length?s[i+1]:s[0]+TAU)-s[i];n+=Math.max(0,Math.floor((g-1e-9)/BOND_HIT)-1);}
 return n;}
function rounded(c,x,y,w,h,r){c.beginPath();c.roundRect(x,y,w,h,r);}
function ring(c,x,y,r,rotation=0){
 c.save();c.shadowColor='#00d9ff';c.shadowBlur=20;c.lineWidth=12;c.strokeStyle='#b8f6ff';c.beginPath();c.arc(x,y,r,0,TAU);c.stroke();c.shadowBlur=0;c.lineWidth=5;c.strokeStyle='#0752a8';c.stroke();c.lineWidth=2;c.strokeStyle='#ffffffb0';c.beginPath();c.arc(x,y,r-8,0,TAU);c.stroke();
 for(let i=0;i<12;i++){const a=i*TAU/12+rotation;c.fillStyle=i%3?'#bdefff':'#ffd24d';c.beginPath();c.arc(x+Math.cos(a)*r,y+Math.sin(a)*r,3.5,0,TAU);c.fill();}c.restore();
}

// Uniform logical pixels keep round objects round on every viewport.
class MiniEngine{
 constructor(canvas,cb,options={}){
  this.canvas=canvas;this.ctx=canvas.getContext('2d');this.cb=cb;this.level=options.level||1;this.motion=options.motion!==false;this.time=0;this.last=0;this.acc=0;this.alpha=0;this.realDt=0;this.ticks=0;this.seed=(options.seed??makeSeed())>>>0;this.random=createRandom(this.seed);this.paused=false;this.ended=false;this.alive=true;this.score=0;this.particles=[];this.shockwaves=[];
  this.resize();this.observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(()=>this.resize());this.observer?.observe(canvas);
  this.pointer=e=>{const r=canvas.getBoundingClientRect();return[(e.clientX-r.left)/this.scale,(e.clientY-r.top)/this.scale];};
  this.frame=this.frame.bind(this);this.raf=requestAnimationFrame(this.frame);
 }
 resize(){
  const r=this.canvas.getBoundingClientRect(),width=r.width||480,height=r.height||720,dpr=Math.min(2,window.devicePixelRatio||1),oldW=this.w,oldH=this.h;this.view=[width,height];
  this.scale=Math.min(width/480,height/720);this.w=width/this.scale;this.h=height/this.scale;this.top=110/this.scale;this.bottom=48/this.scale;
  this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);
  if(this.ctx.setTransform)this.ctx.setTransform(dpr*this.scale,0,0,dpr*this.scale,0,0);else this.ctx.scale(dpr*this.scale,dpr*this.scale);
  if(oldW&&this.onResize)this.onResize(oldW,oldH);
 }
 step(dt){this.ticks++;this.time+=dt;this.update(dt);this.particles=this.particles.filter(p=>(p.life-=dt)>0);for(const p of this.particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=120*dt;}}
 frame(now){
  if(!this.alive)return;const real=Math.min(.25,(now-(this.last||now))/1000);this.last=now;
  // Fixed simulation step: the same inputs give the same run at 30, 60 or 120 Hz, and throttling the CPU
  // no longer slows the game down (below ~10 fps it still drops time rather than spiralling).
  if(!this.paused&&!this.ended){this.acc+=real;let n=0;while(this.acc>=SIM_STEP-1e-9&&n<MAX_STEPS_PER_FRAME&&!this.ended&&this.alive){this.step(SIM_STEP);this.acc-=SIM_STEP;n++;}if(n===MAX_STEPS_PER_FRAME)this.acc=0;}
  if(!this.alive)return;
  // How far past the last fixed state this frame sits, as a fraction of one step. A renderer draws between
  // the last two states with it, which is the whole fix for motion that steps at 120 Hz onto a 60 Hz screen.
  // Read only: the simulation never sees it, so a replay still reproduces the same run byte for byte.
  this.realDt=real;this.alpha=this.paused||this.ended?0:clamp(this.acc/SIM_STEP,0,1);
  this.ctx.clearRect(0,0,this.w,this.h);this.draw();this.drawEffects();this.raf=requestAnimationFrame(this.frame);
 }
 burst(x,y,color='#8fffff',count=24){if(!this.motion)return;this.shockwaves.push({x,y,color,start:this.time});for(let i=0;i<count;i++){const a=i/count*TAU,s=80+Math.random()*90;this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.6+Math.random()*.3,color});}}
 drawEffects(){const c=this.ctx;this.shockwaves=this.shockwaves.filter(p=>this.time-p.start<.55);c.save();for(const p of this.shockwaves){const t=(this.time-p.start)/.55;c.globalAlpha=1-t;c.strokeStyle=p.color;c.lineWidth=3*(1-t);c.beginPath();c.arc(p.x,p.y,10+t*65,0,TAU);c.stroke();}for(const p of this.particles){c.globalAlpha=clamp(p.life/.7,0,1);c.fillStyle=p.color;c.beginPath();c.arc(p.x,p.y,2.5,0,TAU);c.fill();}c.restore();}
 end(result){if(this.ended)return;this.ended=true;this.cb.end(result);}
 pause(value=true){this.cancelPointer?.();this.paused=value;this.last=0;this.acc=0;}
 destroy(){this.cancelPointer?.();if(this.onblur)window.removeEventListener?.('blur',this.onblur);this.alive=false;cancelAnimationFrame(this.raf);this.observer?.disconnect();for(const name of ['pointerdown','pointerup','pointercancel','pointermove','lostpointercapture']){const handler=this['on'+name];if(handler)this.canvas.removeEventListener(name,handler);}}
}

export class OrbitEngine extends MiniEngine{
 constructor(canvas,cb,options){
  super(canvas,cb,options);this.hits=0;this.lives=3;this.combo=0;this.ball=null;this.pull={x:0,y:80};this.dragging=false;this.cooldown=0;this.trail=[];
  this.onpointerdown=e=>{if(this.paused||this.ended||this.ball||this.cooldown>0)return;const[x,y]=this.pointer(e),a=this.anchor();if(Math.hypot(x-a.x,y-a.y)>75)return;this.dragging=true;this.pull={x:0,y:0};canvas.setPointerCapture?.(e.pointerId);};
  this.onpointermove=e=>{if(!this.dragging)return;const[x,y]=this.pointer(e),a=this.anchor();this.pull={x:clamp(x-a.x,-140,140),y:clamp(y-a.y,0,160)};};
  this.onpointerup=e=>{if(!this.dragging)return;this.onpointermove(e);this.dragging=false;if(this.pull.y>=18)this.action();};
  this.onpointercancel=()=>{this.dragging=false;this.pull={x:0,y:80};};
  for(const name of ['pointerdown','pointermove','pointerup','pointercancel'])canvas.addEventListener(name,this['on'+name]);cb.hud(0,3,'0');cb.message('Pull the ball down to aim, then release into the hoop.');
 }
 anchor(){return{x:this.w/2,y:this.h-this.bottom-100};}
 hoop(){const room=this.h-this.top-this.bottom;return{x:this.w/2+(this.hits?Math.sin(this.time*(.45+this.hits*.04))*Math.min(this.w*.23,150):0),y:this.top+room*.25,radius:Math.max(38,61-this.hits*1.15)};}
 aim(key){if(this.ball||this.paused||this.ended)return;if(key==='ArrowLeft')this.pull.x=clamp(this.pull.x-10,-140,140);if(key==='ArrowRight')this.pull.x=clamp(this.pull.x+10,-140,140);if(key==='ArrowDown')this.pull.y=clamp(this.pull.y+10,20,160);if(key==='ArrowUp')this.pull.y=clamp(this.pull.y-10,20,160);this.cb.message(`Aim ${Math.round(-this.pull.x)}. Power ${Math.round(this.pull.y)}. Press Space to release.`);}
 action(){if(this.paused||this.ended||this.ball||this.cooldown>0)return;const a=this.anchor(),hoop=this.hoop(),velocity=orbitVelocity(this.pull,a.y-hoop.y);this.ball={...a,...velocity};this.trail=[];this.cb.sound('launch');this.cb.message('');}
 update(dt){
  this.cooldown=Math.max(0,this.cooldown-dt);if(!this.ball)return;
  const steps=Math.max(1,Math.ceil(dt/.008));for(let i=0;i<steps&&this.ball;i++){
   const step=dt/steps,b=this.ball,previous={x:b.x,y:b.y},hoop=this.hoop();b.vy+=ORBIT_GRAVITY*step;b.x+=b.vx*step;b.y+=b.vy*step;
   if(crossesHoop(previous,b,hoop,18)){this.hits++;this.combo++;this.score+=100+Math.min(5,this.combo)*25;this.burst(hoop.x,hoop.y,'#ffe18b',32);this.cb.sound('swish');this.cb.effect?.(this.combo>1?`${this.combo}× SWISH`:'SWISH!','orbit');this.cb.hud(this.score,this.lives,`${this.combo}×`);this.cb.message('Clean shot. Pull again when the ball returns.');this.ball=null;this.cooldown=.65;this.pull={x:0,y:80};break;}
   if(b.y>this.h+25||b.x<-60||b.x>this.w+60){this.miss();break;}
  }
  if(this.ball&&this.motion){this.trail.push({x:this.ball.x,y:this.ball.y});if(this.trail.length>18)this.trail.shift();}
 }
 miss(){this.ball=null;this.lives--;this.combo=0;this.cooldown=.65;this.pull={x:0,y:80};this.cb.hud(this.score,this.lives,'0');this.cb.sound('rim');this.cb.message(this.lives?`${this.lives} shots left. Adjust your pull and try again.`:'Your hoops are saved.');if(!this.lives)this.finish();}
 onResize(oldW,oldH){if(this.ball){this.ball.x*=this.w/oldW;this.ball.y*=this.h/oldH;}}
 draw(){
  const c=this.ctx,a=this.anchor(),hoop=this.hoop();c.save();c.fillStyle='#071f4670';c.beginPath();c.ellipse(hoop.x,hoop.y+46,hoop.radius*.9,12,0,0,TAU);c.fill();drawSprite(c,'orbit-hoop',hoop.x,hoop.y+19,hoop.radius*3.2,hoop.radius*1.92);
  if(this.dragging){const v=orbitVelocity(this.pull,a.y-hoop.y);c.fillStyle='#eaffff';for(let t=.08;t<1.65;t+=.08){const x=a.x+v.vx*t,y=a.y+v.vy*t+.5*ORBIT_GRAVITY*t*t;if(y<this.top||y>this.h)continue;c.globalAlpha=1-t/1.9;c.beginPath();c.arc(x,y,2.7,0,TAU);c.fill();}c.globalAlpha=1;c.strokeStyle='#8ffaff';c.lineWidth=2;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(a.x+this.pull.x*.32,a.y+this.pull.y*.32);c.stroke();}
  if(this.motion)for(let i=0;i<this.trail.length;i++){c.globalAlpha=i/this.trail.length*.28;c.fillStyle='#8fffff';c.beginPath();c.arc(this.trail[i].x,this.trail[i].y,5+i*.4,0,TAU);c.fill();}c.globalAlpha=1;
  const b=this.ball||{x:a.x+(this.dragging?this.pull.x*.32:0),y:a.y+(this.dragging?this.pull.y*.32:0)};
  if(this.ball||!this.cooldown){c.shadowColor='#2fe8ff';c.shadowBlur=16;drawSprite(c,'orbit-ball',b.x,b.y,49,49,this.ball?this.time*3:0);}
  if(!this.ball&&!this.cooldown){c.shadowBlur=0;c.strokeStyle='#d5fbffaa';c.lineWidth=2;c.beginPath();c.ellipse(a.x,a.y+34,43,9,0,0,TAU);c.stroke();}c.restore();
 }
 finish(){this.end({score:this.score,orbits:this.hits});}
}

export class RidgeEngine extends MiniEngine{
 // Course and physics copied from the Tryout Arcade's Ridge Run. Gameplay runs in a fixed 640-unit-tall world
 // (ground at 582), scaled to fit the screen, so every phone and desktop gets the same course.
 // Gravity 1450, a tap sets climb speed to 430, gates 62 wide every 210 units, speed 165 rising to 230 by
 // gate 60, openings 150 shrinking to 118 between gates 10 and 50, and each opening a random step of up to
 // 120 (rising to 220 by gate 40) from the last. The ceiling stops you instead of ending the run.
 constructor(canvas,cb,options){super(canvas,cb,options);const version=options?.version??options?.rulesVersion;this.courseV=version===4?4:version===5?5:RIDGE_LATEST;this.C=this.courseV===4?RIDGE_V4:RIDGE;this.lastOrbI=-99;this.flapAt=-9;this.bursts=[];this.px=100;this.py=300;this.vy=0;this.started=false;this.dead=false;this.deadT=0;this.gates=[];this.index=0;this.nextX=0;this.lastGy=300;this.lastAmp=0;this.trail=[];this.tilt=0;this.gatesPassed=0;this.orbs=[];this.orbsTaken=0;this.runTime=0;this.popups=[];
  this.inputs=[];this.resumes=[];this.revives=[];this.rescueOffered=false;this.reviveReady=false;this.shield=0;this.regionStage=0;this.skyChangedAt=0;this.nextX=this.C.FIRST_X;this.nextT=(this.C.FIRST_X-this.px)/this.speedFor(0);this.reach=this.C.RAMP===undefined?null:reachStart(this.C);this.reachT=0;
  // Render-only state: the position the last fixed step started from, and the eased tilt. Neither is read
  // by update(), hits() or replay(), so v4/v5/v6 replays are untouched by any of it.
  this.prevPy=this.py;this.drawY=this.py;this.drawTilt=0;for(let i=0;i<4;i++)this.addGate();this.fillGates();
  this.onpointerdown=()=>this.action();canvas.addEventListener('pointerdown',this.onpointerdown);cb.hud(0,0,'1×');cb.message(this.courseV>=6?'Tap anywhere to lift your crystal. Fly through the open gates.':'Tap anywhere to lift your vial. Fly through the open gates.');this.cb.checkpoint?.(ridgeCheckpoint(0),0);}
 // Remembers where the last fixed step started, so a frame can draw between the two states.
 step(dt){this.prevPy=this.py;super.step(dt);}
 // True while the course is scrolling. When it is not (before the first tap, after a crash, holding for a
 // tap after a pause) there is nothing to interpolate and the frame draws the state as it stands.
 get scrolling(){return Boolean(this.started&&!this.dead&&!this.waiting&&!this.rescueOffered&&!this.paused&&!this.ended);}
 // The drawn state for this frame: one simulation step behind real time, interpolated across the leftover.
 // That costs a fixed ~8 ms of latency and removes all of the stepping, instead of the other way round.
 renderState(){
  const a=this.scrolling?clamp(this.alpha??0,0,1):1,back=this.scrolling?SIM_STEP*(1-a):0;
  const prev=this.prevPy===undefined?this.py:this.prevPy;
  return {y:prev+(this.py-prev)*a,shift:this.speed*back,alpha:a};
 }
 // The course (sky to ground, 0 to GROUND in world units) fills the space between the bottom of the HUD and the
 // bottom of the screen, so no vial hides under the score boxes and the ground sits on the screen's bottom edge.
 // Only drawing changes with the screen; the course and physics stay in world units.
 get oy(){return this.hudTop??this.top;}
 get ws(){return Math.max(.1,(this.h-this.oy-this.C.FLOOR_PAD)/this.C.GROUND);}
 // Measures where the HUD ends on screen (it moves with the notch / safe area); falls back to the shared top margin.
 measureHud(){try{const hud=document.querySelector('.in-game .hud'),r=this.canvas.getBoundingClientRect(),route=this.courseV>=6?document.querySelector('.ridge-route'):null,b=(route??hud)?.getBoundingClientRect().bottom-r.top||0;this.hudTop=b>0?(b+10)/this.scale:this.top;}catch{this.hudTop=this.top;}this.hudAt=this.time;}
 sy(y){return this.oy+y*this.ws;}
 get worldW(){return this.w/this.ws;}
 // Speed for a given number of gates passed. The scroll only depends on how many gates are behind the vial, not
 // on how it is flying, so the time the vial reaches gate i is the same for everyone who gets there.
 speedFor(passed){const C=this.C;
  if(C.RAMP===undefined)return C.SPEED+C.SPEED_GAIN*clamp(passed/60,0,1);
  const base=C.SPEED+C.SPEED_GAIN*clamp(passed/C.RAMP,0,1);
  return base*(1+C.SPEED_LATE*clamp((passed-C.RAMP)/C.RAMP,0,1))*(this.courseV>=6?ridgeCheckpoint(passed).speedFactor:1);}
 get speed(){return this.speedFor(this.gatesPassed);}
 // Gap and reach ramp off the gate's own index, not the live score, so the course is the same for everyone
 // however well they are playing.
 // The opening gates are wider still and ease down to the normal gap, so the first seconds of a run forgive the
 // flailing everyone does before they find the rhythm. v4 has no GAP_OPEN, so its opening is unchanged.
 gapFor(i){const C=this.C,base=(C.GAP-C.SLACK)-(C.GAP-C.GAP_TO)*clamp((i-C.GAP_START)/(C.GAP_END-C.GAP_START),0,1);
  const gap=C.GAP_OPEN===undefined?base:base+(C.GAP_OPEN-C.GAP)*(1-clamp(i/C.GAP_OPEN_END,0,1));
  return this.courseV>=6?Math.max(130,gap-ridgeCheckpoint(i).gapReduction):gap;}
 jumpFor(i){return this.C.JUMP+(this.C.JUMP_TO-this.C.JUMP)*clamp(i/this.C.JUMP_END,0,1);}
 // The reachable band is clamped to the playfield first and the centre drawn inside it, so a gate near an
 // edge still uses its whole remaining range instead of piling up on the margin.
 // Moving vials: from gate 15 some gates bob up and down, more of them and further and faster as you go
 // (from 18 to 55 units, by gate 45). The step between gates shrinks by both swings so every gate stays
 // reachable, and a gate never bobs past the playfield edges.
 // Peptide orbs: from gate 3, about a third of the gaps hold an orb worth 2 points, set off the safe line.
 // How hard the generator tries before giving up on a lively gate, and how much room it insists on leaving.
 // The minimum is above zero because the reachable set is bucketed, and a set down to its last few states is a
 // course only a machine could fly.
 static REROLLS=6;static REACH_MIN=24;static REACH_CARRY=112;
 addGate(){const i=this.index++,gap=this.gapFor(i),lo=this.C.EDGE+gap/2,hi=this.C.GROUND-this.C.EDGE-gap/2,ramp=clamp((i-this.C.MOVE_START)/(this.C.MOVE_FULL-this.C.MOVE_START),0,1);
  const share=this.C.MOVE_SHARE===undefined?.4+.6*ramp:this.C.MOVE_SHARE+(this.C.MOVE_SHARE_TO-this.C.MOVE_SHARE)*ramp;
  const moves=i>=this.C.MOVE_START&&this.random()<share,want=moves?this.C.MOVE_AMP+(this.C.MOVE_AMP_TO-this.C.MOVE_AMP)*ramp:0;
  const prev=this.gates.at(-1),phased=this.C.RAMP!==undefined,tCross=this.nextT,speed=this.speedFor(i);
  const anchor=phased&&prev?prev.gy+prev.amp*Math.sin(prev.phase+prev.rate*prev.t):this.lastGy;
  const reachStep=phased?Math.min(this.jumpFor(i),this.C.STEP_MAX??1e9):Math.max(40,this.jumpFor(i)-want-this.lastAmp);
  // One candidate: a height inside the step, a phase, and whatever swing its own phase leaves room for.
  const draw=()=>{const a=Math.max(lo,anchor-reachStep),b=Math.min(hi,anchor+reachStep),gy=a+this.random()*(b-a);
   const rate=this.C.MOVE_SPEED+(this.C.MOVE_SPEED_TO-this.C.MOVE_SPEED)*ramp,phase=this.random()*TAU;
   const sinT=Math.sin(phase+rate*tCross),slack=Math.max(0,reachStep-Math.abs(gy-anchor));
   const cap=phased?slack/Math.max(Math.abs(sinT),1e-3):1e9;
   return {x:this.nextX,gy,cy:gy,gap,amp:Math.min(want,gy-lo,hi-gy,cap),phase,rate,t:tCross,passed:false};};
  let gate=draw(),carried=null;
  // Walk the set of states a player could still be in through the candidate. If it would leave them with nothing,
  // re-roll; this is what catches a run of gates that drift together, which no pairwise rule can see.
  if(this.reach){
   const from=this.reach.length>RidgeEngine.REACH_CARRY?this.reach.slice(0,RidgeEngine.REACH_CARRY):this.reach;
   for(let tries=0;;tries++){
    const out=reachThroughGate(from,gate,this.C,speed,this.px,hitsVial,this.reachT);
    if(out.states.length>=RidgeEngine.REACH_MIN||tries>=RidgeEngine.REROLLS){carried=out;break;}
    gate=draw();
   }
   if(carried.states.length<RidgeEngine.REACH_MIN){
    // Nothing lively fits. Put a still gate in the middle of where the player can actually be.
    let sum=0;for(const s of from)sum+=s.y;
    const mid=clamp(from.length?sum/from.length:(lo+hi)/2,lo,hi);
    gate={x:this.nextX,gy:mid,cy:mid,gap,amp:0,phase:0,rate:1,t:tCross,passed:false};
    carried=reachThroughGate(from,gate,this.C,speed,this.px,hitsVial,this.reachT);
   }
   this.reach=carried.states;this.reachT=carried.t;
  }
  const gy=gate.gy,amp=gate.amp;
  const orbRoom=prev&&i>=this.C.ORB_START&&(this.C.ORB_GAP===undefined||i-this.lastOrbI>=this.C.ORB_GAP);
  if(orbRoom&&this.random()<this.C.ORB_CHANCE){this.lastOrbI=i;const off=(this.C.ORB_OFFSET+(this.C.ORB_OFFSET_TO-this.C.ORB_OFFSET)*clamp(i/(this.C.ORB_OFFSET_END??40),0,1))*(this.random()<.5?-1:1);
   this.orbs.push({x:prev.x+this.C.PW+(this.C.SPACE-this.C.PW)/2,y:clamp((prev.gy+gy)/2+off,this.C.EDGE,this.C.GROUND-this.C.EDGE),taken:false});}
  this.lastGy=gy;this.lastAmp=amp;this.gates.push(gate);this.nextX+=this.C.SPACE;this.nextT+=this.C.SPACE/this.speedFor(i+1);}
 // Gates sit at fixed world positions; wider screens just get a few more of the same gates created ahead of time.
 fillGates(){while(this.nextX<this.worldW+this.C.PW*2)this.addGate();}
 // The tap that ends a post-pause wait only picks the flight back up, at the speed it had when it paused; it does
 // not flap. A forced flap there could throw the vial into glass it was threading when the tab went hidden.
 action(){if(this.paused||this.ended||this.dead)return;this.inputs.push(this.ticks);
  if(this.waiting){this.waiting=false;if(this.reviveReady){this.vy=-this.C.FLAP;this.flapAt=this.time;this.reviveReady=false;this.cb.sound('flap');}this.cb.message('');return;}
  this.started=true;this.vy=-this.C.FLAP;this.flapAt=this.time;this.cb.sound('flap');this.cb.message('');}
 // Broad phase on the gate's column, then the two vial outlines themselves.
 hits(g){const R=this.C.R;if(!(this.px+R>g.x&&this.px-R<g.x+this.C.PW))return false;const cx=g.x+this.C.PW/2;
  return hitsVial(this.px,this.py,R,cx,g.cy+g.gap/2,1)||hitsVial(this.px,this.py,R,cx,g.cy-g.gap/2,-1);}
 update(dt){
  if(this.rescueOffered)return;
  if(this.waiting)return; // holds still where it was paused until the next tap
  if(!this.started){this.py=300+Math.sin(this.time*3)*8;return;}
  this.vy+=this.C.GRAVITY*dt;this.py+=this.vy*dt;this.tilt=clamp(this.vy*.0011,-.35,.7);
  if(this.dead){this.deadT+=dt;if(this.py>this.C.GROUND-this.C.R)this.py=this.C.GROUND-this.C.R;if(this.deadT>.8){if(this.courseV>=6&&!this.revives.length&&this.cb.revive){this.rescueOffered=true;this.paused=true;this.cb.revive();}else this.end(this.result());}return;}
  const sp=this.speed;this.runTime+=dt;this.shield=Math.max(0,this.shield-dt);for(const p of this.popups)p.t+=dt;this.popups=this.popups.filter(p=>p.t<.8);
  for(const g of this.gates)g.cy=g.gy+g.amp*Math.sin(g.phase+g.rate*this.runTime);
  for(const o of this.orbs){o.x-=sp*dt;if(!o.taken&&Math.hypot(o.x-this.px,o.y-this.py)<this.C.R+this.C.ORB_R){o.taken=true;this.orbsTaken++;this.score+=this.C.ORB_POINTS;this.popups.push({x:o.x,y:o.y,t:0});this.bursts.push({x:o.x,y:o.y,t:0});this.cb.hud(this.score,this.gatesPassed,`${Math.min(9,1+Math.floor(this.gatesPassed/5))}×`);this.cb.sound('bond');this.burst(o.x*this.ws,this.sy(o.y),'#ffd24d',14);}}
  this.orbs=this.orbs.filter(o=>o.x>-this.C.ORB_R*2);
  for(const b of this.bursts){b.x-=sp*dt;b.t+=dt;}this.bursts=this.bursts.filter(b=>b.t<.7);
  for(const g of this.gates){g.x-=sp*dt;if(!g.passed&&g.x+this.C.PW<this.px-this.C.R){g.passed=true;this.gatesPassed++;this.score++;g.flashAt=this.time;if(g.minClear<this.C.CLOSE){this.popups.push({x:this.px+18,y:this.py-22,t:0,text:'CLOSE!'});this.cb.haptic?.('close');}if(this.courseV>=6){const checkpoint=ridgeCheckpoint(this.gatesPassed);this.cb.checkpoint?.(checkpoint,this.gatesPassed);if(checkpoint.stage!==this.regionStage){this.regionStage=checkpoint.stage;this.skyChangedAt=this.time;this.cb.effect?.(`ZONE ${checkpoint.stage+1}!`,'ridge',{zone:checkpoint.stage+1,name:checkpoint.name});this.cb.sound('win');this.cb.haptic?.('win',true);}}else if(RIDGE_MILESTONES.includes(this.gatesPassed))this.cb.effect?.(`${this.gatesPassed} GATES!`,'ridge');this.cb.hud(this.score,this.gatesPassed,`${Math.min(9,1+Math.floor(this.gatesPassed/5))}×`);this.cb.sound('perfect');this.burst(this.px*this.ws,this.sy(this.py),'#8fffff',12);}}
  this.nextX-=sp*dt;while(this.gates.length&&this.gates[0].x<-this.C.PW)this.gates.shift();if(this.gates.length<4)this.addGate();this.fillGates();
  if(this.py<this.C.R){this.py=this.C.R;this.vy=0;}
  if(this.py+this.C.R>this.C.GROUND){this.py=this.C.GROUND-this.C.R;if(!this.shield)this.crash();}else if(!this.shield&&this.gates.some(g=>this.hits(g)))this.crash();
  // Near misses, for the "CLOSE!" popup only: the tightest gap to the glass while inside each gate's column.
  if(!this.dead)for(const g of this.gates)if(!g.passed&&this.px+this.C.R>g.x&&this.px-this.C.R<g.x+this.C.PW)g.minClear=Math.min(g.minClear??Infinity,this.py-this.C.R-(g.cy-g.gap/2),g.cy+g.gap/2-(this.py+this.C.R));
  if(this.motion){this.trail.push({x:this.px,y:this.py});for(const p of this.trail)p.x-=sp*dt;if(this.trail.length>14)this.trail.shift();}
 }
 crash(){if(this.dead||this.ended)return;this.dead=true;this.vy=Math.max(this.vy,0);this.burst(this.px*this.ws,this.sy(this.py),'#ffd383');this.cb.sound('miss');}
 result(){return {score:this.score,gates:this.gatesPassed,orbs:this.orbsTaken,replay:this.replay()};}
 replay(){return {v:this.courseV,game:'ridge',seed:this.seed,step:SIM_STEP,taps:[...this.inputs],resumes:[...this.resumes],...(this.courseV>=6?{revives:[...this.revives]}:{}),endTick:this.ticks};}
 revive(){
  if(this.courseV<6||!this.alive||this.ended||!this.dead||!this.rescueOffered||this.revives.length)return false;
  this.revives.push(this.ticks);this.rescueOffered=false;this.dead=false;this.deadT=0;this.paused=false;this.waiting=true;this.reviveReady=true;this.last=0;this.acc=0;this.vy=0;this.tilt=0;this.trail=[];this.shield=1.25;
  const next=this.gates.find(g=>!g.passed&&g.x+this.C.PW>=this.px-this.C.R);this.py=clamp(next?.cy??300,this.C.R+20,this.C.GROUND-this.C.R-20);this.prevPy=this.py;this.drawTilt=0;
  this.cb.message('Shield ready. Tap to keep flying.');this.cb.sound('hint');return true;
 }
 // After a pause the vial (and the course) hold still until a tap, so the run never resumes before the player is
 // ready. Its velocity is kept: the tap continues the same flight, as if the pause never happened.
 pause(value=true){super.pause(value||this.rescueOffered);if(!value&&!this.rescueOffered&&this.started&&!this.dead&&!this.ended){this.resumes.push(this.ticks);this.waiting=true;this.cb.message('Tap to keep flying.');}}
 draw(){if(this.hudAt===undefined||this.time-this.hudAt>1||this.time<this.hudAt)this.measureHud();const c=this.ctx,k=this.ws;if(this.courseV>=6)this.drawSky();c.save();
  // One render state for the whole frame: the gates, orbs, trail and the crystal all move together, so a
  // sub-step shift can never show up as the player sliding against the course.
  const render=this.renderState(),py=this.drawY=render.y,shift=render.shift;
  // Crash shake: about 6px for a quarter second, and only when motion is allowed.
  const shake=this.dead&&this.motion?Math.max(0,1-this.deadT/.25):0;
  if(shake)c.translate(Math.sin(this.deadT*64)*6*shake,Math.cos(this.deadT*51)*6*shake);
  c.translate(0,this.oy);c.scale(k,k);c.translate(shift,0);
  if(this.motion)for(let i=0;i<this.trail.length;i++){c.globalAlpha=i/this.trail.length*.3;c.fillStyle='#8fffff';c.beginPath();c.arc(this.trail[i].x,this.trail[i].y,2+i*.25,0,TAU);c.fill();}
  c.globalAlpha=1;c.shadowColor='#03cfff';c.shadowBlur=10;
  // Pickups: a mini gold vial bobbing in the gap, with a soft glow behind it and a glint every couple of seconds.
  for(const o of this.orbs){if(o.taken)continue;
   const ph=o.x*.03,bob=Math.sin(this.time*3+ph)*2.5,oy=o.y+bob,tilt=Math.sin(this.time*1.6+ph)*.16;
   c.save();
   const gr=c.createRadialGradient(o.x,oy,1,o.x,oy,this.C.ORB_R*2.4);gr.addColorStop(0,"#ffe9a3aa");gr.addColorStop(1,"#ffd24d00");
   c.fillStyle=gr;c.beginPath();c.arc(o.x,oy,this.C.ORB_R*2.4,0,TAU);c.fill();
   c.shadowColor="#ffd24d";c.shadowBlur=14;drawSprite(c,"vial-gold",o.x,oy,19,36,tilt);
   // Glint: a short white flick across the glass, roughly every two seconds.
   const gl=(this.time*.5+ph)%1;if(gl<.12){c.globalAlpha=Math.sin(gl/.12*Math.PI)*.9;c.strokeStyle="#ffffff";c.lineWidth=2;
    c.beginPath();c.moveTo(o.x-5,oy-9+gl*40);c.lineTo(o.x+5,oy-13+gl*40);c.stroke();c.globalAlpha=1;}
   c.restore();}
  // Collecting one: a gold ring opening out with eight sparks, over about 0.7s.
  for(const b of this.bursts){const p=b.t/.7,ease=1-(1-p)*(1-p);c.save();c.globalAlpha=1-p;
   c.strokeStyle="#ffe9a3";c.lineWidth=2.5;c.beginPath();c.arc(b.x,b.y,6+ease*26,0,TAU);c.stroke();
   c.fillStyle="#fff6d6";for(let i=0;i<8;i++){const a=i*TAU/8,d=8+ease*30;c.beginPath();c.arc(b.x+Math.cos(a)*d,b.y+Math.sin(a)*d,2.2*(1-p),0,TAU);c.fill();}
   c.globalAlpha=1;c.restore();}
  for(const p of this.popups){const close=p.text==='CLOSE!',pop=close?1+.5*Math.max(0,1-p.t/.16)-.5*0:1;
   c.save();c.globalAlpha=close?Math.max(0,1-p.t/.55):1-p.t/.8;if(close){c.translate(p.x,p.y-14);c.scale(pop,pop);c.translate(-p.x,-(p.y-14));}c.font=close?'900 30px Inter, sans-serif':'900 20px Inter, sans-serif';c.textAlign='center';c.lineJoin='round';c.lineWidth=close?7:5;c.strokeStyle='#2a1400d9';c.shadowColor='#ff9d2e';c.shadowBlur=close?14:10;const label=p.text??`+${this.C.ORB_POINTS}`,ty=p.y-14-p.t*30;c.strokeText(label,p.x,ty);c.fillStyle=close?'#fff2c2':'#ffe9a3';c.fillText(label,p.x,ty);c.restore();}
  for(const g of this.gates){const top=g.cy-g.gap/2,bottom=g.cy+g.gap/2,cx=g.x+this.C.PW/2;drawBottleObstacle(c,cx,top,top+this.oy/k,this.C.PW,true);drawBottleObstacle(c,cx,bottom,this.C.GROUND-bottom,this.C.PW,false);
   // A tick of light on the glass of a gate just cleared.
   const fl=g.flashAt===undefined?9:this.time-g.flashAt;if(fl<.28){c.save();c.globalAlpha=(1-fl/.28)*.85;c.strokeStyle='#eaffff';c.lineWidth=3;c.shadowColor='#8fffff';c.shadowBlur=12;
    c.beginPath();c.moveTo(cx-this.C.PW/2,top);c.lineTo(cx+this.C.PW/2,top);c.moveTo(cx-this.C.PW/2,bottom);c.lineTo(cx+this.C.PW/2,bottom);c.stroke();c.restore();}}
  c.shadowBlur=14;c.strokeStyle='#8fffffaa';c.lineWidth=2;c.beginPath();c.moveTo(-shift-4,this.C.GROUND);c.lineTo(this.worldW+shift+4,this.C.GROUND);c.stroke();
  c.shadowColor='#8fffff';c.shadowBlur=16;
  // A flap squashes the vial for about 120ms and kicks its nose up; a dead vial tumbles as it falls.
  const fl=this.motion?clamp(1-(this.time-this.flapAt)/.12,0,1):0;
  const want=this.dead?this.tilt+this.deadT*7:this.tilt-.5*fl;
  // Exponential easing off the real frame time, so the feel is the same at 60 and 120 Hz.
  this.drawTilt=this.motion?this.drawTilt+(want-this.drawTilt)*(1-Math.exp(-(this.realDt||SIM_STEP)/RIDGE_TILT_EASE)):want;
  const tilt=this.drawTilt;
  // The crystal keeps its own screen x; only the course behind it was shifted.
  c.save();c.translate(-shift,0);
  if(this.courseV>=6)this.drawPlayer(this.px,py,tilt);else drawSprite(c,'vial-cyan',this.px,py,this.C.R*2*(1-.2*fl),this.C.R*2.6*(1+.26*fl),tilt);
  c.restore();
  c.restore();
  // Crash flash: about 80ms of white over the whole screen, motion permitting.
  if(this.dead&&this.motion&&this.deadT<.08){c.save();c.globalAlpha=(1-this.deadT/.08)*.7;c.fillStyle='#ffffff';c.fillRect(0,0,this.w,this.h);c.restore();}
 }
 drawSky(){
  const c=this.ctx,region=ridgeCheckpoint(this.gatesPassed),previous=ridgeCheckpoint(Math.max(0,region.from-1)),fade=this.motion?clamp((this.time-this.skyChangedAt)/1.4,0,1):1;
  const paint=(r,alpha)=>{c.globalAlpha=alpha;const g=c.createLinearGradient(0,0,0,this.h);g.addColorStop(0,r.top);g.addColorStop(1,r.bottom);c.fillStyle=g;c.fillRect(0,0,this.w,this.h);};
  c.save();paint(previous,1);paint(region,fade);c.globalAlpha=.12;c.lineWidth=1.5;c.lineCap='round';
  // Broad, slow bands supply a sense of flight without scenery competing with the gates.
  for(let i=0;i<5;i++){const span=this.w+260,x=(i*173-(this.motion?this.runTime*25:0))%span;const mist=c.createLinearGradient(x-150,0,x+span*.15,0);mist.addColorStop(0,'#d1f8ff00');mist.addColorStop(.5,'#d1f8ff');mist.addColorStop(1,'#d1f8ff00');c.strokeStyle=mist;c.beginPath();c.moveTo(x+span*.15,this.h*.12+i*this.h*.19);c.lineTo(x-150,this.h*.19+i*this.h*.19);c.stroke();}
  c.restore();
 }
 drawPlayer(x=this.px,y=this.py,tilt=0){
  const c=this.ctx,r=this.C.R;c.save();c.translate(x,y);
  if(this.shield){c.strokeStyle='#fff3b0';c.lineWidth=2;c.shadowColor='#ffe47c';c.shadowBlur=10;c.beginPath();c.arc(0,0,r+6,0,TAU);c.stroke();}
  c.shadowColor='#73e9ff';c.shadowBlur=7;const glass=c.createRadialGradient(-r*.3,-r*.4,1,0,0,r);glass.addColorStop(0,'#f2ffff');glass.addColorStop(.35,'#76edff');glass.addColorStop(.75,'#0c9ce8');glass.addColorStop(1,'#0750a3');
  c.fillStyle=glass;c.strokeStyle='#d1faff';c.lineWidth=1.5;c.beginPath();c.arc(0,0,r,0,TAU);c.fill();c.stroke();c.shadowBlur=0;
  c.rotate(tilt);c.strokeStyle='#ffffff';c.lineWidth=2.5;c.lineCap='round';c.lineJoin='round';c.beginPath();c.moveTo(-3,-5);c.lineTo(2,-5);c.lineTo(6,0);c.lineTo(2,5);c.moveTo(0,0);c.lineTo(-4,3);c.stroke();c.fillStyle='#fff';c.beginPath();c.arc(-4,3,2,0,TAU);c.fill();c.restore();
 }
 finish(){if(!this.ended)this.end(this.result());}
}

export class BondEngine extends MiniEngine{
 // Stage design copied from the Tryout Arcade's Bond (Log Hit), whose stages count from 0: chain n here is
 // its stage n-1. A chain hands you 5 + stage vials, climbing by one a chain without an upper limit, and can
 // start with up to 5 fixed vials (faded) seeded at least 0.55 rad apart. Spin is 1.7 + 0.22 × stage in a
 // random direction from a random angle; from stage 3 the ring speeds up, stalls and swings back
 // (sin(t × 1.15) × 1.3 + 0.35, so it can run backwards). One vial flies at a time, and a shot clock of 4 s,
 // easing to 2.5 s by stage 20, runs while a vial waits — it is armed by the first throw of the run.
 constructor(canvas,cb,options){super(canvas,cb,options);this.rotation=0;this.bonds=0;this.stage=0;this.inputs=[];this.flights=[];this.clearT=0;this.bump=0;this.clockLive=false;this.nextStage();this.onpointerdown=()=>this.action();canvas.addEventListener('pointerdown',this.onpointerdown);cb.message('Tap anywhere to send a vial into a clear gap.');}
 geometry(){const room=this.h-this.top-this.bottom;return{x:this.w/2,y:this.top+room*.37,r:Math.min(155,room*.26,this.w*.31),launch:this.h-this.bottom-60};}
 get round(){return this.stage;}
 get index(){return this.stage-1;}
 get clockLimit(){return bondClock(this.index);}
 // The wobble follows run time, not stage time, exactly as the Tryout Arcade does.
 get wobble(){return this.index>=3?Math.sin(this.time*1.15)*1.3+.35:1;}
 nextStage(){this.stage++;const s=this.index;this.left=bondVials(s);this.pins=[];this.stageTime=0;
  // Up to five seeded fixed vials, each kept a gap clear of the others, 24 tries apiece, so a chain
  // never starts already crowded. Fewer than asked for is normal once the ring is busy. A fixed vial is
  // also refused if it would leave less room than the chain has shots: until the shots alone outgrow the
  // ring (chain 33), every chain can be cleared. That only bites from chain 25; earlier chains seed as before.
  const want=Math.floor(this.random()*(BOND_MAX_FIXED+1)),roomy=this.left<=bondCapacity([]);
  for(let i=0;i<want;i++)for(let t=0;t<24;t++){const a=this.random()*TAU;if(this.pins.every(p=>angularDistance(p,a)>BOND_FIXED_GAP)&&(!roomy||bondCapacity([...this.pins,a])>=this.left)){this.pins.push(a);break;}}
  this.fixed=this.pins.length;
  this.base=(1.7+s*.22)*(this.random()<.5?-1:1);this.rotation=this.random()*TAU;this.clock=this.clockLimit;
  this.cb.hud(this.score,this.left,String(this.stage));if(this.stage>1)this.cb.message(`Chain ${this.stage}. ${this.left} vials.`);}
 get speed(){return Math.abs(this.base*this.wobble);}
 replay(){return {v:1,game:'bond',seed:this.seed,view:this.view,step:SIM_STEP,taps:[...this.inputs],endTick:this.ticks};}
 // A refused tap is not a throw, so the shot clock is armed and reset here rather than on every tap.
 action(){if(this.paused||this.ended||this.flights.length||this.clearT>0||this.left<=0)return;this.inputs.push(this.ticks);this.flights.push({progress:0,sprite:vialSprites[(this.pins.length)%4]});this.clockLive=true;this.clock=this.clockLimit;this.cb.sound('launch');this.cb.message('');}
 update(dt){
  this.stageTime+=dt;this.bump=Math.max(0,this.bump-dt*6);
  if(this.clearT>0){this.clearT-=dt;if(this.clearT<=0)this.nextStage();return;}
  this.rotation=(this.rotation+this.base*this.wobble*dt)%TAU;
  const flying=this.flights.length>0;
  for(const flight of this.flights){flight.progress+=dt/.12;if(flight.progress<1)continue;
   const target=Math.PI/2-this.rotation,collision=this.pins.some(a=>angularDistance(a,target)<BOND_HIT);
   if(collision){this.flights=[];this.cb.sound('miss');this.end({score:this.score,bonds:this.bonds,round:this.stage,replay:this.replay()});return;}
   this.pins.push(target);this.bonds++;this.left--;this.score+=100;this.bump=1;this.clock=this.clockLimit;const g=this.geometry();this.burst(g.x,g.y+g.r);
   this.cb.hud(this.score,this.left,String(this.stage));this.cb.sound('bond');
   if(this.left===0){this.clearT=.45;this.burst(g.x,g.y,'#ffd24d',36);this.cb.sound('perfect');this.cb.effect?.('CHAIN COMPLETE!','bond');}else this.cb.effect?.('BONDED!','bond');}
  this.flights=this.flights.filter(f=>f.progress<1);
  // Shot clock, only while a vial waits at the launcher. A frame that carried a vial in flight does not
  // spend clock, so the time in the air is never counted against the next throw.
  if(!flying&&!this.ended&&this.clearT<=0&&this.left>0&&this.clockLive){this.clock-=dt;
   if(this.clock<=0){this.clock=0;this.cb.sound('miss');this.cb.message('Out of time.');this.cb.effect?.('OUT OF TIME','bond');this.end({score:this.score,bonds:this.bonds,round:this.stage,timeout:true,replay:this.replay()});}}}
 draw(){const c=this.ctx,g=this.geometry(),gy=g.y-this.bump*8;
  if(this.clearT<=0){ring(c,g.x,gy,g.r,this.rotation);c.save();const glow=c.createRadialGradient(g.x,gy,4,g.x,gy,50);glow.addColorStop(0,'#dcffff');glow.addColorStop(.4,'#00c9ff');glow.addColorStop(1,'#024fc7');c.fillStyle=glow;c.shadowColor='#03d9ff';c.shadowBlur=24;c.beginPath();c.arc(g.x,gy,47,0,TAU);c.fill();c.strokeStyle='#c1ffff';c.lineWidth=3;c.stroke();c.shadowBlur=0;
   for(let i=0;i<this.pins.length;i++){const a=this.pins[i]+this.rotation,px=g.x+Math.cos(a)*g.r,py=gy+Math.sin(a)*g.r;c.globalAlpha=i<this.fixed?.6:1;c.strokeStyle='#a1ecffb0';c.lineWidth=3;c.beginPath();c.moveTo(g.x+Math.cos(a)*48,gy+Math.sin(a)*48);c.lineTo(px,py);c.stroke();drawSprite(c,vialSprites[i%4],px,py,24,42,a-Math.PI/2);c.globalAlpha=1;}c.restore();}
  else{c.save();c.globalAlpha=Math.min(1,this.clearT*3);c.textAlign='center';c.fillStyle='#ffe77a';c.shadowColor='#ff9d2e';c.shadowBlur=16;c.font='900 30px Inter, sans-serif';c.fillText('CHAIN COMPLETE',g.x,g.y);c.restore();}
  c.save();c.shadowColor='#8fffff';c.shadowBlur=18;if(!this.flights.length&&this.left>0&&this.clearT<=0){drawSprite(c,vialSprites[this.pins.length%4],g.x,g.launch,45,78);
   // The shot clock as a draining ring round the waiting vial, cyan until the last second, then warm.
   if(this.clockLive&&!this.ended){const left=clamp(this.clock/this.clockLimit,0,1),urgent=this.clock<=1;c.shadowBlur=0;
    c.strokeStyle='#ffffff26';c.lineWidth=3;c.beginPath();c.arc(g.x,g.launch,38,0,TAU);c.stroke();
    c.strokeStyle=urgent?'#ff8d6b':'#8fffff';c.lineWidth=4;c.beginPath();c.arc(g.x,g.launch,38,-Math.PI/2,-Math.PI/2+TAU*left);c.stroke();c.shadowBlur=18;}}
  for(const flight of this.flights){const y=g.launch-(g.launch-gy-g.r)*Math.min(1,flight.progress);drawSprite(c,flight.sprite,g.x,y,45,78);}c.restore();
  // Shots left: a big number on the left with one vial per shot underneath, like the Tryout Arcade.
  const total=Math.min(bondVials(this.index),14),lx=38,top=g.y-g.r*.55,room=this.h-this.bottom-40-(top+48),gap=Math.min(30,room/total);
  c.save();c.textAlign='center';c.textBaseline='middle';c.fillStyle='#ffffff';c.shadowColor='#00c9ff';c.shadowBlur=14;c.font='900 36px Inter, sans-serif';c.fillText(String(this.left),lx,top);
  c.shadowBlur=0;c.font='800 11px Inter, sans-serif';c.fillStyle='#bfefff';c.fillText('SHOTS',lx,top+26);c.restore();
  for(let i=0;i<total;i++){c.save();c.globalAlpha=i<this.left?1:.22;drawSprite(c,vialSprites[i%4],lx,top+56+i*gap,Math.min(18,gap*.62),Math.min(30,gap*.95));c.restore();}
  // Shot clock bar above the launcher.
  const bw=Math.min(240,g.r*1.6),bx=g.x-bw/2,by=g.launch-62,limit=this.clockLimit,frac=!this.clockLive?1:clamp(this.clock/limit,0,1),low=this.clockLive&&this.clock<1.2;
  c.save();c.fillStyle='#03183dcc';rounded(c,bx,by,bw,10,5);c.fill();c.fillStyle=low?'#ff6b8a':'#5ff3ff';c.shadowColor=c.fillStyle;c.shadowBlur=low?14:8;if(frac>0){rounded(c,bx,by,bw*frac,10,5);c.fill();}
  c.shadowBlur=0;c.fillStyle='#e8fbff';c.font='800 12px Inter, sans-serif';c.textAlign='center';c.textBaseline='bottom';c.fillText(!this.clockLive?'TIMER STARTS ON YOUR FIRST SHOT':`${Math.max(0,this.clock).toFixed(1)}s`,g.x,by-4);c.restore();}
 finish(){this.end({score:this.score,bonds:this.bonds,round:this.stage,replay:this.replay()});}
}

export class SequenceEngine extends MiniEngine{
 constructor(canvas,cb,options){
  super(canvas,cb,options);
  // Every draw (the opening board, each refill, any reshuffle) comes from the seeded generator, in that order,
  // so the seed plus the logged swaps rebuild the run exactly.
  const asked=options?.rulesVersion;this.rulesVersion=asked===1?1:asked===2?2:asked===3?3:SEQUENCE_LATEST_VERSION;const v3=this.rulesVersion>=3;
  this.config=v3?v3Level(this.level,this.rulesVersion):sequenceLevel(this.level);this.progress=v3?createV3Progress(this.config):createSequenceProgress(this.config);this.palette=v3?this.config.palette:sequencePalette(this.level);
  this.board=this.rulesVersion===1?createSequenceBoard(this.level,this.random):v3?createV3Board(this.config,this.random,this.progress):createProgressionBoard(this.config,this.random,this.progress);
  // v4 only: two uses of each tool per run. Neither costs a move — a tool is the way out of a board that
  // has stopped giving, and charging a move for one would make reaching for it feel like a punishment.
  this.tools=this.rulesVersion>=SEQUENCE_V4_VERSION?{...SEQUENCE_TOOLS}:null;this.stuck=false;this.hammerArmed=false;
  this.inputs=[];this.movesTotal=v3?this.config.moves:SEQUENCE_MOVES;this.moves=this.movesTotal;this.target=this.rulesVersion===1?sequenceTarget(this.level):this.config.target;this.selection=null;this.cursor=24;this.keyboard=false;this.chain=0;this.pending=0;this.phase=null;this.swap=null;this.falls=new Map();this.pointerStart=null;this.clearing=null;this.creating=null;this.fallDur=0;this.popups=[];this.cracks=[];this.banner=null;this.shake=0;this.idle=0;this.hintPair=null;
  // v3 only: what the current cascade is still owed. `again` is the wrapped crystals due a second blast,
  // `bonus` counts the end-of-level striped crystals still to fire, `blasts` are the effects being drawn.
  this.trigger=null;this.again=[];this.blasts=[];this.bonus=null;this.bonusDone=false;this.lastCombo=null;this.warned=false;
  this.pointerId=null;
  const owns=e=>this.pointerId!==null&&(e.pointerId===undefined||e.pointerId===this.pointerId);
  this.cancelPointer=()=>{const id=this.pointerId;this.pointerId=null;this.pointerStart=null;this.pressed=null;try{if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);}catch{}};
  this.onpointerdown=e=>{if(this.paused||this.ended||this.pending||this.pointerId!==null||e.isPrimary===false||(e.button!==undefined&&e.button!==0))return;this.pointerId=e.pointerId??1;this.keyboard=false;this.idle=0;this.hintPair=null;this.pointerStart=this.pointer(e);this.pressed=this.cellAt(...this.pointerStart);canvas.setPointerCapture?.(e.pointerId);};
  // The first finger owns the gesture until release, cancellation or loss of capture.
  const swapFromGesture=(start,dx,dy)=>{const horizontal=Math.abs(dx)>Math.abs(dy),to=start+(horizontal?(dx>0?1:-1):(dy>0?7:-7));if(to>=0&&to<49&&(!horizontal||Math.floor(to/7)===Math.floor(start/7)))this.choose(start,to);};
  this.onpointermove=e=>{if(!owns(e)||!this.pointerStart||this.pending)return;const [x,y]=this.pointer(e),dx=x-this.pointerStart[0],dy=y-this.pointerStart[1];if(Math.hypot(dx,dy)<this.geometry().cell*.3)return;const start=this.cellAt(...this.pointerStart);this.pointerStart=null;this.pressed=null;if(start!==null)swapFromGesture(start,dx,dy);};
  this.onpointerup=e=>{if(!owns(e))return;const origin=this.pointerStart,[x,y]=this.pointer(e);this.cancelPointer();if(!origin)return;const start=this.cellAt(...origin),dx=x-origin[0],dy=y-origin[1];if(start===null)return;if(Math.hypot(dx,dy)*this.scale<10)this.choose(start);else swapFromGesture(start,dx,dy);};
  this.onpointercancel=(e={})=>{if(owns(e))this.cancelPointer();};this.onlostpointercapture=this.onpointercancel;this.onblur=()=>this.cancelPointer();window.addEventListener?.('blur',this.onblur);
  for(const name of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,this['on'+name]);cb.hud(0,this.moves,this.target);cb.message(this.rulesVersion===1?`Match three or more. Reach ${this.target} points in ${this.moves} moves.`:this.rulesVersion>=3?v3Brief(this.level,this.rulesVersion):sequenceBrief(this.level));this.reportGoals();
 }
 geometry(){
  let top=this.top+(this.rulesVersion>=2?38/this.scale:0),bottom=this.bottom+(this.rulesVersion>=2?36/this.scale:0);
  try{const r=this.canvas.getBoundingClientRect(),goals=document.querySelector('#sequence-goals'),guide=document.querySelector('.sequence-guide');if(goals&&!goals.hidden)top=(goals.getBoundingClientRect().bottom-r.top+14)/this.scale;if(guide)bottom=(r.bottom-guide.getBoundingClientRect().top+14)/this.scale;}catch{}
  // boardFit lives with the rules so the sizing can be checked without a browser.
  const fit=boardFit({width:this.w,height:this.h,top,bottom}),size=fit.size,cell=size/7;
  return{x:(this.w-size)/2,y:top+Math.max(0,fit.slack/2),size,cell,slack:fit.slack,limitedBy:fit.limitedBy};
 }

 complete(){return this.rulesVersion===1?this.score>=this.target:this.rulesVersion>=3?v3Complete(this.score,{...this.config,target:this.target},this.progress):sequenceComplete(this.score,{...this.config,target:this.target},this.progress);}
 reportGoals(){const goals=this.rulesVersion===1?[]:this.rulesVersion>=3?v3AllGoals({...this.config,target:this.target},this.progress,this.score):sequenceGoals(this.config,this.progress);this.cb.goals?.({version:this.rulesVersion,level:this.level,target:this.target,moves:this.moves,goals});}
 cellAt(x,y){const g=this.geometry();if(x<g.x||x>=g.x+g.size||y<g.y||y>=g.y+g.size)return null;return Math.floor((y-g.y)/g.cell)*7+Math.floor((x-g.x)/g.cell);}
 choose(index,swapWith=null){
  if(this.paused||this.ended||this.pending||!Number.isInteger(index)||index<0||index>=49)return;
  // An armed hammer takes the next tap, wherever it lands. A tap it cannot break puts the hammer away
  // without spending it, the way a Peak Blocks bomb dropped on empty squares is not spent.
  if(this.hammerArmed){
   this.hammerArmed=false;
   if(this.useHammer(index))return;
   this.reportTools();this.cb.sound("invalid");
   this.cb.message(this.progress?.locks?.[index]?"That crystal is trapped. Free it with a match beside its padlock. No use spent.":"Nothing to break there. No use spent.");
   return;
  }
  if(this.rulesVersion>=2&&(this.progress.locks[index]||(swapWith!==null&&this.progress.locks[swapWith]))){this.selection=null;this.cb.sound('invalid');this.cb.message('This crystal is locked. Make a match beside its padlock to open it. No move used.');this.cb.effect?.('MATCH BESIDE THE LOCK','sequence');return;}if(swapWith!==null)this.selection=index;
  if(this.selection===null){this.selection=index;this.cursor=index;this.cb.sound('select');this.cb.message(`Row ${Math.floor(index/7)+1}, column ${index%7+1} selected. Choose a neighbour.`);return;}
  if(this.selection===index&&swapWith===null){this.selection=null;return;}
  const from=this.selection,to=swapWith??index,v3=this.rulesVersion>=3;
  // In v3 a swap of two specials, or any swap involving a colour bomb, is a move even though it makes no
  // line. Validity is a pure function of the board and the pair, so a replay accepts exactly the same swaps.
  const trigger=v3?v3SwapKind(this.board,from,to,this.progress):null;
  const next=v3?(trigger?trigger.next:v3Exchange(this.board,from,to,this.progress)):this.rulesVersion===1?sequenceExchange(this.board,from,to):progressionExchange(this.board,from,to,this.progress);
  if(!next){const d=Math.abs(Math.floor(to/7)-Math.floor(from/7))+Math.abs(to%7-from%7);if(d!==1){this.selection=to;this.cursor=to;}this.cb.sound('invalid');this.cb.message(v3?'Swap neighbours to make a line of three, or swap two specials together.':'Swap neighbours to make a line of three.');return;}
  this.inputs.push([this.ticks,from,to]);
  const matched=v3?trigger!==null:sequenceMatches(next).size>0;this.idle=0;this.hintPair=null;this.selection=null;this.cursor=to;if(matched)this.moves--;this.chain=0;this.trigger=v3?trigger:null;this.again=[];
  // The warning is about running out of moves, so it does not care whether the score goal is already met.
  if(this.moves===5&&!this.complete()&&!this.warned){this.warned=true;this.cb.effect?.('5 MOVES LEFT','sequence');}
  this.swap={from,to,next,original:this.board,matched};this.phase='swap';this.pending=SEQ_SWAP;this.cb.hud(this.score,this.moves,this.target);this.cb.sound('drop');this.cb.message('');
 }
 // Matched crystals now shrink out over 0.18 s with a "+points" popup, and cascades announce "Chain ×n".
 resolveMatches(){const matches=sequenceMatches(this.board);if(!matches.size){this.finishMove();return;}const g=this.geometry();let sx=0,sy=0;
  for(const i of matches){this.burst(g.x+(i%7+.5)*g.cell,g.y+(Math.floor(i/7)+.5)*g.cell,colors[this.board[i]],6);sx+=i%7;sy+=Math.floor(i/7);}
  const gained=matches.size*50*(1+this.chain);this.score+=gained;this.chain++;this.clearing=matches;if(this.rulesVersion===2){const was=this.progress;this.progress=applySequenceWave(this.config,this.progress,this.board,matches);this.noteBreaks(was,this.progress);this.reportGoals();}
  this.popups.push({text:`+${gained}`,x:g.x+(sx/matches.size+.5)*g.cell,y:g.y+(sy/matches.size+.5)*g.cell,t:0});
  if(this.chain>1){const n=this.chain,word=n>=5?'Amazing!':n>=4?'Great!':n>=3?'Nice!':'';this.banner={text:word?`Chain ×${n} ${word}`:`Chain ×${n}`,t:0};if(n>=4){this.cb.effect?.(n>=5?'AMAZING CHAIN!':'GREAT CHAIN!','sequence');if(this.motion)this.shake=1;}}if(matches.size>=8&&this.motion)this.shake=1;
  this.cb.sound(this.chain>1?'perfect':'crystal');this.cb.hud(this.score,this.moves,this.target);this.phase='clear';this.pending=SEQ_CLEAR;}
 // ---- v4 helper tools ----
 // A tool is refused in exactly the places a swap is: mid-animation, paused, over, or during the
 // end-of-level bonus. Refusing rather than queueing is what keeps a replay honest: the server runs the
 // same check on the same tick and rejects a log that spends a tool it could not have spent.
 canUseTool(name){
  return Boolean(this.tools&&this.tools[name]>0&&this.alive&&!this.paused&&!this.ended&&!this.pending&&!this.bonus);
 }
 toolState(){return {...this.tools,stuck:this.stuck,armed:this.hammerArmed};}
 // The hammer waits for a target: the next tap on the board breaks that crystal instead of selecting it.
 // Arming is not a rule and is never logged; only the break itself goes in the replay.
 armHammer(on=true){
  if(!on){this.hammerArmed=false;this.reportTools();this.cb.message("Hammer put away. No use spent.");return true;}
  if(!this.canUseTool("hammer"))return false;
  this.hammerArmed=true;this.selection=null;this.reportTools();
  this.cb.message("Hammer ready. Tap the crystal to break, or tap Hammer again to put it away.");
  return true;
 }
 reportTools(){if(this.tools)this.cb.tools?.(this.toolState());}
 // Shuffle: re-mix the board from the same seeded generator the free reshuffle uses, which is guaranteed
 // to leave a valid move. The draw happens at a point the log pins down, so a replay re-mixes identically.
 useShuffle(){
  if(!this.canUseTool('shuffle'))return false;
  this.tools.shuffle--;this.inputs.push([this.ticks,SEQ_LOG.shuffle,-1]);
  this.board=createV3Board(this.config,this.random,this.progress,this.board);
  this.selection=null;this.idle=0;this.hintPair=null;this.stuck=false;
  this.cb.sound('shuffle');this.cb.effect?.('BOARD RE-MIXED','sequence');
  this.cb.message('Fresh crystals. No move used.');this.reportTools();
  return true;
 }
 // Hammer: break one crystal. It goes through the same wave a match does, so it scores, it sets off a
 // special it lands on, and it counts toward ice, traps and collection exactly as a cleared crystal would.
 useHammer(index){
  if(!this.canUseTool('hammer'))return false;
  if(!Number.isInteger(index)||index<0||index>=49)return false;
  // An empty cell has nothing to break, and a trapped crystal is freed by a match beside its padlock.
  if(this.board[index]<0)return false;
  if(this.progress?.locks?.[index])return false;
  this.tools.hammer--;this.inputs.push([this.ticks,SEQ_LOG.hammer,index]);
  this.selection=null;this.idle=0;this.hintPair=null;this.stuck=false;this.chain=0;this.again=[];
  this.trigger={type:'fire',cells:[index]};
  this.cb.sound('tool');this.reportTools();
  this.resolveV3();
  return true;
 }
 // Any swap that makes a line, for the idle hint.
 // One v3 wave: the blast goes off, the specials it earns are minted, the objectives take their hit, and
 // anything still owed (a wrapped crystal's second explosion) is held for after the board settles.
 resolveV3(){
  const plan=planV3Wave(this.board,this.config,this.progress,{trigger:this.trigger,again:this.again,wave:this.chain+1,create:!this.bonus});
  this.trigger=null;
  if(!plan.clear.size&&!plan.create.size){this.again=[];this.finishMove();return;}
  const g=this.geometry(),cellAt=i=>[g.x+(i%7+.5)*g.cell,g.y+(Math.floor(i/7)+.5)*g.cell];
  for(const i of plan.clear){const [x,y]=cellAt(i),colour=colourOf(this.board[i]);this.burst(x,y,colors[colour<0||colour>6?6:colour],5);}
  this.score+=plan.gained;this.chain++;this.clearing=plan.clear;this.creating=plan.create;this.again=plan.againAt;
  const wasV3=this.progress;this.progress=applyV3Wave(this.config,this.progress,this.board,plan.clear);this.noteBreaks(wasV3,this.progress);this.reportGoals();
  // Points popup over the middle of whatever went off.
  const spots=plan.clear.size?[...plan.clear]:[...plan.create.keys()];
  let sx=0,sy=0;for(const i of spots){sx+=i%7;sy+=Math.floor(i/7);}
  this.popups.push({text:`+${plan.gained}`,x:g.x+(sx/spots.length+.5)*g.cell,y:g.y+(sy/spots.length+.5)*g.cell,t:0});
  // Firing effects: a beam for a stripe, a shockwave for a wrapped crystal, a colour pulse for a bomb,
  // plus a flash on every special that was just made.
  this.blasts=[...plan.effects.map(e=>({...e,t:0})),...[...plan.create.keys()].map(at=>({type:'make',at,t:0}))];
  const label=COMBO_LABELS[plan.combo];
  if(label){this.banner={text:label,t:0};this.cb.effect?.(label,'sequence');}
  else if(this.chain>1){const n=this.chain,word=n>=5?'Amazing!':n>=4?'Great!':n>=3?'Nice!':'';this.banner={text:word?`Chain ×${n} ${word}`:`Chain ×${n}`,t:0};if(n>=4)this.cb.effect?.(n>=5?'AMAZING CHAIN!':'GREAT CHAIN!','sequence');}
  else if(plan.made.bomb)this.cb.effect?.('COLOUR BOMB!','sequence');
  else if(plan.made.wrap)this.cb.effect?.('WRAPPED!','sequence');
  // The cascade climbs two semitones a wave, and the buzz is forced through so a fast chain is still felt.
  const depth=Math.min(7,this.chain-1),hap=this.chain>=5||label?'combo3':this.chain>=3?'combo2':this.chain>1?'perfect':'crystal';
  this.cb.haptic?.(hap,true);
  this.cb.sound(this.chain>1||label?'perfect':'crystal',{rate:Math.pow(2,depth*2/12)});
  if(this.motion)this.shake=Math.min(1.8,(plan.clear.size+(label?14:0))/10);
  this.cb.hud(this.score,this.moves,this.target);this.phase='clear';this.pending=SEQ_CLEAR*(this.bonus?SEQ_BONUS_RATE:1);
 }
 // The end-of-level bonus. Every move the player did not need fires a striped crystal, in the order this
 // run's own generator picks, and then anything still special on the board goes off. It is drawn from the
 // seeded generator at a fixed point in the run, so a replay reproduces every point of it.
 startBonus(){
  if(this.rulesVersion<3||this.bonusDone||!this.complete())return false;
  if(!this.bonus){
   if(this.moves<=0&&!v3RemainingSpecials(this.board).length){this.bonusDone=true;return false;}
   this.bonus={left:Math.max(0,this.moves),sweeps:0};this.banner={text:'BONUS!',t:0};this.cb.effect?.('BONUS!','sequence');this.cb.message('Bonus! Every move you did not need fires a striped crystal.');
  }
  if(this.bonus.left>0){
   this.bonus.left--;
   const pick=v3BonusPick(this.board,this.progress,this.random);
   if(pick){this.board=this.board.slice();this.board[pick.at]=pick.cell;this.chain=0;this.trigger={type:'fire',cells:[pick.at]};this.resolveV3();return true;}
   this.bonus.left=0;
  }
  const specials=v3RemainingSpecials(this.board);
  if(specials.length&&this.bonus.sweeps<12){this.bonus.sweeps++;this.chain=0;this.trigger={type:'fire',cells:specials};this.resolveV3();return true;}
  this.bonusDone=true;this.bonus=null;return false;
 }
 findMove(){if(this.rulesVersion>=3)return v3Move(this.board,this.progress);if(this.rulesVersion===2)return progressionMove(this.board,this.progress);for(let i=0;i<49;i++)for(const to of [i%7<6?i+1:-1,i+7]){if(to<0||to>48)continue;const next=sequenceExchange(this.board,i,to);if(next&&sequenceMatches(next).size)return [i,to];}return null;}
 finishMove(){
  this.phase=null;this.pending=0;this.falls.clear();this.idle=0;this.hintPair=null;this.blasts=[];this.stuck=false;this.reportTools();this.cb.hud(this.score,this.moves,this.target);
  if(this.startBonus())return;
  if(this.complete()||this.moves<=0){this.finish();return;}
  if(!this.findMove()){
   const held=this.tools&&(this.tools.shuffle>0||this.tools.hammer>0);
   if(held){this.stuck=true;this.reportTools();this.cb.message('No moves? Use a tool.');this.cb.effect?.('NO MOVES? USE A TOOL','sequence');return;}
   this.board=this.rulesVersion===1?createSequenceBoard(this.level,this.random):this.rulesVersion>=3?createV3Board(this.config,this.random,this.progress,this.board):createProgressionBoard(this.config,this.random,this.progress,this.board);this.cb.message('Fresh crystals. No move used.');}else{const remaining=this.rulesVersion===1?[]:(this.rulesVersion>=3?v3Goals(this.config,this.progress):sequenceGoals(this.config,this.progress)).filter(g=>g.left).map(g=>`${g.left} ${g.label.toLowerCase()}`);this.cb.message(`${this.moves} moves left. ${this.score<this.target?`${Math.max(0,this.target-this.score)} points to go.`:'Score goal reached.'}${remaining.length?' Still needed: '+remaining.join(', ')+'.':''}`);}
 }
 tickEffects(dt){for(const p of this.popups)p.t+=dt;this.popups=this.popups.filter(p=>p.t<.9);if(this.banner&&(this.banner.t+=dt)>1.1)this.banner=null;this.shake=Math.max(0,this.shake-dt*4);
  for(const b of this.blasts)b.t+=dt;this.blasts=this.blasts.filter(b=>b.t<.45);
  for(const k of this.cracks)k.t+=dt;this.cracks=this.cracks.filter(k=>k.t<SEQ_CRACK);
  if(!this.pending&&!this.ended&&!this.paused&&!this.hintPair&&(this.idle+=dt)>SEQ_HINT_AFTER)this.hintPair=this.findMove();}
 update(dt){
  this.tickEffects(dt);if(this.pending<=0)return;this.pending-=dt;if(this.pending>0)return;
  if(this.phase==='swap'){this.board=this.swap.next;if(!this.swap.matched){this.phase='return';this.pending=SEQ_SWAP;return;}this.swap=null;if(this.rulesVersion>=3){this.resolveV3();return;}this.resolveMatches();return;}
  if(this.phase==='return'){this.board=this.swap.original;this.swap=null;this.phase=null;this.pending=0;this.cb.sound('undo');this.cb.message('Try another pair. No move used.');return;}
  if(this.phase==='clear'&&this.rulesVersion>=3){
   const gone=this.clearing,held=this.board.map((v,i)=>gone.has(i)?-1:v);
   for(const [at,cell] of this.creating??[])held[at]=cell;
   const settled=settleV3(held,this.random,this.palette,this.progress);
   this.board=settled.board;this.falls=settled.falls;this.clearing=null;this.creating=null;this.phase='fall';
   this.fallDur=Math.max(.12,...[...this.falls.values()].map(d=>fallTime(d)))*(this.bonus?SEQ_BONUS_RATE:1);this.pending=this.fallDur;return;}
  if(this.phase==='clear'&&this.rulesVersion===2){const gone=this.clearing,cleared=this.board.map((v,i)=>gone.has(i)?-1:v),settled=settleProgression(cleared,this.random,this.palette,this.progress);this.board=settled.board;this.falls=settled.falls;this.clearing=null;this.phase='fall';this.fallDur=Math.max(.12,...[...this.falls.values()].map(d=>fallTime(d)));this.pending=this.fallDur;return;}
  if(this.phase==='clear'){const gone=this.clearing;this.board=this.board.map((v,i)=>gone.has(i)?-1:v);this.clearing=null;this.falls.clear();for(let col=0;col<7;col++){let write=6;for(let row=6;row>=0;row--)if(this.board[row*7+col]>=0){this.falls.set(write*7+col,row-write);write--;}for(let row=write;row>=0;row--)this.falls.set(row*7+col,-write-1);}this.board=settleSequence(this.board,this.random,7,this.palette);this.phase='fall';
   // Crystals fall like they have weight: each one accelerates and takes longer the further it drops.
   this.fallDur=Math.max(.12,...[...this.falls.values()].map(d=>fallTime(d)));this.pending=this.fallDur;return;}
  if(this.phase==='fall'){this.falls.clear();if(this.rulesVersion>=3){this.resolveV3();return;}if(this.complete())this.finishMove();else this.resolveMatches();}
 }
 moveSelection(key){this.keyboard=true;let r=Math.floor(this.cursor/7),c=this.cursor%7;if(key==='ArrowUp')r=(r+6)%7;if(key==='ArrowDown')r=(r+1)%7;if(key==='ArrowLeft')c=(c+6)%7;if(key==='ArrowRight')c=(c+1)%7;this.cursor=r*7+c;if(this.selection!==null)this.choose(this.cursor);else this.cb.message(`Row ${r+1}, column ${c+1}. Press Enter to select.`);}
 action(){if(this.paused||this.ended||this.pending)return;this.keyboard=true;this.choose(this.cursor);}
 draw(){
  const c=this.ctx,g=this.geometry();c.save();if(this.shake)c.translate(Math.sin(this.time*90)*this.shake*4,Math.cos(this.time*70)*this.shake*3);c.fillStyle='#03183de8';rounded(c,g.x-5,g.y-5,g.size+10,g.size+10,16);c.fill();c.strokeStyle='#8cefff77';c.lineWidth=2;c.stroke();c.save();rounded(c,g.x,g.y,g.size,g.size,12);c.clip();
  for(let i=0;i<this.board.length;i++){const row=Math.floor(i/7),col=i%7,v=this.board[i];let x=g.x+(col+.5)*g.cell,y=g.y+(row+.5)*g.cell;c.fillStyle='#123965a0';rounded(c,g.x+col*g.cell+2,g.y+row*g.cell+2,g.cell-4,g.cell-4,9);c.fill();if(v<0)continue;
   if((this.phase==='swap'||this.phase==='return')&&(i===this.swap.from||i===this.swap.to)){const to=i===this.swap.from?this.swap.to:this.swap.from,t=1-clamp(this.pending/SEQ_SWAP,0,1);x+=((to%7)-col)*g.cell*t;y+=(Math.floor(to/7)-row)*g.cell*t;}
   if(this.phase==='fall'){const d=this.falls.get(i)||0;if(d){const k=clamp((this.fallDur-this.pending)/fallTime(d),0,1);y+=d*g.cell*(1-k*k);}}
   let size=g.cell*.86;const held=this.pressed===i||(this.phase==='swap'&&this.swap&&i===this.swap.from);if(held){size*=1.1;c.save();c.shadowColor='#ffe77a';c.shadowBlur=18;c.fillStyle='#ffe77a33';rounded(c,g.x+col*g.cell+2,g.y+row*g.cell+2,g.cell-4,g.cell-4,9);c.fill();c.restore();}
   if(this.clearing?.has(i)){const p=1-clamp(this.pending/SEQ_CLEAR,0,1),s=1-p*p;size*=s;c.globalAlpha=s;}
   const kind=this.rulesVersion>=3?kindOf(v):PLAIN,colour=this.rulesVersion>=3?colourOf(v):v;
   if(!drawSequenceCrystal(c,kind,colour,x,y,size))this.drawSpecial(kind,colour,x,y,size);
   c.globalAlpha=1;if(this.rulesVersion>=2)this.drawObstacle(i,g);
   if(this.selection===i||(this.keyboard&&this.cursor===i)){c.strokeStyle=this.selection===i?'#ffe77a':'#e6ffff';c.lineWidth=3;rounded(c,g.x+col*g.cell+3,g.y+row*g.cell+3,g.cell-6,g.cell-6,9);c.stroke();}
  }
  if(this.rulesVersion>=3&&this.blasts.length)this.drawBlasts(g);
  // Idle hint: after a few seconds without a move, one swap that works pulses gently.
  if(this.hintPair&&!this.pending){const a=.45+.35*Math.sin(this.time*5);c.strokeStyle=`rgba(255,231,122,${a})`;c.lineWidth=3;for(const i of this.hintPair)rounded(c,g.x+i%7*g.cell+3,g.y+Math.floor(i/7)*g.cell+3,g.cell-6,g.cell-6,9),c.stroke();}
  c.restore();
  c.textAlign='center';c.textBaseline='middle';
  for(const p of this.popups){c.globalAlpha=Math.max(0,1-p.t/.9);c.fillStyle='#ffffff';c.shadowColor='#00c9ff';c.shadowBlur=10;c.font=`800 ${Math.round(g.cell*.36)}px Inter, sans-serif`;c.fillText(p.text,p.x,p.y-p.t*g.cell*.7);}
  if(this.banner){const t=this.banner.t,a=Math.min(1,t*6,(1.1-t)*3);c.globalAlpha=Math.max(0,a);c.fillStyle='#ffe77a';c.shadowColor='#ff9d2e';c.shadowBlur=16;c.font=`900 ${Math.round(g.cell*.5)}px Inter, sans-serif`;c.fillText(this.banner.text.toUpperCase(),g.x+g.size/2,g.y+g.size/2-(1-Math.min(1,t*5))*12);}
  c.globalAlpha=1;c.shadowBlur=0;c.restore();
 }
 // Each special reads at a glance: stripes run the way the blast will travel, a wrapped crystal wears a
 // double box, and a colour bomb is a white crystal inside a spinning ring.
 drawSpecial(kind,colour,x,y,size){
  const c=this.ctx,half=size/2,tint=colors[colour<0||colour>6?6:colour];c.save();
  if(kind===STRIPE_V||kind===STRIPE_H){
   c.globalAlpha=.9;c.strokeStyle='#f4ffff';c.lineWidth=Math.max(2,size*.085);c.shadowColor=tint;c.shadowBlur=10;
   for(const off of [-.22,.22]){c.beginPath();
    if(kind===STRIPE_V){c.moveTo(x+off*size,y-half*.62);c.lineTo(x+off*size,y+half*.62);}
    else{c.moveTo(x-half*.62,y+off*size);c.lineTo(x+half*.62,y+off*size);}
    c.stroke();}
  }else if(kind===WRAP){
   const pulse=.5+.5*Math.sin(this.time*6);c.globalAlpha=.55+.35*pulse;c.strokeStyle='#fff6c8';c.shadowColor=tint;c.shadowBlur=14;
   c.lineWidth=Math.max(2,size*.08);rounded(c,x-half*.78,y-half*.78,size*.78,size*.78,6);c.stroke();
   c.lineWidth=Math.max(1.5,size*.05);rounded(c,x-half*.5,y-half*.5,size*.5,size*.5,4);c.stroke();
  }else if(kind===BOMB){
   c.globalAlpha=.95;c.lineWidth=Math.max(2,size*.09);c.shadowColor='#ffffff';c.shadowBlur=16;
   for(let k=0;k<6;k++){c.strokeStyle=colors[k];c.beginPath();c.arc(x,y,half*.66,this.time*2+k*TAU/6,this.time*2+(k+.8)*TAU/6);c.stroke();}
   c.globalAlpha=1;c.fillStyle='#06203f';c.beginPath();c.arc(x,y,half*.3,0,TAU);c.fill();
  }
  c.restore();
 }
 // A beam for a stripe, a shockwave for a wrapped crystal, a colour sweep for a bomb, a flash for a
 // special being made. Decorative only: none of it touches the simulation.
 drawBlasts(g){
  const c=this.ctx;c.save();
  for(const b of this.blasts){
   const t=Math.min(1,b.t/.45),fade=1-t,x=g.x+(b.at%7+.5)*g.cell,y=g.y+(Math.floor(b.at/7)+.5)*g.cell;
   c.globalAlpha=fade;
   if(b.type==='beam'){
    c.fillStyle='#f2ffff';c.shadowColor='#5ff3ff';c.shadowBlur=22;
    const reach=t*g.size;
    if(b.axis==='h')c.fillRect(x-reach,y-g.cell*.16,reach*2,g.cell*.32);
    else c.fillRect(x-g.cell*.16,y-reach,g.cell*.32,reach*2);
   }else if(b.type==='shock'){
    c.strokeStyle='#fff6c8';c.lineWidth=5*fade+1;c.shadowColor='#ff9d2e';c.shadowBlur=18;
    c.beginPath();c.arc(x,y,g.cell*(b.radius+.4)*t,0,TAU);c.stroke();
   }else if(b.type==='pulse'){
    c.strokeStyle=colors[b.colour<0||b.colour>6?6:b.colour];c.lineWidth=6*fade+1;c.shadowColor=c.strokeStyle;c.shadowBlur=20;
    c.beginPath();c.arc(x,y,g.size*.75*t,0,TAU);c.stroke();
   }else if(b.type==='cross'){
    c.fillStyle='#f2ffff';c.shadowColor='#5ff3ff';c.shadowBlur=22;const w=g.cell*.32*b.width;
    c.fillRect(g.x,y-w/2,g.size*t,w);c.fillRect(x-w/2,g.y,w,g.size*t);
   }else if(b.type==='whiteout'){
    c.globalAlpha=fade*.8;c.fillStyle='#ffffff';c.fillRect(g.x,g.y,g.size,g.size);
   }else if(b.type==='make'){
    c.globalAlpha=fade;c.strokeStyle='#ffffff';c.lineWidth=4*fade+1;c.shadowColor='#ffe77a';c.shadowBlur=18;
    c.beginPath();c.arc(x,y,g.cell*(.3+t*.7),0,TAU);c.stroke();
   }
  }
  c.restore();
 }
 // Ice and traps have to read from arm's length, so each one covers its crystal rather than sitting
 // beside it: ice is a frosted pane carrying the number of hits it still needs, a trap is a barred
 // cage with a padlock. A layer breaking throws a short burst of cracks so the hit is visible.
 drawObstacle(i,g){
  const c=this.ctx,x=g.x+(i%7)*g.cell+3,y=g.y+Math.floor(i/7)*g.cell+3,w=g.cell-6;
  const ice=this.progress.ice[i],locked=this.progress.locks[i],crack=this.cracks?.find(k=>k.i===i);
  if(!ice&&!locked&&!crack)return;
  c.save();
  if(ice){
   c.fillStyle='#bdeeff4a';rounded(c,x,y,w,w,7);c.fill();
   c.save();rounded(c,x,y,w,w,7);c.clip();
   c.strokeStyle='#ffffff5c';c.lineWidth=Math.max(1,w*.05);c.beginPath();
   for(const [ax,ay,bx,by] of [[.06,.34,.44,.0],[.58,.0,.98,.42],[.0,.7,.36,1],[.6,1,1,.62]]){c.moveTo(x+w*ax,y+w*ay);c.lineTo(x+w*bx,y+w*by);}
   c.stroke();c.restore();
   c.strokeStyle='#eafdff';c.lineWidth=Math.max(2,w*.055);rounded(c,x+1,y+1,w-2,w-2,6);c.stroke();
   const size=Math.round(w*.54);
   c.font=`900 ${size}px Inter, sans-serif`;c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';
   c.lineWidth=Math.max(3,size*.26);c.strokeStyle='#05304f';c.strokeText(String(ice),x+w/2,y+w/2+size*.04);
   c.fillStyle='#ffffff';c.fillText(String(ice),x+w/2,y+w/2+size*.04);
  }
  if(locked){
   c.fillStyle='#071f3678';rounded(c,x,y,w,w,7);c.fill();
   c.strokeStyle='#ffc748';c.lineCap='round';c.lineWidth=Math.max(2,w*.075);
   rounded(c,x+1,y+1,w-2,w-2,6);c.stroke();
   c.beginPath();
   for(const f of [.3,.5,.7]){c.moveTo(x+w*f,y+w*.06);c.lineTo(x+w*f,y+w*.94);}
   c.moveTo(x+w*.06,y+w*.5);c.lineTo(x+w*.94,y+w*.5);
   c.stroke();
   const r=Math.max(6,w*.2),cx=x+w/2,cy=y+w*.56;
   c.strokeStyle='#ffdc86';c.lineWidth=Math.max(2,w*.055);
   c.beginPath();c.arc(cx,cy-r*.72,r*.5,Math.PI,TAU);c.stroke();
   c.fillStyle='#ffdc86';rounded(c,cx-r*.74,cy-r*.32,r*1.48,r*1.18,Math.max(2,r*.26));c.fill();
   c.fillStyle='#0d2238';c.beginPath();c.arc(cx,cy+r*.26,r*.18,0,TAU);c.fill();
  }
  if(crack){
   const p=Math.min(1,crack.t/SEQ_CRACK),grow=this.motion?p:.55;
   c.globalAlpha=Math.max(0,1-p);c.lineCap='round';
   c.strokeStyle=crack.kind==='free'?'#ffe6a1':'#f2feff';c.lineWidth=Math.max(2,w*.075)*(1-grow*.45);
   const cx=x+w/2,cy=y+w/2,reach=w*(.2+grow*.4);
   c.beginPath();
   for(let k=0;k<6;k++){const a=crack.a+k*Math.PI/3;c.moveTo(cx+Math.cos(a)*reach*.22,cy+Math.sin(a)*reach*.22);c.lineTo(cx+Math.cos(a)*reach,cy+Math.sin(a)*reach);}
   c.stroke();
  }
  c.restore();
 }
 // A broken ice layer or a freed crystal gets its own burst, so the player can see what their match did.
 noteBreaks(before,after){
  if(!before||!after)return;
  for(let i=0;i<after.ice.length;i++){
   if(after.ice[i]<before.ice[i])this.cracks.push({i,t:0,kind:'ice',a:(i%6)*.27});
   else if(before.locks[i]&&!after.locks[i])this.cracks.push({i,t:0,kind:'free',a:(i%6)*.27});
  }
 }

 finish(){this.end({score:this.score,moves:this.movesTotal-this.moves,movesTotal:this.movesTotal,won:this.complete(),target:this.target,objectives:this.rulesVersion===1?[]:this.rulesVersion>=3?v3Goals(this.config,this.progress):sequenceGoals(this.config,this.progress),replay:this.replay()});}
 replay(){return {v:this.rulesVersion,game:'sequence',seed:this.seed,level:this.level,step:SIM_STEP,moves:this.inputs.map(m=>[...m]),endTick:this.ticks};}
 // How many of each tool the run has spent, for the result screen.
 toolsUsed(){return this.tools?{shuffle:SEQUENCE_TOOLS.shuffle-this.tools.shuffle,hammer:SEQUENCE_TOOLS.hammer-this.tools.hammer}:null;}
}
