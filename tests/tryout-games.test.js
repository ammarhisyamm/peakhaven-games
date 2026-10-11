import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window={devicePixelRatio:1};
globalThis.requestAnimationFrame=()=>1;
globalThis.cancelAnimationFrame=()=>{};
const {OrbitEngine,RidgeEngine,BondEngine,SequenceEngine}=await import('../dist/tryout-games.js');
const {sequenceTarget}=await import('../dist/sequence-rules.js');
const {crossesHoop,orbitVelocity}=await import('../dist/orbit-rules.js');

function harness(width=480,height=720){
 let result=null;const messages=[],events=new Map(),sounds=[];const transform=[];
 const cb={hud(){},sound(v){sounds.push(v);},ready(){},effect(){},message(text){messages.push(text);},end(value){result=value;}};
 const canvas={width:0,height:0,getContext:()=>({setTransform(...v){transform.push(v);},clearRect(){}}),addEventListener(n,f){events.set(n,f);},removeEventListener(n){events.delete(n);},getBoundingClientRect:()=>({left:0,top:0,width,height})};
 return {canvas,cb,result:()=>result,messages,events,sounds,transform};
}
function tick(game,duration){for(let t=0;t<duration&&!game.ended;t+=.01){game.time+=.01;game.update(.01);}}

test('Orbit pull and release follows a ballistic arc into the hoop from above',()=>{
 const h=harness(),game=new OrbitEngine(h.canvas,h.cb,{motion:false}),a=game.anchor();
 h.events.get('pointerdown')({clientX:a.x,clientY:a.y,pointerId:1});
 h.events.get('pointermove')({clientX:a.x,clientY:a.y+80});
 assert.equal(game.ball,null,'aiming does not launch');
 h.events.get('pointerup')({clientX:a.x,clientY:a.y+80});
 assert.ok(game.ball.vy<0);assert.equal(game.ball.vx,0);tick(game,3);
 assert.equal(game.hits,1);assert.equal(game.score,125);assert.equal(game.lives,3);assert.ok(h.sounds.includes('swish'));
 game.finish();assert.deepEqual(h.result(),{score:125,orbits:1});game.destroy();assert.equal(h.events.size,0);
});

test('Orbit misses consume three chances and paused input cannot fire',()=>{
 const h=harness(),game=new OrbitEngine(h.canvas,h.cb,{motion:false});game.pause();game.action();assert.equal(game.ball,null);game.pause(false);
 for(let i=0;i<3;i++){game.cooldown=0;game.pull={x:140,y:100};game.action();tick(game,4);}
 assert.equal(game.lives,0);assert.deepEqual(h.result(),{score:0,orbits:0});game.destroy();
});

test('Hoop detection rejects upward, outside and below-rim crossings',()=>{
 const hoop={x:100,y:200,radius:40};assert.equal(crossesHoop({x:100,y:190},{x:100,y:210,vy:100},hoop),true);
 assert.equal(crossesHoop({x:100,y:210},{x:100,y:190,vy:-100},hoop),false);
 assert.equal(crossesHoop({x:150,y:190},{x:150,y:210,vy:100},hoop),false);
 assert.equal(crossesHoop({x:100,y:210},{x:100,y:230,vy:100},hoop),false);
 assert.ok(orbitVelocity({x:0,y:120},300).vy<orbitVelocity({x:0,y:30},300).vy);
});

test('Canvas sizing keeps uniform scale and maps pointer positions at mobile and landscape sizes',()=>{
 for(const [width,height] of [[320,568],[390,844],[844,390],[1280,800]]){
  const h=harness(width,height),game=new SequenceEngine(h.canvas,h.cb,{motion:false});const t=h.transform.at(-1);assert.equal(t[0],t[3]);assert.equal(h.canvas.width,width);assert.equal(h.canvas.height,height);
  const g=game.geometry(),x=(g.x+g.cell*.5)*game.scale,y=(g.y+g.cell*.5)*game.scale;assert.equal(game.cellAt(...game.pointer({clientX:x,clientY:y})),0);assert.ok((g.y+g.size)*game.scale<=height-48);game.destroy();
 }
});

test('Ridge Run tightens its gate course and reports a fall',()=>{
 const h=harness(),game=new RidgeEngine(h.canvas,h.cb,{motion:false});const initial=game.gap;game.score=20;game.action();game.update(.01);assert.equal(game.speed,212);assert.ok(game.gap<initial);
 game.y=70;game.vy=0;game.update(.02);assert.equal(h.result(),null,'no invisible ceiling below the screen edge');game.y=20;game.update(.02);assert.deepEqual(h.result(),{score:20,gates:20});game.destroy();
});

