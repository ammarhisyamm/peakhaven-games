import {SEQUENCE_RULES_VERSION,sequenceLevel,createSequenceProgress,sequenceGoals,sequenceComplete,sequenceBrief,applySequenceWave,progressionExchange,progressionMove,settleProgression,createProgressionBoard} from './sequence-progression.js';
import {createSequenceBoard,sequenceMatches,sequenceExchange,settleSequence,sequenceTarget,sequencePalette,SEQUENCE_MOVES} from './sequence-rules.js';
import {drawSprite,drawBottleObstacle,crystalSprites,vialSprites} from './gameplay-art.js';
import {orbitVelocity,crossesHoop,ORBIT_GRAVITY} from './orbit-rules.js';
import {SIM_STEP,MAX_STEPS_PER_FRAME,makeSeed,createRandom} from './rng.js';

const TAU=Math.PI*2;
export const BOND_HIT=.17,BOND_KNEE=6,BOND_MAX_FIXED=5,BOND_FIXED_GAP=.55,BOND_CLOCK_MAX=4,BOND_CLOCK_MIN=2.5,BOND_CLOCK_FROM=5,BOND_CLOCK_TO=20;
const SEQ_SWAP=.16,SEQ_CLEAR=.18,SEQ_HINT_AFTER=5,fallTime=d=>.12+.05*Math.abs(d);
// Ridge Run constants, from the Tryout Arcade (world units; the world is 640 tall).
// Every number here is the Tryout Arcade's Flap Dash, in its fixed 360x640 world: ground H-70, a node of
// radius 13 at x 100, and gates whose openings are the box-era 150..118 less VIAL_SLACK, the room the
// vial-shaped collision below hands back. Shrinking the gap by exactly that keeps the vial a reskin
// rather than an easier game.
const RIDGE=Object.freeze({H:640,W:360,GROUND:570,FLOOR_PAD:6,CLOSE:7,GRAVITY:1450,FLAP:430,PW:62,SPACE:210,SPEED:165,SPEED_GAIN:65,
 SLACK:2.6,GAP:150,GAP_TO:118,GAP_START:10,GAP_END:50,JUMP:120,JUMP_TO:220,JUMP_END:40,EDGE:60,R:13,FIRST_X:450,
 // Moving vials and peptide orbs (additions on top of the Tryout Arcade course).
 MOVE_START:15,MOVE_FULL:45,MOVE_AMP:18,MOVE_AMP_TO:55,MOVE_SPEED:1.2,MOVE_SPEED_TO:2.2,
 ORB_START:3,ORB_CHANCE:.35,ORB_R:10,ORB_POINTS:2,ORB_OFFSET:30,ORB_OFFSET_TO:60});
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
export {RIDGE};
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
  this.canvas=canvas;this.ctx=canvas.getContext('2d');this.cb=cb;this.level=options.level||1;this.motion=options.motion!==false;this.time=0;this.last=0;this.acc=0;this.ticks=0;this.seed=(options.seed??makeSeed())>>>0;this.random=createRandom(this.seed);this.paused=false;this.ended=false;this.alive=true;this.score=0;this.particles=[];this.shockwaves=[];
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
 constructor(canvas,cb,options){super(canvas,cb,options);this.px=100;this.py=300;this.vy=0;this.started=false;this.dead=false;this.deadT=0;this.gates=[];this.index=0;this.nextX=0;this.lastGy=300;this.lastAmp=0;this.trail=[];this.tilt=0;this.gatesPassed=0;this.orbs=[];this.orbsTaken=0;this.runTime=0;this.popups=[];
  this.inputs=[];this.resumes=[];this.nextX=RIDGE.FIRST_X;for(let i=0;i<4;i++)this.addGate();this.fillGates();
  this.onpointerdown=()=>this.action();canvas.addEventListener('pointerdown',this.onpointerdown);cb.hud(0,0,'1×');cb.message('Tap anywhere to lift your vial. Fly through the open gates.');}
 // The course (sky to ground, 0 to GROUND in world units) fills the space between the bottom of the HUD and the
 // bottom of the screen, so no vial hides under the score boxes and the ground sits on the screen's bottom edge.
 // Only drawing changes with the screen; the course and physics stay in world units.
 get oy(){return this.hudTop??this.top;}
 get ws(){return Math.max(.1,(this.h-this.oy-RIDGE.FLOOR_PAD)/RIDGE.GROUND);}
 // Measures where the HUD ends on screen (it moves with the notch / safe area); falls back to the shared top margin.
 measureHud(){try{const hud=document.querySelector('.in-game .hud'),r=this.canvas.getBoundingClientRect(),b=hud?hud.getBoundingClientRect().bottom-r.top:0;this.hudTop=b>0?(b+10)/this.scale:this.top;}catch{this.hudTop=this.top;}this.hudAt=this.time;}
 sy(y){return this.oy+y*this.ws;}
 get worldW(){return this.w/this.ws;}
 get speed(){return RIDGE.SPEED+RIDGE.SPEED_GAIN*clamp(this.gatesPassed/60,0,1);}
 // Gap and reach ramp off the gate's own index, not the live score, so the course is the same for everyone
 // however well they are playing.
 gapFor(i){return(RIDGE.GAP-RIDGE.SLACK)-(RIDGE.GAP-RIDGE.GAP_TO)*clamp((i-RIDGE.GAP_START)/(RIDGE.GAP_END-RIDGE.GAP_START),0,1);}
 jumpFor(i){return RIDGE.JUMP+(RIDGE.JUMP_TO-RIDGE.JUMP)*clamp(i/RIDGE.JUMP_END,0,1);}
 // The reachable band is clamped to the playfield first and the centre drawn inside it, so a gate near an
 // edge still uses its whole remaining range instead of piling up on the margin.
 // Moving vials: from gate 15 some gates bob up and down, more of them and further and faster as you go
 // (from 18 to 55 units, by gate 45). The step between gates shrinks by both swings so every gate stays
 // reachable, and a gate never bobs past the playfield edges.
 // Peptide orbs: from gate 3, about a third of the gaps hold an orb worth 2 points, set off the safe line.
 addGate(){const i=this.index++,gap=this.gapFor(i),lo=RIDGE.EDGE+gap/2,hi=RIDGE.GROUND-RIDGE.EDGE-gap/2,ramp=clamp((i-RIDGE.MOVE_START)/(RIDGE.MOVE_FULL-RIDGE.MOVE_START),0,1);
  const moves=i>=RIDGE.MOVE_START&&this.random()<.4+.6*ramp,want=moves?RIDGE.MOVE_AMP+(RIDGE.MOVE_AMP_TO-RIDGE.MOVE_AMP)*ramp:0;
  const jump=Math.max(40,this.jumpFor(i)-want-this.lastAmp);
  const a=Math.max(lo,this.lastGy-jump),b=Math.min(hi,this.lastGy+jump),gy=a+this.random()*(b-a),amp=Math.min(want,gy-lo,hi-gy);
  const gate={x:this.nextX,gy,cy:gy,gap,amp,phase:this.random()*TAU,rate:RIDGE.MOVE_SPEED+(RIDGE.MOVE_SPEED_TO-RIDGE.MOVE_SPEED)*ramp,passed:false};
  const prev=this.gates.at(-1);
  if(prev&&i>=RIDGE.ORB_START&&this.random()<RIDGE.ORB_CHANCE){const off=(RIDGE.ORB_OFFSET+(RIDGE.ORB_OFFSET_TO-RIDGE.ORB_OFFSET)*clamp(i/40,0,1))*(this.random()<.5?-1:1);
   this.orbs.push({x:prev.x+RIDGE.PW+(RIDGE.SPACE-RIDGE.PW)/2,y:clamp((prev.gy+gy)/2+off,RIDGE.EDGE,RIDGE.GROUND-RIDGE.EDGE),taken:false});}
  this.lastGy=gy;this.lastAmp=amp;this.gates.push(gate);this.nextX+=RIDGE.SPACE;}
 // Gates sit at fixed world positions; wider screens just get a few more of the same gates created ahead of time.
 fillGates(){while(this.nextX<this.worldW+RIDGE.PW*2)this.addGate();}
 // The tap that ends a post-pause wait only picks the flight back up, at the speed it had when it paused; it does
 // not flap. A forced flap there could throw the vial into glass it was threading when the tab went hidden.
 action(){if(this.paused||this.ended||this.dead)return;this.inputs.push(this.ticks);
  if(this.waiting){this.waiting=false;this.cb.message('');return;}
  this.started=true;this.vy=-RIDGE.FLAP;this.cb.sound('flap');this.cb.message('');}
 // Broad phase on the gate's column, then the two vial outlines themselves.
 hits(g){const R=RIDGE.R;if(!(this.px+R>g.x&&this.px-R<g.x+RIDGE.PW))return false;const cx=g.x+RIDGE.PW/2;
  return hitsVial(this.px,this.py,R,cx,g.cy+g.gap/2,1)||hitsVial(this.px,this.py,R,cx,g.cy-g.gap/2,-1);}
 update(dt){
  if(this.waiting)return; // holds still where it was paused until the next tap
  if(!this.started){this.py=300+Math.sin(this.time*3)*8;return;}
  this.vy+=RIDGE.GRAVITY*dt;this.py+=this.vy*dt;this.tilt=clamp(this.vy*.0011,-.35,.7);
  if(this.dead){this.deadT+=dt;if(this.py>RIDGE.GROUND-RIDGE.R)this.py=RIDGE.GROUND-RIDGE.R;if(this.deadT>.8)this.end(this.result());return;}
  const sp=this.speed;this.runTime+=dt;for(const p of this.popups)p.t+=dt;this.popups=this.popups.filter(p=>p.t<.8);
  for(const g of this.gates)g.cy=g.gy+g.amp*Math.sin(g.phase+g.rate*this.runTime);
  for(const o of this.orbs){o.x-=sp*dt;if(!o.taken&&Math.hypot(o.x-this.px,o.y-this.py)<RIDGE.R+RIDGE.ORB_R){o.taken=true;this.orbsTaken++;this.score+=RIDGE.ORB_POINTS;this.popups.push({x:o.x,y:o.y,t:0});this.cb.hud(this.score,this.gatesPassed,`${Math.min(9,1+Math.floor(this.gatesPassed/5))}×`);this.cb.sound('bond');this.burst(o.x*this.ws,this.sy(o.y),'#ffd24d',14);}}
  this.orbs=this.orbs.filter(o=>o.x>-RIDGE.ORB_R*2);
  for(const g of this.gates){g.x-=sp*dt;if(!g.passed&&g.x+RIDGE.PW<this.px-RIDGE.R){g.passed=true;this.gatesPassed++;this.score++;if(g.minClear<RIDGE.CLOSE)this.popups.push({x:this.px+18,y:this.py-22,t:0,text:'CLOSE!'});if(RIDGE_MILESTONES.includes(this.gatesPassed))this.cb.effect?.(`${this.gatesPassed} GATES!`,'ridge');this.cb.hud(this.score,this.gatesPassed,`${Math.min(9,1+Math.floor(this.gatesPassed/5))}×`);this.cb.sound('perfect');this.burst(this.px*this.ws,this.sy(this.py),'#8fffff',12);}}
  this.nextX-=sp*dt;while(this.gates.length&&this.gates[0].x<-RIDGE.PW)this.gates.shift();if(this.gates.length<4)this.addGate();this.fillGates();
  if(this.py<RIDGE.R){this.py=RIDGE.R;this.vy=0;}
  if(this.py+RIDGE.R>RIDGE.GROUND){this.py=RIDGE.GROUND-RIDGE.R;this.crash();}else if(this.gates.some(g=>this.hits(g)))this.crash();
  // Near misses, for the "CLOSE!" popup only: the tightest gap to the glass while inside each gate's column.
  if(!this.dead)for(const g of this.gates)if(!g.passed&&this.px+RIDGE.R>g.x&&this.px-RIDGE.R<g.x+RIDGE.PW)g.minClear=Math.min(g.minClear??Infinity,this.py-RIDGE.R-(g.cy-g.gap/2),g.cy+g.gap/2-(this.py+RIDGE.R));
  if(this.motion){this.trail.push({x:this.px,y:this.py});for(const p of this.trail)p.x-=sp*dt;if(this.trail.length>14)this.trail.shift();}
 }
 crash(){if(this.dead||this.ended)return;this.dead=true;this.vy=Math.max(this.vy,0);this.burst(this.px*this.ws,this.sy(this.py),'#ffd383');this.cb.sound('miss');}
 result(){return {score:this.score,gates:this.gatesPassed,orbs:this.orbsTaken,replay:this.replay()};}
 replay(){return {v:4,game:'ridge',seed:this.seed,step:SIM_STEP,taps:[...this.inputs],resumes:[...this.resumes],endTick:this.ticks};}
 // After a pause the vial (and the course) hold still until a tap, so the run never resumes before the player is
 // ready. Its velocity is kept: the tap continues the same flight, as if the pause never happened.
 pause(value=true){super.pause(value);if(!value&&this.started&&!this.dead&&!this.ended){this.resumes.push(this.ticks);this.waiting=true;this.cb.message('Tap to keep flying.');}}
 draw(){if(this.hudAt===undefined||this.time-this.hudAt>1||this.time<this.hudAt)this.measureHud();const c=this.ctx,k=this.ws;c.save();c.translate(0,this.oy);c.scale(k,k);
  if(this.motion)for(let i=0;i<this.trail.length;i++){c.globalAlpha=i/this.trail.length*.3;c.fillStyle='#8fffff';c.beginPath();c.arc(this.trail[i].x,this.trail[i].y,2+i*.25,0,TAU);c.fill();}
  c.globalAlpha=1;c.shadowColor='#03cfff';c.shadowBlur=10;
  // Peptide orbs: a glowing core with three bonded atoms circling it.
  for(const o of this.orbs){if(o.taken)continue;const pulse=1+.12*Math.sin(this.time*6+o.x*.05);c.save();c.shadowColor='#ffd24d';c.shadowBlur=16;
   c.strokeStyle='#ffe9a3';c.lineWidth=1.5;for(let k=0;k<3;k++){const a=this.time*2.4+k*TAU/3,ax=o.x+Math.cos(a)*RIDGE.ORB_R*1.5,ay=o.y+Math.sin(a)*RIDGE.ORB_R*1.5;c.beginPath();c.moveTo(o.x,o.y);c.lineTo(ax,ay);c.stroke();c.fillStyle='#fff6d6';c.beginPath();c.arc(ax,ay,2.6,0,TAU);c.fill();}
   const gr=c.createRadialGradient(o.x,o.y,1,o.x,o.y,RIDGE.ORB_R*pulse);gr.addColorStop(0,'#fffbe8');gr.addColorStop(.5,'#ffd24d');gr.addColorStop(1,'#ff9d2e');c.fillStyle=gr;c.beginPath();c.arc(o.x,o.y,RIDGE.ORB_R*pulse*.8,0,TAU);c.fill();c.restore();}
  for(const p of this.popups){c.save();c.globalAlpha=1-p.t/.8;c.fillStyle='#ffe9a3';c.shadowColor='#ff9d2e';c.shadowBlur=10;c.font='900 18px Inter, sans-serif';c.textAlign='center';c.fillText(p.text??`+${RIDGE.ORB_POINTS}`,p.x,p.y-14-p.t*30);c.restore();}
  for(const g of this.gates){const top=g.cy-g.gap/2,bottom=g.cy+g.gap/2,cx=g.x+RIDGE.PW/2;drawBottleObstacle(c,cx,top,top+this.oy/k,RIDGE.PW,true);drawBottleObstacle(c,cx,bottom,RIDGE.GROUND-bottom,RIDGE.PW,false);}
  c.shadowBlur=14;c.strokeStyle='#8fffffaa';c.lineWidth=2;c.beginPath();c.moveTo(0,RIDGE.GROUND);c.lineTo(this.worldW,RIDGE.GROUND);c.stroke();
  c.shadowColor='#8fffff';c.shadowBlur=16;drawSprite(c,'vial-cyan',this.px,this.py,RIDGE.R*2,RIDGE.R*2.6,this.tilt);
  c.restore();}
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
  this.rulesVersion=options?.rulesVersion===1?1:SEQUENCE_RULES_VERSION;this.config=sequenceLevel(this.level);this.progress=createSequenceProgress(this.config);this.palette=sequencePalette(this.level);this.board=this.rulesVersion===1?createSequenceBoard(this.level,this.random):createProgressionBoard(this.config,this.random,this.progress);this.inputs=[];this.moves=SEQUENCE_MOVES;this.target=this.rulesVersion===1?sequenceTarget(this.level):this.config.target;this.selection=null;this.cursor=24;this.keyboard=false;this.chain=0;this.pending=0;this.phase=null;this.swap=null;this.falls=new Map();this.pointerStart=null;this.clearing=null;this.fallDur=0;this.popups=[];this.banner=null;this.shake=0;this.idle=0;this.hintPair=null;
  this.pointerId=null;
  const owns=e=>this.pointerId!==null&&(e.pointerId===undefined||e.pointerId===this.pointerId);
  this.cancelPointer=()=>{const id=this.pointerId;this.pointerId=null;this.pointerStart=null;this.pressed=null;try{if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);}catch{}};
  this.onpointerdown=e=>{if(this.paused||this.ended||this.pending||this.pointerId!==null||e.isPrimary===false||(e.button!==undefined&&e.button!==0))return;this.pointerId=e.pointerId??1;this.keyboard=false;this.idle=0;this.hintPair=null;this.pointerStart=this.pointer(e);this.pressed=this.cellAt(...this.pointerStart);canvas.setPointerCapture?.(e.pointerId);};
  // The first finger owns the gesture until release, cancellation or loss of capture.
  const swapFromGesture=(start,dx,dy)=>{const horizontal=Math.abs(dx)>Math.abs(dy),to=start+(horizontal?(dx>0?1:-1):(dy>0?7:-7));if(to>=0&&to<49&&(!horizontal||Math.floor(to/7)===Math.floor(start/7)))this.choose(start,to);};
  this.onpointermove=e=>{if(!owns(e)||!this.pointerStart||this.pending)return;const [x,y]=this.pointer(e),dx=x-this.pointerStart[0],dy=y-this.pointerStart[1];if(Math.hypot(dx,dy)<this.geometry().cell*.3)return;const start=this.cellAt(...this.pointerStart);this.pointerStart=null;this.pressed=null;if(start!==null)swapFromGesture(start,dx,dy);};
  this.onpointerup=e=>{if(!owns(e))return;const origin=this.pointerStart,[x,y]=this.pointer(e);this.cancelPointer();if(!origin)return;const start=this.cellAt(...origin),dx=x-origin[0],dy=y-origin[1];if(start===null)return;if(Math.hypot(dx,dy)*this.scale<10)this.choose(start);else swapFromGesture(start,dx,dy);};
  this.onpointercancel=(e={})=>{if(owns(e))this.cancelPointer();};this.onlostpointercapture=this.onpointercancel;this.onblur=()=>this.cancelPointer();window.addEventListener?.('blur',this.onblur);
  for(const name of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,this['on'+name]);cb.hud(0,this.moves,this.target);cb.message(this.rulesVersion===1?`Match three or more. Reach ${this.target} points in ${this.moves} moves.`:sequenceBrief(this.level));this.reportGoals();
 }
 geometry(){const inset=this.rulesVersion===2?38/this.scale:0,top=this.top+inset,bottom=this.bottom+(this.rulesVersion===2?36/this.scale:0),size=Math.min(this.w-36,this.h-top-bottom-24,560),cell=size/7;return{x:(this.w-size)/2,y:top+(this.h-top-bottom-size)/2,size,cell};}
 complete(){return this.rulesVersion===1?this.score>=this.target:sequenceComplete(this.score,{...this.config,target:this.target},this.progress);}
 reportGoals(){this.cb.goals?.({version:this.rulesVersion,level:this.level,target:this.target,goals:this.rulesVersion===1?[]:sequenceGoals(this.config,this.progress)});}
 cellAt(x,y){const g=this.geometry();if(x<g.x||x>=g.x+g.size||y<g.y||y>=g.y+g.size)return null;return Math.floor((y-g.y)/g.cell)*7+Math.floor((x-g.x)/g.cell);}
 choose(index,swapWith=null){
  if(this.paused||this.ended||this.pending||!Number.isInteger(index)||index<0||index>=49)return;
  if(this.rulesVersion===2&&(this.progress.locks[index]||(swapWith!==null&&this.progress.locks[swapWith]))){this.selection=null;this.cb.sound('invalid');this.cb.message('Trapped crystal. Match on or beside it to break the trap. No move used.');return;}if(swapWith!==null)this.selection=index;
  if(this.selection===null){this.selection=index;this.cursor=index;this.cb.sound('select');this.cb.message(`Row ${Math.floor(index/7)+1}, column ${index%7+1} selected. Choose a neighbour.`);return;}
  if(this.selection===index&&swapWith===null){this.selection=null;return;}
  const from=this.selection,to=swapWith??index,next=this.rulesVersion===1?sequenceExchange(this.board,from,to):progressionExchange(this.board,from,to,this.progress);
  if(!next){const d=Math.abs(Math.floor(to/7)-Math.floor(from/7))+Math.abs(to%7-from%7);if(d!==1){this.selection=to;this.cursor=to;}this.cb.sound('invalid');this.cb.message('Swap neighbours to make a line of three.');return;}
  this.inputs.push([this.ticks,from,to]);
  const matched=sequenceMatches(next).size>0;this.idle=0;this.hintPair=null;this.selection=null;this.cursor=to;if(matched)this.moves--;this.chain=0;if(this.moves===5&&this.score<this.target)this.cb.effect?.('5 MOVES LEFT','sequence');this.swap={from,to,next,original:this.board,matched};this.phase='swap';this.pending=SEQ_SWAP;this.cb.hud(this.score,this.moves,this.target);this.cb.sound('drop');this.cb.message('');
 }
 // Matched crystals now shrink out over 0.18 s with a "+points" popup, and cascades announce "Chain ×n".
 resolveMatches(){const matches=sequenceMatches(this.board);if(!matches.size){this.finishMove();return;}const g=this.geometry();let sx=0,sy=0;
  for(const i of matches){this.burst(g.x+(i%7+.5)*g.cell,g.y+(Math.floor(i/7)+.5)*g.cell,colors[this.board[i]],6);sx+=i%7;sy+=Math.floor(i/7);}
  const gained=matches.size*50*(1+this.chain);this.score+=gained;this.chain++;this.clearing=matches;if(this.rulesVersion===2){this.progress=applySequenceWave(this.config,this.progress,this.board,matches);this.reportGoals();}
  this.popups.push({text:`+${gained}`,x:g.x+(sx/matches.size+.5)*g.cell,y:g.y+(sy/matches.size+.5)*g.cell,t:0});
  if(this.chain>1){const n=this.chain,word=n>=5?'Amazing!':n>=4?'Great!':n>=3?'Nice!':'';this.banner={text:word?`Chain ×${n} ${word}`:`Chain ×${n}`,t:0};if(n>=4){this.cb.effect?.(n>=5?'AMAZING CHAIN!':'GREAT CHAIN!','sequence');if(this.motion)this.shake=1;}}if(matches.size>=8&&this.motion)this.shake=1;
  this.cb.sound(this.chain>1?'perfect':'crystal');this.cb.hud(this.score,this.moves,this.target);this.phase='clear';this.pending=SEQ_CLEAR;}
 // Any swap that makes a line, for the idle hint.
 findMove(){if(this.rulesVersion===2)return progressionMove(this.board,this.progress);for(let i=0;i<49;i++)for(const to of [i%7<6?i+1:-1,i+7]){if(to<0||to>48)continue;const next=sequenceExchange(this.board,i,to);if(next&&sequenceMatches(next).size)return [i,to];}return null;}
 finishMove(){
  this.phase=null;this.pending=0;this.falls.clear();this.idle=0;this.hintPair=null;this.cb.hud(this.score,this.moves,this.target);
  if(this.complete()||this.moves<=0){this.finish();return;}
  if(!this.findMove()){this.board=this.rulesVersion===1?createSequenceBoard(this.level,this.random):createProgressionBoard(this.config,this.random,this.progress,this.board);this.cb.message('Fresh crystals. No move used.');}else{const remaining=this.rulesVersion===1?[]:sequenceGoals(this.config,this.progress).filter(g=>g.left).map(g=>`${g.left} ${g.label.toLowerCase()}`);this.cb.message(`${this.moves} moves left. ${this.score<this.target?`${Math.max(0,this.target-this.score)} points to go.`:'Score goal reached.'}${remaining.length?' Still needed: '+remaining.join(', ')+'.':''}`);}
 }
 tickEffects(dt){for(const p of this.popups)p.t+=dt;this.popups=this.popups.filter(p=>p.t<.9);if(this.banner&&(this.banner.t+=dt)>1.1)this.banner=null;this.shake=Math.max(0,this.shake-dt*4);
  if(!this.pending&&!this.ended&&!this.paused&&!this.hintPair&&(this.idle+=dt)>SEQ_HINT_AFTER)this.hintPair=this.findMove();}
 update(dt){
  this.tickEffects(dt);if(this.pending<=0)return;this.pending-=dt;if(this.pending>0)return;
  if(this.phase==='swap'){this.board=this.swap.next;if(!this.swap.matched){this.phase='return';this.pending=SEQ_SWAP;return;}this.swap=null;this.resolveMatches();return;}
  if(this.phase==='return'){this.board=this.swap.original;this.swap=null;this.phase=null;this.pending=0;this.cb.sound('undo');this.cb.message('Try another pair. No move used.');return;}
  if(this.phase==='clear'&&this.rulesVersion===2){const gone=this.clearing,cleared=this.board.map((v,i)=>gone.has(i)?-1:v),settled=settleProgression(cleared,this.random,this.palette,this.progress);this.board=settled.board;this.falls=settled.falls;this.clearing=null;this.phase='fall';this.fallDur=Math.max(.12,...[...this.falls.values()].map(d=>fallTime(d)));this.pending=this.fallDur;return;}
  if(this.phase==='clear'){const gone=this.clearing;this.board=this.board.map((v,i)=>gone.has(i)?-1:v);this.clearing=null;this.falls.clear();for(let col=0;col<7;col++){let write=6;for(let row=6;row>=0;row--)if(this.board[row*7+col]>=0){this.falls.set(write*7+col,row-write);write--;}for(let row=write;row>=0;row--)this.falls.set(row*7+col,-write-1);}this.board=settleSequence(this.board,this.random,7,this.palette);this.phase='fall';
   // Crystals fall like they have weight: each one accelerates and takes longer the further it drops.
   this.fallDur=Math.max(.12,...[...this.falls.values()].map(d=>fallTime(d)));this.pending=this.fallDur;return;}
  if(this.phase==='fall'){this.falls.clear();if(this.complete())this.finishMove();else this.resolveMatches();}
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
   drawSprite(c,crystalSprites[v],x,y,size,size);c.globalAlpha=1;if(this.rulesVersion===2)this.drawObstacle(i,g);
   if(this.selection===i||(this.keyboard&&this.cursor===i)){c.strokeStyle=this.selection===i?'#ffe77a':'#e6ffff';c.lineWidth=3;rounded(c,g.x+col*g.cell+3,g.y+row*g.cell+3,g.cell-6,g.cell-6,9);c.stroke();}
  }
  // Idle hint: after a few seconds without a move, one swap that works pulses gently.
  if(this.hintPair&&!this.pending){const a=.45+.35*Math.sin(this.time*5);c.strokeStyle=`rgba(255,231,122,${a})`;c.lineWidth=3;for(const i of this.hintPair)rounded(c,g.x+i%7*g.cell+3,g.y+Math.floor(i/7)*g.cell+3,g.cell-6,g.cell-6,9),c.stroke();}
  c.restore();
  c.textAlign='center';c.textBaseline='middle';
  for(const p of this.popups){c.globalAlpha=Math.max(0,1-p.t/.9);c.fillStyle='#ffffff';c.shadowColor='#00c9ff';c.shadowBlur=10;c.font=`800 ${Math.round(g.cell*.36)}px Inter, sans-serif`;c.fillText(p.text,p.x,p.y-p.t*g.cell*.7);}
  if(this.banner){const t=this.banner.t,a=Math.min(1,t*6,(1.1-t)*3);c.globalAlpha=Math.max(0,a);c.fillStyle='#ffe77a';c.shadowColor='#ff9d2e';c.shadowBlur=16;c.font=`900 ${Math.round(g.cell*.5)}px Inter, sans-serif`;c.fillText(this.banner.text.toUpperCase(),g.x+g.size/2,g.y+g.size/2-(1-Math.min(1,t*5))*12);}
  c.globalAlpha=1;c.shadowBlur=0;c.restore();
 }
 drawObstacle(i,g){
  const c=this.ctx,x=g.x+(i%7)*g.cell+3,y=g.y+Math.floor(i/7)*g.cell+3,w=g.cell-6,ice=this.progress.ice[i],locked=this.progress.locks[i];c.save();
  if(ice){c.fillStyle=ice===2?'#b4efff66':'#d3faff33';c.strokeStyle='#bff5ff';c.lineWidth=ice===2?2.5:1.5;rounded(c,x,y,w,w,8);c.fill();c.stroke();
   c.beginPath();c.moveTo(x+w*.16,y+w*.15);c.lineTo(x+w*.46,y+w*.37);c.lineTo(x+w*.34,y+w*.65);c.moveTo(x+w*.46,y+w*.37);c.lineTo(x+w*.8,y+w*.56);c.stroke();
   c.fillStyle='#052b50';rounded(c,x+w-16,y+2,14,15,4);c.fill();c.fillStyle='#e9ffff';c.font='800 11px Inter, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(String(ice),x+w-9,y+10);
  }
  if(locked){c.strokeStyle='#f8d18b';c.lineWidth=3;rounded(c,x+2,y+2,w-4,w-4,6);c.stroke();for(const off of [.35,.65]){c.beginPath();c.moveTo(x+w*off,y+3);c.lineTo(x+w*off,y+w-3);c.stroke();}c.fillStyle='#082546';rounded(c,x+w*.35,y+w*.36,w*.3,w*.28,3);c.fill();c.stroke();}
  c.restore();
 }
 finish(){this.end({score:this.score,moves:SEQUENCE_MOVES-this.moves,won:this.complete(),target:this.target,objectives:this.rulesVersion===1?[]:sequenceGoals(this.config,this.progress),replay:this.replay()});}
 replay(){return {v:this.rulesVersion,game:'sequence',seed:this.seed,level:this.level,step:SIM_STEP,moves:this.inputs.map(m=>[...m]),endTick:this.ticks};}
}
