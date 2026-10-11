import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window={devicePixelRatio:1};
globalThis.requestAnimationFrame=()=>1;
globalThis.cancelAnimationFrame=()=>{};
const {OrbitEngine,RidgeEngine,BondEngine,SequenceEngine}=await import('../dist/tryout-games.js');
const {sequenceTarget}=await import('../dist/sequence-rules.js');

function harness(){
  let result=null;const messages=[];
  const cb={hud(){},sound(){},ready(){},effect(){},message(text){messages.push(text);},end(value){result=value;}};
  const canvas={width:0,height:0,getContext:()=>({scale(){},clearRect(){}}),addEventListener(){},removeEventListener(){},getBoundingClientRect:()=>({left:0,top:0,width:480,height:580})};
  return {canvas,cb,result:()=>result,messages};
}

test('Orbit awards a safe attachment and ends on a collision',()=>{
  const h=harness(),game=new OrbitEngine(h.canvas,h.cb,{motion:false});
  game.pins=[];game.action();game.update(.47);
  assert.equal(game.score,10);assert.equal(game.pins.length,1);assert.ok(game.angularSpeed>.32);
  game.finish();assert.deepEqual(h.result(),{score:10,orbits:10});game.destroy();
});

test('Ridge Run tightens its gate course and reports a fall',()=>{
  const h=harness(),game=new RidgeEngine(h.canvas,h.cb,{motion:false});
  game.score=20;game.action();game.update(.01);
  assert.equal(game.speed,212);
  game.y=70;game.update(.02);
  assert.deepEqual(h.result(),{score:20,gates:20});game.destroy();
});

test('Bond awards clean placements while retaining the one-hit fail state',()=>{
  const h=harness(),game=new BondEngine(h.canvas,h.cb,{motion:false});
  game.pins=[];game.action();game.update(.37);
  assert.equal(game.score,100);assert.equal(game.pins.length,1);assert.ok(game.speed>.5);
  game.finish();assert.deepEqual(h.result(),{score:100,bonds:100});game.destroy();
});

test('Sequence counts one move, reaches its level goal, and unlocks through the puzzle result',()=>{
  const h=harness(),game=new SequenceEngine(h.canvas,h.cb,{motion:false,level:3});
  game.board.fill(1);game.board[0]=0;game.board[1]=1;game.board[2]=0;game.board[8]=0;game.target=100;
  game.choose(1);game.choose(1,8);
  assert.equal(game.moves,24);assert.ok(game.score>=100);
  assert.deepEqual(h.result(),{score:game.score,moves:1,won:true});
  assert.ok(sequenceTarget(4)>sequenceTarget(3));game.destroy();
});
