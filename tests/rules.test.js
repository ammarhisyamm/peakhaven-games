import test from 'node:test';
import assert from 'node:assert/strict';
import {pour,canPour,isSolved,createPuzzle,findHint,towerPlacement,mergePair} from '../dist/rules.js';
test('sort only transfers a matching top run and respects capacity',()=>{
  assert.deepEqual(pour([[0,1,1],[1,1,1],[]],0,1),[[0,1],[1,1,1,1],[]]);
  assert.equal(pour([[0],[1]],0,1),null);
  assert.equal(canPour([[0],[0,0,0,0]],0,1),false);
  assert.equal(isSolved([[0,0,0,0],[]]),true);
  assert.equal(isSolved([[0],[0,0,0],[]]),false);
});
test('generated levels conserve four units per colour and have a usable solution',()=>{
  let seed=420;const random=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
  for(const level of [1,2,4,6,8,10]){
    let tubes=createPuzzle(level,random),moves=0;
    assert.ok(!isSolved(tubes));
    for(const c of new Set(tubes.flat()))assert.equal(tubes.flat().filter(x=>x===c).length,4);
    while(!isSolved(tubes)&&moves<100){const hint=findHint(tubes,200000);assert.ok(hint,`No hint for level ${level}, move ${moves}`);tubes=pour(tubes,...hint);moves++;}
    assert.ok(isSolved(tubes),`Level ${level} not solved`);
  }
});
test('tower supports centred drops and rejects missed supports',()=>{
  assert.equal(towerPlacement(240,244).perfect,true);
  assert.equal(towerPlacement(240,269).safe,true);
  assert.equal(towerPlacement(240,310).safe,false);
});
test('merge only combines equal non-final tiers and increases size',()=>{
  const a={x:100,y:200,vx:0,vy:5,tier:2,r:32},b={...a,x:140};
  const merged=mergePair(a,b);assert.equal(merged.tier,3);assert.equal(merged.x,120);assert.ok(merged.r>a.r);
  assert.equal(mergePair(a,{...b,tier:3}),null);
  assert.equal(mergePair({...a,tier:5},{...b,tier:5}),null);
});
