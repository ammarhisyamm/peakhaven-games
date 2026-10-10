import {towerPlacement,MERGE_RADII,mergePair,COLORS} from './rules.js';
const W=480,H=580;
const sprite=new Image();sprite.src='assets/collectible-vials.webp';
const happy=new Image();happy.src='assets/happy-vials.webp';
const chamber=new Image();chamber.src='assets/merge-chamber.webp';
const TOWER_STEP=164,TOWER_DROP=205;
const MERGE_LEFT=62,MERGE_RIGHT=418,MERGE_FLOOR=486;
const happyBounds=[[68,110,359,621],[59,110,350,621],[51,110,339,621],[35,110,325,621],[23,110,313,621],[9,110,300,621]];
const collectibleBounds=[[54,95,340,636],[54,96,337,636],[47,96,329,636],[38,97,321,637],[30,96,313,637],[25,97,310,637]];
function vial(ctx,x,y,width,height,tier=0,rotation=0,character=false) {
  const sheet=character?happy:sprite;
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);
  if(sheet.complete&&sheet.naturalWidth) {
    const cell=sheet.naturalWidth/6,index=tier%6;
    const [left,top,right,bottom]=(character?happyBounds:collectibleBounds)[index];
    const sx=cell*index+left,sy=top,sw=right-left,sh=bottom-top;
    const scale=Math.min(width/sw,height/sh),dw=sw*scale,dh=sh*scale;
    ctx.drawImage(sheet,sx,sy,sw,sh,-dw/2,-dh/2,dw,dh);
  } else {ctx.fillStyle=COLORS[tier%6];ctx.beginPath();ctx.roundRect(-width/2,-height/2,width,height,8);ctx.fill();ctx.fillStyle='#d9e8f5';ctx.fillRect(-width/2,-height/2,width,10);}
  ctx.restore();
}
function labBackdrop(ctx){ctx.clearRect(0,0,W,H);}
class CanvasEngine {
  constructor(canvas,callbacks,options={}) {
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.cb=callbacks;this.motion=options.motion;this.level=options.level||1;this.paused=false;this.ended=false;this.alive=true;this.time=0;this.last=0;this.particles=[];this.rings=[];
    const dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=W*dpr;canvas.height=H*dpr;this.ctx.scale(dpr,dpr);
    this.pointer=e=>{const rect=canvas.getBoundingClientRect();return (e.clientX-rect.left)/rect.width*W;};
    this.frame=this.frame.bind(this);this.raf=requestAnimationFrame(this.frame);
  }
  frame(now) {
    if(!this.alive)return;const dt=Math.min(.025,(now-(this.last||now))/1000);this.last=now;
    if(!this.paused&&!this.ended){this.time+=dt;this.update(dt);this.particles=this.particles.filter(p=>(p.life-=dt)>0);for(const p of this.particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=180*dt;}}
    this.draw();this.drawParticles();this.raf=requestAnimationFrame(this.frame);
  }
  burst(x,y,color) {if(!this.motion)return;this.rings.push({x,y,color,start:this.time});for(let i=0;i<28;i++){const a=i/28*Math.PI*2;this.particles.push({x,y,vx:Math.cos(a)*115,vy:Math.sin(a)*115-60,life:.8,color});}}
  drawParticles(){const c=this.ctx;this.rings=this.rings.filter(r=>this.time-r.start<.55);for(const r of this.rings){const t=(this.time-r.start)/.55;c.globalAlpha=1-t;c.strokeStyle=r.color;c.lineWidth=4*(1-t);c.beginPath();c.ellipse(r.x,r.y,12+t*50,5+t*18,0,0,Math.PI*2);c.stroke();}for(const p of this.particles){c.globalAlpha=p.life/.8;c.fillStyle=p.color;c.fillRect(p.x,p.y,4,4);}c.globalAlpha=1;}
  end(result){if(this.ended)return;this.ended=true;this.cb.end(result);}
  pause(value=true){this.paused=value;}
  destroy(){this.alive=false;cancelAnimationFrame(this.raf);this.canvas.removeEventListener('pointerdown',this.onDown);this.canvas.removeEventListener('pointermove',this.onMove);this.canvas.removeEventListener('pointerup',this.onUp);this.canvas.removeEventListener('pointercancel',this.onCancel);}
}
export class TowerEngine extends CanvasEngine {
  constructor(canvas,callbacks,options){super(canvas,callbacks,options);this.skin=options.skin||0;this.placementWidth=74-Math.min(18,Math.log2(this.level)*3);this.speedMultiplier=1+Math.min(1.2,(this.level-1)*.025);this.stack=[{x:240,y:475}];this.x=80;this.dir=1;this.score=0;this.perfects=0;this.combo=0;this.camera=0;this.inputReady=true;this.drop=null;this.failure=0;this.tip='Tap when the vial is above the stack.';this.onDown=()=>this.action();canvas.addEventListener('pointerdown',this.onDown);this.cb.hud(0,0,'0');}
  action(){if(this.paused||this.ended||this.drop||!this.inputReady)return;const top=this.stack.at(-1);const offset=this.x-top.x;const landingX=Math.abs(offset)<this.placementWidth?top.x+offset*.4:this.x;this.drop={x:landingX,y:top.y-TOWER_DROP,vy:0};this.inputReady=false;this.cb.ready?.(false);this.cb.message('');this.cb.aligned?.(false);}
  update(dt){
    const top=this.stack.at(-1);const target=Math.max(0,320-top.y);this.camera+=(target-this.camera)*Math.min(1,dt*8);
    if(this.failure){this.failure+=dt;this.drop.y+=this.drop.vy*dt;this.drop.vy+=650*dt;if(this.failure>1)this.finish();return;}
    if(!this.drop){const ready=target-this.camera<10;if(ready!==this.inputReady){this.inputReady=ready;this.cb.ready?.(ready);}if(!ready)return;this.x+=this.dir*(110+Math.min(160,(this.stack.length-1)*6))*this.speedMultiplier*dt;if(this.x>428){this.x=428;this.dir=-1;}if(this.x<52){this.x=52;this.dir=1;}const aligned=Math.abs(this.x-top.x)<40;if(aligned!==this.aligned){this.aligned=aligned;this.cb.aligned?.(aligned);}return;}
    this.drop.vy+=1000*dt;this.drop.y+=this.drop.vy*dt;
    if(this.drop.y>=top.y-TOWER_STEP){
      const result=towerPlacement(top.x,this.drop.x,this.placementWidth);const candidate=[...this.stack,{x:this.drop.x,y:top.y-TOWER_STEP}];
      let stable=result.safe;
      // Every supporting vial must contain the centre of mass above it.
      for(let i=0;i<candidate.length-1;i++){const above=candidate.slice(i+1);const com=above.reduce((a,b)=>a+b.x,0)/above.length;if(Math.abs(com-candidate[i].x)>33)stable=false;}
      if(!stable){this.failure=.001;this.drop.vy=120;this.cb.message('A lovely run. Let’s try another!');this.cb.sound('miss');return;}
      this.stack=candidate;this.drop=null;this.combo=result.perfect?this.combo+1:0;if(result.perfect)this.perfects++;
      this.score+=result.perfect?150+Math.min(5,this.combo)*25:100;
      this.cb.hud(this.score,this.stack.length-1,this.combo>1?`${this.combo}×`:'0');this.cb.message(result.perfect?(this.combo>1?`Perfect! ${this.combo} in a row`:'Perfect placement!'):'Nicely stacked. Keep going.');this.cb.sound(result.perfect?'perfect':'drop');this.burst(top.x,top.y-TOWER_STEP+this.camera,'#51afc6');
      this.cb.effect?.(result.perfect?(this.combo>1?`PERFECT ×${this.combo}`:'PERFECT!'):'+100','tower');this.x=this.dir>0?52:428;this.cb.place(this.stack.length-1);
    }
  }
  finish(){this.end({score:this.score,height:this.stack.length-1,perfects:this.perfects});}
  draw(){const c=this.ctx;labBackdrop(c,this.time,this.motion);c.save();c.translate(0,this.camera);const metal=c.createLinearGradient(0,540,0,580);metal.addColorStop(0,'#e7fbff');metal.addColorStop(.3,'#164f97');metal.addColorStop(.6,'#9bcbed');metal.addColorStop(1,'#061c4b');c.fillStyle=metal;c.beginPath();c.ellipse(240,556,180,22,0,0,Math.PI*2);c.fill();c.strokeStyle='#7bffff';c.lineWidth=4;c.stroke();c.fillStyle='#0caaff55';c.beginPath();c.ellipse(240,550,126,12,0,0,Math.PI*2);c.fill();
    this.stack.forEach((b,i)=>{const sway=this.motion?Math.sin(this.time*2)*Math.min(2,i*.12):0;vial(c,b.x+sway,b.y,124,170,this.skin,this.failure?Math.min(.8,this.failure*(i%2?.45:-.45)):0,this.skin===0);});
    const top=this.stack.at(-1);if(!this.ended){const active=this.drop||{x:this.x,y:Math.max(95-this.camera,top.y-TOWER_DROP)};c.strokeStyle='#98ffff';c.setLineDash([5,7]);c.beginPath();c.moveTo(active.x,active.y+68);c.lineTo(active.x,top.y-65);c.stroke();c.setLineDash([]);vial(c,active.x,active.y,124,170,this.skin,this.failure?this.failure*.6:0,this.skin===0);}
    c.restore();if(this.stack.length===1&&!this.drop){c.font='700 15px Inter';c.textAlign='center';c.fillStyle='#ffffff';c.fillText('Line it up. Tap to drop.',240,180);} }
}
export class MergeEngine extends CanvasEngine {
  constructor(canvas,callbacks,options){super(canvas,callbacks,options);this.bodies=[];this.score=0;this.merges=0;this.highest=0;this.x=240;this.next=0;this.preview=1;this.cooldown=0;this.danger=0;this.chain=0;this.lastMerge=0;this.onMove=e=>{this.x=Math.max(MERGE_LEFT+MERGE_RADII[this.next],Math.min(MERGE_RIGHT-MERGE_RADII[this.next],this.pointer(e)));};this.onDown=e=>{this.onMove(e);this.dragging=true;canvas.setPointerCapture?.(e.pointerId);};this.onUp=e=>{if(this.dragging){this.onMove(e);this.action();}this.dragging=false;};this.onCancel=()=>{this.dragging=false;};canvas.addEventListener('pointermove',this.onMove);canvas.addEventListener('pointerdown',this.onDown);canvas.addEventListener('pointerup',this.onUp);canvas.addEventListener('pointercancel',this.onCancel);this.cb.hud(0,1,'1');}
  move(direction){this.x=Math.max(MERGE_LEFT+MERGE_RADII[this.next],Math.min(MERGE_RIGHT-MERGE_RADII[this.next],this.x+direction*18));}
  action(){if(this.paused||this.ended||this.cooldown>0)return;const r=MERGE_RADII[this.next];this.bodies.push({x:Math.max(MERGE_LEFT+r,Math.min(MERGE_RIGHT-r,this.x)),y:74,r,tier:this.next,vx:(Math.random()-.5)*22,vy:0,age:0});this.next=this.preview;this.preview=Math.floor(Math.random()*Math.min(5,3+Math.floor((this.level-1)/8)));this.cooldown=.65;this.cb.ready?.(false);this.cb.sound('drop');this.cb.message('Match two of the same colour and number.');}
  update(dt){const previousCooldown=this.cooldown;this.cooldown=Math.max(0,this.cooldown-dt);if(previousCooldown>0&&this.cooldown===0)this.cb.ready?.(true);
    // Fixed substeps and several contact passes keep the pile stable on slow frames.
    const step=dt/3;for(let sub=0;sub<3;sub++){
      for(const b of this.bodies){b.age+=step;b.vy+=460*step;b.x+=b.vx*step;b.y+=b.vy*step;b.vx*=.995;if(b.x-b.r<MERGE_LEFT){b.x=MERGE_LEFT+b.r;b.vx=Math.abs(b.vx)*.25;}if(b.x+b.r>MERGE_RIGHT){b.x=MERGE_RIGHT-b.r;b.vx=-Math.abs(b.vx)*.25;}if(b.y+b.r>MERGE_FLOOR){b.y=MERGE_FLOOR-b.r;b.vy=-Math.abs(b.vy)*.12;b.vx*=.94;if(Math.abs(b.vy)<5)b.vy=0;}}
      for(let pass=0;pass<4;pass++)for(let i=0;i<this.bodies.length;i++)for(let j=i+1;j<this.bodies.length;j++){
        const a=this.bodies[i],b=this.bodies[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),over=a.r+b.r-d;if(over<=0)continue;
        const merged=mergePair(a,b);if(merged){this.bodies.splice(j,1);this.bodies.splice(i,1,merged);this.merges++;this.highest=Math.max(this.highest,merged.tier);this.chain=this.time-this.lastMerge<1.4?this.chain+1:1;this.lastMerge=this.time;this.score+=2**(merged.tier+1)*25;this.cb.hud(this.score,this.highest+1,this.chain>1?`${this.chain}×`:'1');this.cb.message(this.chain>1?`${this.chain}× chain reaction!`:`Lovely merge. Tier ${merged.tier+1}!`);this.cb.sound('merge');this.cb.effect?.(this.chain>1?`${this.chain}× CHAIN!`:'MERGED!','merge');this.cb.progress?.({merges:this.merges});this.burst(merged.x,merged.y,COLORS[merged.tier]);if(merged.tier===5)this.cb.topTier();break;}
        if(d<.001){dx=1;dy=0;d=1;}const nx=dx/d,ny=dy/d,ma=a.r*a.r,mb=b.r*b.r,weight=ma+mb;a.x-=nx*over*mb/weight;a.y-=ny*over*mb/weight;b.x+=nx*over*ma/weight;b.y+=ny*over*ma/weight;
        const velocity=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;if(velocity<0){const impulse=-(1.05)*velocity/(1/ma+1/mb);a.vx-=impulse*nx/ma;a.vy-=impulse*ny/ma;b.vx+=impulse*nx/mb;b.vy+=impulse*ny/mb;}
      }
    }
    const overflow=this.bodies.some(b=>b.age>1.8&&b.y-b.r<174&&Math.abs(b.vy)<45);this.danger=overflow?this.danger+dt:Math.max(0,this.danger-dt*2);if(this.danger>0)this.cb.message('Getting full — merge below the dotted line.');if(this.danger>2)this.finish();
  }
  finish(){this.end({score:this.score,merges:this.merges,tier:this.highest+1});}
  draw(){const c=this.ctx;labBackdrop(c);
    if(chamber.complete&&chamber.naturalWidth)c.drawImage(chamber,12,72,456,490);
    c.setLineDash([7,7]);c.strokeStyle=this.danger>0?'#ff7088':'#72eaff88';c.lineWidth=2;c.beginPath();c.moveTo(MERGE_LEFT,174);c.lineTo(MERGE_RIGHT,174);c.stroke();c.setLineDash([]);
    for(const b of this.bodies)this.drawOrb(b.x,b.y,b.r,b.tier,Math.max(-.35,Math.min(.35,b.vx*.004)));
    if(!this.ended){const r=MERGE_RADII[this.next];c.strokeStyle='#8ffbff';c.setLineDash([4,6]);c.beginPath();c.moveTo(this.x,92);c.lineTo(this.x,525);c.stroke();c.setLineDash([]);this.drawOrb(this.x,64,r,this.next);c.fillStyle='#031d5dd9';c.beginPath();c.roundRect(390,10,64,89,14);c.fill();c.strokeStyle='#8eefff';c.lineWidth=2;c.stroke();c.textAlign='center';c.fillStyle='#ffffff';c.font='800 11px Inter';c.fillText('NEXT',422,28);this.drawOrb(422,62,23,this.preview);}
  }
  drawOrb(x,y,r,tier,rotation=0){const c=this.ctx;c.save();c.shadowColor='#00c9ff66';c.shadowBlur=8;vial(c,x,y,r*1.65,r*2.08,tier,rotation,true);c.shadowBlur=0;c.fillStyle='#062359';c.beginPath();c.arc(x+r*.65,y+r*.6,10,0,Math.PI*2);c.fill();c.strokeStyle='#c3fbff';c.lineWidth=1.5;c.stroke();c.fillStyle='#fff';c.font='800 11px Inter';c.textAlign='center';c.fillText(String(tier+1),x+r*.65,y+r*.6+4);c.restore();}
}
