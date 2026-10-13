import {createSequenceBoard,hasSequenceMove,sequenceMatches,sequenceExchange,settleSequence,sequenceTarget,SEQUENCE_MOVES} from './sequence-rules.js';
import {drawSprite,drawBottleObstacle,crystalSprites,vialSprites} from './gameplay-art.js';
import {orbitVelocity,crossesHoop,ORBIT_GRAVITY} from './orbit-rules.js';
import {SIM_STEP,MAX_STEPS_PER_FRAME,makeSeed,createRandom} from './rng.js';

const TAU=Math.PI*2;
export const BOND_ROUND=8;
const colors=['#0ea5ff','#27d8f3','#ffd24d','#ba75ff','#24d58b','#ff609a','#f2fbff'];
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const angularDistance=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
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
 pause(value=true){this.paused=value;this.last=0;this.acc=0;}
 destroy(){this.alive=false;cancelAnimationFrame(this.raf);this.observer?.disconnect();for(const name of ['pointerdown','pointerup','pointercancel','pointermove']){const handler=this['on'+name];if(handler)this.canvas.removeEventListener(name,handler);}}
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
 constructor(canvas,cb,options){super(canvas,cb,options);this.y=this.top+(this.h-this.top-this.bottom)*.5;this.vy=0;this.started=false;this.gates=[];this.speed=148;this.spawn=0;this.trail=[];this.lastCenter=null;this.lastInterval=0;this.inputs=[];this.resizes=[];this.resumes=[];this.startView=this.view;this.onpointerdown=()=>this.action();canvas.addEventListener('pointerdown',this.onpointerdown);cb.hud(0,0,'1×');cb.message('Tap anywhere to lift your vial. Fly through the open gates.');}
 get playerX(){return Math.min(170,this.w*.28);}
 get floor(){return this.h;}
 get gap(){return Math.max(140,Math.min(245,(this.floor-this.top)*.36)-this.score*2.8);}
 get flap(){return Math.sqrt((this.floor-this.top)/430)*282;}
 action(){if(this.paused||this.ended)return;this.inputs.push(this.ticks);this.started=true;this.vy=-this.flap;this.cb.sound('flap');this.cb.message('');}
 update(dt){
  if(!this.started)return;this.speed=Math.min(300,148+this.score*3.2);this.vy+=640*dt;this.y+=this.vy*dt;this.spawn-=dt;
  if(this.spawn<=0){const gap=this.gap,center=this.nextCenter(gap);this.gates.push({x:this.w+40,center,gap,passed:false});this.lastCenter=center;this.spawn=this.lastInterval=Math.max(1.02,1.9-this.score*.014);}
  for(const g of this.gates){const gap=g.gap??this.gap;g.x-=this.speed*dt;if(!g.passed&&g.x+35<this.playerX-18){g.passed=true;this.score++;this.cb.hud(this.score,this.score,`${Math.min(9,1+Math.floor(this.score/5))}×`);this.cb.sound('perfect');this.burst(this.playerX,this.y,'#8fffff',12);}
   if(g.x-35<this.playerX+17&&g.x+35>this.playerX-17&&(this.y-29<g.center-gap/2||this.y+29>g.center+gap/2)){this.crash();return;}}
  this.gates=this.gates.filter(g=>g.x>-60);if(this.y-28<0||this.y+28>this.floor)this.crash();
  if(this.motion){this.trail.push({x:this.playerX,y:this.y});for(const p of this.trail)p.x-=this.speed*dt;if(this.trail.length>24)this.trail.shift();}
 }
 // Every gate must be reachable from the one before. The vial gets the time between leaving one gate and
 // entering the next; a human tapping fast climbs about 75% of the flap speed, and falls at most what gravity
 // allows. Half the spare room inside the gap counts too. MAX_SHIFT also stops tall phones getting bigger swings.
 nextCenter(gap){
  const margin=gap/2+38,lo=this.top+margin,hi=Math.max(lo+1,this.floor-margin);
  let a=lo,b=hi;
  if(this.lastCenter!==null){
   const travel=Math.max(.2,this.lastInterval-(70+34)/this.speed),slack=Math.max(0,gap-58)/2,MAX_SHIFT=240;
   const up=Math.min(MAX_SHIFT,.75*this.flap*travel+slack),down=Math.min(MAX_SHIFT,.75*.5*640*travel*travel+slack);
   a=Math.max(lo,this.lastCenter-up);b=Math.min(hi,this.lastCenter+down);if(b<a)a=b=clamp(this.lastCenter,lo,hi);
  }
  return a+this.random()*(b-a);
 }
 replay(){return {v:1,game:'ridge',seed:this.seed,view:this.startView,step:SIM_STEP,taps:[...this.inputs],resizes:this.resizes.map(([t,v])=>[t,[...v]]),resumes:[...this.resumes]};}
 // After a pause the vial waits for a tap instead of resuming mid-fall.
 pause(value=true){super.pause(value);if(!value&&this.started&&!this.ended){this.resumes.push(this.ticks);this.started=false;this.vy=0;this.cb.message('Tap to keep flying.');}}
 crash(){if(this.ended)return;this.burst(this.playerX,this.y,'#ffd383');this.cb.sound('miss');this.end({score:this.score,gates:this.score,replay:this.replay()});}
 onResize(oldW,oldH){this.resizes?.push([this.ticks,this.view]);this.y*=this.h/oldH;for(const g of this.gates){g.x*=this.w/oldW;g.center*=this.h/oldH;}}
 gateSegments(g){const gap=g.gap??this.gap;return{top:g.center-gap/2,bottom:g.center+gap/2};}
 draw(){const c=this.ctx;c.save();if(this.motion)for(let i=0;i<this.trail.length;i++){c.globalAlpha=i/this.trail.length*.28;c.fillStyle='#8fffff';c.beginPath();c.arc(this.trail[i].x,this.trail[i].y,2+i*.16,0,TAU);c.fill();}c.globalAlpha=1;c.shadowColor='#03cfff';c.shadowBlur=10;for(const g of this.gates){const{top,bottom}=this.gateSegments(g);drawBottleObstacle(c,g.x,top,top,70,true);drawBottleObstacle(c,g.x,bottom,this.h-bottom,70,false);}c.shadowColor='#8fffff';c.shadowBlur=16;const bob=this.started?0:Math.sin(this.time*2.8)*6;drawSprite(c,'vial-cyan',this.playerX,this.y+bob,48,80,clamp(this.vy*.0011,-.28,.6));c.restore();}
 finish(){this.crash();}
}

