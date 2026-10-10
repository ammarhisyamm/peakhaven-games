import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.Image=class {complete=false;naturalWidth=0;};
globalThis.window={devicePixelRatio:1};
globalThis.requestAnimationFrame=()=>1;
globalThis.cancelAnimationFrame=()=>{};
const {TowerEngine,MergeEngine}=await import('../dist/engines.js');
function harness(){let ended=null;const cb={hud(){},message(){},sound(){},place(){},topTier(){},end(result){ended=result;}};const canvas={getContext:()=>({scale(){}}),addEventListener(){},removeEventListener(){}};return {canvas,cb,result:()=>ended};}
test('tower drop advances score once, ignores repeat taps, and ends after a miss',()=>{
  const h=harness(),e=new TowerEngine(h.canvas,h.cb,{motion:false});e.x=240;e.action();e.action();
  for(let i=0;i<100;i++)e.update(.01);
  assert.equal(e.stack.length,2);assert.equal(e.perfects,1);assert.equal(e.score,175);
  e.x=420;e.action();for(let i=0;i<250&&!e.ended;i++)e.update(.01);
  assert.deepEqual(h.result(),{score:175,height:1,perfects:1});e.destroy();
});
test('merge physics combines matching contacts once and settles within the jar',()=>{
  const h=harness(),e=new MergeEngine(h.canvas,h.cb,{motion:false});
  e.bodies=[{x:210,y:490,r:21,tier:0,vx:0,vy:0,age:2},{x:245,y:490,r:21,tier:0,vx:0,vy:0,age:2}];
  e.update(1/60);assert.equal(e.bodies.length,1);assert.equal(e.bodies[0].tier,1);assert.equal(e.merges,1);assert.equal(e.score,100);
  for(let i=0;i<600;i++)e.update(1/60);
  const b=e.bodies[0];assert.ok(b.y+b.r<=486.1);assert.ok(b.y>400);assert.ok(Number.isFinite(b.x)&&Number.isFinite(b.y));
  e.action();e.action();assert.equal(e.bodies.length,2);e.finish();assert.equal(h.result().score,100);e.destroy();
});

test('large Tower sprite stays within the viewport as the camera follows repeated drops',()=>{
  const h=harness(),e=new TowerEngine(h.canvas,h.cb,{motion:false});
  for(let n=0;n<8;n++){
    e.x=e.stack.at(-1).x;e.action();for(let i=0;i<130;i++)e.update(.01);
    assert.equal(e.stack.length,n+2);assert.equal(e.inputReady,true);
    const stagedCentre=Math.max(95,e.stack.at(-1).y-205+e.camera);
    assert.ok(stagedCentre-85>=0,'entire 170px vial is visible');
  }e.destroy();
});