test('Ridge bottles fill both screen edges and a gate keeps its original opening',()=>{
 const h=harness(390,844),game=new RidgeEngine(h.canvas,h.cb,{motion:false});game.action();tick(game,.02);const gate=game.gates[0],gap=gate.gap;game.score=40;
 const s=game.gateSegments(gate);assert.equal(s.bottom-s.top,gap);assert.equal(game.floor,game.h);assert.ok(s.top>0&&s.bottom<game.h);game.y=game.h-20;game.vy=0;tick(game,.02);assert.ok(h.result());game.destroy();
});

test('Bond awards clean placements and ends once on a occupied gap',()=>{
 const h=harness(),game=new BondEngine(h.canvas,h.cb,{motion:false});game.pins=[];game.action();game.update(.37);assert.equal(game.score,100);assert.equal(game.bonds,1);assert.ok(game.speed>.5);
 game.pins=Array.from({length:100},(_,i)=>i*Math.PI*2/100);game.cooldown=0;game.action();game.update(.37);assert.deepEqual(h.result(),{score:100,bonds:1});game.destroy();
});

test('Bond accepts a second fast tap while the first vial is still in flight',()=>{
 const h=harness(),game=new BondEngine(h.canvas,h.cb,{motion:false});game.pins=[];game.action();tick(game,.07);game.action();assert.equal(game.flights.length,2);assert.equal(h.sounds.filter(s=>s==='launch').length,2);
 tick(game,.06);assert.equal(game.bonds,1,'first impact occurs after 120ms');assert.equal(game.flights.length,1);game.pause();game.action();assert.equal(game.flights.length,1,'pause blocks new shots');game.destroy();
});

test('Bond starts with a clear lane and supports two well-timed rapid throws',()=>{
 const h=harness(),game=new BondEngine(h.canvas,h.cb,{motion:false});game.action();tick(game,.12);assert.equal(game.bonds,1);game.action();tick(game,.12);assert.equal(game.bonds,2);assert.equal(game.score,200);assert.equal(h.result(),null);game.destroy();
});

test('Sequence animates any neighbour swap back without spending a move if it makes no match',()=>{
 const h=harness(),game=new SequenceEngine(h.canvas,h.cb,{motion:true});game.board=Array.from({length:49},(_,i)=>(i%7+Math.floor(i/7))%4);const original=game.board.slice();
 for(const [from,to] of [[24,23],[24,25],[24,17],[24,31]]){game.choose(from,to);assert.equal(game.phase,'swap');assert.equal(game.moves,25);tick(game,.17);assert.equal(game.phase,'return');assert.notDeepEqual(game.board,original);game.choose(0,1);assert.equal(game.phase,'return','return animation locks duplicate input');tick(game,.17);assert.deepEqual(game.board,original);assert.equal(game.moves,25);assert.equal(game.score,0);assert.equal(game.pending,0);}
 assert.ok(h.messages.includes('Try another pair. No move used.'));game.destroy();
});

test('Sequence long swipes choose one adjacent crystal and cancel never exchanges the board',()=>{
 const h=harness(),game=new SequenceEngine(h.canvas,h.cb,{motion:true}),g=game.geometry(),x=g.x+g.cell*3.5,y=g.y+g.cell*3.5;
 h.events.get('pointerdown')({clientX:x,clientY:y,pointerId:1});h.events.get('pointerup')({clientX:x+g.cell*2.4,clientY:y});assert.equal(game.swap.from,24);assert.equal(game.swap.to,25);
 tick(game,1);const original=game.board.slice();h.events.get('pointerdown')({clientX:x,clientY:y,pointerId:1});h.events.get('pointercancel')();h.events.get('pointerup')({clientX:x-g.cell,clientY:y});assert.deepEqual(game.board,original);game.destroy();
});

test('Sequence resolves one animated swap and settles before returning the winning result',()=>{
 const h=harness(),game=new SequenceEngine(h.canvas,h.cb,{motion:true,level:3});
 game.board.fill(1);game.board[0]=0;game.board[1]=1;game.board[2]=0;game.board[8]=0;game.target=100;game.motion=false;
 game.choose(1,8);assert.equal(game.moves,24);assert.equal(h.result(),null);game.choose(0,1);assert.equal(game.moves,24,'pending swap locks duplicate input');tick(game,.1);
 assert.ok(game.score>=100);assert.equal(game.board.some(v=>v<0),false,'board settles before completion');assert.deepEqual(h.result(),{score:game.score,moves:1,won:true});assert.ok(sequenceTarget(4)>sequenceTarget(3));game.destroy();
});