export class BondEngine extends MiniEngine{
 constructor(canvas,cb,options){super(canvas,cb,options);this.rotation=0;this.speed=2.1;this.bonds=0;this.round=1;this.roundBonds=0;this.direction=1;this.inputs=[];this.pins=this.starterPins(1);this.flights=[];this.cooldown=0;this.onpointerdown=()=>this.action();canvas.addEventListener('pointerdown',this.onpointerdown);cb.hud(0,this.pins.length,'1×');cb.message('Tap anywhere to send a vial into a clear gap.');}
 geometry(){const room=this.h-this.top-this.bottom;return{x:this.w/2,y:this.top+room*.37,r:Math.min(155,room*.26,this.w*.31),launch:this.h-this.bottom-60};}
 // The ring used to fill up: after ~16 bonds no safe gap was left and the run stalled with no game over.
 // Now every BOND_ROUND bonds completes the chain, pays a bonus and starts a fresh ring with more starter
 // vials, and from round 3 every other round spins the other way.
 starterPins(round){if(round===1)return [Math.PI*.25,Math.PI*.75,Math.PI*1.25,Math.PI*1.75];const count=Math.min(7,3+round),pins=[];let guard=0;
  while(pins.length<count&&guard++<500){const a=this.random()*TAU;if(pins.every(p=>angularDistance(p,a)>.7))pins.push(a);}return pins;}
 completeRound(){const g=this.geometry(),bonus=200*this.round;this.score+=bonus;this.round++;this.roundBonds=0;this.flights=[];this.pins=this.starterPins(this.round);
  this.direction=this.round>=3&&this.round%2===0?-1:1;this.burst(g.x,g.y,'#ffd24d',36);this.cb.sound('perfect');this.cb.effect?.('CHAIN COMPLETE!','bond');
  this.cb.message(`Round ${this.round}. +${bonus} bonus.`);this.cb.hud(this.score,this.pins.length,`${Math.min(9,1+Math.floor(this.score/300))}×`);}
 replay(){return {v:1,game:'bond',seed:this.seed,view:this.view,step:SIM_STEP,taps:[...this.inputs]};}
 // Taps closer together than the ring needs to move one vial-width apart are ignored, so a double tap
 // no longer sends two vials into the same spot and ends the run.
 action(){if(this.paused||this.ended||this.cooldown>0)return;this.inputs.push(this.ticks);this.flights.push({progress:0,sprite:vialSprites[(this.pins.length+this.flights.length)%4]});this.cooldown=Math.max(.065,.24/this.speed);this.cb.sound('launch');this.cb.message('');}
 update(dt){this.rotation+=this.direction*this.speed*dt;this.cooldown=Math.max(0,this.cooldown-dt);for(const flight of this.flights){flight.progress+=dt/.12;if(flight.progress<1)continue;const target=Math.PI/2-this.rotation,collision=this.pins.some(a=>angularDistance(a,target)<.22);if(collision){this.flights=[];this.cb.sound('miss');this.end({score:this.score,bonds:this.bonds,round:this.round,replay:this.replay()});return;}this.pins.push(target);this.bonds++;this.roundBonds++;this.score+=100;this.speed=Math.min(4.2,2.1+this.bonds*.04);const g=this.geometry();this.burst(g.x,g.y+g.r);this.cb.hud(this.score,this.pins.length,`${Math.min(9,1+Math.floor(this.score/300))}×`);this.cb.sound('bond');this.cb.effect?.('BONDED!','bond');if(this.roundBonds>=BOND_ROUND){this.completeRound();return;}}this.flights=this.flights.filter(f=>f.progress<1);}
 draw(){const c=this.ctx,g=this.geometry();ring(c,g.x,g.y,g.r,this.rotation);c.save();const glow=c.createRadialGradient(g.x,g.y,4,g.x,g.y,50);glow.addColorStop(0,'#dcffff');glow.addColorStop(.4,'#00c9ff');glow.addColorStop(1,'#024fc7');c.fillStyle=glow;c.shadowColor='#03d9ff';c.shadowBlur=24;c.beginPath();c.arc(g.x,g.y,47,0,TAU);c.fill();c.strokeStyle='#c1ffff';c.lineWidth=3;c.stroke();c.shadowBlur=0;
  for(let i=0;i<this.pins.length;i++){const a=this.pins[i]+this.rotation,px=g.x+Math.cos(a)*g.r,py=g.y+Math.sin(a)*g.r;c.strokeStyle='#a1ecffb0';c.lineWidth=3;c.beginPath();c.moveTo(g.x+Math.cos(a)*48,g.y+Math.sin(a)*48);c.lineTo(px,py);c.stroke();drawSprite(c,vialSprites[i%4],px,py,30,52,a-Math.PI/2);}
  c.shadowColor='#8fffff';c.shadowBlur=18;drawSprite(c,vialSprites[(this.pins.length+this.flights.length)%4],g.x,g.launch,45,78);for(const flight of this.flights){const y=g.launch-(g.launch-g.y-g.r)*Math.min(1,flight.progress);drawSprite(c,flight.sprite,g.x,y,45,78);}c.restore();}
 finish(){this.end({score:this.score,bonds:this.bonds,round:this.round,replay:this.replay()});}
}

export class SequenceEngine extends MiniEngine{
 constructor(canvas,cb,options){
  super(canvas,cb,options);this.board=createSequenceBoard(this.level);this.palette=Math.min(7,4+Math.floor((this.level-1)/5));this.moves=SEQUENCE_MOVES;this.target=sequenceTarget(this.level);this.selection=null;this.cursor=24;this.keyboard=false;this.chain=0;this.pending=0;this.phase=null;this.swap=null;this.falls=new Map();this.pointerStart=null;
  this.onpointerdown=e=>{this.keyboard=false;this.pointerStart=this.pointer(e);canvas.setPointerCapture?.(e.pointerId);};this.onpointerup=e=>{if(!this.pointerStart)return;const start=this.cellAt(...this.pointerStart),[x,y]=this.pointer(e),dx=x-this.pointerStart[0],dy=y-this.pointerStart[1];this.pointerStart=null;if(start===null)return;if(Math.hypot(dx,dy)*this.scale<10){this.choose(start);return;}const horizontal=Math.abs(dx)>Math.abs(dy),to=start+(horizontal?(dx>0?1:-1):(dy>0?7:-7));if(to>=0&&to<49&&(!horizontal||Math.floor(to/7)===Math.floor(start/7)))this.choose(start,to);};this.onpointercancel=()=>{this.pointerStart=null;};for(const name of ['pointerdown','pointerup','pointercancel'])canvas.addEventListener(name,this['on'+name]);cb.hud(0,this.moves,this.target);cb.message(`Match three or more. Reach ${this.target} points in ${this.moves} moves.`);
 }
 geometry(){const size=Math.min(this.w-36,this.h-this.top-this.bottom-24,560),cell=size/7;return{x:(this.w-size)/2,y:this.top+(this.h-this.top-this.bottom-size)/2,size,cell};}
 cellAt(x,y){const g=this.geometry();if(x<g.x||x>=g.x+g.size||y<g.y||y>=g.y+g.size)return null;return Math.floor((y-g.y)/g.cell)*7+Math.floor((x-g.x)/g.cell);}
 choose(index,swapWith=null){
  if(this.paused||this.ended||this.pending)return;if(swapWith!==null)this.selection=index;
  if(this.selection===null){this.selection=index;this.cursor=index;this.cb.sound('select');this.cb.message(`Row ${Math.floor(index/7)+1}, column ${index%7+1} selected. Choose a neighbour.`);return;}
  if(this.selection===index&&swapWith===null){this.selection=null;return;}
  const from=this.selection,to=swapWith??index,next=sequenceExchange(this.board,from,to);
  if(!next){const d=Math.abs(Math.floor(to/7)-Math.floor(from/7))+Math.abs(to%7-from%7);if(d!==1){this.selection=to;this.cursor=to;}this.cb.sound('invalid');this.cb.message('Swap neighbours to make a line of three.');return;}
  const matched=sequenceMatches(next).size>0;this.selection=null;this.cursor=to;if(matched)this.moves--;this.chain=0;this.swap={from,to,next,original:this.board,matched};this.phase='swap';this.pending=this.motion?.16:.001;this.cb.hud(this.score,this.moves,this.target);this.cb.sound('drop');this.cb.message('');
 }
 resolveMatches(){const matches=sequenceMatches(this.board);if(!matches.size){this.finishMove();return;}const g=this.geometry();for(const i of matches)this.burst(g.x+(i%7+.5)*g.cell,g.y+(Math.floor(i/7)+.5)*g.cell,colors[this.board[i]],6);this.board=this.board.map((v,i)=>matches.has(i)?-1:v);this.score+=matches.size*50*(1+this.chain);this.chain++;this.cb.sound('crystal');this.cb.hud(this.score,this.moves,this.target);this.phase='clear';this.pending=this.motion?.24:.001;}
 finishMove(){
  this.phase=null;this.pending=0;this.falls.clear();this.cb.hud(this.score,this.moves,this.target);
  if(this.score>=this.target){this.end({score:this.score,moves:SEQUENCE_MOVES-this.moves,won:true});return;}if(this.moves<=0){this.end({score:this.score,moves:SEQUENCE_MOVES,won:false});return;}
  if(!hasSequenceMove(this.board)){this.board=createSequenceBoard(this.level);this.cb.message('Fresh crystals. No move used.');}else this.cb.message(`${this.moves} moves left. ${Math.max(0,this.target-this.score)} points to go.`);
 }
 update(dt){
  if(this.pending<=0)return;this.pending-=dt;if(this.pending>0)return;
  if(this.phase==='swap'){this.board=this.swap.next;if(!this.swap.matched){this.phase='return';this.pending=this.motion?.16:.001;return;}this.swap=null;this.resolveMatches();return;}
  if(this.phase==='return'){this.board=this.swap.original;this.swap=null;this.phase=null;this.pending=0;this.cb.sound('undo');this.cb.message('Try another pair. No move used.');return;}
  if(this.phase==='clear'){this.falls.clear();for(let col=0;col<7;col++){let write=6;for(let row=6;row>=0;row--)if(this.board[row*7+col]>=0){this.falls.set(write*7+col,row-write);write--;}for(let row=write;row>=0;row--)this.falls.set(row*7+col,-write-1);}this.board=settleSequence(this.board,Math.random,7,this.palette);this.phase='fall';this.pending=this.motion?.28:.001;return;}
  if(this.phase==='fall'){this.falls.clear();if(this.score>=this.target)this.finishMove();else this.resolveMatches();}
 }
 moveSelection(key){this.keyboard=true;let r=Math.floor(this.cursor/7),c=this.cursor%7;if(key==='ArrowUp')r=(r+6)%7;if(key==='ArrowDown')r=(r+1)%7;if(key==='ArrowLeft')c=(c+6)%7;if(key==='ArrowRight')c=(c+1)%7;this.cursor=r*7+c;if(this.selection!==null)this.choose(this.cursor);else this.cb.message(`Row ${r+1}, column ${c+1}. Press Enter to select.`);}
 action(){if(this.paused||this.ended||this.pending)return;this.keyboard=true;this.choose(this.cursor);}
 draw(){
  const c=this.ctx,g=this.geometry();c.save();c.fillStyle='#03183de8';rounded(c,g.x-5,g.y-5,g.size+10,g.size+10,16);c.fill();c.strokeStyle='#8cefff77';c.lineWidth=2;c.stroke();c.save();rounded(c,g.x,g.y,g.size,g.size,12);c.clip();
  for(let i=0;i<this.board.length;i++){const row=Math.floor(i/7),col=i%7,v=this.board[i];let x=g.x+(col+.5)*g.cell,y=g.y+(row+.5)*g.cell;c.fillStyle='#123965a0';rounded(c,g.x+col*g.cell+2,g.y+row*g.cell+2,g.cell-4,g.cell-4,9);c.fill();if(v<0)continue;
   if((this.phase==='swap'||this.phase==='return')&&(i===this.swap.from||i===this.swap.to)){const to=i===this.swap.from?this.swap.to:this.swap.from,t=1-clamp(this.pending/.16,0,1);x+=((to%7)-col)*g.cell*t;y+=(Math.floor(to/7)-row)*g.cell*t;}
   if(this.phase==='fall')y+=(this.falls.get(i)||0)*g.cell*(clamp(this.pending/.28,0,1)**2);drawSprite(c,crystalSprites[v],x,y,g.cell*.86,g.cell*.86);
   if(this.selection===i||(this.keyboard&&this.cursor===i)){c.strokeStyle=this.selection===i?'#ffe77a':'#e6ffff';c.lineWidth=3;rounded(c,g.x+col*g.cell+3,g.y+row*g.cell+3,g.cell-6,g.cell-6,9);c.stroke();}
  }c.restore();c.restore();
 }
 finish(){this.end({score:this.score,moves:SEQUENCE_MOVES-this.moves,won:this.score>=this.target});}
}
